"""Связка «протокол ↔ событие календаря Bitrix» — в обе стороны.

Симптом: событие совещания удалили в Bitrix, а в портале осталась отметка
«✓ Bitrix», и кнопка «Синхронизировать» её не убирала. Разбор показал, что связка была
односторонней и одноразовой:

  • синхронизация проекта трогала ТОЛЬКО задачи и о совещаниях не знала вовсе;
  • попытка отвязать вручную била в `calendar.event.delete` по несуществующему событию, получала
    ошибку и падала с 502 — ДО того, как снять отметку. Человек застревал: ни отвязать, ни создать
    заново (кнопка создания прячется, пока стоит отметка);
  • удаление события шло от имени НАЖАВШЕГО, хотя событие живёт в календаре создателя;
  • удаление совещания в портале оставляло событие в Bitrix навсегда — и без ссылки на него;
  • `bx_add_calendar_event` на неразобранный id возвращал «успех без id»: маршрут отвечал 502,
    а событие в календаре оставалось сиротой.

Здесь проверяется каждая из этих пяти вещей, и главное — правило «отвязываем только при
успешном ответе Bitrix»: молчание внешней системы не повод стирать связку с живым событием.
"""
import asyncio

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
HDR = {"Authorization": "Bearer x"}


def _meta(meetings):
    return {"pm_id": "o1", "_meetings": meetings, "_pending_action_log": []}


def _wire(monkeypatch, meta, *, user=None, calls=None, delete_result=("ok",)):
    """Общая обвязка: мета в памяти, пользователь-владелец, Bitrix настроен."""
    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)

    async def fake_cu(auth):
        return user or {"id": "o1", "full_name": "Owner", "role": "owner", "bitrix24_user_id": 7001}

    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "current_user", fake_cu)
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    if calls is not None:
        monkeypatch.setattr(main, "bx_call", calls)


def _events_call(events_by_owner, log=None, error=""):
    """Фейковый bx_call: calendar.event.get отдаёт события владельца, delete — успех."""
    async def _call(method, payload=None):
        if log is not None:
            log.append((method, dict(payload or {})))
        if method == "calendar.event.get":
            if error:
                return None, error
            owner = int((payload or {}).get("ownerId") or 0)
            return {"result": [{"ID": str(i)} for i in events_by_owner.get(owner, [])]}, ""
        if method == "calendar.event.delete":
            return {"result": True}, ""
        return {"result": []}, ""
    return _call


# ── сверка: что синхронизация замечает, а что нет ──────────────────────────────

def test_reconcile_leaves_live_event_alone(monkeypatch):
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])
    _wire(monkeypatch, meta, calls=_events_call({7001: [999]}))
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["checked"] == 1 and rep["gone"] == []


def test_reconcile_reports_event_deleted_in_bitrix(monkeypatch):
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])
    _wire(monkeypatch, meta, calls=_events_call({7001: [111]}))   # 999 в календаре нет
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["gone"] == ["m1"]


