"""WP5: двусторонний обмен с Bitrix24 — то, что дороже всего чинить постфактум.

Проверяем не «работает ли», а три конкретные катастрофы:
  1) эхо-петля: наш push → ONTASKUPDATE → мы снова пишем → снова push → …
  2) массовая деактивация людей из-за частичной выборки (таймаут на 3-й странице);
  3) утечка токена вебхука в журнал синхронизации, который показывается в UI.
"""
import asyncio
import urllib.parse

from fastapi.testclient import TestClient

import bitrix_routes
import main

client = TestClient(main.app)


def _webhook(bx_id: int, status: str, token: str = "") -> dict:
    body = {"event": "ONTASKUPDATE", "data[FIELDS_AFTER][ID]": str(bx_id),
            "data[FIELDS_AFTER][STATUS]": status}
    if token:
        body["auth[application_token]"] = token
    r = client.post("/webhooks/bitrix24", content=urllib.parse.urlencode(body),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200
    return r.json()


# ── 1. Эхо-петля ────────────────────────────────────────────────────────────────

def test_webhook_skips_when_status_already_ours(monkeypatch):
    """Первый рубеж: Bitrix сообщает статус, который у нас уже стоит → писать нечего.
    Это и есть основной механизм, убивающий эхо от собственного push'а."""
    writes = []

    async def _by_bx(bid):
        return {"id": 10, "project_id": 5, "status": "in_progress", "bx_status": None}

    async def _must_not_write(tid, fields):
        writes.append(fields)

    monkeypatch.setattr(main.db, "task_by_bitrix", _by_bx)
    monkeypatch.setattr(main.db, "update_task", _must_not_write)
    out = _webhook(777, "3")               # 3 = «Выполняется» = наш in_progress
    assert out.get("skipped")
    assert writes == []


def test_webhook_skips_own_echo_when_mapping_is_lossy(monkeypatch):
    """Второй рубеж — без него эхо прорывается. Маппинг НЕ биекция: «отменена» и on_hold
    оба уезжают в Bitrix как «Отложена» (6). Задача отменена, мы сами положили в Bitrix 6;
    прилетает эхо с 6 → по маппингу это on_hold ≠ cancelled, и первый рубеж молчит.
    Спасает метка bx_status: код в Bitrix ровно тот, что мы туда и положили."""
    writes = []

    async def _by_bx(bid):
        return {"id": 10, "project_id": 5, "status": "cancelled", "bx_status": "6"}

    async def _must_not_write(tid, fields):
        writes.append(fields)

    monkeypatch.setattr(main.db, "task_by_bitrix", _by_bx)
    monkeypatch.setattr(main.db, "update_task", _must_not_write)
    out = _webhook(777, "6")
    assert out.get("skipped")
    assert writes == [], "эхо собственного push'а перезаписало бы «отменена» на «отложена»"


def test_webhook_accepts_real_human_change(monkeypatch):
    """А вот правку живого человека принять ОБЯЗАНЫ — защита не должна глушить всё подряд."""
    writes, marks = [], []

    async def _by_bx(bid):
        return {"id": 10, "project_id": 5, "status": "cancelled", "bx_status": "6"}

    async def _upd(tid, fields):
        writes.append(fields)

    async def _mark(tid, code):
        marks.append(code)

    async def _log(*a, **k):
        return None

    monkeypatch.setattr(main.db, "task_by_bitrix", _by_bx)
    monkeypatch.setattr(main.db, "update_task", _upd)
    monkeypatch.setattr(main.db, "set_task_bx_status", _mark)
    monkeypatch.setattr(main, "_bx_log", _log)
    out = _webhook(777, "3")               # человек вернул задачу в работу
    assert out.get("status") == "in_progress"
    assert writes == [{"status": "in_progress"}]
    assert marks == ["3"], "новый код Bitrix обязан быть запомнен, иначе следующее эхо не узнаем"


def test_deferred_is_on_hold_not_cancelled():
    """Код 6 в Bitrix — «Отложена». Раньше он маппился в cancelled, и отложенная задача
    приезжала в портал ОТМЕНЁННОЙ."""
    assert bitrix_routes.BX_STATUS_TO_OURS["6"] == "on_hold"


# ── 2. Массовая деактивация ─────────────────────────────────────────────────────

def test_empty_string_error_is_still_an_error():
    """Регресс-якорь: httpx-таймаут даёт ПУСТОЙ str(e). Прежний код проверял `if err:`, и
    пустая строка проходила как «ошибки нет». `_bx_safe_error` обязан вернуть непустой текст
    для исключения, иначе синк принял бы таймаут за успешный обход."""
    import httpx
    assert main._bx_safe_error(httpx.ConnectTimeout("")) == "ConnectTimeout"
    assert main._bx_safe_error("") == ""            # штатное «ошибки нет» (успешный вызов) не трогаем


def test_partial_fetch_never_deactivates(monkeypatch):
    """Сбой на второй странице = обход НЕ завершён. Ни один человек не уволен — иначе один
    таймаут «увольняет» всех, кто не попал в первую полусотню. Используем РЕАЛЬНЫЙ режим отказа:
    таймаут httpx с пустым текстом, прогнанный через настоящий bx_call → _bx_safe_error."""
    import httpx
    people = [{"id": "p1", "full_name": "Есть в Bitrix", "bitrix24_id": 1, "is_active": True},
              {"id": "p2", "full_name": "Не пришёл (страница 2)", "bitrix24_id": 2, "is_active": True}]
    saved = []

    async def _bx_call(method, payload=None):
        if (payload or {}).get("start"):
            return None, main._bx_safe_error(httpx.ConnectTimeout(""))   # реальный пустой таймаут
        return {"result": [{"ID": 1, "NAME": "Есть", "LAST_NAME": "в Bitrix"}], "next": 50}, ""

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aret(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(saved.append(ps)))
    monkeypatch.setattr(main, "USERS", {})
    rep = asyncio.run(main._sync_bitrix_people())

    assert rep["complete"] is False and rep["error"]
    assert rep["deactivated"] == 0
    assert people[1]["is_active"] is True, "человека уволили из-за сетевого сбоя"


def test_empty_full_crawl_deactivates_nobody(monkeypatch):
    """Bitrix отдал пустоту БЕЗ ошибки (слетели права/фильтр). Обход формально «полный», но
    fetched=0 — компания из живых людей не могла уволиться поголовно. Не трогаем никого."""
    people = [{"id": "p1", "full_name": "Живой", "bitrix24_id": 1, "is_active": True}]

    async def _bx_call(method, payload=None):
        return {"result": [], "next": None}, ""      # пусто, но без ошибки

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aret(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(None))
    monkeypatch.setattr(main, "USERS", {})
    rep = asyncio.run(main._sync_bitrix_people())

    assert rep["complete"] is True and rep["fetched"] == 0
    assert rep["deactivated"] == 0
    assert people[0]["is_active"] is True, "уволили всех из-за пустого ответа Bitrix"


def test_full_fetch_deactivates_only_bitrix_people(monkeypatch):
    """При полном обходе уволенный (его нет в выгрузке) деактивируется МЯГКО, а человек,
    заведённый руками (без bitrix24_id), не трогается: «нет в Bitrix» ≠ «уволен»."""
    people = [{"id": "p1", "full_name": "Уволен", "bitrix24_id": 2, "is_active": True},
              {"id": "p2", "full_name": "Заведён руками", "bitrix24_id": None, "is_active": True}]

    async def _bx_call(method, payload=None):
        return {"result": [{"ID": 1, "NAME": "Работает", "LAST_NAME": "Тут"}], "next": None}, ""

    async def _load():
        return people

    async def _save(ps):
        return None

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", _load)
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(None))
    monkeypatch.setattr(main, "USERS", {})
    rep = asyncio.run(main._sync_bitrix_people())

    assert rep["complete"] is True
    assert rep["deactivated"] == 1
    assert people[0]["is_active"] is False          # уволенный — мягко, не удалён
    assert people[1]["is_active"] is True           # ручной человек не тронут
    assert people[0].get("full_name") == "Уволен"   # историю исполнителей не режем


def test_sync_is_byte_idempotent(monkeypatch):
    """Ничего не изменилось в Bitrix → НЕ пишем вообще. Прежний импорт безусловно ставил
    updated_at, и ночная джоба каждую ночь двигала бы байты /persons — голден-гейт краснел бы."""
    people = [{"id": "p1", "first_name": "Ivan", "last_name": "Petrov", "full_name": "Ivan Petrov",
               "bitrix24_id": 1, "email": "i@example.com", "is_active": True, "updated_at": "СТАРОЕ"}]
    saved = []

    async def _bx_call(method, payload=None):
        return {"result": [{"ID": 1, "NAME": "Ivan", "LAST_NAME": "Petrov", "EMAIL": "i@example.com"}],
                "next": None}, ""

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aret(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(saved.append(ps)))
    monkeypatch.setattr(main, "USERS", {})
    rep = asyncio.run(main._sync_bitrix_people())

    assert (rep["imported"], rep["updated"]) == (0, 0)
    assert saved == [], "запись без изменений = ежедневный дрейф голденов"
    assert people[0]["updated_at"] == "СТАРОЕ"


def test_sync_links_person_id_onto_the_login(monkeypatch):
    """Связка обязана быть ДВУСТОРОННЕЙ. Синк издавна ставил только `p["user_id"]`, а обратную
    ссылку `u["person_id"]` не ставил никто, кроме разового migrate_identity. Логин, заведённый
    через POST /admin/users, приезжал с person_id=None — и `_my_task_match` сравнивал
    assignee_person_id задачи с пустотой (ранний return, без фолбэка на email/имя). РП молча
    видел пустые «Мои задачи» и пустой ICS."""
    people = [{"id": "p1", "first_name": "Ivan", "last_name": "Petrov", "full_name": "Ivan Petrov",
               "bitrix24_id": 1, "email": "i@example.com", "is_active": True}]
    users = {"i@example.com": {"id": "u1", "email": "i@example.com", "role": "pm"}}
    saved_users = []

    async def _bx_call(method, payload=None):
        return {"result": [{"ID": 1, "NAME": "Ivan", "LAST_NAME": "Petrov", "EMAIL": "i@example.com"}],
                "next": None}, ""

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aret(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(None))
    monkeypatch.setattr(main, "_save_users", lambda: _aret(saved_users.append(1)))
    monkeypatch.setattr(main, "USERS", users)
    rep = asyncio.run(main._sync_bitrix_people())

    assert people[0]["user_id"] == "u1", "прямая связь person→user (была и раньше)"
    assert users["i@example.com"]["person_id"] == "p1", "обратная связь user→person: без неё «Мои задачи» пусты"
    assert rep["person_linked"] == 1
    assert saved_users, "проставили person_id, но не сохранили логины"