def test_reconcile_unlinks_nothing_when_bitrix_is_silent(monkeypatch):
    """САМОЕ ВАЖНОЕ правило. Таймаут и отказ в правах неотличимы от «событий нет» по составу
    ответа, но означают ровно противоположное. Стереть связку на живом событии хуже, чем
    пропустить удаление: следующее «Создать в Bitrix» позвало бы всех участников второй раз."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])
    _wire(monkeypatch, meta, calls=_events_call({}, error="ConnectTimeout"))
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["gone"] == [] and rep["checked"] == 0


def test_reconcile_asks_bitrix_once_per_calendar(monkeypatch):
    """У проекта совещаний десятки, а календарь один: спрашиваем диапазоном, не по событию."""
    meta = _meta([{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 1, "bitrix_event_owner": 7001},
                  {"id": "m2", "meeting_date": "2026-11-18", "bitrix_event_id": 2, "bitrix_event_owner": 7001},
                  {"id": "m3", "meeting_date": "2026-11-20", "bitrix_event_id": 3, "bitrix_event_owner": 777}])
    log = []
    _wire(monkeypatch, meta, calls=_events_call({7001: [1, 2], 777: [3]}, log=log))
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    gets = [p for mth, p in log if mth == "calendar.event.get"]
    assert len(gets) == 2, gets                       # по одному на владельца, а не на совещание
    assert rep["checked"] == 3 and rep["gone"] == []
    win = next(p for p in gets if int(p["ownerId"]) == 7001)
    assert win["from"] <= "2026-11-04" and win["to"] >= "2026-11-18"   # окно накрыло оба


def test_reconcile_skips_meeting_with_no_known_calendar(monkeypatch):
    """Не у кого спросить — не наше дело гадать: связку не трогаем."""
    meta = {"_meetings": [{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 999}],
            "_pending_action_log": []}          # ни pm_id, ни владельца события
    _wire(monkeypatch, meta, calls=_events_call({}))
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["checked"] == 0 and rep["gone"] == []


def test_reconcile_backfills_owner_for_legacy_meeting(monkeypatch):
    """У событий, созданных до этой правки, владельца не записано. Нашли под РП — запомним,
    чтобы следующая сверка и удаление не гадали заново."""
    meta = _meta([{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 999}])
    _wire(monkeypatch, meta, calls=_events_call({7001: [999]}))
    monkeypatch.setattr(main, "_project_pm_bitrix_id", lambda m: 7001)
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["gone"] == [] and rep["backfill_owner"] == {"m1": 7001}


def test_reconcile_never_unlinks_when_the_calendar_was_only_GUESSED(monkeypatch):
    """Промах по УГАДАННОМУ календарю не доказывает ничего.

    У всех записей, созданных до этой правки, владельца нет, и его приходится угадывать: РП
    проекта, затем нажавший. Но создать событие вправе и со-РП, и руководитель портфеля — тогда
    оно лежит в ИХ календаре. Спросив календарь РП, мы получим честный пустой ответ, и приняли бы
    его за удаление живого события: связка стёрлась бы, а следующее «Создать в Bitrix» позвало бы
    всех участников вторым событием. Тот же путь массово срабатывал бы после передачи проекта.
    """
    meta = _meta([{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 999}])  # владельца нет
    _wire(monkeypatch, meta, calls=_events_call({7001: [], 777: [999]}))  # событие у со-РП 777
    monkeypatch.setattr(main, "_project_pm_bitrix_id", lambda m: 7001)   # спросим РП — там пусто
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["gone"] == [], "отвязали живое событие по промаху в чужом календаре"


def test_reconcile_unlinks_only_after_the_owner_became_known(monkeypatch):
    """Догадка лечится попаданием: первая сверка запоминает владельца, и лишь потом портал
    вправе судить об удалении. Проверяем обе половины подряд — это и есть весь жизненный цикл."""
    meta = _meta([{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 999}])
    _wire(monkeypatch, meta, calls=_events_call({7001: [999]}))
    monkeypatch.setattr(main, "_project_pm_bitrix_id", lambda m: 7001)
    rep1 = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep1["gone"] == [] and rep1["backfill_owner"] == {"m1": 7001}
    meta["_meetings"][0]["bitrix_event_owner"] = 7001      # синк записал владельца
    _wire(monkeypatch, meta, calls=_events_call({7001: []}))   # теперь событие удалили в Bitrix
    rep2 = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep2["gone"] == ["m1"]


def test_reconcile_finds_an_event_moved_inside_bitrix(monkeypatch):
    """Встречу могли перенести в самом Bitrix. `bitrix_event_from` — дата на момент СОЗДАНИЯ,
    поэтому узкое окно вернуло бы ответ без события, и перенос выглядел бы удалением."""
    meta = _meta([{"id": "m1", "meeting_date": "2026-11-04", "bitrix_event_id": 999,
                   "bitrix_event_owner": 7001, "bitrix_event_from": "2026-11-04 10:00:00"}])
    win = {}

    async def _call(method, payload=None):
        if method == "calendar.event.get":
            win.update(payload or {})
            return {"result": [{"ID": "999"}]}, ""
        return {"result": []}, ""
    _wire(monkeypatch, meta, calls=_call)
    rep = asyncio.run(main._reconcile_meeting_events("5", meta, {"id": "o1"}))
    assert rep["gone"] == []
    assert win["from"] <= "2026-09-01" and win["to"] >= "2027-01-01", f"окно слишком узкое: {win}"


def test_calendar_answer_of_unexpected_shape_is_not_an_empty_calendar(monkeypatch):
    """Не поняли ответ — значит не знаем. Пустой список здесь читался бы как «удалено ВСЁ»
    у этого владельца разом. Тот же урок, что у синка людей: при неполной выборке не трогаем никого."""
    async def _weird(method, payload=None):
        return {"result": {"5001": {"ID": "5001"}}}, ""      # словарь вместо списка

    async def _paged(method, payload=None):
        return {"result": [{"ID": "1"}], "next": 50}, ""     # ответ обрезан постраничностью
    monkeypatch.setattr(main, "bx_call", _weird)
    ids, err = asyncio.run(main.bx_calendar_event_ids(7001, "2026-01-01", "2026-12-31"))
    assert ids is None and err
    monkeypatch.setattr(main, "bx_call", _paged)
    ids2, err2 = asyncio.run(main.bx_calendar_event_ids(7001, "2026-01-01", "2026-12-31"))
    assert ids2 is None and err2


# ── синхронизация проекта ──────────────────────────────────────────────────────

def test_sync_unlinks_meeting_whose_event_is_gone(monkeypatch):
    """Тот самый симптом: «Синхронизировать» обязан убрать отметку с удалённого в Bitrix события."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _no_tasks(pid):
        return []
    _wire(monkeypatch, meta, calls=_events_call({7001: []}))
    monkeypatch.setattr(main.db, "tasks_with_bitrix", _no_tasks)

    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    r = client.post("/projects/5/bitrix24/sync?force=true", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["meetings_checked"] == 1 and d["meetings_unlinked"] == 1
    assert "bitrix_event_id" not in meta["_meetings"][0]
    log = meta.get("_pending_action_log") or meta.get("_action_log") or []
    assert any(a.get("action") == "meetings.bitrix_event_gone" for a in log), log


def test_sync_throttled_answer_keeps_the_same_shape(monkeypatch):
    """Форма ответа не должна плясать: фронт читает meetings_unlinked всегда."""
    meta = {"bitrix_last_sync": main._now_iso(), "_meetings": []}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.post("/projects/5/bitrix24/sync", headers={"Authorization": f"Bearer {tok}"}).json()["data"]
    assert d["skipped"] == "throttled"
    assert d["meetings_checked"] == 0 and d["meetings_unlinked"] == 0


# ── отвязка вручную ────────────────────────────────────────────────────────────

def test_delete_helper_treats_missing_event_as_done(monkeypatch):
    """Свойство самого помощника, отдельно от маршрута: «события нет» — это выполненная цель.

    Маршрут выше подстрахован ещё и проверкой диапазоном, поэтому без ЭТОГО теста откат
    поведения в `bx_delete_calendar_event` прошёл бы незамеченным."""
    async def _gone(method, payload=None):
        return None, "Event not found"

    async def _broken(method, payload=None):
        return None, "ConnectTimeout"
    monkeypatch.setattr(main, "bx_call", _gone)
    assert asyncio.run(main.bx_delete_calendar_event(7001, 999)) == (True, "")
    monkeypatch.setattr(main, "bx_call", _broken)
    ok, err = asyncio.run(main.bx_delete_calendar_event(7001, 999))
    assert ok is False and err, "недоступный Bitrix нельзя считать успешным удалением"


def test_unlink_succeeds_when_event_already_gone(monkeypatch):
    """Цель вызова — чтобы события не было. Оно уже удалено → цель достигнута, а не ошибка.
    Пока это была ошибка, совещание застревало с неснимаемой отметкой навсегда."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _call(method, payload=None):
        if method == "calendar.event.delete":
            return None, "Event not found"
        return {"result": []}, ""
    _wire(monkeypatch, meta, calls=_call)
    r = client.delete("/projects/5/meetings/m1/bitrix-event", headers=HDR)
    assert r.status_code == 200, r.text
    assert "bitrix_event_id" not in meta["_meetings"][0]


def test_unlink_keeps_the_link_when_bitrix_errors_and_event_is_alive(monkeypatch):
    """А вот тут отметку снимать НЕЛЬЗЯ: событие живо, Bitrix просто не дал его удалить."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _call(method, payload=None):
        if method == "calendar.event.delete":
            return None, "ACCESS_DENIED"
        if method == "calendar.event.get":
            return {"result": [{"ID": "999"}]}, ""       # событие на месте
        return {"result": []}, ""
    _wire(monkeypatch, meta, calls=_call)
    r = client.delete("/projects/5/meetings/m1/bitrix-event", headers=HDR)
    assert r.status_code == 502, r.text
    assert meta["_meetings"][0]["bitrix_event_id"] == 999


def test_unlink_force_clears_the_link_and_says_so(monkeypatch):
    """Последний выход, когда Bitrix недоступен: снять отметку в портале, записав это в журнал."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _call(method, payload=None):
        return None, "ConnectTimeout"
    _wire(monkeypatch, meta, calls=_call)
    assert client.delete("/projects/5/meetings/m1/bitrix-event", headers=HDR).status_code == 502
    r = client.delete("/projects/5/meetings/m1/bitrix-event?force=true", headers=HDR)
    assert r.status_code == 200, r.text
    assert "bitrix_event_id" not in meta["_meetings"][0]


def test_unlink_deletes_from_the_creator_calendar_not_the_clicker(monkeypatch):
    """Событие живёт у создателя. Пока владельцем считался нажавший, со-РП бил в свой календарь
    и получал отказ на чужое событие."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                   "bitrix_event_id": 999, "bitrix_event_owner": 7001}])
    log = []
    _wire(monkeypatch, meta, calls=_events_call({7001: [999]}, log=log),
          user={"id": "co1", "full_name": "Co PM", "role": "owner", "bitrix24_user_id": 777})
    r = client.delete("/projects/5/meetings/m1/bitrix-event", headers=HDR)
    assert r.status_code == 200, r.text
    dele = next(p for mth, p in log if mth == "calendar.event.delete")
    assert int(dele["ownerId"]) == 7001, "удаляли из календаря нажавшего, а не создателя"


# ── создание запоминает владельца ──────────────────────────────────────────────

def test_create_stores_the_calendar_owner(monkeypatch):
    meta = _meta([{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04", "attendees": []}])

    async def fake_add(owner, title, start, end, description="", attendees=None, location=""):
        return (999, "")
    _wire(monkeypatch, meta)
    monkeypatch.setattr(main, "bx_add_calendar_event", fake_add)
    r = client.post("/projects/5/meetings/m1/bitrix-event", headers=HDR, json={})
    assert r.status_code == 200, r.text
    mt = meta["_meetings"][0]
    assert mt["bitrix_event_id"] == 999 and mt["bitrix_event_owner"] == 7001
    assert mt["bitrix_event_from"].startswith("2026-11-04")


# ── удаление совещания уносит событие ──────────────────────────────────────────

def test_deleting_a_meeting_deletes_its_bitrix_event(monkeypatch):
    meta = _meta([{"id": "m1", "title": "Планёрка", "bitrix_event_id": 999, "bitrix_event_owner": 7001}])
    log = []
    _wire(monkeypatch, meta, calls=_events_call({7001: [999]}, log=log))

    async def _owns(u, p):
        return True

    async def _append(pid, user, action, detail=""):
        meta.setdefault("_pending_action_log", []).append({"action": action, "detail": detail})
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    monkeypatch.setattr(main, "_append_action_log", _append)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    r = client.delete("/projects/5/meetings/m1", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    assert any(mth == "calendar.event.delete" for mth, _p in log), "событие осталось жить в Bitrix"


def test_failing_hook_does_not_break_the_delete(monkeypatch):
    """Провал внешней системы не отменяет удаление у нас — оно уже произошло."""
    meta = _meta([{"id": "m1", "title": "Планёрка", "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _boom(pid, item, user):
        raise RuntimeError("Bitrix упал")

    async def _owns(u, p):
        return True

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    monkeypatch.setattr(main, "_meeting_on_delete", _boom)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    r = client.delete("/projects/5/meetings/m1", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    assert meta["_meetings"] == []


# ── разбор id события ──────────────────────────────────────────────────────────

def test_client_cannot_write_the_bitrix_link_fields(monkeypatch):
    """САМОЕ ОПАСНОЕ, что нашла проверка этой правки.

    Совещание правится обычным PUT, а тот копировал в документ ЛЮБОЕ поле из тела. Пока адресом
    удаления был календарь нажавшего, подсунутый `bitrix_event_id` позволял снести произвольное
    событие в СВОЁМ календаре. Как только адресом стал сохранённый `bitrix_event_owner`, тем же
    приёмом можно было бы удалить любое событие из календаря ЛЮБОГО сотрудника — руками
    вебхука интеграции. Эти поля ставит только сервер.
    """
    meta = _meta([{"id": "m1", "title": "Планёрка", "bitrix_event_id": 999, "bitrix_event_owner": 7001}])

    async def _owns(u, p):
        return True

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    r = client.put("/projects/5/meetings/m1", headers=h, json={
        "title": "Планёрка", "bitrix_event_id": 4242, "bitrix_event_owner": 777,
        "bitrix_event_from": "2030-01-01 10:00:00"})
    assert r.status_code == 200, r.text
    mt = meta["_meetings"][0]
    assert mt["bitrix_event_id"] == 999, "клиент переписал id события Bitrix"
    assert mt["bitrix_event_owner"] == 7001, "клиент подменил календарь для удаления"
    assert "bitrix_event_from" not in mt or mt.get("bitrix_event_from") != "2030-01-01 10:00:00"
    assert mt["title"] == "Планёрка"        # обычные поля по-прежнему правятся

    # И на создании тоже: иначе связку можно принести сразу в новом совещании.
    r2 = client.post("/projects/5/meetings", headers=h,
                     json={"title": "Новая", "bitrix_event_id": 4242, "bitrix_event_owner": 777})
    assert r2.status_code == 200, r2.text
    created = r2.json()["data"]
    assert "bitrix_event_id" not in created and "bitrix_event_owner" not in created


def test_method_or_user_errors_are_not_a_deleted_event(monkeypatch):
    """«Method not found!» и «user not found» содержат not found, но говорят про метод и про
    пользователя. Приняв их за «событие удалено», портал рапортовал бы об успешном удалении
    всего подряд ровно в тот день, когда у вебхука отобрали права на календарь."""
    for text in ("Method not found!", "ERROR_METHOD_NOT_FOUND", "user not found", "ACCESS_DENIED"):
        async def _err(method, payload=None, _t=text):
            return None, _t
        monkeypatch.setattr(main, "bx_call", _err)
        ok, err = asyncio.run(main.bx_delete_calendar_event(7001, 999))
        assert ok is False and err, f"«{text}» сочли удалённым событием"
    assert main._bx_event_gone("Event not found") is True     # контроль: настоящее «нет события»


def test_event_id_is_parsed_from_every_shape():
    assert main._bx_parse_event_id(5) == 5
    assert main._bx_parse_event_id("5") == 5
    assert main._bx_parse_event_id({"ID": "5"}) == 5      # объект — Bitrix отдаёт и так
    assert main._bx_parse_event_id("abc") is None


def test_unparsable_id_is_an_error_not_a_silent_success(monkeypatch):
    """Раньше здесь возвращался «успех без id»: маршрут отвечал 502, а событие оставалось в
    календаре сиротой — без ссылки из портала и без шанса быть удалённым."""
    async def _call(method, payload=None):
        return {"result": "неведомо что"}, ""
    monkeypatch.setattr(main, "bx_call", _call)
    monkeypatch.setattr(main, "bx_calendar_section", lambda o: _aret(None))
    eid, err = asyncio.run(main.bx_add_calendar_event(7001, "Планёрка", "2026-11-04 10:00:00",
                                                     "2026-11-04 11:00:00"))
    assert eid is None and err, "молчаливый успех снова прячет сироту в календаре"


def _aret(v):
    async def _c():
        return v
    return _c()