def test_sync_person_link_is_byte_idempotent(monkeypatch):
    """Связка уже стоит с обеих сторон → синк не пишет НИЧЕГО. Иначе ночная джоба трогала бы
    users каждую ночь (инвариант «синк идемпотентен побайтово» из CLAUDE.md)."""
    people = [{"id": "p1", "first_name": "Ivan", "last_name": "Petrov", "full_name": "Ivan Petrov",
               "bitrix24_id": 1, "email": "i@example.com", "is_active": True, "user_id": "u1"}]
    users = {"i@example.com": {"id": "u1", "email": "i@example.com", "role": "pm",
                         "person_id": "p1", "bitrix24_user_id": 1}}
    saved_users, saved_persons = [], []

    async def _bx_call(method, payload=None):
        return {"result": [{"ID": 1, "NAME": "Ivan", "LAST_NAME": "Petrov", "EMAIL": "i@example.com"}],
                "next": None}, ""

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aret(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aret(saved_persons.append(ps)))
    monkeypatch.setattr(main, "_save_users", lambda: _aret(saved_users.append(1)))
    monkeypatch.setattr(main, "USERS", users)
    rep = asyncio.run(main._sync_bitrix_people())

    assert rep["person_linked"] == 0 and rep["linked"] == 0
    assert saved_users == [], "перезапись users без изменений = ночной дрейф"
    assert saved_persons == [], "перезапись persons без изменений = дрейф голденов"


async def _aret(v):
    return v


# ── 3. Утечка токена ────────────────────────────────────────────────────────────

def test_error_message_never_leaks_the_webhook_token(monkeypatch):
    """Токен вебхука — часть URL (…/rest/7001/<СЕКРЕТ>/method.json), а текст ошибки httpx
    содержит URL целиком. Этот журнал показывается в настройках, поэтому URL вырезаем."""
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://bitrix.example.com/rest/7001/s3cr3tt0ken")
    msg = main._bx_safe_error(
        "ConnectError: https://bitrix.example.com/rest/7001/s3cr3tt0ken/tasks.task.update.json failed")
    assert "s3cr3tt0ken" not in msg
    assert "<bitrix>" in msg

    # и если вебхук в этот момент вообще не настроен — режем по форме URL
    monkeypatch.setattr(main, "_bitrix_url", lambda: "")
    msg2 = main._bx_safe_error("timeout on https://other.bitrix24.ru/rest/7/aBcD9/user.get.json")
    assert "aBcD9" not in msg2


# ── 4. Исходящий push ───────────────────────────────────────────────────────────

def test_push_sends_only_changed_fields_and_keeps_code_prefix(monkeypatch):
    """Раньше связь была ОДНОСТОРОННЕЙ: задача уезжала в Bitrix при создании и больше
    не обновлялась никогда. Теперь шлём — но только изменившееся, и с тем же префиксом
    кода проекта, что при создании (иначе апдейт молча срезал бы «[PRJ-1]» из заголовка)."""
    sent, marks = [], []

    async def _bx_call(method, payload=None):
        sent.append((method, payload))
        return {"result": True}, ""

    async def _mark(tid, code):
        marks.append(code)

    async def _log(*a, **k):
        return None

    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main.db, "set_task_bx_status", _mark)
    monkeypatch.setattr(main, "_bx_log", _log)
    tk = {"title": "Новое имя", "status": "completed", "description": "d", "planned_end": "2026-08-01"}
    asyncio.run(main.bx_push_task("10", 777, "PRJ-1", tk, {"title", "status"}))

    assert len(sent) == 1
    method, payload = sent[0]
    assert method == "tasks.task.update" and payload["taskId"] == 777
    assert payload["fields"] == {"TITLE": "[PRJ-1] Новое имя", "STATUS": "5"}   # только изменённое
    assert "DESCRIPTION" not in payload["fields"] and "DEADLINE" not in payload["fields"]
    assert marks == ["5"], "код статуса обязан быть запомнен — на нём держится защита от эха"


def test_push_records_failure_in_sync_log(monkeypatch):
    """Отправка фоновая: пользователь о сбое Bitrix не узнает из ответа. Значит журнал —
    единственное место, где сбой виден. Молча терять его нельзя."""
    logged = []

    async def _bx_call(method, payload=None):
        return None, "QUERY_LIMIT_EXCEEDED"

    async def _log(action, status, error="", task_id=None, bx_task_id=None):
        logged.append((action, status, error))

    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_bx_log", _log)
    asyncio.run(main.bx_push_task("10", 777, "PRJ-1", {"title": "x", "status": "in_progress"}, {"title"}))
    assert logged == [("task.update", "error", "QUERY_LIMIT_EXCEEDED")]


# ── 5. Регрессы, найденные состязательным ревью релиза ───────────────────────────

def test_identity_does_not_wipe_email_when_person_has_none(monkeypatch):
    """Ревью-critical #1: у части сотрудников Bitrix email пустой. resolve по person_id не
    должен затирать уже стоявший на задаче assignee_email на None — иначе правка любого поля
    мигрированной задачи молча уничтожает адрес, и ломаются письма и RESPONSIBLE_ID в Bitrix."""
    async def _resolve(person_id=None, email=None, name=None):
        return {"person_id": "P", "full_name": "Иван Петров", "email": None}   # у person email пуст
    monkeypatch.setattr(main, "resolve_person", _resolve)
    out = asyncio.run(main._task_identity_fields(
        {"assignee_person_id": "P", "assignee_email": "i.petrov@example.com"}))
    assert out["assignee_email"] == "i.petrov@example.com", "адрес исполнителя стёрт на None"


def test_my_task_match_person_id_beats_namesake():
    """Ревью-#18: у задачи есть assignee_person_id → сопоставляем ТОЛЬКО по нему. Иначе откат
    на имя показал бы задачу тёзке (два «Ивана Петрова» — обычное дело)."""
    me = {"person_id": "P1", "full_name": "Иван Петров", "email": "ivan1@example.com"}
    namesake_task = {"assignee_person_id": "P2", "assignee_name": "Иван Петров"}
    assert main._my_task_match(me, namesake_task) is False   # person_id другой → не моя
    mine = {"assignee_person_id": "P1", "assignee_name": "Иван Петров"}
    assert main._my_task_match(me, mine) is True
    # легаси-задача без person_id — откат на имя работает
    legacy = {"assignee_name": "Иван Петров"}
    assert main._my_task_match(me, legacy) is True


# ── 6. PULL фактических дат ─────────────────────────────────────────────────────
# Жалоба владельца: задачу создали из портала, запустили в Bitrix (там появилось
# фактическое начало), нажали «Синхронизировать» — «Факт. начало» в портале осталось пустым.
# Причина: синк запрашивал у Bitrix только STATUS, а эхо-гард по статусу выбрасывал задачу целиком.


def _sync_headers(monkeypatch):
    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _run_sync(monkeypatch, task: dict, bx_task: dict):
    """Прогон одного цикла синка: одна наша задача, один ответ Bitrix. Возвращает записи в БД."""
    writes: list = []
    marks: list = []

    async def _tasks(pid):
        return [task]

    async def _bx_call(method, payload=None):
        return {"result": {"task": bx_task}}, ""

    async def _upd(tid, fields):
        writes.append((tid, fields))

    async def _mark(tid, raw):
        marks.append((tid, raw))

    async def _log(*a, **kw):
        return None

    async def _retry(pid, mut, attempts=4):
        return mut({})
    monkeypatch.setattr(main.db, "tasks_with_bitrix", _tasks)
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main.db, "update_task", _upd)
    monkeypatch.setattr(main.db, "set_task_bx_status", _mark)
    monkeypatch.setattr(main, "_bx_log", _log)
    monkeypatch.setattr(main, "with_meta_retry", _retry)
    monkeypatch.setattr(main, "load_meta", lambda pid, with_docs=True: _aret(({"id": pid}, {})))
    h = _sync_headers(monkeypatch)
    r = client.post("/projects/5/bitrix24/sync", params={"force": "true"}, headers=h)
    assert r.status_code == 200, r.text
    return writes, marks, r.json()["data"]


def test_pull_fills_actual_dates_from_bitrix(monkeypatch):
    """Случай владельца: задача не начата у нас, в Bitrix её запустили."""
    writes, _, data = _run_sync(
        monkeypatch,
        {"id": 7, "status": "not_started", "bx_status": None, "bitrix24_task_id": 777,
         "actual_start": None, "actual_end": None},
        {"id": "777", "status": "3", "dateStart": "2026-08-15T09:12:00+03:00", "closedDate": None})
    assert len(writes) == 1
    fields = writes[0][1]
    assert fields["status"] == "in_progress"
    assert fields["actual_start"] == "2026-08-15"      # календарный день Bitrix, без перевода в UTC
    assert "actual_end" not in fields
    assert data["updated"] == 1


def test_pull_dates_survive_status_echo_guard(monkeypatch):
    """Главная ловушка: статус в портале УЖЕ in_progress (эхо-гард срабатывает), а дата ещё пуста.
    Гард обязан висеть только на статусе — иначе дата не приедет никогда."""
    writes, marks, _ = _run_sync(
        monkeypatch,
        {"id": 7, "status": "in_progress", "bx_status": "3", "bitrix24_task_id": 777,
         "actual_start": None, "actual_end": None},
        {"id": "777", "status": "3", "dateStart": "2026-08-17T18:14:37+03:00", "closedDate": None})
    assert len(writes) == 1
    assert writes[0][1] == {"actual_start": "2026-08-17"}
    assert marks == [], "статус не менялся — метку bx_status трогать незачем"


def test_pull_never_blanks_a_fact_date(monkeypatch):
    """В Bitrix задачу не запускали (dateStart=null), а у нас дата вбита руками. Пустым не затираем
    и вообще не пишем: update_row бампает version, а синк ходит каждые 15 минут."""
    writes, _, data = _run_sync(
        monkeypatch,
        {"id": 7, "status": "not_started", "bx_status": "2", "bitrix24_task_id": 777,
         "actual_start": "2026-08-01", "actual_end": None},
        {"id": "777", "status": "2", "dateStart": None, "closedDate": None})
    assert writes == []
    assert data["updated"] == 0


def test_pull_is_idempotent_on_unchanged_dates(monkeypatch):
    """Даты и статус совпадают — записи быть не должно (иначе version-дрейф и ложные 409)."""
    writes, _, data = _run_sync(
        monkeypatch,
        {"id": 7, "status": "in_progress", "bx_status": "3", "bitrix24_task_id": 777,
         "actual_start": "2026-08-15", "actual_end": None},
        {"id": "777", "status": "3", "dateStart": "2026-08-15T09:12:00+03:00", "closedDate": None})
    assert writes == [] and data["updated"] == 0


def test_pull_closed_date_lands_in_actual_end(monkeypatch):
    """Задачу завершили в Bitrix: статус, прогресс и фактическое завершение — ОДНОЙ записью."""
    writes, marks, _ = _run_sync(
        monkeypatch,
        {"id": 7, "status": "in_progress", "bx_status": "3", "bitrix24_task_id": 777,
         "actual_start": "2026-08-15", "actual_end": None},
        {"id": "777", "status": "5", "dateStart": "2026-08-15T09:12:00+03:00",
         "closedDate": "2026-08-20T16:40:00+03:00"})
    assert len(writes) == 1
    fields = writes[0][1]
    assert fields["status"] == "completed" and fields["progress"] == 100
    assert fields["actual_end"] == "2026-08-20"
    assert marks == [(str(7), "5")]


def test_pull_status_4_gets_actual_end_fallback(monkeypatch):
    """«Ожидает контроля» мы считаем завершением, но closedDate Bitrix ставит только при
    «Завершена». Без фолбэка задача приезжала бы завершённой с пустым «Факт. конец»."""
    writes, _, _ = _run_sync(
        monkeypatch,
        {"id": 7, "status": "in_progress", "bx_status": "3", "bitrix24_task_id": 777,
         "actual_start": "2026-08-15", "actual_end": None},
        {"id": "777", "status": "4", "dateStart": "2026-08-15T09:12:00+03:00", "closedDate": None})
    fields = writes[0][1]
    assert fields["status"] == "completed"
    assert fields["actual_end"] == main._now_iso()[:10]


def test_bx_date_parses_without_timezone_shift():
    """Календарный день берём как прислали. Перевод в UTC отправил бы задачу, начатую в 00:30
    по Риге, во вчерашний день."""
    assert main._bx_date("2026-08-17T00:30:00+03:00") == "2026-08-17"
    assert main._bx_date("17.08.2026 10:30:00") == "2026-08-17"
    assert main._bx_date(None) is None
    assert main._bx_date("") is None
    assert main._bx_date("скоро") is None
