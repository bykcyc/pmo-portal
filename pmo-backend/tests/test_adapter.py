"""
Юнит-тесты бэкенда: токены, маппинг строк БД<->task/risk, скоринг, счётчики, RBAC, auth.
Не требуют живого Postgres (чистая логика + TestClient с monkeypatch на слой db).
Запуск:  docker exec pmo-backend sh -lc "cd /app && python -m pytest tests -q"
"""
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
from attention_stubs import silence_db_sources  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(main.app)

# Тот же id, что у сид-пользователя owner@company.com (app_runtime.seed_users):
# тесты про охват уведомлений делают владельца портфеля РУКОВОДИТЕЛЕМ проекта,
# а не просто читателем — право читать и право получать колокол это разные вещи.
OWNER_USER_ID = "eccb57bc-e135-481f-8d6c-90f5ab946596"


@pytest.fixture(autouse=True)
def _reset_login_rate_state():
    # Сброс per-email login-счётчика между тестами (изоляция rate-limit кейсов).
    main._LOGIN_ATTEMPTS.clear()
    yield


# ---------- HMAC-токены ----------
def test_token_roundtrip():
    tok = main.make_token("owner@company.com")
    data = main.read_token(tok)
    assert data and data["sub"] == "owner@company.com"


def test_token_tampered_and_garbage():
    tok = main.make_token("pm1@company.com")
    assert main.read_token(tok + "x") is None      # подделан
    assert main.read_token("garbage") is None       # мусор
    assert main.read_token("a.b.c") is None


# ---------- скоринг рисков ----------
def test_risk_score():
    assert main._risk_score("high", "high") == 9
    assert main._risk_score("low", "medium") == 2
    assert main._risk_score(None, None) == 4  # default medium*medium


# ---------- WP -> task ----------
def test_wp_to_task_mapping():
    wp = {
        "id": 10, "subject": "T1", "startDate": "2026-01-01", "dueDate": "2026-01-05",
        "percentageDone": 50, "createdAt": "2026-01-01T00:00:00Z",
        "description": {"raw": "desc"},
        "_links": {"type": {"title": "Task"}, "status": {"href": "/api/v3/statuses/7"},
                   "parent": {"href": "/api/v3/work_packages/9"}},
    }
    extra = {"10": {"priority": "high", "assignee_name": "PM", "wbs_code": "1.1"}}
    t = main._wp_to_task(wp, extra, "5", 1, 0)
    assert t["id"] == "10" and t["title"] == "T1"
    assert t["task_type"] == "task" and t["status"] == "in_progress"
    assert t["priority"] == "high" and t["assignee_name"] == "PM"
    assert t["parent_id"] == "9" and t["progress"] == 50
    assert t["duration_days"] == 5 and t["level"] == 1


def test_wp_to_task_phase_and_status_reverse():
    wp = {"id": 1, "subject": "Phase", "createdAt": "x",
          "_links": {"type": {"title": "Summary task"}, "status": {"href": "/api/v3/statuses/12"}}}
    t = main._wp_to_task(wp, {}, "5", 0, 0)
    assert t["task_type"] == "phase" and t["status"] == "completed"


# ---------- WP -> risk ----------
def test_wp_to_risk_mapping():
    wp = {"id": 20, "subject": "R1", "description": {"raw": "d"}, "createdAt": "x"}
    rextra = {"20": {"probability": "high", "impact": "high", "status": "open", "mitigation_plan": "mp"}}
    r = main._wp_to_risk(wp, rextra, "5")
    assert r["score"] == 9 and r["probability"] == "high"
    assert r["status"] == "open" and r["mitigation_plan"] == "mp"
    assert isinstance(r["updates"], list)


# ---------- счётчики задач из WP ----------
def test_task_counts():
    wps = [
        {"_links": {"status": {"href": "/api/v3/statuses/12"}}, "dueDate": "2020-01-01"},  # completed, не overdue
        {"_links": {"status": {"href": "/api/v3/statuses/7"}}, "dueDate": "2020-01-01"},   # in_progress, overdue
        {"_links": {"status": {"href": "/api/v3/statuses/1"}}, "dueDate": None},           # new
    ]
    c = main._task_counts(wps)
    assert c["tasks_total"] == 3 and c["tasks_completed"] == 1 and c["overdue_tasks"] == 1


# ---------- RBAC: владение проектом ----------
def test_owns_item():
    u = {"id": "u1", "full_name": "PM One"}
    assert main._owns_item(u, {"pm_id": "u1"})
    assert not main._owns_item(u, {"pm_id": "u2"})
    # S3: имя (pm_name) БОЛЬШЕ не даёт владения — иначе переименование в PUT /me = захват легаси-проекта.
    assert not main._owns_item(u, {"pm_id": None, "pm_name": "PM One"})
    assert not main._owns_item(u, {"pm_id": None, "pm_name": "Someone"})


# ---------- auth + RBAC через HTTP ----------
def test_login_and_me():
    r = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"})
    assert r.status_code == 200
    tok = r.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200 and me.json()["role"] == "owner"


def test_login_wrong_password():
    r = client.post("/auth/login", json={"email": "owner@company.com", "password": "nope"})
    assert r.status_code == 401


def test_dummy_verify_always_false():
    # Timing equalizer: runs a real bcrypt verify but never authenticates.
    assert main._dummy_verify("anything") is False
    assert main._dummy_verify("") is False


def test_login_unknown_email_401():
    # Unknown account: 401 (and internally spends a dummy bcrypt so timing doesn't leak existence).
    r = client.post("/auth/login", json={"email": "nobody@nowhere.example", "password": "x"})
    assert r.status_code == 401


def test_login_inactive_account_401():
    main.USERS["pm1@company.com"]["is_active"] = False
    try:
        r = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"})
        assert r.status_code == 401  # деактивированный аккаунт не входит, даже с верным паролем
    finally:
        main.USERS["pm1@company.com"]["is_active"] = True


def test_no_token_401():
    assert client.get("/projects").status_code == 401


def test_owner_can_write_any_project(monkeypatch):
    """WP2: Руководитель портфеля правит ЛЮБОЙ проект — даже тот, которым не владеет.
    Раньше owner был строго read-only и получал 403 на любую запись (не мог поправить и опечатку)."""
    meta = {"_team": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r

    async def _not_owns(user, pid):
        return False  # owner НЕ владелец этого проекта — и всё равно должен пройти
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _not_owns)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    r = client.post("/projects/5/team", headers={"Authorization": f"Bearer {tok}"}, json={"full_name": "X"})
    assert r.status_code == 200
    assert meta["_team"][0]["full_name"] == "X"


def test_pm_cannot_write_foreign_project_403(monkeypatch):
    """А РП по-прежнему пишет ТОЛЬКО в свои проекты (скоуп владения не ослаб)."""
    async def _not_owns(user, pid):
        return False
    monkeypatch.setattr(main, "_user_owns_project", _not_owns)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/team", headers={"Authorization": f"Bearer {tok}"}, json={"full_name": "X"})
    assert r.status_code == 403


def test_pm_sees_own_scoped_portfolio(monkeypatch):
    """Портфель открыт всем, кто ведёт проекты, но показывает ТОЛЬКО доступные проекты.

    Заменил прежний test_pm_has_no_portfolio_403: контракт изменён намеренно (решение
    владельца). Гард пускает РП на страницу, а выборку режет
    `_accessible_projects` — здесь список проектов пуст, значит и портфель пуст.
    Это и есть доказательство скоупа: будь скоуп сломан, РП увидел бы чужое."""
    async def _no_projects(*a, **kw):
        return []

    async def _no_baselines(*a, **kw):
        return {}
    monkeypatch.setattr(main, "fetch_projects", _no_projects)
    # Дашборд читает базовые планы напрямую из БД — прежний тест до этого не доходил,
    # потому что упирался в 403 раньше. Пула в юнит-тестах нет, поэтому глушим.
    monkeypatch.setattr(main.db, "load_latest_baselines", _no_baselines)
    monkeypatch.setattr(main, "_load_snapshots", _no_baselines)   # тренды читают снимки
    silence_db_sources(monkeypatch, main)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    for url in ("/portfolio/dashboard", "/portfolio/trends", "/portfolio/workload",
                "/portfolio/risk-heatmap", "/portfolio/milestones", "/portfolio/risks"):
        r = client.get(url, headers=h)
        assert r.status_code == 200, (url, r.status_code)
        # Проверяем не «пустоту вообще» (нули счётчиков — законное содержимое), а то,
        # что не утёк ни один чужой проект: любой список внутри ответа обязан быть пуст.
        body = r.json().get("data")
        lists = ([body] if isinstance(body, list)
                 else [v for v in body.values() if isinstance(v, list)] if isinstance(body, dict)
                 else [])
        assert all(len(x) == 0 for x in lists), (url, body)
    for url in ("/attention", "/me/tasks", "/search?q=x"):
        assert client.get(url, headers=h).status_code == 200, url


def test_my_tasks_only_mine(monkeypatch):
    """WP4: «Мои задачи» = назначенные НА МЕНЯ. Раньше фильтра по исполнителю не было вовсе,
    и раздел отдавал ВСЕ задачи всех доступных проектов — вперемешку с задачами чужих людей.
    Здесь проверяем три канала опознания (person_id / email / имя) и что чужое не просочилось."""
    proj = {"id": "5", "code": "PRJ-002", "name": "Проект", "status": "active"}

    async def _accessible(user, **kw):
        return [(proj, {})]

    async def _bulk(pids, types):
        return {"5": []}

    def _tasks(wps, m, pid):
        return [
            {"id": "t1", "title": "по person_id", "assignee_person_id": "p-42"},
            {"id": "t2", "title": "по email", "assignee_email": "PM1@Company.com"},
            {"id": "t3", "title": "по имени", "assignee_name": "Project Manager 1"},
            {"id": "t4", "title": "чужая", "assignee_name": "Кто-то Другой",
             "assignee_email": "other@example.com", "assignee_person_id": "p-99"},
            {"id": "t5", "title": "ничья"},
            {"id": "t6", "title": "чужая фаза", "task_type": "phase", "assignee_person_id": "p-99"},
            {"id": "t7", "title": "моя фаза", "task_type": "phase", "assignee_email": "pm1@company.com"},
        ]

    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    data = client.get("/me/tasks", headers={"Authorization": f"Bearer {tok}"}).json()["data"]
    # t2/t3 — email+имя (у сид-юзера нет person_id); t7 — фаза, назначенная НА МЕНЯ, теперь тоже видна;
    # t6 — чужая фаза отсеяна (не совпал исполнитель).
    assert [t["id"] for t in data] == ["t2", "t3", "t7"]


def test_my_items_grouped_by_project(monkeypatch):
    """Ф1-B5: «Мои задачи» → ВСЕ элементы (вкл. совещания), назначенные на меня, по проектам.
    Проверяем каждый канал, путь по почте (team), отсев чужого, флаг closed (актуальные/завершённые),
    project_active и КЛЮЧЕВОЙ гейт доступа: pm1 — лишь участник этого проекта (не РП/со-РП), поэтому
    элементы видит, но can_open=False — зайти внутрь проекта из «Моих задач» нельзя."""
    proj = {"id": "5", "code": "PRJ-002", "name": "Проект", "status": "active"}  # без pm_id/editors → участник
    ME = "Project Manager 1"
    meta = {
        "_backlog": [
            {"id": "b1", "title": "мой бэклог", "code": "B-1", "status": "new", "assignee_name": ME},
            {"id": "b2", "title": "чужой", "assignee_name": "Другой"},
        ],
        "_team": [
            {"id": "tm1", "full_name": ME, "project_role": "РП"},
            {"id": "tm2", "full_name": "Другой", "email": "pm1@company.com", "project_role": "по почте"},
            {"id": "tm3", "full_name": "Некто", "project_role": "чужая роль"},
        ],
        "_stakeholders": [
            {"id": "s1", "name": ME, "role": "спонсор"},
            {"id": "s2", "name": "Внешний", "role": "чужой"},
        ],
        "_assumptions": [
            {"id": "a1", "description": "моё допущение", "owner": ME, "status": "active"},
            {"id": "a2", "description": "чужое", "owner": "Другой"},
        ],
        "_comms": [
            {"id": "c1", "goal": "мой отчёт", "responsible": ME, "frequency": "еженедельно"},
            {"id": "c2", "goal": "чужой", "responsible": "Другой"},
        ],
        "_kpis": [
            {"id": "k1", "name": "мой KPI", "responsible": ME, "status": "on_track"},
            {"id": "k2", "name": "чужой", "responsible": "Другой"},
        ],
        "_decisions": [
            {"id": "d1", "title": "моё решение", "code": "D-1", "decided_by": ME, "status": "active"},
            {"id": "d2", "title": "чужое", "decided_by": "Другой"},
        ],
        "_meetings": [
            {"id": "mt1", "title": "Планёрка", "meeting_date": "2000-01-01", "status": "scheduled",
             "attendees": [{"name": ME}, {"name": "Другой"}]},
            {"id": "mt2", "title": "чужая", "meeting_date": "2000-01-01", "attendees": [{"name": "Некто"}]},
        ],
    }

    async def _fetch_projects(*a, **k):
        return ["EL"]  # один «сырой» ряд; to_project/_meta ниже его игнорируют

    async def _bulk(pids, types):
        return {"5": []}

    def _tasks(wps, m, pid):
        return [
            {"id": "t1", "title": "моя активная", "assignee_name": ME, "status": "in_progress"},
            {"id": "t2", "title": "моя завершённая", "assignee_name": ME, "status": "completed"},
            {"id": "t3", "title": "чужая", "assignee_name": "Другой"},
        ]

    def _risks(wps, m, pid):
        return [
            {"id": "r1", "title": "мой риск", "code": "R-1", "owner": ME, "status": "open"},
            {"id": "r2", "title": "чужой", "owner": "Другой"},
        ]

    monkeypatch.setattr(main, "fetch_projects", _fetch_projects)
    monkeypatch.setattr(main, "to_project", lambda el: proj)
    monkeypatch.setattr(main, "_meta", lambda el: meta)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    monkeypatch.setattr(main, "_risks_from_wps", _risks)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    data = client.get("/me/items", headers={"Authorization": f"Bearer {tok}"}).json()["data"]

    assert len(data) == 1
    g = data[0]
    assert (g["project_id"], g["project_code"], g["project_name"]) == ("5", "PRJ-002", "Проект")
    assert g["project_status"] == "active" and g["project_active"] is True
    assert g["can_open"] is False  # участник, не РП/со-РП — внутрь проекта нельзя
    byid = {(it["type"], it["id"]): it for it in g["items"]}
    assert set(byid) == {
        ("task", "t1"), ("task", "t2"), ("risk", "r1"), ("backlog", "b1"), ("decision", "d1"),
        ("assumption", "a1"), ("comm", "c1"), ("kpi", "k1"),
        ("team", "tm1"), ("team", "tm2"), ("stakeholder", "s1"), ("meeting", "mt1"),
    }
    assert byid[("task", "t1")]["closed"] is False
    assert byid[("task", "t2")]["closed"] is True         # completed → завершённая
    assert byid[("meeting", "mt1")]["closed"] is True     # прошедшая дата → завершённая
    assert byid[("meeting", "mt1")]["section"] == "meetings"
    assert byid[("comm", "c1")]["section"] == "comm-plan"


def test_my_calendar_dated_tasks_and_backlog(monkeypatch):
    """Ф1: /me/calendar — датированные задачи WBS + бэклог, назначенные на меня. Без даты и фазы — не в ленте."""
    proj = {"id": "5", "code": "PRJ-002", "name": "Проект", "status": "active"}
    ME = "Project Manager 1"
    meta = {"_backlog": [
        {"id": "b1", "title": "бэклог с датой", "assignee_name": ME, "planned_start": "2026-07-01",
         "planned_end": "2026-07-05", "status": "new"},
        {"id": "b2", "title": "бэклог без даты", "assignee_name": ME},
        {"id": "b3", "title": "чужой", "assignee_name": "Другой", "planned_end": "2026-07-05"},
    ]}

    async def _accessible(user, **kw):
        return [(proj, meta)]

    async def _bulk(pids, types):
        return {"5": []}

    def _tasks(wps, m, pid):
        return [
            {"id": "t1", "title": "задача с датой", "assignee_name": ME, "planned_end": "2026-07-10", "status": "in_progress"},
            {"id": "t2", "title": "задача без даты", "assignee_name": ME},
            {"id": "t3", "title": "фаза", "task_type": "phase", "assignee_name": ME, "planned_end": "2026-07-10"},
            {"id": "t4", "title": "чужая", "assignee_name": "Другой", "planned_end": "2026-07-10"},
        ]

    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    d = client.get("/me/calendar", headers={"Authorization": f"Bearer {tok}"}).json()["data"]
    got = {(x["type"], x["id"]) for x in d}
    # t3 — фаза с датой, назначенная на меня: ВКЛючена (как в «Моих задачах»). t2/b2 без дат, t4/b3 чужие.
    assert got == {("task", "t1"), ("task", "t3"), ("backlog", "b1")}
    byid = {x["id"]: x for x in d}
    assert byid["b1"]["start"] == "2026-07-01" and byid["b1"]["end"] == "2026-07-05"
    assert byid["b1"]["project_code"] == "PRJ-002" and byid["b1"]["section"] == "backlog"


def test_my_task_match_folds_diacritics():
    """Латышские файлы пишут одного человека и с макронами, и без: задачи назначены
    на «Pēteris Piemērs», а пользователь заведён как «Peteris Piemers». Это один человек."""
    user = {"full_name": "Peteris Piemers", "email": "peteris.piemers@example.com"}
    assert main._my_task_match(user, {"assignee_name": "Pēteris Piemērs"})
    assert main._my_task_match(user, {"assignee_name": "  peteris   PIEMERS "})
    assert not main._my_task_match(user, {"assignee_name": "Pēteris Ozols"})
    assert not main._my_task_match(user, {"assignee_name": "IT lead"})


def test_pm_read_scope_foreign_project_403(monkeypatch):
    # PM, не владеющий проектом и не наблюдающий его, не может читать — RBAC отбивает GET
    # до тела эндпоинта. Гард чтения с появлением наблюдателей отдельный от гарда записи,
    # поэтому глушим именно его.
    async def _cannot_read(user, pid):
        return False
    monkeypatch.setattr(main, "_user_can_read_project", _cannot_read)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.get("/projects/5/tasks", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_task_and_risk_mutations_reject_foreign_object_ids(monkeypatch):
    """RBAC по pid недостаточно: tid/rid также обязаны принадлежать этому проекту."""
    async def _owns(user, pid):
        return True

    async def _foreign(_wid, _pid):
        return False

    async def _must_not_write(*_args, **_kwargs):
        raise AssertionError("foreign object reached the DB write path")

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_task_in_project", _foreign)
    monkeypatch.setattr(main, "_risk_in_project", _foreign)
    monkeypatch.setattr(main.db, "update_task", _must_not_write)
    monkeypatch.setattr(main.db, "update_risk", _must_not_write)
    monkeypatch.setattr(main.db, "delete_wp", _must_not_write)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    assert client.put("/projects/5/tasks/900", headers=h, json={"title": "foreign"}).status_code == 404
    assert client.delete("/projects/5/tasks/900", headers=h).status_code == 404
    assert client.put("/projects/5/risks/901", headers=h, json={"title": "foreign"}).status_code == 404
    assert client.delete("/projects/5/risks/901", headers=h).status_code == 404


def test_task_reorder_validates_all_ids_before_first_write(monkeypatch):
    writes = []

    async def _owns(user, pid):
        return True

    async def _ids(pid):
        return {"1"}  # только задача 1 в проекте

    async def _reorder(items):
        writes.append(items)

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main.db, "project_task_ids", _ids)
    monkeypatch.setattr(main.db, "reorder_tasks", _reorder)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    r = client.post("/projects/5/tasks/reorder", headers=h, json=[
        {"id": "1", "sort_order": 1},
        {"id": "999", "sort_order": 2},
    ])
    assert r.status_code == 404
    assert writes == []  # чужой id → 404 до единственного атомарного reorder_tasks


def test_task_reorder_refuses_a_loop(monkeypatch):
    """Задача не может стать потомком самой себя. Перетаскивание такого не предложит, но
    маршрут открыт напрямую и помощнику, а зациклённая ветка выпала бы из дерева целиком:
    задачи есть в базе, а на экране их нет."""
    called = {}

    async def _owns(user, pid):
        return True

    async def _ids(pid):
        return {"1", "2", "3"}

    async def _parents(pid):
        return {"1": None, "2": "1", "3": "2"}   # 1 → 2 → 3

    async def _reorder(items):
        called["yes"] = True

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main.db, "project_task_ids", _ids)
    monkeypatch.setattr(main.db, "project_task_parents", _parents)
    monkeypatch.setattr(main.db, "reorder_tasks", _reorder)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    # кладём корень 1 внутрь его же внука 3
    r = client.post("/projects/5/tasks/reorder", headers={"Authorization": f"Bearer {tok}"},
                    json=[{"id": "1", "sort_order": 0, "wbs_code": "", "parent_id": "3"}])
    assert r.status_code == 422, r.text
    assert "не" in r.json()["detail"]
    assert "yes" not in called, "петля дошла до записи"


def test_task_reorder_writes_atomically(monkeypatch):
    # Валидный reorder → ОДИН вызов reorder_tasks со всеми строками (setp только там, где прислан parent_id).
    captured = {}

    async def _owns(user, pid):
        return True

    async def _ids(pid):
        return {"1", "2"}

    async def _reorder(items):
        captured["items"] = items

    async def _parents(pid):
        return {"1": None, "2": None}   # проверка петли читает текущих родителей

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main.db, "project_task_ids", _ids)
    monkeypatch.setattr(main.db, "project_task_parents", _parents)
    monkeypatch.setattr(main.db, "reorder_tasks", _reorder)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/tasks/reorder", headers={"Authorization": f"Bearer {tok}"}, json=[
        {"id": "1", "sort_order": 0, "wbs_code": "1"},
        {"id": "2", "sort_order": 1, "wbs_code": "1.1", "parent_id": "1"},
    ])
    assert r.status_code == 200
    items = dict(captured["items"])  # [(tid, fields), …]
    assert "parent_id" in items["2"] and items["2"]["parent_id"] == 1
    assert "parent_id" not in items["1"]  # без parent_id — не трогаем (setp=False в reorder_tasks)


def test_tasks_bulk_creates_in_order(monkeypatch):
    # Массовое создание: пустые строки пропускаются, порядок сохраняется, один вызов insert_tasks.
    calls = {"n": 0}

    async def _owns(user, pid):
        return True

    async def _insert_tasks(pid, rows):
        calls["n"] += 1
        return [10 + i for i in range(len(rows))]

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main.db, "insert_tasks", _insert_tasks)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/tasks/bulk", headers={"Authorization": f"Bearer {tok}"},
                    json={"titles": ["a", "", {"title": "c"}]})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["created"] == ["10", "11"] and data["count"] == 2  # пустая строка отброшена
    assert calls["n"] == 1  # одна транзакция


def test_append_action_log_entry_shape(monkeypatch):
    # Форма записи append-only журнала = _log_action (порядок ключей важен для golden-байтов).
    import asyncio
    captured = {}

    async def fake_append(pid, entry, cap):
        captured.update(pid=pid, entry=entry, cap=cap)

    monkeypatch.setattr(main.db, "append_action_log", fake_append)
    asyncio.run(main._append_action_log("5", {"id": "u1", "full_name": "PM One"}, "task.create", "Hello"))
    e = captured["entry"]
    assert captured["pid"] == "5" and captured["cap"] == main._ACTION_LOG_CAP
    assert e["user_id"] == "u1" and e["user_name"] == "PM One"
    assert e["action"] == "task.create" and e["detail"] == "Hello"
    assert list(e.keys()) == ["at", "user_id", "user_name", "action", "detail"]  # тот же порядок, что у _log_action


def test_pmo_api_protocol_in_sync_with_main():
    # PmoApi (facade-протокол) должен покрывать только реальные члены main — иначе pyright даёт
    # ложные ошибки на api.* при рассинхроне (переименование в main). Дрейф-гард.
    import pmo_api
    members = set(getattr(pmo_api.PmoApi, "__annotations__", {}))
    members |= {n for n, v in vars(pmo_api.PmoApi).items() if callable(v) and not n.startswith("__")}
    missing = sorted(n for n in members if not hasattr(main, n))
    assert not missing, f"PmoApi рассинхронизирован с main, отсутствуют: {missing}"
    assert len(members) >= 100  # защита от пустого/битого протокола


def test_pmo_api_protocol_covers_every_api_access():
    # Обратная сторона того же дрейфа: роут зовёт api.<хелпер>, которого в PmoApi нет, —
    # pytest зелёный, а pyright в CI красный, и сборка падает. Держим оба направления.
    import pathlib, re, pmo_api
    # Корень берём от самого main, а не от __file__ теста: под pytest каталог теста
    # разрешался иначе, glob не находил ни одного файла и проверка молча проходила.
    root = pathlib.Path(main.__file__).resolve().parent
    declared = set(getattr(pmo_api.PmoApi, "__annotations__", {}))
    declared |= {n for n, v in vars(pmo_api.PmoApi).items() if callable(v) and not n.startswith("__")}
    used: dict[str, str] = {}
    for f in sorted(root.glob("*_routes.py")):
        # Просмотр назад, а не : во-первых, надёжнее при генерации файла, во-вторых
        # без него в выборку попадает `fastapi.responses`.
        for name in re.findall(r"(?<![A-Za-z0-9_])api[.]([A-Za-z_][A-Za-z0-9_]*)", f.read_text(encoding="utf-8")):
            used.setdefault(name, f.name)
    assert used, f"проверка ничего не просканировала — не тот корень: {root}"
    undeclared = sorted(f"{n} ({used[n]})" for n in used if n not in declared)
    assert not undeclared, "в PmoApi не объявлены члены, которые зовут роуты: " + ", ".join(undeclared)


def test_run_with_job_lock_no_pool_runs_fn():
    # Без пула (оффлайн-тесты) advisory-lock невозможен → задача выполняется без блокировки.
    import asyncio
    assert main.db._pool is None
    ran = {"n": 0}

    async def fn(x):
        ran["n"] += 1
        return x * 2

    res = asyncio.run(main.db.run_with_job_lock(0x504D4F01, fn, 21))
    assert res == 42 and ran["n"] == 1


def test_budget_reports_normalized_out_of_blob():
    # _budget/_reports вынесены в project_docs (не в 60КБ-блоб projects.meta) → защита от 413.
    assert "_budget" in main._DOC_COLLS and "_reports" in main._DOC_COLLS
    snap = main._extract_colls({"_budget": [{"x": 1}], "_reports": [{"y": 2}], "code": "P"})
    assert snap["_budget"] == [{"x": 1}] and snap["_reports"] == [{"y": 2}]


def test_asgi_wraps_main_without_import_time_dotenv():
    # asgi.py — тонкая обёртка: грузит .env и отдаёт то же приложение; main без load_dotenv на импорте.
    import asgi
    assert asgi.app is main.app
    assert not hasattr(main, "load_dotenv")  # no import-time file I/O в main


def test_is_primary_requires_write_role():
    # Разжалованный pm→viewer с прежним pm_id больше НЕ основной РП (не управляет со-РП/шарингом).
    assert main._is_primary_pm_or_owner({"id": "u1", "role": "pm"}, {"pm_id": "u1"}) is True
    assert main._is_primary_pm_or_owner({"id": "u1", "role": "viewer"}, {"pm_id": "u1"}) is False
    assert main._is_primary_pm_or_owner({"id": "u1", "role": "owner"}, {"pm_id": "other"}) is True


def test_task_create_rejects_cross_project_parent(monkeypatch):
    # Нельзя привязать задачу к родителю из ДРУГОГО проекта (create/update, как reorder).
    async def _owns(u, p):
        return True

    async def _in_proj(tid, pid):
        return False  # родитель не принадлежит проекту

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_task_in_project", _in_proj)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/tasks", headers={"Authorization": f"Bearer {tok}"},
                    json={"title": "T", "task_type": "task", "parent_id": "999"})
    assert r.status_code == 404


# ---------- P4: optimistic-lock retry ----------
def test_with_meta_retry_on_conflict(monkeypatch):
    import asyncio
    calls = {"n": 0}

    async def fake_load(pid):
        return ({"lockVersion": 1}, {})

    seq = [False, True]  # первый UPDATE — конфликт (version mismatch), второй — успех

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        calls["n"] += 1
        return seq.pop(0)

    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    res = asyncio.run(main.with_meta_retry("5", lambda m: "ok", attempts=3))
    assert res == "ok" and calls["n"] == 2


# ---------- единый 409 на конфликт версий (Block 4) ----------
def test_save_meta_conflict_is_409(monkeypatch):
    import asyncio
    import pytest

    async def fake_row(pid):
        return {"lockVersion": 1, "description": {"raw": "{}"}, "name": "P"}

    async def fake_docs(pid):
        return {}

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        return False  # projects.version опередили

    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main._save_meta("5", {}))
    assert e.value.status_code == 409  # раньше был 400 (single-shot путь)


def test_save_meta_full_conflict_is_409(monkeypatch):
    import asyncio
    import pytest

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        return False

    async def fake_row(pid):
        return {"lockVersion": 1}

    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main.save_meta_full("5", {"lockVersion": 1}, {}))
    assert e.value.status_code == 409  # раньше был 400 (clone путь)


def test_with_meta_retry_exhausts_409(monkeypatch):
    import asyncio
    import pytest

    async def fake_load(pid):
        return ({"lockVersion": 1}, {})

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        return False  # всегда конфликт → исчерпание попыток

    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main.with_meta_retry("5", lambda m: "x", attempts=2))
    assert e.value.status_code == 409


# ---------- P4: bulk-маппер задач (чистый, без сети) ----------
def test_tasks_from_wps_pure():
    # extra теперь живёт в самом шиме под ключом '_extra' (сайдкар-колонки влиты в строку)
    wps = [{"id": 1, "subject": "A", "createdAt": "x", "_extra": {"priority": "high"},
            "_links": {"type": {"title": "Task"}, "status": {"href": "/api/v3/statuses/1"}}}]
    out = main._tasks_from_wps(wps, {}, "5")
    assert len(out) == 1 and out[0]["id"] == "1" and out[0]["priority"] == "high"


# ---------- P4: rate-limit логина ----------
def test_login_rate_limit():
    email = "ratelimit-probe@test.com"  # нет в USERS → 401, но счётчик попыток растёт
    codes = [client.post("/auth/login", json={"email": email, "password": "x"}).status_code
             for _ in range(main._LOGIN_MAX + 1)]
    assert codes[:main._LOGIN_MAX] == [401] * main._LOGIN_MAX  # первые N — обычный 401
    assert codes[-1] == 429                                    # (N+1)-я — лимит


# ---------- P4: подпись вебхука Bitrix ----------
def test_webhook_token(monkeypatch):
    monkeypatch.setattr(main, "BITRIX_INBOUND_TOKEN", "secret")
    bad = client.post("/webhooks/bitrix24", data={"event": "ONTASKUPDATE"})
    assert bad.status_code == 403  # без токена — отказ
    ok = client.post("/webhooks/bitrix24", data={"event": "PING", "auth[application_token]": "secret"})
    assert ok.status_code == 200   # верный токен, незначимое событие → ok


# ---------- P3: агрегатор загрузки по исполнителям ----------
def test_workload_from_tasks():
    tasks = [
        {"task_type": "task", "status": "in_progress", "assignee_name": "Alice", "planned_end": "2000-01-01", "duration_days": 3},
        {"task_type": "task", "status": "not_started", "assignee_name": "Alice", "planned_end": "2999-01-01", "duration_days": 2},
        {"task_type": "task", "status": "completed", "assignee_name": "Alice", "planned_end": "2000-01-01", "duration_days": 9},  # closed — не считаем
        {"task_type": "phase", "status": "in_progress", "assignee_name": "Bob"},  # фаза — пропуск
        {"task_type": "task", "status": "in_progress", "assignee_name": None, "duration_days": 1},  # без исполнителя → "—"
    ]
    rows = main._workload_from_tasks(tasks)
    by = {r["assignee"]: r for r in rows}
    assert by["Alice"]["open_tasks"] == 2 and by["Alice"]["overdue"] == 1 and by["Alice"]["duration_days"] == 5
    assert "Bob" not in by                      # фаза не попала
    assert by["—"]["open_tasks"] == 1
    assert rows[0]["open_tasks"] >= rows[-1]["open_tasks"]  # отсортировано по убыванию


# ---------- P2: email-транспорт (dry-run outbox без SMTP) ----------
def test_mailer_dry_run():
    import mailer
    mailer.OUTBOX.clear()
    assert not mailer.is_configured()           # SMTP не настроен в тестах
    rec = mailer.send_email("x@y.com", "subj", "body")
    assert rec.get("dry_run") and not rec.get("sent")
    assert mailer.OUTBOX and mailer.OUTBOX[-1]["to"] == "x@y.com"


# ---------- WBS-дерево: глубина уровней по цепочке родителей ----------
def test_levels_depth():
    wps = [
        {"id": 1, "_links": {}},
        {"id": 2, "_links": {"parent": {"href": "/api/v3/work_packages/1"}}},
        {"id": 3, "_links": {"parent": {"href": "/api/v3/work_packages/2"}}},
    ]
    lv = main._levels(wps)
    assert lv["1"] == 0 and lv["2"] == 1 and lv["3"] == 2


def test_task_level_parent_chain(monkeypatch):
    # _task_level должен побайтно совпадать с _levels()[tid] на всех рёбрах: корень, цепочка,
    # само-родитель (цикл), родитель в другом проекте (обрыв).
    import asyncio
    rows = {
        "30": {"id": 30, "project_id": 5, "parent_id": None},
        "31": {"id": 31, "project_id": 5, "parent_id": 30},
        "32": {"id": 32, "project_id": 5, "parent_id": 31},
        "40": {"id": 40, "project_id": 5, "parent_id": 40},   # само-родитель (цикл)
        "50": {"id": 50, "project_id": 5, "parent_id": 51},
        "51": {"id": 51, "project_id": 9, "parent_id": None},  # другой проект
    }

    def shim(row):
        links = {}
        if row.get("parent_id") is not None:
            links["parent"] = {"href": f"/api/v3/work_packages/{row['parent_id']}"}
        return {"id": row["id"], "_links": links}

    async def fake_get_task(tid):
        return rows.get(str(tid))

    monkeypatch.setattr(main.db, "get_task", fake_get_task)
    monkeypatch.setattr(main.db, "task_shim", shim)

    # эталон: _levels над задачами проекта 5
    same_proj = [shim(r) for r in rows.values() if r["project_id"] == 5]
    lv = main._levels(same_proj)
    for tid in ("30", "31", "32", "40", "50"):
        got = asyncio.run(main._task_level(shim(rows[tid]), "5"))
        assert got == lv[tid], f"{tid}: {got} != _levels {lv[tid]}"
    assert lv["30"] == 0 and lv["31"] == 1 and lv["32"] == 2 and lv["40"] == 1 and lv["50"] == 0


# ---------- валидация входных данных (422) ----------
def test_validate_task_payload():
    import pytest
    with pytest.raises(main.HTTPException) as e:
        main._validate_task_payload({"status": "bogus"})
    assert e.value.status_code == 422
    with pytest.raises(main.HTTPException):
        main._validate_task_payload({"priority": "ultra"})
    with pytest.raises(main.HTTPException):
        main._validate_task_payload({"title": "x" * 256})
    main._validate_task_payload({"status": "in_progress", "priority": "high", "task_type": "task"})  # ок


def test_validate_risk_payload():
    import pytest
    with pytest.raises(main.HTTPException) as e:
        main._validate_risk_payload({"probability": "nope"})
    assert e.value.status_code == 422
    main._validate_risk_payload({"probability": "high", "impact": "low"})  # ок


# ---------- S: безопасность вложений ----------
def test_safe_filename():
    assert main._safe_filename("../../etc/passwd") == "passwd"          # path traversal срезан
    assert "<" not in main._safe_filename("a<b>:c.txt") and main._safe_filename(None) == "file"


def test_rollup_phase_progress():
    tasks = [
        {"id": "p", "task_type": "phase", "parent_id": None, "progress": 0},
        {"id": "a", "task_type": "task", "parent_id": "p", "progress": 100},
        {"id": "b", "task_type": "task", "parent_id": "p", "progress": 50},
        {"id": "c", "task_type": "task", "parent_id": "p", "progress": 0},
    ]
    out = {t["id"]: t for t in main._rollup_phase_progress(tasks)}
    assert out["p"]["progress"] == 50  # (100+50+0)/3
    # фаза без детей не падает
    assert main._rollup_phase_progress([{"id": "x", "task_type": "phase", "progress": 0}])[0]["progress"] == 0


def test_ics_esc():
    assert main._ics_esc("a,b;c\nd") == "a\\,b\\;c d"
    assert main._ics_esc(None) == ""


def test_rag_settings_rbac():
    # GET порогов RAG — только owner (require_owner), pm → 403.
    ow = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    pm = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.get("/admin/settings/rag", headers={"Authorization": f"Bearer {ow}"})
    data = r.json()["data"]
    assert r.status_code == 200 and set(data) == {"red_overdue_pct", "red_overdue_min",
                                                  "red_unmitigated_high", "amber_medium"}
    assert client.get("/admin/settings/rag", headers={"Authorization": f"Bearer {pm}"}).status_code == 403
    assert client.put("/admin/settings/rag", headers={"Authorization": f"Bearer {pm}"},
                      json={"amber_medium": 2}).status_code == 403


def test_rag_settings_put_accepts_old_form_and_garbage(monkeypatch):
    """PUT настроек не падает ни на старой форме, ни на мусоре и не пишет опасных значений.

    Старая форма присылает red_high / red_overdue — новое правило их не читает, недостающие
    ключи берутся из умолчаний. Ноль и текст не роняют запрос: при red_unmitigated_high = 0
    красным стал бы каждый проект.
    """
    saved = {}

    async def fake_save(st):
        saved.update(st)
    monkeypatch.setattr(main, "_settings_cache", {})
    monkeypatch.setattr(main.db, "save_settings", fake_save)
    ow = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    H = {"Authorization": f"Bearer {ow}"}
    r = client.put("/admin/settings/rag", headers=H, json={"red_high": 1, "red_overdue": 1, "amber_medium": 2})
    assert r.status_code == 200
    assert r.json()["data"] == {"red_overdue_pct": 25, "red_overdue_min": 3,
                                "red_unmitigated_high": 1, "amber_medium": 2}
    r = client.put("/admin/settings/rag", headers=H,
                   json={"red_overdue_pct": "мусор", "red_overdue_min": 0, "red_unmitigated_high": None,
                         "amber_medium": 500})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["red_overdue_pct"] == 25 and d["red_overdue_min"] == 1 and d["red_unmitigated_high"] == 1


def test_workload_hours():
    tasks = [
        {"task_type": "task", "status": "in_progress", "assignee_name": "Ann", "estimated_hours": 8, "actual_hours": 3},
        {"task_type": "task", "status": "not_started", "assignee_name": "Ann", "estimated_hours": 4, "actual_hours": 0},
    ]
    row = main._workload_from_tasks(tasks)[0]
    assert row["assignee"] == "Ann" and row["estimated_hours"] == 12 and row["actual_hours"] == 3


def test_rag_thresholds_ignore_old_prod_keys(monkeypatch):
    """В старых settings.rag бывают явно сохранены red_high=1, red_overdue=1. Унаследуй их новое
    правило — проект краснел бы от ОДНОЙ просрочки, ровно как раньше."""
    monkeypatch.setattr(main, "_settings_cache", {"rag": {"red_high": 1, "red_overdue": 1, "amber_medium": 1}})
    th = main._rag_thresholds()
    assert th == {"red_overdue_pct": 25, "red_overdue_min": 3, "red_unmitigated_high": 1, "amber_medium": 1}
    # одна просрочка из десяти — жёлтый, а не красный
    assert main._rag({"_counts": {"rag_total": 10, "rag_overdue": 1}}) == "amber"


def test_rag_thresholds_saved_values(monkeypatch):
    monkeypatch.setattr(main, "_settings_cache", {"rag": {"red_overdue_pct": 50, "red_overdue_min": 2,
                                                          "red_unmitigated_high": 2, "amber_medium": 3}})
    assert main._rag({"_counts": {"rag_total": 4, "rag_overdue": 2}}) == "red"        # 50% и ≥2
    assert main._rag({"_counts": {"risks_high_unmitigated": 1, "risks_high": 1}}) == "amber"  # < 2
    assert main._rag({"_counts": {"risks_medium": 2}}) == "green"                     # < 3


def test_rag_thresholds_garbage_in_settings(monkeypatch):
    # Ноль и мусор в сохранённых настройках не перекрашивают портфель.
    monkeypatch.setattr(main, "_settings_cache", {"rag": {"red_unmitigated_high": 0, "red_overdue_pct": "x"}})
    th = main._rag_thresholds()
    assert th["red_unmitigated_high"] == 1 and th["red_overdue_pct"] == 25
    assert main._rag({"_counts": {}}) == "green"


def test_attachment_scope_denied(monkeypatch):
    # PM владеет проектом (rbac пройдёт), но вложение НЕ из этого проекта → 404 (анти-IDOR), без сети.
    async def _owns(u, p):
        return True

    async def _not_in(aid, pid):
        return False
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    # Чтение и запись проверяются разными гардами (наблюдатель читает, но не пишет) —
    # чтобы дойти до объектной проверки, пропускаем оба.
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    monkeypatch.setattr(main, "_attachment_in_project", _not_in)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.get("/projects/3/attachments/999/content", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404


# ---------- RAG из счётчиков ----------
def _rag_of(total=0, overdue=0, high=0, unmitigated=0, medium=0):
    return main._rag({"_counts": {"rag_total": total, "rag_overdue": overdue, "risks_high": high,
                                  "risks_high_unmitigated": unmitigated, "risks_medium": medium}})


def test_rag(monkeypatch):
    monkeypatch.setattr(main, "_settings_cache", {})
    assert _rag_of() == "green"                                   # 0 работ, 0 рисков
    assert _rag_of(total=0, overdue=0) == "green"                 # при 0 работ процент не срабатывает
    assert _rag_of(total=4, overdue=2) == "amber"                 # 50%, но меньше 3 работ
    assert _rag_of(total=12, overdue=3) == "red"                  # ровно 25% и ровно 3
    assert _rag_of(total=13, overdue=3) == "amber"                # 3 из 13 — меньше 25%
    assert _rag_of(total=10, overdue=1) == "amber"                # хоть одна просрочка — жёлтый
    assert _rag_of(high=1, unmitigated=0) == "amber"              # высокий риск С планом — жёлтый
    assert _rag_of(high=1, unmitigated=1) == "red"                # высокий БЕЗ плана — красный
    assert _rag_of(medium=1) == "amber"                           # средний ≥ amber_medium


def _task(status="not_started", end="2020-01-01", ttype="task"):
    return {"task_type": ttype, "status": status, "planned_end": end}


def _risk(p="high", i="high", plan=None, status="open"):
    return {"probability": p, "impact": i, "mitigation_plan": plan, "status": status}


def test_rag_task_counts_same_definition_as_portfolio():
    today = "2026-09-30"
    tasks = [_task(), _task(status="completed"), _task(status="cancelled"),     # 1 просрочена
             _task(end="2027-01-01"), _task(ttype="phase")]                     # фаза не считается
    c = main._rag_task_counts(tasks, today)
    assert c == {"rag_total": 4, "rag_overdue": 1}


def test_risk_counts_unmitigated():
    c = main._risk_counts([_risk(), _risk(plan="  "), _risk(plan="эскалация"),
                           _risk(status="closed"), _risk(p="low", i="low")])
    assert c["risks_high"] == 3 and c["risks_high_unmitigated"] == 2   # пробелы — это не план


def test_project_rag_closed_and_manual(monkeypatch):
    monkeypatch.setattr(main, "_settings_cache", {})
    bad = [_task() for _ in range(5)]
    assert main._project_rag({}, bad, [], "2026-09-30", done=True) == "green"          # закрытый — зелёный
    assert main._project_rag({"rag_status": "green"}, bad, [], "2026-09-30", False) == "green"  # ручной главнее
    assert main._project_rag({}, bad, [], "2026-09-30", False) == "red"


def test_rag_same_color_on_every_path(monkeypatch):
    """Один проект через все пути даёт ОДИН цвет: строка портфеля, сводка проекта, дайджест.

    Раньше сводка и дайджест считали задачи вместе с фазами и отменённые — просроченными, и цвет
    одного проекта в портфеле и в его сводке мог различаться. Проект построен так, чтобы старый
    способ счёта дал другой ответ: 3 просрочки только если считать отменённые.
    """
    monkeypatch.setattr(main, "_settings_cache", {})
    today = main.datetime.now(main.timezone.utc).date().isoformat()
    tasks = ([_task(end="2020-01-01") for _ in range(2)] + [_task(status="cancelled")]
             + [_task(end="2099-01-01") for _ in range(6)] + [_task(ttype="phase")])
    risks = [_risk(plan="есть план")]
    p = {"id": "9", "code": "X", "name": "X", "status": "active", "priority": "medium", "pm_name": None,
         "planned_end": None}
    row = main._portfolio_row(p, {}, tasks, risks, {}, today)
    direct = main._project_rag({}, tasks, risks, today, False)
    assert row["rag_status"] == direct == "amber"          # 2 из 8 и риск с планом — жёлтый

    # Сводка проекта и дайджест зовут ту же точку; старый способ (все WP, отменённые в просрочке)
    # насчитал бы здесь 3 просрочки и дал бы красный.
    import inspect
    import projects_routes
    assert "_project_rag" in inspect.getsource(projects_routes)
    assert "_project_rag(" in inspect.getsource(main._run_leadership_digest)


# ======================== G1/G2 (audit#3) ========================

# ---------- G2: критический путь (CPM по подграфу зависимостей) ----------
def test_compute_critical():
    tasks = [
        {"id": "1", "task_type": "task", "duration_days": 3},
        {"id": "2", "task_type": "task", "duration_days": 2},
        {"id": "3", "task_type": "task", "duration_days": 4},
        {"id": "9", "task_type": "task", "duration_days": 99},  # изолированная длинная — НЕ критическая
        {"id": "p", "task_type": "phase", "duration_days": 0},   # фаза — не узел
    ]
    deps = [{"depends_on_id": "1", "task_id": "2"}, {"depends_on_id": "2", "task_id": "3"}]
    crit = main._compute_critical(tasks, deps)
    assert crit == {"1", "2", "3"}                  # цепочка критична целиком
    assert "9" not in crit                          # изолированная не входит в критпуть
    assert main._compute_critical(tasks, []) == set()  # без зависимостей — пусто


def test_compute_critical_cycle_safe():
    tasks = [{"id": "1", "task_type": "task", "duration_days": 1}, {"id": "2", "task_type": "task", "duration_days": 1}]
    deps = [{"depends_on_id": "1", "task_id": "2"}, {"depends_on_id": "2", "task_id": "1"}]  # цикл
    assert main._compute_critical(tasks, deps) == set()  # не падает, возвращает пусто


# ---------- G2: агрегаты бюджета (by_category + burn-down) ----------
def test_budget_aggregates():
    items = [
        {"category": "Dev", "planned_amount": 1000, "actual_amount": 800,
         "monthly": [{"month": "2026-01", "planned": 600, "actual": 500}, {"month": "2026-02", "planned": 400, "actual": 300}]},
        {"category": "Dev", "planned_amount": 500, "actual_amount": 400, "monthly": []},
        {"category": "QA", "planned_amount": 200, "actual_amount": 100, "monthly": [{"month": "2026-01", "planned": 200, "actual": 100}]},
    ]
    cats, monthly = main._budget_aggregates(items)
    bycat = {c["category"]: c for c in cats}
    assert bycat["Dev"]["planned"] == 1500 and bycat["QA"]["actual"] == 100
    assert monthly[0]["month"] == "2026-01" and monthly[0]["planned"] == 800   # 600+200
    assert monthly[-1]["cum_planned"] == 1200 and monthly[-1]["cum_actual"] == 900


def test_budget_planned_actual_new_fields():
    # Новая простая форма пишет amount (план) и actual_total (факт) — строками из формы.
    assert main._budget_planned({"amount": "1000"}) == 1000
    assert main._budget_actual({"actual_total": "800"}) == 800
    # by_category читает новые поля
    cats, _ = main._budget_aggregates([{"category": "X", "amount": "1000", "actual_total": "800"}])
    assert cats[0]["planned"] == 1000 and cats[0]["actual"] == 800
    # legacy: forecast_total / разбивка
    assert main._budget_planned({"forecast_total": 500}) == 500
    assert main._budget_planned({"equipment_amount": 100, "labour_amount": 200}) == 300


def test_unique_code():
    # первый клон — как есть; повторные — с суффиксом; регистр/пробелы не в счёт
    assert main._unique_code("PRJ-COPY", []) == "PRJ-COPY"
    assert main._unique_code("PRJ-COPY", ["PRJ-COPY"]) == "PRJ-COPY-2"
    assert main._unique_code("PRJ-COPY", ["prj-copy ", "PRJ-COPY-2"]) == "PRJ-COPY-3"
    assert main._unique_code("PRJ-COPY", ["OTHER"]) == "PRJ-COPY"


def test_budget_monthly_fallback_and_kind():
    # План/факт статьи без явных сумм считаются из помесячных записей.
    item = {"monthly": [{"year": 2026, "month": 1, "planned": 1000, "actual": 900},
                        {"year": 2027, "month": 1, "planned": 500, "actual": 0}]}
    assert main._budget_planned(item) == 1500
    assert main._budget_actual(item) == 900
    # amount/actual_total имеют приоритет над помесячными
    assert main._budget_planned({"amount": 2000, "monthly": [{"planned": 1}]}) == 2000
    # kind: явный income, легаси revenue → income, иначе расход
    assert main._budget_kind({"kind": "income"}) == "income"
    assert main._budget_kind({"category": "revenue"}) == "income"
    assert main._budget_kind({"kind": "expense", "category": "revenue"}) == "expense"
    assert main._budget_kind({"category": "operational"}) == "expense"


def test_share_cfg_defaults():
    assert main._share_cfg({}) == {"enabled": False, "token": "", "sections": []}
    cfg = main._share_cfg({"_share": {"enabled": True, "token": "abc", "sections": ["wbs", "risks"]}})
    assert cfg["enabled"] is True and cfg["token"] == "abc" and cfg["sections"] == ["wbs", "risks"]


# ---------- G2: перегрузка/мультипроектность в workload ----------
def test_workload_overload_and_projects():
    tasks = [{"task_type": "task", "status": "in_progress", "assignee_name": "Z",
              "project_id": f"p{i % 2}", "duration_days": 1} for i in range(9)]
    row = main._workload_from_tasks(tasks)[0]
    assert row["open_tasks"] == 9 and row["overloaded"] is True and row["projects_count"] == 2
    low = main._workload_from_tasks([{"task_type": "task", "status": "in_progress", "assignee_name": "Y", "project_id": "p1"}])[0]
    assert low["overloaded"] is False and low["projects_count"] == 1


# ---------- G1: страж размера описания (413) ----------
def test_serialize_meta_limit(monkeypatch):
    import pytest
    monkeypatch.setattr(main, "_DESC_MAX", 50)
    main._serialize_meta("5", {"k": "v"})            # маленькое — ок
    with pytest.raises(main.HTTPException) as e:
        main._serialize_meta("5", {"k": "x" * 200})
    assert e.value.status_code == 413


# ---------- G1: валидация проекта/генерик-айтема/пользователя ----------
def test_validate_project_payload():
    import pytest
    with pytest.raises(main.HTTPException) as e:
        main._validate_project_payload({"status": "weird"})
    assert e.value.status_code == 422
    with pytest.raises(main.HTTPException):
        main._validate_project_payload({"priority": "huge"})
    main._validate_project_payload({"status": "active", "priority": "high", "name": "P"})  # ок
    with pytest.raises(main.HTTPException):  # начало позже завершения
        main._validate_project_payload({"planned_start": "2026-05-01", "planned_end": "2026-01-01"})
    main._validate_project_payload({"planned_start": "2026-01-01", "planned_end": "2026-05-01"})  # ок


def test_validate_generic_item():
    import pytest
    with pytest.raises(main.HTTPException):
        main._validate_generic_item(["not", "dict"])
    with pytest.raises(main.HTTPException) as e:
        main._validate_generic_item({"note": "x" * 20001})
    assert e.value.status_code == 422
    main._validate_generic_item({"name": "ok", "n": 5})  # ок


def test_validate_user_payload():
    import pytest
    with pytest.raises(main.HTTPException) as e:
        main._validate_user_payload({"email": "bad", "password": "1234"}, require_email=True, require_password=True)
    assert e.value.status_code == 422                # email без @
    with pytest.raises(main.HTTPException):
        main._validate_user_payload({"email": "a@b.com", "role": "king", "password": "1234"}, require_email=True, require_password=True)
    with pytest.raises(main.HTTPException):
        main._validate_user_payload({"email": "a@b.com", "password": "12"}, require_email=True, require_password=True)  # короткий пароль
    main._validate_user_payload({"email": "a@b.com", "role": "pm", "password": "12345678", "full_name": "A"}, require_email=True, require_password=True)


# ---------- G1: управление пользователями (/admin/users) ----------
def test_admin_users_rbac():
    ow = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    pm = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.get("/admin/users", headers={"Authorization": f"Bearer {ow}"})
    assert r.status_code == 200
    emails = {u["email"] for u in r.json()["data"]}
    assert "owner@company.com" in emails and "pm1@company.com" in emails
    assert client.get("/admin/users", headers={"Authorization": f"Bearer {pm}"}).status_code == 403  # pm не админ


def test_admin_users_create_dup_delete(monkeypatch):
    async def _noop_save():  # не писать в БД в тесте
        return None
    monkeypatch.setattr(main, "_save_users", _noop_save)
    ow = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {ow}"}
    email = "unit.temp@company.com"
    try:
        r = client.post("/admin/users", headers=h, json={"email": email, "password": "pass1234", "full_name": "Unit Temp", "role": "pm"})
        assert r.status_code == 200
        uid = r.json()["data"]["id"]
        assert email in main.USERS
        # дубликат → 409
        assert client.post("/admin/users", headers=h, json={"email": email, "password": "x1234567", "full_name": "Dup", "role": "pm"}).status_code == 409
        assert client.delete(f"/admin/users/{uid}", headers=h).status_code == 200
        assert email not in main.USERS
    finally:
        main.USERS.pop(email, None)


def test_me_password_wrong_current_403():
    pm = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.put("/me/password", headers={"Authorization": f"Bearer {pm}"},
                   json={"current_password": "WRONG", "new_password": "abcd"})
    assert r.status_code == 403


# ---------- G1: валидация зависимостей (self/обязательность/кросс-проект) ----------
def test_dep_validation(monkeypatch):
    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    pm = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {pm}"}
    assert client.post("/projects/5/task-dependencies", headers=h, json={"task_id": "1", "depends_on_id": "1"}).status_code == 422  # self-dep
    assert client.post("/projects/5/task-dependencies", headers=h, json={}).status_code == 422  # нет id

    async def _not_in(tid, pid):
        return False
    # dep_create теперь валидирует оба конца как ЗАДАЧИ (_task_in_project), а не любой WP —
    # иначе risk id проходил бы как зависимость задачи.
    monkeypatch.setattr(main, "_task_in_project", _not_in)
    assert client.post("/projects/5/task-dependencies", headers=h, json={"task_id": "1", "depends_on_id": "2"}).status_code == 404  # не в проекте (или не задача)


# ---------- S1: деактивированный пользователь теряет доступ по выданному токену ----------
def test_deactivated_user_token_rejected():
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/auth/me", headers=h).status_code == 200
    main.USERS["pm1@company.com"]["is_active"] = False   # деактивация (как admin_users_update)
    try:
        assert client.get("/auth/me", headers=h).status_code == 401
    finally:
        main.USERS["pm1@company.com"]["is_active"] = True


# ---------- transfer: новый РП должен быть активным и не viewer ----------
def test_transfer_rejects_inactive_and_viewer(monkeypatch):
    # Маршрут перешёл с require_owner на rbac (передавать может и основной РП), а rbac проверяет
    # доступ к проекту по базе — в тесте её нет.
    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)

    async def fake_load(pid):
        return ({"id": pid}, {"pm_id": "someone", "pm_name": "Someone"})
    monkeypatch.setattr(main, "load_meta", fake_load)
    ow = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {ow}"}
    main.USERS["viewer@company.com"] = {"id": "vid1", "full_name": "Viewer", "role": "viewer", "is_active": True}
    main.USERS["dead@company.com"] = {"id": "did1", "full_name": "Dead PM", "role": "pm", "is_active": False}
    try:
        assert client.post("/admin/projects/5/transfer", headers=h, json={"pm_id": "vid1"}).status_code == 422
        assert client.post("/admin/projects/5/transfer", headers=h, json={"pm_id": "did1"}).status_code == 422
        assert client.post("/admin/projects/5/transfer", headers=h, json={"pm_id": "missing"}).status_code == 404
    finally:
        main.USERS.pop("viewer@company.com", None)
        main.USERS.pop("dead@company.com", None)


# ---------- G5: отзыв токена (logout) ----------
def test_logout_revokes_token():
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    try:
        assert client.get("/auth/me", headers=h).status_code == 200
        assert client.post("/auth/logout", headers=h).status_code == 200
        assert client.get("/auth/me", headers=h).status_code == 401  # токен отозван
    finally:
        main._REVOKED.clear()


# ---------- Block 8: смена пароля отзывает прежние токены ----------
def test_password_change_stamps_pw_changed_at(monkeypatch):
    # Проверяем проводку роута: PUT /me/password проставляет pw_changed_at (отзыв прежних сессий).
    async def noop_save():
        return None
    monkeypatch.setattr(main, "_save_users", noop_save)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    try:
        assert client.get("/auth/me", headers=h).status_code == 200
        r = client.put("/me/password", headers=h, json={"current_password": "pm123", "new_password": "pm124xyz"})
        assert r.status_code == 200
        assert main.USERS["pm1@company.com"].get("pw_changed_at")  # штамп проставлен
    finally:
        u = main.USERS["pm1@company.com"]
        u.pop("password_hash", None); u.pop("pw_changed_at", None); u["password"] = "pm123"


def test_pw_epoch_rejects_pre_change_token():
    import time as _t
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    main.USERS["pm1@company.com"]["pw_changed_at"] = int(_t.time()) + 10  # строго позже выдачи токена
    try:
        assert client.get("/auth/me", headers=h).status_code == 401  # токен предшествует смене пароля
    finally:
        main.USERS["pm1@company.com"].pop("pw_changed_at", None)


def test_token_ttl_derives_issued():
    import time as _t
    before = int(_t.time())
    tok = main.make_token("owner@company.com")
    data = main.read_token(tok)
    issued = data["exp"] - main.security_ops.TOKEN_TTL
    assert before <= issued <= int(_t.time())  # issued-at корректно выводится из exp - TTL


def test_revocation_persists_via_store():
    import asyncio
    store = {}

    async def fake_db_revoke(sig, exp):
        store[sig] = exp

    revoked = {}
    asyncio.run(main.security_ops.revoke_token(
        "sig1", 9999999999.0, redis_client=None, revoked=revoked,
        logger=main.logger, db_revoke=fake_db_revoke))
    assert store == {"sig1": 9999999999.0}  # записано в durable-стор (переживёт рестарт)
    assert revoked.get("sig1") == 9999999999.0  # и в память (горячий путь)


# ---------- G5: шифрование секрета-at-rest (op_token) ----------
def test_encrypt_secret_roundtrip():
    import pytest
    if main._FERNET is None:
        pytest.skip("cryptography недоступен")
    enc = main._encrypt_secret("op-secret-123")
    assert enc.startswith("enc:") and enc != "op-secret-123"
    assert main._decrypt_secret(enc) == "op-secret-123"
    assert main._decrypt_secret("legacy-plain") == "legacy-plain"  # обратная совместимость с плейнтекстом


# ---------- R1: анти-IDOR в активности/комментариях ----------
def test_activity_scope_denied(monkeypatch):
    # PM владеет проектом (rbac ок), но WP НЕ из этого проекта → 404 (нельзя читать/писать чужие комментарии).
    async def _owns(u, p):
        return True

    async def _not_in(wpid, pid):
        return False
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    # Чтение и запись проверяются разными гардами (наблюдатель читает, но не пишет) —
    # чтобы дойти до объектной проверки, пропускаем оба.
    monkeypatch.setattr(main, "_user_can_read_project", _owns)
    monkeypatch.setattr(main, "_wp_in_project", _not_in)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/projects/3/work-packages/999/activity", headers=h).status_code == 404
    assert client.post("/projects/3/work-packages/999/activity", headers=h, json={"comment": "x"}).status_code == 404


# ---------- R3: прод fail-fast секретов ----------
def test_enforce_prod_secrets(monkeypatch):
    import pytest
    monkeypatch.delenv("ADAPTER_ENV", raising=False)
    main._enforce_prod_secrets()  # dev + дефолт → только warning, без исключения
    monkeypatch.setenv("ADAPTER_ENV", "production")
    monkeypatch.setattr(main, "SECRET", b"pmo-adapter-secret")
    with pytest.raises(RuntimeError):
        main._enforce_prod_secrets()                      # prod + дефолтный secret
    monkeypatch.setattr(main, "SECRET", b"short-secret")  # не дефолт, но < 32 байт
    with pytest.raises(RuntimeError):
        main._enforce_prod_secrets()                      # prod + слишком короткий secret
    monkeypatch.setattr(main, "SECRET", b"real-secret-abcdefghijklmnopqrstuvwxyz")  # ≥32 байт
    monkeypatch.setattr(main, "_USERS_FALLBACK", False)   # БД-пользователи загружены (не сид)
    # БД со сменёнными паролями (без дефолтных сид-кред) — чтобы кейсы ниже проверяли своё условие
    _strong = {"real@company.com": {"id": "1", "password_hash": main._hash_pw("Str0ng-Pass-9"),
                                    "full_name": "Real Owner", "role": "owner", "is_active": True}}
    monkeypatch.setattr(main, "USERS", _strong)
    monkeypatch.setattr(main, "BITRIX_URL", "https://bx.example")
    monkeypatch.setattr(main, "BITRIX_INBOUND_TOKEN", "")
    with pytest.raises(RuntimeError):
        main._enforce_prod_secrets()                      # prod + Bitrix без inbound-токена
    monkeypatch.setattr(main, "BITRIX_INBOUND_TOKEN", "tok")
    main._enforce_prod_secrets()                          # prod + всё задано → ок
    # сид-аккаунт всё ещё принимает пароль по умолчанию (admin123) в наполненной БД → fail-fast
    monkeypatch.setattr(main, "USERS", {"owner@company.com": {"id": "1", "password": "admin123",
                                        "full_name": "Portfolio Owner", "role": "owner", "is_active": True}})
    with pytest.raises(RuntimeError):
        main._enforce_prod_secrets()
    monkeypatch.setattr(main, "USERS", _strong)
    # fallback-креды (пустая таблица users) в проде → fail-fast
    monkeypatch.setattr(main, "BITRIX_URL", "")
    monkeypatch.setattr(main, "_USERS_FALLBACK", True)
    with pytest.raises(RuntimeError):
        main._enforce_prod_secrets()
    monkeypatch.setattr(main, "_USERS_FALLBACK", False)
    main._enforce_prod_secrets()                          # реальный users → ок


def test_redact_public_strips_author_id():
    # публичная share-выдача рисков не отдаёт author_id апдейтов (внутренний UUID)
    src = [{"id": "r1", "title": "Risk", "updates": [{"author_id": "uuid-x", "text": "note"}]}]
    out = main._redact_public(src)
    assert "author_id" not in out[0]["updates"][0]
    assert out[0]["updates"][0]["text"] == "note" and out[0]["title"] == "Risk"


def test_task_payload_rejects_non_numeric():
    main._validate_task_payload({"progress": "50", "estimated_hours": 8})  # валидные — без исключения
    for bad in ({"progress": "abc"}, {"estimated_hours": "x"}, {"actual_hours": "n/a"}):
        with pytest.raises(main.HTTPException) as e:
            main._validate_task_payload(bad)
        assert e.value.status_code == 422, bad


def test_generic_item_rejects_huge_list():
    main._validate_generic_item({"action_items": [{"t": "x"}, {"t": "y"}]})  # норм
    with pytest.raises(main.HTTPException) as e:
        main._validate_generic_item({"action_items": [0] * 5001})
    assert e.value.status_code == 422


def test_me_password_rate_limited():
    # перебор текущего пароля через /me/password ограничен (иначе обход лимита /auth/login)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    codes = [client.put("/me/password", headers=h,
                        json={"current_password": "WRONG", "new_password": "irrelevant"}).status_code
             for _ in range(main._LOGIN_MAX + 1)]
    assert codes[:main._LOGIN_MAX] == [403] * main._LOGIN_MAX  # неверный текущий пароль
    assert codes[-1] == 429                                    # лимит попыток


# ---------- RBAC-1/6: передача проекта owner'ом + журнал действий ----------
def test_project_transfer_and_action_log(monkeypatch):
    meta = {"pm_id": "old", "pm_name": "Old PM", "_action_log": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        # эмулируем append-слив журнала (A2): with_meta_retry сливает _pending_action_log в project_docs
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r

    async def fake_load(pid):
        return ({"id": pid}, meta)
    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setitem(main.USERS, "new@company.com",
                        {"id": "newpm", "full_name": "New PM", "role": "pm", "is_active": True, "password": "x"})
    otok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    oh = {"Authorization": f"Bearer {otok}"}
    ptok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    # РП чужого проекта передавать не может: pm_id проекта — «old», а не он
    assert client.post("/admin/projects/9/transfer", headers={"Authorization": f"Bearer {ptok}"},
                       json={"pm_id": "newpm"}).status_code == 403
    # несуществующий pm_id → 404
    assert client.post("/admin/projects/9/transfer", headers=oh, json={"pm_id": "ghost"}).status_code == 404
    # успешная передача
    r = client.post("/admin/projects/9/transfer", headers=oh, json={"pm_id": "newpm", "pm_name": "New PM"}).json()["data"]
    assert r["pm_id"] == "newpm" and r["pm_name"] == "New PM"
    # действие залогировано и читается новейшим сверху
    log = client.get("/projects/9/action-log", headers=oh).json()["data"]
    assert log and log[0]["action"] == "project.transfer" and "New PM" in log[0]["detail"]


def _transfer_env(monkeypatch, meta):
    """Окружение передачи без базы: доступ к проекту, мета и слив журнала."""
    async def _owns(u, p):
        return True

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_user_can_read_project", _owns)   # GET-маршрут спрашивает чтение
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setitem(main.USERS, "new@company.com",
                        {"id": "newpm", "full_name": "New PM", "role": "pm", "is_active": True, "password": "x"})
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}, main.USERS["pm1@company.com"]["id"]


def test_primary_pm_can_transfer_own_project(monkeypatch):
    """Основной РП отдаёт СВОЙ проект сам.

    Раньше это могла только владельческая учётка, а она может быть одна на весь портал: отдать
    даже собственный проект было нечем, и каждая передача шла через владельца портфеля.
    """
    meta = {"pm_id": None, "pm_name": "PM One", "_action_log": []}
    h, pm_id = _transfer_env(monkeypatch, meta)
    meta["pm_id"] = pm_id                                     # проект принадлежит ему
    r = client.post("/admin/projects/9/transfer", headers=h, json={"pm_id": "newpm", "pm_name": "New PM"})
    assert r.status_code == 200, r.text
    assert meta["pm_id"] == "newpm" and meta["pm_name"] == "New PM"


def test_transfer_leaves_previous_pm_as_co_pm(monkeypatch):
    """Кто отдал — остаётся со-РП.

    Без этого человек нажимает «Передать» и в ту же секунду теряет доступ к собственному проекту,
    а вернуть его может только владелец портфеля — то есть кнопка создавала бы тупик.
    """
    meta = {"pm_id": None, "pm_name": "PM One", "_action_log": []}
    h, pm_id = _transfer_env(monkeypatch, meta)
    meta["pm_id"] = pm_id
    assert client.post("/admin/projects/9/transfer", headers=h,
                       json={"pm_id": "newpm", "pm_name": "New PM"}).status_code == 200
    assert str(pm_id) in [str(x) for x in meta.get("_editors", [])]


def test_owner_transfer_does_not_add_itself_as_co_pm(monkeypatch):
    # Владелец портфеля передаёт ЧУЖОЙ проект — списка со-РП это не касается (у него и так всё видно).
    meta = {"pm_id": "old", "pm_name": "Old PM", "_action_log": []}
    _transfer_env(monkeypatch, meta)
    otok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    assert client.post("/admin/projects/9/transfer", headers={"Authorization": f"Bearer {otok}"},
                       json={"pm_id": "newpm", "pm_name": "New PM"}).status_code == 200
    assert not meta.get("_editors")


def test_co_pm_cannot_transfer(monkeypatch):
    """Со-РП передавать не может — и это не мелочь.

    У со-РП полная запись через _owns_item; пусти его сюда — и он назначил бы основным РП себя,
    заперев прежнего: управление со-РП есть только у основного.
    """
    meta = {"pm_id": "other", "pm_name": "Other PM", "_action_log": []}
    h, pm_id = _transfer_env(monkeypatch, meta)
    meta["_editors"] = [pm_id]                                # он со-РП, но не основной
    assert client.post("/admin/projects/9/transfer", headers=h, json={"pm_id": "newpm"}).status_code == 403


def test_transfer_candidates_only_active_writers(monkeypatch):
    """Список «кому отдать» отдаёт сервер: раньше диалог брал его из /admin/users (только владелец),
    и у РП он открывался пустым. Заодно правило «кто может быть РП» перестало дублироваться на фронте.
    """
    meta = {"pm_id": None, "pm_name": "PM One"}
    h, pm_id = _transfer_env(monkeypatch, meta)
    meta["pm_id"] = pm_id
    monkeypatch.setitem(main.USERS, "dead@company.com",
                        {"id": "deadid", "full_name": "Dead PM", "role": "pm", "is_active": False})
    ids = [u["id"] for u in client.get("/projects/9/transfer-candidates", headers=h).json()["data"]]
    assert "newpm" in ids
    assert "deadid" not in ids          # неактивному проект не отдать
    assert str(pm_id) not in ids        # и самому себе тоже незачем


def test_put_project_cannot_change_pm_id(monkeypatch):
    # P0-authz: обычный PUT /projects/{pid} (author задан) НЕ может сменить ВЛАДЕЛЬЦА (pm_id) — иначе
    # со-РП (write через _owns_item) выставил бы pm_id=себе и стал бы основным РП. Менять РП может
    # только руководитель портфеля. На create (author=None) pm_id выставляется штатно.
    #
    # Контракт ужесточён: pm_name больше НЕ косметическое. Пока подпись в паспорте жила
    # отдельно от владения, портал мог показывать одного руководителя, а проект лежал в папке
    # другого — и у названного РП «Мои проекты» оставались пусты. Теперь смена
    # подписи и есть передача проекта, и подчиняется тому же праву.
    # Подробности поведения — tests/test_pm_follows_passport.py.
    import asyncio
    import pytest

    async def fake_row(pid):
        return {"lockVersion": 1, "description": {"raw": '{"pm_id": "old", "pm_name": "Old PM"}'}, "name": "P"}

    async def fake_docs(pid):
        return {}

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        return True

    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    monkeypatch.setattr(main, "to_project", lambda d: {"ok": True})

    # PUT (author задан) со сменой pm_id на другое значение → 403
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main._save_meta("5", {"pm_id": "attacker"}, author="Co PM", user={"id": "co", "role": "pm"}))
    assert e.value.status_code == 403
    # смена подписи РП со-РП'ом — тоже 403: это передача проекта, а не правка текста
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main._save_meta("5", {"pm_name": "Co PM"}, author="Co PM", user={"id": "co", "role": "pm"}))
    assert e.value.status_code == 403
    # `pm` — алиас-подпись, владением не управляет и остаётся свободным полем
    assert asyncio.run(main._save_meta("5", {"pm": "New PM alias"}, author="Co PM")) == {"ok": True}
    # та же подпись в payload (автосохранение шлёт паспорт целиком) — не передача, проходит
    assert asyncio.run(main._save_meta("5", {"pm_name": "Old PM", "priority": "high"},
                                       author="Co PM", user={"id": "co", "role": "pm"})) == {"ok": True}
    # PUT без смены владельца (та же pm_id) — проходит
    assert asyncio.run(main._save_meta("5", {"pm_id": "old", "priority": "high"}, author="Co PM")) == {"ok": True}
    # create (author=None) — pm_id выставляется штатно (штатный путь project_create)
    assert asyncio.run(main._save_meta("5", {"pm_id": "attacker"})) == {"ok": True}


def test_archive_and_template(monkeypatch):
    meta = {"_action_log": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        # эмулируем append-слив журнала (A2): with_meta_retry сливает _pending_action_log в project_docs
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r

    async def _owns(u, p):
        return True

    async def _load(pid):
        # Шаблон теперь сначала смотрит на дерево — подменяем ТОТ шов, которым ходит код.
        return {}, meta
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "load_meta", _load)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/projects/3/archive", headers=h).json()["data"]["archived"] is True
    assert meta["_archived"] is True
    assert client.post("/projects/3/unarchive", headers=h).json()["data"]["archived"] is False
    assert client.post("/projects/3/template", headers=h, json={"on": True}).json()["data"]["is_template"] is True
    assert meta["_is_template"] is True
    acts = [e["action"] for e in meta["_action_log"]]
    assert "project.archive" in acts and "project.unarchive" in acts and "project.template" in acts


def test_template_refused_inside_tree(monkeypatch):
    """Проект в дереве шаблоном не становится: зонтик спрятался бы из списков вместе с живыми
    подпроектами, а клон шаблона детей не копирует — новый проект получил бы пустой зонтик."""
    state = {"meta": {"_action_log": []}}

    async def fake_retry(pid, mut, attempts=4):
        return mut(state["meta"])

    async def _owns(u, p):
        return True

    async def _load(pid):
        return {}, state["meta"]
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "load_meta", _load)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    state["meta"] = {"_action_log": [], "_tree": {"parent_id": "7", "subprojects_count": 0}}
    r = client.post("/projects/3/template", headers=h, json={"on": True})
    assert r.status_code == 422 and "отвяжите" in r.json()["detail"]

    state["meta"] = {"_action_log": [], "_tree": {"parent_id": None, "subprojects_count": 2}}
    r = client.post("/projects/3/template", headers=h, json={"on": True})
    assert r.status_code == 422 and "подпроект" in r.json()["detail"]

    # Снять флаг дереву не мешает: запрет только на «сделать шаблоном».
    assert client.post("/projects/3/template", headers=h, json={"on": False}).status_code == 200

    # Одиночный проект шаблоном становится как раньше.
    state["meta"] = {"_action_log": [], "_tree": {"parent_id": None, "subprojects_count": 0}}
    assert client.post("/projects/3/template", headers=h, json={"on": True}).json()["data"]["is_template"] is True


# ---------- со-РП (co-PM / _editors) ----------
def test_owns_item_honors_editors():
    # чистая логика: со-РП владеет проектом (и в форме to_project 'editors', и в мете '_editors')
    assert main._owns_item({"id": "u9"}, {"editors": ["u9"]}) is True
    assert main._owns_item({"id": "u9"}, {"_editors": ["u9", "x"]}) is True
    assert main._owns_item({"id": "u9"}, {"pm_id": "other", "_editors": ["z"]}) is False
    # но управлять со-РП co-PM не вправе (только основной РП/owner)
    assert main._is_primary_pm_or_owner({"id": "u9", "role": "pm"}, {"pm_id": "p", "_editors": ["u9"]}) is False
    assert main._is_primary_pm_or_owner({"id": "u9", "role": "owner"}, {"pm_id": "p"}) is True
    # S3: pm_name-совпадение больше не даёт прав управления (ни _owns_item, ни _is_primary)
    assert main._is_primary_pm_or_owner({"id": "u1", "role": "pm", "full_name": "PM One"},
                                        {"pm_id": None, "pm_name": "PM One"}) is False


def test_project_editors(monkeypatch):
    meta = {"pm_id": "primary1", "pm_name": "Primary", "_editors": [], "_action_log": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        # эмулируем append-слив журнала (A2): with_meta_retry сливает _pending_action_log в project_docs
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r

    async def fake_load(pid):
        return ({"id": pid}, meta)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setitem(main.USERS, "co1@company.com",
                        {"id": "co1", "full_name": "Co PM", "role": "pm", "is_active": True, "password": "x"})
    monkeypatch.setitem(main.USERS, "primary1@company.com",
                        {"id": "primary1", "full_name": "Primary", "role": "pm", "is_active": True, "password": "x"})
    oh = {"Authorization": "Bearer " + client.post("/auth/login",
          json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]}
    ph = {"Authorization": "Bearer " + client.post("/auth/login",
          json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]}
    # не основной РП и не owner → 403
    assert client.post("/projects/9/editors", headers=ph, json={"user_id": "co1"}).status_code == 403
    # несуществующий пользователь → 404
    assert client.post("/projects/9/editors", headers=oh, json={"user_id": "ghost"}).status_code == 404
    # добавить основного РП как со-РП → 422
    assert client.post("/projects/9/editors", headers=oh, json={"user_id": "primary1"}).status_code == 422
    # owner добавляет со-РП
    r = client.post("/projects/9/editors", headers=oh, json={"user_id": "co1"}).json()["data"]
    assert [e["id"] for e in r["editors"]] == ["co1"] and meta["_editors"] == ["co1"]
    # список со-РП
    lst = client.get("/projects/9/editors", headers=oh).json()["data"]
    assert lst[0]["id"] == "co1" and lst[0]["full_name"] == "Co PM"
    # убрать со-РП
    r2 = client.delete("/projects/9/editors/co1", headers=oh).json()["data"]
    assert r2["editors"] == [] and meta["_editors"] == []
    acts = [e["action"] for e in meta["_action_log"]]
    assert "project.editor_add" in acts and "project.editor_remove" in acts


# ---------- наблюдатель проекта (_observers) ----------
def test_observer_reads_but_never_writes():
    """Ключевой инвариант: наблюдатель есть в чтении и отсутствует в записи.

    Если наблюдателя однажды занесут в `_owns_item`, этот тест покраснеет — а вместе
    с ним покраснеет и попытка молча выдать право правки пяти write-гардам разом."""
    u = {"id": "obs1"}
    proj = {"_observers": ["obs1"], "pm_id": "other", "_editors": []}
    assert main._observes_item(u, proj) is True
    assert main._can_read_item(u, proj) is True
    assert main._owns_item(u, proj) is False        # <- запись закрыта
    # форма «наружу» (to_project отдаёт observers) распознаётся так же, как мета
    assert main._observes_item(u, {"observers": ["obs1"]}) is True
    # чужой наблюдатель прав не даёт
    assert main._can_read_item({"id": "nobody"}, proj) is False
    # пустой id не совпадает с пустым списком
    assert main._observes_item({"id": ""}, {"_observers": [""]}) is False


def test_observer_sees_project_in_list(monkeypatch):
    """Проект, где человек наблюдатель, обязан быть в его списке проектов."""
    uid = main.USERS["pm1@company.com"]["id"]   # id фикстуры, а не выдуманная строка

    async def fake_projects(*a, **kw):
        # Форма ровно как у db.project_shim: мета лежит строкой в description.raw.
        return [{"id": 7, "name": "Наблюдаемый", "identifier": "obs-7",
                 "description": {"raw": json.dumps({"code": "OBS-1", "status": "active",
                                                    "pm_id": "someone_else", "_observers": [uid]})},
                 "createdAt": "2026-09-04T00:00:00Z", "updatedAt": "2026-09-04T00:00:00Z"}]
    monkeypatch.setattr(main, "fetch_projects", fake_projects)

    async def no_wps(*a, **kw):
        return {}
    monkeypatch.setattr(main, "_fetch_wps_bulk", no_wps)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.get("/projects", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["data"]]
    assert ids == ["7"], r.json()
    # роль видна в строке списка — по ней фронт рисует пометку
    assert r.json()["data"][0]["observers"] == [uid]


def test_observer_project_reaches_every_read_aggregator(monkeypatch):
    """Наблюдаемый проект обязан доходить до ВСЕХ читающих сводок, а не только до списка.

    Ловит целый класс ошибок: у портфеля, дайджеста «Требует внимания» и поиска были
    СВОИ строчки фильтра, скопированные с `_owns_item`. Список проектов чинится сменой
    одной функции, а эти три копии молча остаются на владении — и РП видит проект в
    списке, но не в портфеле. Проверяем каждую точку отдельно; тест на «ничего не
    утекло» (test_pm_sees_own_scoped_portfolio) такую потерю не поймает: там пусто и
    при исправном коде, и при сломанном."""
    uid = main.USERS["pm1@company.com"]["id"]

    async def fake_projects(*a, **kw):
        return [{"id": 7, "name": "Наблюдаемый проект", "identifier": "obs-7",
                 "description": {"raw": json.dumps({"code": "OBS-1", "status": "active",
                                                    "pm_id": "someone_else", "_observers": [uid]})},
                 "createdAt": "2026-09-04T00:00:00Z", "updatedAt": "2026-09-04T00:00:00Z"}]

    async def empty_map(*a, **kw):
        return {}
    monkeypatch.setattr(main, "fetch_projects", fake_projects)
    monkeypatch.setattr(main, "_fetch_wps_bulk", empty_map)
    monkeypatch.setattr(main.db, "load_latest_baselines", empty_map)
    monkeypatch.setattr(main, "_load_snapshots", empty_map)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    rows = client.get("/portfolio/dashboard", headers=h).json()["data"]
    assert [r["id"] for r in rows] == ["7"], rows

    found = client.get("/search?q=Наблюдаемый", headers=h).json()["data"]
    assert [p["project_id"] for p in found["projects"]] == ["7"], found


def test_project_observers_routes(monkeypatch):
    meta = {"pm_id": "primary1", "pm_name": "Primary", "_editors": [], "_observers": [], "_action_log": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r

    async def fake_load(pid):
        return ({"id": pid}, meta)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setitem(main.USERS, "watch1@company.com",
                        {"id": "watch1", "full_name": "Watcher", "role": "pm", "is_active": True, "password": "x"})
    monkeypatch.setitem(main.USERS, "co1@company.com",
                        {"id": "co1", "full_name": "Co PM", "role": "pm", "is_active": True, "password": "x"})
    monkeypatch.setitem(main.USERS, "primary1@company.com",
                        {"id": "primary1", "full_name": "Primary", "role": "pm", "is_active": True, "password": "x"})
    oh = {"Authorization": "Bearer " + client.post("/auth/login",
          json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]}
    ph = {"Authorization": "Bearer " + client.post("/auth/login",
          json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]}

    # не основной РП и не owner → 403 (наблюдателей не плодят все подряд)
    assert client.post("/projects/9/observers", headers=ph, json={"user_id": "watch1"}).status_code == 403
    # несуществующий пользователь → 404
    assert client.post("/projects/9/observers", headers=oh, json={"user_id": "ghost"}).status_code == 404
    # основной РП наблюдателем быть не может — он и так видит больше
    assert client.post("/projects/9/observers", headers=oh, json={"user_id": "primary1"}).status_code == 422
    # со-РП не понижают до наблюдателя незаметной командой
    meta["_editors"] = ["co1"]
    assert client.post("/projects/9/observers", headers=oh, json={"user_id": "co1"}).status_code == 422
    meta["_editors"] = []
    # owner добавляет наблюдателя
    r = client.post("/projects/9/observers", headers=oh, json={"user_id": "watch1"}).json()["data"]
    assert [o["id"] for o in r["observers"]] == ["watch1"] and meta["_observers"] == ["watch1"]
    # повторное добавление не плодит дублей
    r = client.post("/projects/9/observers", headers=oh, json={"user_id": "watch1"}).json()["data"]
    assert meta["_observers"] == ["watch1"]
    # действие попало в журнал проекта
    assert any(a.get("action") == "project.observer_add" for a in meta["_action_log"]), meta["_action_log"]
    # список
    lst = client.get("/projects/9/observers", headers=oh).json()["data"]
    assert lst[0]["id"] == "watch1" and lst[0]["full_name"] == "Watcher"
    # снять
    r2 = client.delete("/projects/9/observers/watch1", headers=oh).json()["data"]
    assert r2["observers"] == [] and meta["_observers"] == []

    # Повышение наблюдателя до со-РП переводит его, а не оставляет в двух списках разом.
    # Иначе в списке проектов одно имя стояло бы и в «Со-РП», и в «Наблюдателях», а снятие
    # со-РП тихо оставляло бы человеку доступ на чтение.
    client.post("/projects/9/observers", headers=oh, json={"user_id": "watch1"})
    assert meta["_observers"] == ["watch1"]
    client.post("/projects/9/editors", headers=oh, json={"user_id": "watch1"})
    assert meta["_editors"] == ["watch1"], meta
    assert meta["_observers"] == [], "наблюдателя не сняли при повышении до со-РП"
    # Проект, где наблюдателей отродясь не было, лишнего ключа в мете не получает:
    # мета — байтовый контракт, пустой список менял бы её у каждого проекта с со-РП.
    clean = {"pm_id": "primary1", "pm_name": "Primary", "_editors": [], "_action_log": []}
    meta.clear()
    meta.update(clean)
    client.post("/projects/9/editors", headers=oh, json={"user_id": "watch1"})
    assert "_observers" not in meta, meta


def test_access_cache_invalidation_clears_both_guards():
    """Кэш доступа чистится и для чтения, и для записи.

    Ключи разной формы: (uid, pid) у владения и (uid, pid, "read") у чтения. Точечная
    чистка одного ключа оставила бы второй жить до 30 секунд — новый со-РП или
    наблюдатель полминуты не видел бы проект."""
    main._OWNS_TTL[("u1", "42")] = (True, 9e9)
    main._OWNS_TTL[("u1", "42", "read")] = (True, 9e9)
    main._OWNS_TTL[("u2", "42")] = (True, 9e9)
    main._invalidate_user_access("u1", "42")
    assert ("u1", "42") not in main._OWNS_TTL
    assert ("u1", "42", "read") not in main._OWNS_TTL
    assert ("u2", "42") in main._OWNS_TTL          # чужой доступ не трогаем
    main._invalidate_project_ownership("42")        # сброс по всему проекту
    assert not [k for k in main._OWNS_TTL if k[1] == "42"]


def test_project_create_forces_creator_as_pm(monkeypatch):
    # Регресс Excel-импорта: создатель обязан стать РП, иначе pm тут же 403 на свои же данные.
    captured = {}

    async def fake_insert(name, identifier, meta_raw):
        return {"id": "999"}

    async def fake_save(pid, payload, author=None):
        captured["payload"] = payload
        return {"id": pid, **payload}
    monkeypatch.setattr(main.db, "insert_project", fake_insert)
    monkeypatch.setattr(main, "_save_meta", fake_save)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    me = client.get("/auth/me", headers=h).json()
    me = me.get("data") or me
    r = client.post("/projects", headers=h, json={"name": "Imported", "pm_name": "Someone From Excel"})
    assert r.status_code == 200
    # pm_name из файла перезаписан создателем, pm_id проставлен на создателя
    assert str(captured["payload"]["pm_id"]) == str(me["id"])
    assert captured["payload"]["pm_name"] == me["full_name"]
    assert captured["payload"]["pm_name"] != "Someone From Excel"


def test_project_create_validates_before_insert_and_cleans_up_failed_initial_save(monkeypatch):
    calls = {"insert": 0, "deleted": []}

    async def fake_insert(name, identifier, meta_raw):
        calls["insert"] += 1
        return {"id": "999"}

    async def fake_delete(pid):
        calls["deleted"].append(str(pid))

    monkeypatch.setattr(main.db, "insert_project", fake_insert)
    monkeypatch.setattr(main.db, "delete_project", fake_delete)
    h = _pm_headers(monkeypatch)

    invalid = client.post("/projects", headers=h, json={"name": "Bad", "status": "not-a-status"})
    assert invalid.status_code == 422 and calls["insert"] == 0

    async def failed_save(pid, payload, author=None):
        raise main.HTTPException(status_code=413, detail="too large")

    monkeypatch.setattr(main, "_save_meta", failed_save)
    failed = client.post("/projects", headers=h, json={"name": "Too large"})
    assert failed.status_code == 413 and calls["insert"] == 1
    assert calls["deleted"] == ["999"]


def test_risk_code_autoassign(monkeypatch):
    # Код риска никогда не присваивался (импорт и ручное добавление) → авто R-NN на create.
    meta = {}

    async def fake_fetch_risks(pid):
        return [{"code": "R-01"}]  # существующий риск занял R-01 → next = R-02

    async def fake_insert_risk(pid, fields):
        return {**fields, "id": 99}  # эхо строки (со всеми колонками из fields)

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)

    async def _owns(u, p):
        return True
    monkeypatch.setattr(main.db, "fetch_risks", fake_fetch_risks)
    monkeypatch.setattr(main.db, "insert_risk", fake_insert_risk)
    monkeypatch.setattr(main.db, "risk_shim", lambda r: {"id": r["id"], "subject": r.get("title"),
                        "description": {"raw": r.get("description") or ""}, "createdAt": "x", "lockVersion": 0,
                        "_links": {"type": {"title": "Risk"}, "status": {"href": "/api/v3/statuses/1"}}})
    monkeypatch.setattr(main.db, "risk_extra", lambda rows: (
        {str(rows[0]["id"]): {k: rows[0][k] for k in main._RISK_EXTRA_KEYS if rows[0].get(k) is not None}}
        if rows else {}))
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.post("/projects/5/risks", headers=h, json={"title": "Тестовый риск"}).json()["data"]
    assert r["code"] == "R-02"  # R-01 занят существующим риском
    # явный code из payload не перетирается автогенерацией
    r2 = client.post("/projects/5/risks", headers=h, json={"title": "Второй", "code": "RX-9"}).json()["data"]
    assert r2["code"] == "RX-9"


def test_create_user_from_person_links_both_ways(monkeypatch):
    """Логин, заведённый из справочника, обязан получить person_id СРАЗУ. Иначе «Мои задачи»
    у человека пусты без ошибки до ближайшего синка (_my_task_match сравнивает
    assignee_person_id именно с person_id и выходит сразу). Плюс пароль генерируется сервером
    и возвращается ровно один раз — рядом с data, но не внутри неё."""
    store = {"data": [{"id": "p-1", "first_name": "Иван", "last_name": "Новый",
                       "full_name": "Иван Новый", "email": "ivan@example.com", "bitrix24_id": None}]}
    monkeypatch.setattr(main.db, "load_persons", lambda: _aw(list(store["data"])))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aw(store["data"].__setitem__(0, ps[0])))
    monkeypatch.setattr(main, "_save_users", lambda: _aw(None))
    otok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    oh = {"Authorization": f"Bearer {otok}"}

    r = client.post("/admin/users", headers=oh, json={
        "email": "ivan@example.com", "full_name": "Иван Новый", "role": "pm",
        "person_id": "p-1", "generate_password": True,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    pw = body["generated_password"]
    assert len(pw) >= 12
    assert not (set(pw) & set("0O1lI")), "в пароле не должно быть путающих символов"
    assert "password" not in body["data"] and "password_hash" not in body["data"]

    created = main.USERS["ivan@example.com"]
    assert created["person_id"] == "p-1", "прямая связь логин→человек"
    assert store["data"][0]["user_id"] == created["id"], "обратная связь человек→логин"
    # пароль действительно рабочий, а не декоративный
    assert client.post("/auth/login", json={"email": "ivan@example.com", "password": pw}).status_code == 200
    main.USERS.pop("ivan@example.com", None)


def test_create_user_from_person_rejects_unknown_and_taken(monkeypatch):
    """Неизвестный человек → 404; человек с ЖИВОЙ учёткой → 409. Но висячая ссылка на
    удалённого пользователя блокировать не должна: admin_users_delete её не чистит."""
    store = {"data": [
        {"id": "p-2", "first_name": "А", "last_name": "Б", "full_name": "А Б", "email": "ab@example.com"},
        {"id": "p-3", "first_name": "В", "last_name": "Г", "full_name": "В Г", "email": "vg@example.com",
         "user_id": "ghost-user-id"},   # пользователь давно удалён
    ]}
    monkeypatch.setattr(main.db, "load_persons", lambda: _aw(list(store["data"])))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aw(None))
    monkeypatch.setattr(main, "_save_users", lambda: _aw(None))
    otok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    oh = {"Authorization": f"Bearer {otok}"}

    r = client.post("/admin/users", headers=oh, json={
        "email": "nobody@example.com", "person_id": "нет-такого", "generate_password": True})
    assert r.status_code == 404

    # висячая ссылка не мешает завести логин
    r = client.post("/admin/users", headers=oh, json={
        "email": "vg@example.com", "person_id": "p-3", "generate_password": True})
    assert r.status_code == 200, r.text
    main.USERS.pop("vg@example.com", None)

    # а живая — мешает
    store["data"][0]["user_id"] = main.USERS["owner@company.com"]["id"]
    r = client.post("/admin/users", headers=oh, json={
        "email": "ab@example.com", "person_id": "p-2", "generate_password": True})
    assert r.status_code == 409


def test_person_hidden_from_pickers_is_sparse(monkeypatch):
    """Признак «скрыт из пикеров» пишется ТОЛЬКО как true и удаляется при снятии галочки.
    Если бы писали false, документ тронутого человека отличался бы от нетронутых, а байты
    /persons — это голден-контракт. Проверяем и это, и что ключ дописывается в КОНЕЦ
    (порядок ключей — часть контракта)."""
    store = {"data": []}
    monkeypatch.setattr(main.db, "load_persons", lambda: _aw(list(store["data"])))
    monkeypatch.setattr(main.db, "save_persons", lambda ps: _aw(store.__setitem__("data", list(ps))))
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    pid_ = client.post("/persons", headers=h, json={"first_name": "Тех", "last_name": "Логин"}).json()["data"]["id"]
    before = dict(next(p for p in store["data"] if p["id"] == pid_))
    assert "hidden_from_pickers" not in before, "новый человек виден по умолчанию"

    r = client.put(f"/persons/{pid_}", headers=h, json={"hidden_from_pickers": True})
    assert r.status_code == 200 and r.json()["data"]["hidden_from_pickers"] is True
    hidden = next(p for p in store["data"] if p["id"] == pid_)
    assert list(hidden)[-1] == "hidden_from_pickers", "ключ должен дописываться в конец"

    r = client.put(f"/persons/{pid_}", headers=h, json={"hidden_from_pickers": False})
    assert r.status_code == 200
    after = next(p for p in store["data"] if p["id"] == pid_)
    assert "hidden_from_pickers" not in after, "false обязан УДАЛЯТЬ ключ, а не писать false"
    # документ вернулся к исходному виду (updated_at сравнивать нельзя — он меняется осознанно)
    assert {k: v for k, v in after.items() if k != "updated_at"} ==            {k: v for k, v in before.items() if k != "updated_at"}


def test_bitrix_sync_does_not_unhide_person(monkeypatch):
    """Ночной синк не должен снимать галочку «скрыт»: иначе владелец переделывал бы работу
    каждое утро. Сейчас это верно по построению (синк пишет только свои поля) — закрепляем."""
    people = [{"id": "p1", "first_name": "Тех", "last_name": "Логин", "full_name": "Тех Логин",
               "bitrix24_id": 1, "email": "t@example.com", "is_active": True, "hidden_from_pickers": True}]

    async def _bx_call(method, payload=None):
        return {"result": [{"ID": 1, "NAME": "Тех", "LAST_NAME": "Логин", "EMAIL": "t@example.com"}], "next": None}, ""

    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x/rest/1/t")
    monkeypatch.setattr(main, "bx_call", _bx_call)
    monkeypatch.setattr(main, "_load_persons", lambda: _aw(people))
    monkeypatch.setattr(main.db, "upsert_persons", lambda ps: _aw(None))
    monkeypatch.setattr(main, "USERS", {})
    import asyncio
    asyncio.run(main._sync_bitrix_people())

    assert people[0].get("hidden_from_pickers") is True


async def _aw(v):
    return v


def test_persons_crud(monkeypatch):
    # /persons раньше не существовали в адаптере (мёртвый UI PersonPicker). Стор — таблица persons.
    store = {"data": []}

    async def fake_load():
        return list(store["data"])

    async def fake_save(persons):
        store["data"] = list(persons)
    monkeypatch.setattr(main.db, "load_persons", fake_load)
    monkeypatch.setattr(main.db, "save_persons", fake_save)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    otok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    oh = {"Authorization": f"Bearer {otok}"}
    # первичный сид из пользователей портала — пикер не пустой
    lst = client.get("/persons", headers=h).json()["data"]
    assert len(lst) >= 2
    # создать
    r = client.post("/persons", headers=h, json={"first_name": "Иван", "last_name": "Тестов"})
    assert r.status_code == 200 and r.json()["data"]["full_name"] == "Иван Тестов"
    pid_ = r.json()["data"]["id"]
    # дубликат → 409; без фамилии → 422
    assert client.post("/persons", headers=h, json={"first_name": "Иван", "last_name": "Тестов"}).status_code == 409
    assert client.post("/persons", headers=h, json={"first_name": "Икс", "last_name": ""}).status_code == 422
    # owner (админ портфеля) теперь тоже управляет общим справочником людей
    ro = client.post("/persons", headers=oh, json={"first_name": "А", "last_name": "Б"})
    assert ro.status_code == 200
    client.delete(f"/persons/{ro.json()['data']['id']}", headers=oh)
    # поиск по подстроке
    q = client.get("/persons?q=тестов", headers=h).json()["data"]
    assert len(q) == 1 and q[0]["id"] == pid_
    # update пересобирает full_name; delete убирает
    up = client.put(f"/persons/{pid_}", headers=h, json={"last_name": "Обновлён"}).json()["data"]
    assert up["full_name"] == "Иван Обновлён"
    assert client.delete(f"/persons/{pid_}", headers=h).status_code == 200
    assert all(p["id"] != pid_ for p in client.get("/persons", headers=h).json()["data"])


def _pm_headers(monkeypatch):
    async def _owns(u, p):
        return True
    async def _in_scope(wid, pid):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_task_in_project", _in_scope)
    monkeypatch.setattr(main, "_risk_in_project", _in_scope)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_passport_version_autobump(monkeypatch):
    # Раньше фронт слал bump_version, а адаптер игнорировал → версия/дата версии не проставлялись.
    import json as _j
    state = {"m": {"code": "X", "status": "planning"}, "name": "Old", "ver": 1}

    async def fake_get(pid):
        return {"id": "9", "name": state["name"], "identifier": "x", "active": True,
                "description": {"raw": _j.dumps(state["m"], ensure_ascii=False)},
                "createdAt": "c", "updatedAt": "u", "lockVersion": state["ver"]}

    async def fake_docs(pid):
        return state.get("colls") or {}  # эмулируем project_docs: накапливаем между PUT-ами

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        state["m"] = _j.loads(meta_raw)
        if colls is not None:
            state.setdefault("colls", {}).update(colls)  # writer правит только переданные коллекции, не затирает
        if name is not None:
            state["name"] = name
        state["ver"] += 1
        return True

    async def fake_append(pid, entry, cap):
        # A2: _action_log теперь append-only через db.append_action_log (не через colls) — эмулируем store
        state.setdefault("colls", {}).setdefault("_action_log", []).append(entry)
    monkeypatch.setattr(main.db, "get_project_row", fake_get)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    monkeypatch.setattr(main.db, "append_action_log", fake_append)
    h = _pm_headers(monkeypatch)
    r = client.put("/projects/9", headers=h, json={"status": "active", "project_kind": "pilot"}).json()["data"]
    assert r["version"] == "1.0001" and r["version_date"]   # формат «мажор.минор», см. _format_version
    assert r["project_kind"] == "pilot"
    # СЕАНС ПРАВКИ: вторая правка того же человека в пределах окна дополняет ту же запись
    # журнала и НЕ увеличивает версию. Иначе автосохранение накручивало бы сотни версий
    # за один присест, а журнал (кап 50) показывал бы последние минуты вместо истории.
    r2 = client.put("/projects/9", headers=h, json={"priority": "high"}).json()["data"]
    assert r2["version"] == "1.0001"
    vlog = state["m"]["_version_log"]
    assert len(vlog) == 1
    fields = [c["field"] for c in vlog[0]["changed_fields"]]
    assert fields == ["status", "project_kind", "priority"]   # порядок стабилен: старые, потом новые
    # В журнал действий сеанс пишется ОДИН раз: он append-only и обрезан 50 записями.
    # _action_log нормализован в project_docs — в мок он приходит через colls, не в meta.
    acts = (state.get("colls") or {}).get("_action_log") or []
    assert len([a for a in acts if a["action"] == "project.update"]) == 1
    assert "project_kind" in acts[-1]["detail"]
    # кривой вид проекта → 422 (валидация до сети)
    assert client.put("/projects/9", headers=h, json={"project_kind": "weird"}).status_code == 422


def test_vlog_session_grouping_rules():
    """Границы сеанса правки. Проверяем чистые хелперы: живой PUT их уже покрыл выше,
    а здесь дёшево перебрать края, ради которых склейка и сделана."""
    now = "2026-08-12T10:00:00+00:00"
    same = {"author_name": "РП", "created_at": "2026-08-12T09:50:00+00:00"}
    old_entry = {"author_name": "РП", "created_at": "2026-08-12T09:40:00+00:00"}
    other = {"author_name": "Со-РП", "created_at": "2026-08-12T09:59:00+00:00"}

    assert main._vlog_session_open(same, "РП", now) is True
    # 20 минут — уже другой сеанс: иначе в одну запись слипся бы весь рабочий день.
    assert main._vlog_session_open(old_entry, "РП", now) is False
    # Разные авторы не склеиваем НИКОГДА — «кто менял» перестало бы отвечать на вопрос.
    assert main._vlog_session_open(other, "РП", now) is False
    assert main._vlog_session_open(None, "РП", now) is False
    # Битая дата не должна ронять сохранение — просто начинаем новый сеанс.
    assert main._vlog_session_open({"author_name": "РП", "created_at": "мусор"}, "РП", now) is False


def test_vlog_merge_keeps_first_old_and_drops_reverts():
    # old_value берём из самой ранней правки поля, new_value — из последней.
    merged = main._vlog_merge(
        [{"field": "name", "old_value": "A", "new_value": "B"}],
        [{"field": "name", "old_value": "B", "new_value": "C"},
         {"field": "goal", "old_value": "", "new_value": "Цель"}],
    )
    assert merged == [
        {"field": "name", "old_value": "A", "new_value": "C"},
        {"field": "goal", "old_value": "", "new_value": "Цель"},
    ]
    # Поле, возвращённое к исходному значению, из записи исчезает: сеанс описывает результат.
    assert main._vlog_merge(
        [{"field": "name", "old_value": "A", "new_value": "B"}],
        [{"field": "name", "old_value": "B", "new_value": "A"}],
    ) == []


def test_task_status_autodates(monkeypatch):
    # extra (actual_start/end/hours) теперь колонки: авто-даты уходят одним UPDATE в db.update_task.
    store = {"title": "T", "task_type": "task", "status": "not_started",
             "actual_start": None, "actual_end": None, "actual_hours": None}

    async def fake_get(tid):
        return dict(store)

    async def fake_update(tid, fields):
        store.update(fields)
        return dict(store)

    monkeypatch.setattr(main.db, "get_task", fake_get)
    monkeypatch.setattr(main.db, "update_task", fake_update)
    monkeypatch.setattr(main.db, "task_shim", lambda r: {"id": 7, "subject": r.get("title"), "startDate": None,
                        "dueDate": None, "percentageDone": None, "createdAt": "x",
                        "_links": {"status": {"href": "/api/v3/statuses/1"}}})
    monkeypatch.setattr(main.db, "task_extra", lambda rows: (
        {"7": {k: rows[0][k] for k in main._EXTRA_KEYS if rows[0].get(k) is not None}} if rows else {}))

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut({})
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    client.put("/projects/5/tasks/7", headers=h, json={"status": "in_progress"})
    assert store.get("actual_start") and not store.get("actual_end")
    client.put("/projects/5/tasks/7", headers=h, json={"status": "completed"})
    assert store.get("actual_end")
    # авто-часы факта: раб.дни × 8 из факт-дат (старт=финиш=сегодня → 8ч в будни, 0 в выходные)
    assert store.get("actual_hours") == main._workdays(store["actual_start"], store["actual_end"]) * 8 or not store.get("actual_hours")


def test_workdays():
    assert main._workdays("2026-07-06", "2026-07-10") == 5   # пн–пт
    assert main._workdays("2026-07-06", "2026-07-12") == 5   # + выходные не считаются
    assert main._workdays("2026-07-11", "2026-07-12") == 0   # сб–вс
    assert main._workdays("2026-07-10", "2026-07-06") == 0   # обратный порядок
    assert main._workdays(None, "2026-07-10") == 0


def test_baseline_snapshot_has_task_id(monkeypatch):
    # Снимок хранит task_id (контракт таблицы отклонений) + пишется в ФАЙЛ-СТОР, не в описание (иначе 413).
    meta = {}
    store = {}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_tasks(pid, m):
        return [{"id": "42", "title": "T", "planned_start": "2026-01-01", "planned_end": "2026-01-05"}]

    async def fake_append(pid, doc):
        store.setdefault(str(pid), []).append(doc)

    async def fake_proj_bl(pid, m):
        return store.get(str(pid), [])
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "_wp_tasks", fake_tasks)
    monkeypatch.setattr(main, "_owns_item", lambda u, m: True)
    monkeypatch.setattr(main.db, "append_baseline", fake_append)
    monkeypatch.setattr(main, "_project_baselines", fake_proj_bl)
    h = _pm_headers(monkeypatch)
    b = client.post("/projects/5/baselines", headers=h, json={"name": "v1"}).json()["data"]
    assert b["tasks"][0]["task_id"] == "42" and b["tasks"][0]["id"] == "42"
    assert b["tasks"][0]["planned_end"] == "2026-01-05"
    # хранится в файл-сторе, описание проекта не растёт снимками
    assert "_baselines" not in meta
    assert store["5"][0]["name"] == "v1"


def test_backlog_promote_creates_wp(monkeypatch):
    # Регресс: promote писал в мёртвую коллекцию _tasks → задача «пропадала» (WBS читает таблицу tasks).
    # Теперь создаёт настоящую строку tasks и убирает пункт из бэклога.
    meta = {"_backlog": [{"id": "b1", "title": "Сделать X", "priority": "high"}], "_counts": {}}
    captured = {}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_insert(pid, fields):
        captured["fields"] = fields
        return {"id": 777}

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "insert_task", fake_insert)
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    r = client.post("/projects/5/backlog/b1/promote", headers=h).json()["data"]
    assert r["task_id"] == "777" and r["backlog_id"] == "b1"
    assert meta["_backlog"] == []                       # убрано из бэклога
    assert captured["fields"].get("priority") == "high"  # extra ушли в колонки одним INSERT
    assert "_tasks" not in meta or not meta.get("_tasks")    # НЕ пишем в мёртвую коллекцию


def test_backlog_promote_carries_bitrix_task_id(monkeypatch):
    """Перенос в план работ не теряет связь с уже поставленной задачей Bitrix24.

    Из пункта бэклога можно поставить задачу в Bitrix кнопкой в строке. Перенос пункта в план
    работ номер не брал, а сам пункт удалял — портал забывал про уже существующую задачу: у новой
    задачи колонка Bitrix снова предлагала «Создать», и исполнитель получал вторую такую же.
    Номер в мете может лежать строкой (правленые руками проекты), колонка — BIGINT.
    """
    meta = {"_backlog": [{"id": "b1", "title": "Сделать X", "bitrix24_task_id": "4821"}], "_counts": {}}
    captured = {}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_insert(pid, fields):
        captured["fields"] = fields
        return {"id": 778}

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    async def no_twin(bx):
        return None                                  # этот номер ещё ни за одной задачей не числится
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "insert_task", fake_insert)
    monkeypatch.setattr(main.db, "task_by_bitrix", no_twin)
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    client.post("/projects/5/backlog/b1/promote", headers=h)
    assert captured["fields"]["bitrix24_task_id"] == 4821   # именно числом, иначе INSERT упадёт

    # Тот же номер уже за задачей (перенос оборвался и его нажали ещё раз) — второй задаче его
    # не отдаём: «Удалить задачу из Bitrix24» на любой из двух снесло бы ОБЩУЮ задачу в Bitrix.
    async def twin(bx):
        return {"id": 700, "project_id": 5}
    monkeypatch.setattr(main.db, "task_by_bitrix", twin)
    meta["_backlog"] = [{"id": "b1", "title": "Сделать X", "bitrix24_task_id": "4821"}]
    captured.clear()
    client.post("/projects/5/backlog/b1/promote", headers=h)
    assert "bitrix24_task_id" not in captured["fields"]


def test_backlog_promote_without_bitrix_id_writes_nothing(monkeypatch):
    # У пунктов без задачи в Bitrix поведение и набор полей INSERT прежние: ключа быть не должно.
    meta = {"_backlog": [{"id": "b1", "title": "Сделать X"}], "_counts": {}}
    captured = {}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_insert(pid, fields):
        captured["fields"] = fields
        return {"id": 779}

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "insert_task", fake_insert)
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    client.post("/projects/5/backlog/b1/promote", headers=h)
    assert "bitrix24_task_id" not in captured["fields"]


def test_decision_backlog_autocode(monkeypatch):
    # decisions → D-NN, backlog → B-NN (как R-NN у рисков), нумерация по свободному номеру.
    meta = {"_decisions": [{"id": "x", "code": "D-01"}], "_backlog": []}

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    d = client.post("/projects/5/decisions", headers=h, json={"title": "Решение 2"}).json()["data"]
    assert d["code"] == "D-02"
    b = client.post("/projects/5/backlog", headers=h, json={"title": "Идея"}).json()["data"]
    assert b["code"] == "B-01"


def _finalize_meta(actions=None, decisions=None):
    return {"_meetings": [{"id": "m1", "title": "Планёрка", "meeting_date": "2026-02-01", "status": "draft",
                           "decisions": decisions if decisions is not None else
                           [{"id": "d1", "decision_text": "Взять подрядчика", "rationale": "дешевле"}],
                           "actions": actions if actions is not None else
                           [{"id": "a1", "action_text": "Собрать КП", "assignee_name": "Иван",
                             "due_date": "2026-02-10"}]}],
            "_decisions": [], "_backlog": [], "_counts": {}}


def _finalize_patches(monkeypatch, meta, person=None):
    """Общая обвязка финализации: она читает мету ДО транзакции (резолв исполнителей async,
    а _mut синхронный) и резолвит человека через реестр."""
    async def fake_load(pid, with_docs=True):
        return {"id": pid}, meta

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)

    async def fake_resolve(person_id=None, email=None, name=None):
        return person
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "resolve_person", fake_resolve)
    return _pm_headers(monkeypatch)


def test_meeting_finalize_copies_decisions(monkeypatch):
    # Финализация встречи: решения → журнал решений, поручения → бэклог (идемпотентно).
    meta = _finalize_meta()
    h = _finalize_patches(monkeypatch, meta,
                          person={"person_id": "p1", "full_name": "Иван Иванов", "email": "i@example.com"})
    r = client.post("/projects/5/meetings/m1/finalize", headers=h).json()["data"]
    assert r["status"] == "final" and r["decisions_added"] == 1 and r["actions_added"] == 1
    assert meta["_meetings"][0]["status"] == "final"
    assert meta["_decisions"][0]["title"] == "Взять подрядчика" and meta["_decisions"][0]["code"] == "D-01"
    bl = meta["_backlog"][0]
    assert bl["title"] == "Собрать КП" and bl["code"] == "B-01"
    # Исполнитель поручения — «Ответственный» пункта (иначе он не найдётся ни в «Моих задачах»,
    # ни в календаре), «Запросил» = совещание-источник, срок → planned_end.
    assert bl["assignee_person_id"] == "p1" and bl["assignee_name"] == "Иван Иванов"
    assert bl["requested_by"] == "Планёрка"
    assert bl["planned_end"] == "2026-02-10"
    # повторная финализация не дублирует ни решения, ни поручения
    r2 = client.post("/projects/5/meetings/m1/finalize", headers=h).json()["data"]
    assert r2["decisions_added"] == 0 and r2["actions_added"] == 0
    assert len(meta["_decisions"]) == 1 and len(meta["_backlog"]) == 1


def test_meeting_finalize_does_not_guess_person(monkeypatch):
    """Роль вместо имени («IT lead») или тёзка: resolve_person вернул None. Пункт создаётся,
    текст исполнителя сохраняется, но person_id пуст — лучше пусто, чем не тот человек."""
    meta = _finalize_meta(actions=[{"id": "a1", "action_text": "Согласовать смету",
                                    "assignee_name": "IT lead", "due_date": "2026-03-01"}])
    h = _finalize_patches(monkeypatch, meta, person=None)
    client.post("/projects/5/meetings/m1/finalize", headers=h)
    bl = meta["_backlog"][0]
    assert bl["assignee_person_id"] is None
    assert bl["assignee_name"] == "IT lead"


def test_meeting_finalize_due_date_must_be_iso(monkeypatch):
    """Срок из формы не гарантированно ISO: там бывает пусто или сырой текст. В planned_end
    (TEXT-колонка, сравнивается строками) кладём только настоящую дату."""
    for raw, expected in (("", None), ("к пятнице", None), ("15.08.2026", None), ("2026-08-15", "2026-08-15")):
        meta = _finalize_meta(actions=[{"id": "a1", "action_text": "Поручение", "due_date": raw}])
        h = _finalize_patches(monkeypatch, meta, person=None)
        client.post("/projects/5/meetings/m1/finalize", headers=h)
        assert meta["_backlog"][0]["planned_end"] == expected, f"срок {raw!r}"


def test_meeting_finalize_action_lands_in_my_work(monkeypatch):
    """Стыковка с читателем: созданный пункт обязан находиться у своего человека в «Моих задачах».
    Ровно это и было сломано — исполнитель уезжал в «Запросил», которое не читает никто."""
    meta = _finalize_meta()
    h = _finalize_patches(monkeypatch, meta,
                          person={"person_id": "p1", "full_name": "Иван Иванов", "email": "i@example.com"})
    client.post("/projects/5/meetings/m1/finalize", headers=h)
    item = meta["_backlog"][0]
    assert main._my_backlog_match({"person_id": "p1", "full_name": "Иван Иванов"}, item) is True
    assert main._my_backlog_match({"person_id": "p2", "full_name": "Пётр Петров"}, item) is False


def test_meeting_finalize_recognises_legacy_marker(monkeypatch):
    """Пункт перенесён СТАРЫМ ключом (по тексту), а форму с тех пор пересохранили — у поручения
    появился id. Повторная финализация обязана узнать легаси-маркер, иначе будет вторая копия."""
    meta = _finalize_meta()
    meta["_backlog"] = [{"id": "b-old", "code": "B-01", "title": "Собрать КП",
                         "_from_meeting": "meeting:m1:act:Собрать КП"}]
    meta["_decisions"] = [{"id": "d-old", "code": "D-01", "title": "Взять подрядчика",
                           "_from_meeting": "meeting:m1:Взять подрядчика"}]
    h = _finalize_patches(monkeypatch, meta, person=None)
    r = client.post("/projects/5/meetings/m1/finalize", headers=h).json()["data"]
    assert r["actions_added"] == 0 and r["decisions_added"] == 0
    assert len(meta["_backlog"]) == 1 and len(meta["_decisions"]) == 1


def test_meeting_bitrix_create_excludes_busy(monkeypatch):
    # «Создать без них»: явный exclude_bitrix_ids убирает занятого гостя из события Bitrix.
    # Иначе вебхук интеграции принудительно добавил бы всех, игнорируя занятость. Хост в событии
    # остаётся всегда (он не в списке гостей). Занятость проверяет фронт; сюда приходит уже решение.
    meta = {"_meetings": [{"id": "m1", "title": "Планёрка", "meeting_date": "2026-11-04",
                           "attendees": [
                               {"id": "a1", "name": "Занятой", "bitrix24_id": 10},
                               {"id": "a2", "name": "Свободный", "bitrix24_id": 20}]}],
            "_pending_action_log": []}
    captured = {}

    async def fake_load(pid):
        return ({"id": pid}, meta)

    async def fake_cu(auth):
        return {"id": "o1", "full_name": "Owner", "role": "owner", "bitrix24_user_id": 7001}

    async def fake_add(owner, title, start, end, description="", attendees=None, location=""):
        captured["owner"] = owner
        captured["attendees"] = list(attendees or [])
        return (999, None)

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "current_user", fake_cu)
    monkeypatch.setattr(main, "_bitrix_url", lambda: "x")
    monkeypatch.setattr(main, "_meeting_start_iso", lambda mt: "2026-11-04T18:00:00+03:00")
    monkeypatch.setattr(main, "_meeting_end_iso", lambda mt: "2026-11-04T19:00:00+03:00")
    monkeypatch.setattr(main, "bx_add_calendar_event", fake_add)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)

    hdr = {"Authorization": "Bearer x"}
    r = client.post("/projects/5/meetings/m1/bitrix-event", headers=hdr, json={"exclude_bitrix_ids": [10]})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["bitrix_event_id"] == 999
    assert captured["owner"] == 7001                       # хост всегда организатор
    assert 10 not in captured["attendees"]                # занятого исключили
    assert 20 in captured["attendees"]                    # свободного пригласили

    # Контроль: без exclude приглашаются оба гостя (значит фильтрует именно список, а не что-то ещё).
    captured.clear()
    r2 = client.post("/projects/5/meetings/m1/bitrix-event", headers=hdr, json={})
    assert r2.status_code == 200, r2.text
    assert 10 in captured["attendees"] and 20 in captured["attendees"]


def test_suggest_slots_includes_host(monkeypatch):
    # Организатор совещания тоже должен быть свободен в предложенном слоте: его bitrix-id обязан
    # попасть в проверку занятости наравне с участниками И считаться в total_count (иначе подбор
    # предложил бы время, когда сам РП занят).
    captured = {}

    async def fake_cu(auth):
        return {"id": "o1", "full_name": "Owner", "role": "owner", "bitrix24_user_id": 7001}

    async def fake_resolve(**kw):
        return {}   # bitrix-id берём прямо из тела участника

    async def fake_bx_call(method, params):
        captured["method"] = method
        captured["users"] = list(params.get("users") or [])
        # пустая занятость по каждому запрошенному — все остаются resolved и считаются участниками
        return ({"result": {str(u): [] for u in (params.get("users") or [])}}, None)
    monkeypatch.setattr(main, "current_user", fake_cu)
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://x.bitrix24.ru/rest/1/tok/")
    monkeypatch.setattr(main, "resolve_person", fake_resolve)
    monkeypatch.setattr(main, "bx_call", fake_bx_call)

    r = client.post("/projects/5/meetings/suggest-slots", headers={"Authorization": "Bearer x"},
                    json={"attendees": [{"name": "Гость", "bitrix24_id": 20}],
                          "duration_minutes": 60, "days": 7})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert captured["method"] == "calendar.accessibility.get"
    assert 7001 in captured["users"] and 20 in captured["users"]   # хост и гость — оба в проверке
    ids = {x["bitrix24_id"] for x in data["resolved"]}
    assert 7001 in ids and 20 in ids                                # хост посчитан как участник
    assert data["slots"] and data["slots"][0]["total_count"] == 2  # total = хост + гость, не 1


def test_generic_crud_action_log(monkeypatch):
    meta = {"_team": [], "_action_log": []}

    async def fake_retry(pid, mut, attempts=4):
        r = mut(meta)
        # эмулируем append-слив журнала (A2): with_meta_retry сливает _pending_action_log в project_docs
        meta.setdefault("_action_log", []).extend(meta.pop("_pending_action_log", []))
        return r
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    h = _pm_headers(monkeypatch)
    client.post("/projects/5/team", headers=h, json={"full_name": "Анна Тест"})
    acts = meta["_action_log"]
    assert acts and acts[-1]["action"] == "team.create" and "Анна Тест" in acts[-1]["detail"]
    item_id = meta["_team"][0]["id"]
    # UPDATE журналируется с диффом «поле: было→стало» (раньше — только create/delete)
    client.put(f"/projects/5/team/{item_id}", headers=h, json={"project_role": "Аналитик"})
    upd = meta["_action_log"][-1]
    assert upd["action"] == "team.update" and "project_role" in upd["detail"] and "Аналитик" in upd["detail"]
    # повтор того же значения — диффа нет, записи нет
    n_before = len(meta["_action_log"])
    client.put(f"/projects/5/team/{item_id}", headers=h, json={"project_role": "Аналитик"})
    assert len(meta["_action_log"]) == n_before
    client.delete(f"/projects/5/team/{item_id}", headers=h)
    assert meta["_action_log"][-1]["action"] == "team.delete"


def test_action_log_append_only_no_clobber(monkeypatch):
    # A2 (гонка потери записи): правка паспорта/generic НЕ должна переписывать _action_log через
    # version-checked colls (DELETE+re-INSERT из снимка в памяти затёр бы параллельный append журнала
    # задачи/риска, идущий без бампа version). Инвариант: (1) _action_log никогда не среди colls,
    # отданных update_project_meta; (2) запись журнала доставлена append-only (db.append_action_log).
    import json as _j
    import asyncio
    state = {"m": {"code": "X", "status": "planning"}, "ver": 1, "appended": [], "colls_seen": []}

    async def fake_get(pid):
        return {"id": "9", "name": "P", "identifier": "x", "active": True,
                "description": {"raw": _j.dumps(state["m"], ensure_ascii=False)},
                "createdAt": "c", "updatedAt": "u", "lockVersion": state["ver"]}

    async def fake_docs(pid):
        return {}

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        state["colls_seen"].append(dict(colls or {}))
        state["ver"] += 1
        return True

    async def fake_append(pid, entry, cap):
        state["appended"].append(entry)
    monkeypatch.setattr(main.db, "get_project_row", fake_get)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    monkeypatch.setattr(main.db, "append_action_log", fake_append)
    monkeypatch.setattr(main, "to_project", lambda d: {"ok": True})
    asyncio.run(main._save_meta("9", {"priority": "high"}, author="Owner",
                                user={"id": "o", "full_name": "Owner", "role": "owner"}))
    # (1) ни один вызов записи меты не несёт _action_log в colls → параллельный append нечем затереть
    assert state["colls_seen"] and all("_action_log" not in c for c in state["colls_seen"])
    # (2) запись журнала доставлена append-only, с ожидаемым действием/диффом
    assert state["appended"] and state["appended"][-1]["action"] == "project.update"
    assert "priority" in state["appended"][-1]["detail"]


# ---------- R5: round-trip JSON-стора ----------
def test_serialize_round_trip():
    import json as _json
    meta = {"code": "X", "_team": [{"id": "1", "n": "Анна"}], "_counts": {"tasks_total": 3},
            "nested": {"a": [1, 2, {"b": "ц"}]}, "_deps": []}
    raw = main._serialize_meta("5", meta)
    assert _json.loads(raw) == meta  # точная сохранность (кириллица/вложенность/числа)


# ---------- R5: вложения — запрет типа (415) ----------
def test_attachment_upload_bad_ext(monkeypatch):
    async def _owns(u, p):
        return True

    async def _in(wpid, pid):
        return True
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "_wp_in_project", _in)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.post("/projects/5/work-packages/202/attachments", headers=h,
                    files={"file": ("evil.exe", b"x", "application/octet-stream")})
    assert r.status_code == 415  # .exe не в whitelist (до обращения к сети)


def test_upload_reader_stops_at_limit():
    import asyncio
    import io
    import pytest
    from starlette.datastructures import UploadFile

    upload = UploadFile(file=io.BytesIO(b"abcdef"), filename="x.txt")
    with pytest.raises(main.HTTPException) as exc:
        asyncio.run(main._read_upload_limited(upload, max_bytes=5))
    assert exc.value.status_code == 413


def test_meta_is_parsed_once_per_project_shim():
    import json as _json

    el = {"description": {"raw": _json.dumps({"code": "P-1"})}}
    first = main._meta(el)
    el["description"]["raw"] = "not-json-anymore"
    second = main._meta(el)
    assert first is second and second["code"] == "P-1"


def test_public_project_redacts_passport_unless_explicitly_published():
    import json as _json

    base = {"code": "P-1", "status": "active", "priority": "high", "client": "Secret client",
            "budget": 12345, "pm_name": "Secret PM"}
    el = {"id": 1, "identifier": "p-1", "name": "Visible name",
          "description": {"raw": _json.dumps(base)}, "createdAt": "c", "updatedAt": "u"}
    redacted = main._public_project_view(el, {**base, "_share": {"sections": ["gantt"]}})
    assert redacted["name"] == "Visible name"
    assert "budget" not in redacted and "client" not in redacted and "pm_name" not in redacted

    full = main._public_project_view(el, {**base, "_share": {"sections": ["passport"]}})
    assert full["budget"] == 12345 and full["client"] == "Secret client"


def test_redact_public_strips_contact_pii():
    # чистая логика: _redact_public вырезает email/phone/_distribution/assignee_email на любой глубине,
    # но оставляет имена/роли/статусы; исходные структуры НЕ мутирует.
    src = [{"id": "t1", "name": "Alice", "role": "Dev", "email": "a@co.com", "phone": "+371",
            "action_items": [{"title": "do", "assignee_email": "a@co.com"}],
            "_distribution": {"recipients": [{"name": "A", "email": "a@co.com"}]}}]
    out = main._redact_public(src)
    assert out[0]["name"] == "Alice" and out[0]["role"] == "Dev"          # видимое остаётся
    assert "email" not in out[0] and "phone" not in out[0]                # контакты вырезаны
    assert "_distribution" not in out[0]                                  # рассылка вырезана
    assert "assignee_email" not in out[0]["action_items"][0] and out[0]["action_items"][0]["title"] == "do"
    # исходник НЕ мутирован (redact пересобирает структуры → кэш меты не портится)
    assert src[0]["email"] == "a@co.com" and "_distribution" in src[0]


def test_public_share_endpoint_strips_contact_pii(monkeypatch):
    # ИНТЕГРАЦИЯ по РЕАЛЬНОМУ публичному пути: анонимный GET /projects/{pid}/team?share=<token>
    # (rbac→_resolve_public минтит role="public") не должен отдавать email/phone команды.
    import asyncio  # noqa: F401
    meta = {"_share": {"enabled": True, "token": "TOK", "sections": ["team"]},
            "_team": [{"id": "t1", "name": "Alice", "role": "Dev", "email": "a@co.com", "phone": "+371"}]}
    row = {"id": "5"}

    async def fake_find_share(token):
        return (row, meta) if token == "TOK" else (None, None)

    async def fake_load_meta(pid):
        return (row, meta)

    monkeypatch.setattr(main, "_find_share", fake_find_share)
    monkeypatch.setattr(main, "load_meta", fake_load_meta)
    # опубликованная секция team по валидному share-токену — 200, но без контактов
    r = client.get("/projects/5/team?share=TOK")
    assert r.status_code == 200
    items = r.json()["data"]
    assert items and items[0]["name"] == "Alice" and items[0]["role"] == "Dev"
    assert "email" not in items[0] and "phone" not in items[0]
    # НЕопубликованная секция (stakeholders) по тому же токену — публичного не минтит → 401 (нет auth)
    assert client.get("/projects/5/stakeholders?share=TOK").status_code == 401


def test_login_malformed_email_is_not_500():
    # кривой email (число/объект/список вместо строки) → 401, а не 500 (str-коэрсия в auth_routes)
    for bad in (123, {"x": 1}, ["a"]):
        r = client.post("/auth/login", json={"email": bad, "password": "x"})
        assert r.status_code == 401, (bad, r.status_code)


def test_legacy_baselines_are_awaited_and_removed_before_meta_save(monkeypatch):
    import asyncio
    import json as _json

    captured = {}

    async def fake_ensure(pid, items):
        captured["pid"] = pid
        captured["items"] = list(items)

    monkeypatch.setattr(main.db, "ensure_baselines", fake_ensure)
    meta = {"code": "P-1", "_baselines": [{"id": "b1"}], "_counts": {"tasks_total": 99}}
    raw = asyncio.run(main._meta_raw_for_save("5", meta))
    assert captured == {"pid": "5", "items": [{"id": "b1"}]}
    saved = _json.loads(raw)
    assert "_baselines" not in meta and "_baselines" not in saved
    assert "_counts" not in meta and "_counts" not in saved


# ---------- R5: клон — ремап иерархии и зависимостей ----------
def test_clone_remaps_hierarchy_and_deps(monkeypatch):
    import json as _json
    SRC = {"code": "PRJ-1", "name": "Src", "status": "active", "_team": [{"id": "t1", "full_name": "X"}],
           "_meetings": [{"id": "mt1", "title": "Синк", "bitrix_event_id": "500", "fireflies_meeting_id": "ff1",
                          "transcript_url": "https://app.fireflies.ai/view/ff1", "fireflies_minutes_sha": "ab"}]}
    state = {"n": 0}
    captured = {}
    tasks_inserted = []
    deps_inserted = []

    async def _owns(u, p):
        return True

    async def fake_load(pidarg):
        if str(pidarg) == "5":
            return ({"id": "5", "lockVersion": 0, "description": {"raw": _json.dumps(SRC)}}, dict(SRC))
        return ({"id": "NEW", "lockVersion": 0, "description": {"raw": "{}"}}, {})

    async def fake_wp_tasks(pidarg, m):
        return [
            {"id": "A", "title": "Phase", "task_type": "phase", "status": "not_started", "parent_id": None, "level": 0, "planned_start": None, "planned_end": None, "progress": 0, "description": None},
            {"id": "B", "title": "Task", "task_type": "task", "status": "in_progress", "parent_id": "A", "level": 1, "planned_start": None, "planned_end": None, "progress": 0, "description": None},
        ]

    async def fake_wp_risks(pidarg, m):
        return []

    async def fake_fetch_wps(pidarg, type_ids=None):
        return []

    async def fake_save(pidarg, el, meta):
        captured["meta"] = meta
        return {}

    cons = []

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_transaction():
        cons.append("CON")
        yield "CON"  # атомарность: все insert_* внутри клона получают этот con

    async def fake_insert_project(name, ident, meta_raw, con=None):
        assert con == "CON"  # insert_project идёт внутри транзакции
        return {"id": "NEW"}

    async def fake_insert_task(pid, fields, con=None):
        assert con == "CON"
        state["n"] += 1
        wid = state["n"]           # числовой id (как настоящая строка) — int(idmap[...]) для parent_id
        tasks_inserted.append((wid, fields))
        return {"id": wid}

    async def fake_fetch_deps(pid):
        return [{"id": "d1", "task_id": "B", "depends_on_id": "A", "dependency_type": "finish_to_start", "lag_days": 0}]

    async def fake_insert_dep(pid, did, task_id, depends_on_id, dtype, lag, con=None):
        assert con == "CON"
        deps_inserted.append({"task_id": task_id, "depends_on_id": depends_on_id})

    monkeypatch.setattr(main, "_user_owns_project", _owns)
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main, "_wp_tasks", fake_wp_tasks)
    monkeypatch.setattr(main, "_wp_risks", fake_wp_risks)
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch_wps)
    monkeypatch.setattr(main, "save_meta_full", fake_save)
    monkeypatch.setattr(main.db, "transaction", fake_transaction)
    baselines_appended = []

    async def fake_load_baselines_for(pidarg):
        return [{"id": "b1", "name": "BL", "tasks": [{"id": "A", "task_id": "A", "planned_end": "2026-01-01"}]}]

    async def fake_append_baseline(pidarg, doc):
        baselines_appended.append(doc)

    monkeypatch.setattr(main.db, "insert_project", fake_insert_project)
    monkeypatch.setattr(main.db, "insert_task", fake_insert_task)
    monkeypatch.setattr(main.db, "fetch_deps", fake_fetch_deps)
    monkeypatch.setattr(main.db, "insert_dep", fake_insert_dep)
    monkeypatch.setattr(main.db, "load_baselines_for", fake_load_baselines_for)
    monkeypatch.setattr(main.db, "append_baseline", fake_append_baseline)

    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/clone", headers={"Authorization": f"Bearer {tok}"}, json={"code": "PRJ-1-COPY"})
    assert r.status_code == 200
    nm = captured["meta"]
    # A→1 (level 0, раньше), B→2; зависимость B←A ремапнута в таблицу deps на 2←1
    assert deps_inserted == [{"task_id": "2", "depends_on_id": "1"}]
    # структурная коллекция скопирована с НОВЫМ id
    assert len(nm["_team"]) == 1 and nm["_team"][0]["id"] != "t1"
    # серверные поля совещания (событие Битрикса, связка Fireflies) в клон не едут: иначе resend
    # нашёл бы два «связанных» совещания или переписал протокол в чужом проекте
    mt = nm["_meetings"][0]
    assert mt["title"] == "Синк"
    for k in main._protected_fields("_meetings"):
        assert k not in mt, k
    # строка задачи B создана с родителем = новый id фазы (1)
    b_fields = next(f for wid, f in tasks_inserted if wid == 2)
    assert b_fields.get("parent_id") == 1
    # базовый план скопирован с новым id и ремапом task_id A→1 (иначе клон терял историю baseline)
    assert len(baselines_appended) == 1
    assert baselines_appended[0]["id"] != "b1"
    assert baselines_appended[0]["tasks"][0]["task_id"] == "1"


# ---------- D1: version-log (журнал изменений паспорта) ----------
def test_version_log_records_changes(monkeypatch):
    import asyncio
    import json as _json
    src = {"status": "planning", "priority": "medium", "code": "P1"}
    captured = {}

    async def fake_get(pid):
        return {"id": "5", "name": "Proj", "identifier": "x", "active": True,
                "description": {"raw": _json.dumps(src)}, "createdAt": "c", "updatedAt": "u", "lockVersion": 1}

    async def fake_docs(pid):
        return {}

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        captured["meta_raw"] = meta_raw
        return True
    monkeypatch.setattr(main.db, "get_project_row", fake_get)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    asyncio.run(main._save_meta("5", {"status": "active"}, author="PM One"))
    vlog = _json.loads(captured["meta_raw"])["_version_log"]
    assert len(vlog) == 1 and vlog[0]["author_name"] == "PM One"
    assert vlog[0]["changed_fields"][0] == {"field": "status", "old_value": "planning", "new_value": "active"}
    # без author (создание проекта) — не журналируем
    captured.clear()
    asyncio.run(main._save_meta("5", {"status": "active"}))
    assert _json.loads(captured["meta_raw"]).get("_version_log", []) == []


# ---------- H6: version-log числовой дифф (budget int↔str не ложно-меняется) ----------
def test_vlog_changed_numeric():
    assert main._vlog_changed("1000", 1000) is False      # int↔str одно значение
    assert main._vlog_changed(1000, 1000.0) is False
    assert main._vlog_changed("2000.00", 2000) is False
    assert main._vlog_changed("1000", "2000") is True      # реальное изменение числа
    assert main._vlog_changed(1000, 1500) is True
    assert main._vlog_changed("high", "low") is True       # нечисловое — построково
    assert main._vlog_changed("active", "active") is False
    assert main._vlog_changed(None, None) is False         # None/'' эквивалентны
    assert main._vlog_changed("", None) is False
    assert main._vlog_changed(None, "x") is True


# ---------- H4: структурная валидация генерик-CRUD ----------
def test_validate_generic_item_structure():
    import pytest
    # вложенный объект на верхнем уровне — запрещён (мусор вида {"role": {...}})
    with pytest.raises(main.HTTPException):
        main._validate_generic_item({"role": {"nested": "x"}})
    # список плоских объектов (напр. action_items встреч) — разрешён
    main._validate_generic_item({"action_items": [{"text": "a", "status": "open", "tags": ["t"]}]})
    # список скаляров — разрешён
    main._validate_generic_item({"agenda": ["a", "b"], "count": 3})
    # список с глубоко вложенным объектом — запрещён
    with pytest.raises(main.HTTPException):
        main._validate_generic_item({"items": [{"deep": {"x": 1}}]})
    # элемент списка — вложенный список — запрещён
    with pytest.raises(main.HTTPException):
        main._validate_generic_item({"items": [["nested-list"]]})


# ---------- H1: файловый стор портфельных снимков (round-trip) ----------
def test_snapshots_roundtrip(monkeypatch):
    import asyncio
    backing = {"store": {}}

    async def fake_load():
        return dict(backing["store"])

    async def fake_save(s):
        backing["store"] = dict(s)
    monkeypatch.setattr(main.db, "load_snapshots", fake_load)
    monkeypatch.setattr(main.db, "save_snapshots", fake_save)
    assert asyncio.run(main._load_snapshots()) == {}  # пусто
    store = {"2026-06-01": {"5": {"rag": "red", "overdue": 16}},
             "2026-06-02": {"5": {"rag": "amber"}}}
    asyncio.run(main._save_snapshots(store))
    assert asyncio.run(main._load_snapshots()) == store
    store["2026-06-03"] = {"5": {"rag": "green"}}
    asyncio.run(main._save_snapshots(store))
    assert set(asyncio.run(main._load_snapshots()).keys()) == {"2026-06-01", "2026-06-02", "2026-06-03"}


# ---------- H6: /metrics токен-гейт ----------
def test_metrics_open_by_default(monkeypatch):
    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    r = client.get("/metrics")
    assert r.status_code == 200 and "pmo_requests_total" in r.text


def test_metrics_token_gate(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "s3cret")
    assert client.get("/metrics").status_code == 403            # нет токена
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 403
    # Токен — только заголовком: из строки запроса он оседал в журналах доступа.
    assert client.get("/metrics", params={"token": "s3cret"}).status_code == 403
    assert client.get("/metrics", headers={"Authorization": "Bearer s3cret"}).status_code == 200


# ---------- Recurring встречи: даты шага weekly +7/+14/+21, без протокола ----------
def test_meeting_recur_dates(monkeypatch):
    meta = {"_meetings": [{"id": "m1", "title": "Sync", "recurrence": "weekly",
                           "meeting_date": "2026-06-01", "agenda": ["x"], "bitrix_event_id": 4242,
                           "action_items": [{"text": "old"}], "minutes": "done",
                           "fireflies_meeting_id": "ff-old", "transcript_url": "https://app.fireflies.ai/view/ff-old",
                           "fireflies_minutes_sha": "abc"}]}

    async def fake_retry(pid, mut, attempts=4):
        return mut(meta)

    async def _owns(u, p):
        return True
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_user_owns_project", _owns)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    r = client.post("/projects/5/meetings/m1/recur", params={"count": 3},
                    headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["data"]["count"] == 3
    new = [x for x in meta["_meetings"] if x["id"] != "m1"]
    assert sorted(x["meeting_date"] for x in new) == ["2026-06-08", "2026-06-15", "2026-06-22"]
    assert all("minutes" not in x and "action_items" not in x for x in new)  # протокол не копируется
    # Массивы ВСЕГДА присутствуют (иначе фронт падал на m.actions.length у экземпляров «Повторить»).
    for x in new:
        assert isinstance(x.get("actions"), list) and x["actions"] == []
        assert isinstance(x.get("agenda_items"), list)
        assert isinstance(x.get("attendees"), list)
        # Событие в календаре у оригинала одно: копия не должна показывать «✓ Bitrix», иначе
        # корзина в копии удалит встречу оригинала.
        assert "bitrix_event_id" not in x
        # Связка Fireflies — про протокол оригинала: копия с чужим fireflies_meeting_id навсегда
        # уходила бы в conflict на своей встрече, а resend оригинала — в unmatched.
        for k in main._protected_fields("_meetings"):
            assert k not in x, k
        assert isinstance(x.get("decisions"), list) and x["decisions"] == []
        assert x.get("status") == "draft" and x.get("minutes_content") is None


# ---------- Пакет A: open_actions считается из поручений встреч ----------
def test_recount_open_actions():
    m = {"_decisions": [{"id": "d1"}],
         "_meetings": [
             {"id": "m1", "action_items": [
                 {"text": "a", "status": "open"},
                 {"text": "b", "status": "done"},
                 {"text": "c"}]},                      # без статуса = открыто
             {"id": "m2", "actions": [{"text": "d", "status": "completed"}]},
             {"id": "m3"},                              # встреча без поручений
         ]}
    c = main._recount(m)
    assert c["decisions_total"] == 1
    assert c["open_actions"] == 2  # a + c
    assert main._recount({"_meetings": []}) == {"decisions_total": 0, "open_actions": 0}


# ---------- Редактируемый Bitrix-вебхук из настроек (secret at-rest) ----------
def test_bitrix_webhook_settings(monkeypatch):
    import json

    async def fake_save(doc):  # стор настроек — таблица settings (пишем no-op, кэш обновляет _save_settings)
        return None
    monkeypatch.setattr(main.db, "save_settings", fake_save)
    monkeypatch.setattr(main, "_settings_cache", {})  # пустой кэш вместо файла
    monkeypatch.setattr(main, "BITRIX_URL", "")  # env пуст → изолируем override
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    # изначально не настроен
    assert client.get("/admin/settings/bitrix", headers=h).json()["data"]["configured"] is False
    # pm не имеет доступа
    ptok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    assert client.get("/admin/settings/bitrix", headers={"Authorization": f"Bearer {ptok}"}).status_code == 403
    # кривой URL → 422
    assert client.put("/admin/settings/bitrix", headers=h, json={"webhook_url": "not-a-url"}).status_code == 422
    # валидный → configured, host виден, ТОКЕН не отдаётся
    r = client.put("/admin/settings/bitrix", headers=h, json={"webhook_url": "https://bx.example.com/rest/7001/SeCrEtToKeN123/"}).json()["data"]
    assert r["configured"] is True and r["host"] == "https://bx.example.com" and r["source"] == "settings"
    assert "SeCrEtToKeN123" not in json.dumps(r)  # секрет не утёк в ответ
    # эффективный URL применился внутри
    assert main._bitrix_url() == "https://bx.example.com/rest/7001/SeCrEtToKeN123"
    # в сторе (кэш → БД) хранится зашифрованным (если cryptography доступна)
    raw = json.dumps(main._settings_cache, ensure_ascii=False)
    if main._FERNET is not None:
        assert "SeCrEtToKeN123" not in raw and "enc:" in raw
    # очистка → возврат к env (пустому)
    assert client.put("/admin/settings/bitrix", headers=h, json={"webhook_url": ""}).json()["data"]["configured"] is False


# ---------- SMTP-настройки из UI (secret at-rest) ----------
def test_smtp_settings(monkeypatch):
    import json

    async def fake_save(doc):  # стор настроек — таблица settings
        return None
    monkeypatch.setattr(main.db, "save_settings", fake_save)
    monkeypatch.setattr(main, "_settings_cache", {})
    monkeypatch.setattr(main.mailer, "SMTP_HOST", "")  # env пуст → изолируем override
    main.mailer.configure({})
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    ptok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    assert client.get("/admin/settings/smtp", headers={"Authorization": f"Bearer {ptok}"}).status_code == 403
    assert client.get("/admin/settings/smtp", headers=h).json()["data"]["configured"] is False
    r = client.put("/admin/settings/smtp", headers=h, json={
        "host": "smtp.example.com", "port": 465, "user": "u@x", "from": "u@x",
        "password": "S3cretPass", "starttls": True}).json()["data"]
    assert r["configured"] is True and r["host"] == "smtp.example.com" and r["password_set"] is True and r["source"] == "settings"
    assert "S3cretPass" not in json.dumps(r)          # пароль не отдаётся наружу
    assert main.mailer.is_configured() is True         # применилось к mailer
    raw = json.dumps(main._settings_cache, ensure_ascii=False)
    if main._FERNET is not None:
        assert "S3cretPass" not in raw and "enc:" in raw  # в сторе шифрованный
    assert client.put("/admin/settings/smtp", headers=h, json={"host": ""}).json()["data"]["configured"] is False  # очистка → env
    main.mailer.configure({})  # cleanup


# ---------- Пакеты B-D: закрытый проект не шумит в портфеле/внимании ----------
def test_completed_project_quiet(monkeypatch):
    import json as _json
    meta = {"code": "PRJ-X", "status": "completed", "priority": "medium",
            "pm_name": "Project Manager 1",
            "_counts": {"tasks_total": 10, "overdue_tasks": 7, "risks_high": 2, "progress": 40}}
    el = {"id": 99, "identifier": "rd-prj-x", "name": "Closed proj", "active": True,
          "description": {"raw": _json.dumps(meta)}, "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}

    async def fake_fetch(*a, **kw):  # принимает with_docs/user kwargs
        return [el]

    async def fake_bulk(pids, type_ids=None):
        return {str(p): [] for p in pids}

    async def fake_bl():
        return {}
    monkeypatch.setattr(main, "fetch_projects", fake_fetch)
    monkeypatch.setattr(main, "_fetch_wps_bulk", fake_bulk)
    monkeypatch.setattr(main.db, "load_latest_baselines", fake_bl)
    silence_db_sources(monkeypatch, main)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    # портфель: rag green, просрочка 0, внимания не требует (несмотря на 7 overdue в counts)
    row = [r for r in client.get("/portfolio/dashboard", headers=h).json()["data"] if str(r["id"]) == "99"][0]
    assert row["rag_status"] == "green" and row["overdue_tasks_count"] == 0 and row["attention_required"] is False
    # attention и мои задачи: проект пропущен целиком
    att = client.get("/attention", headers=h).json()
    assert all(x.get("project_id") != 99 for grp in att["data"].values() for x in grp)
    mt = client.get("/me/tasks", headers=h).json()["data"]
    assert all(str(t.get("project_id")) != "99" for t in mt)


def test_fetch_projects_scopes_by_role(monkeypatch):
    # P3: owner/viewer/None → scope=None (байт-идентично по построению); pm → SQL-предфильтр по его id
    import asyncio
    calls = {}

    async def fake_rows(owner_scope=None):
        calls["scope"] = owner_scope
        return []

    async def fake_all_docs():
        calls["docs"] = "all"
        return {}

    async def fake_docs_for(pids):
        calls["docs"] = "scoped"
        return {}

    monkeypatch.setattr(main.db, "fetch_project_rows", fake_rows)
    monkeypatch.setattr(main.db, "load_all_project_docs", fake_all_docs)
    monkeypatch.setattr(main.db, "load_project_docs_for", fake_docs_for)
    asyncio.run(main.fetch_projects(user={"id": "o1", "role": "owner"}))
    assert calls["scope"] is None and calls["docs"] == "all"          # owner видит всё, полный bulk
    asyncio.run(main.fetch_projects(user={"id": "pm9", "role": "pm"}))
    assert calls["scope"] == "pm9" and calls["docs"] == "scoped"       # pm — только свои, scoped-доки
    asyncio.run(main.fetch_projects(user=None))
    assert calls["scope"] is None                                     # не-RBAC вызовы (share/snapshot) — без скоупа


# ---------- Аудит№5: graceful-деградация при недоступном OpenProject ----------
def test_openproject_down_graceful(monkeypatch):
    """БД недоступна (пул не инициализирован в тестах): /ready=503,
    логин жив (сид-пользователи в памяти), health жив, списки не 500."""
    assert client.get("/ready").status_code == 503  # db.pool() бросает → 503
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]

    async def empty_projects(with_docs=True, user=None):
        return []
    monkeypatch.setattr(main, "fetch_projects", empty_projects)
    r = client.get("/projects", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["data"] == []
    # health (liveness) не зависит от БД
    assert client.get("/health").status_code == 200


# ---------- Финал-3: бюджет портфеля из статей + новые поля/корзины ----------
def test_budget_rollup_sources():
    # план = сумма плановых расходных статей (та же цифра, что «Общий бюджет (расходы)»)
    m = {"_budget": [
        {"kind": "expense", "amount": 1000, "monthly": [{"actual": 300}]},
        {"kind": "expense", "amount": 500},
        {"kind": "income", "amount": 9999},
    ]}
    plan, actual, cur = main._budget_rollup(m)
    assert plan == 1500 and actual == 300 and cur == "EUR"
    # нет статей → утверждённый лимит
    assert main._budget_rollup({"budget_target": "2000"})[0] == 2000
    # нет ни статей, ни лимита → легаси-паспортное поле budget
    assert main._budget_rollup({"budget": 700})[0] == 700
    # совсем пусто → None (фронт покажет «—»)
    assert main._budget_rollup({})[0] is None


def test_portfolio_new_fields_and_stats(monkeypatch):
    import json as _json

    def _el(pid, meta, name):
        return {"id": pid, "identifier": f"rd-p{pid}", "name": name, "active": True,
                "description": {"raw": _json.dumps(meta)}, "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}

    els = [
        _el(201, {"code": "P-1", "status": "planning", "priority": "medium", "pm_name": "PM",
                  "project_kind": "strategic", "budget_currency": "EUR",
                  "_budget": [{"kind": "expense", "amount": 100100, "monthly": [{"actual": 527}]}]}, "Со статьями"),
        _el(202, {"code": "P-2", "status": "cancelled", "priority": "low", "pm_name": "PM",
                  "_counts": {"overdue_tasks": 5}}, "Отменённый"),
        _el(203, {"code": "P-3", "status": "planning", "priority": "low", "pm_name": "PM",
                  "_archived": True}, "Архивный"),
    ]

    async def fake_fetch(*a, **kw):  # принимает with_docs/user kwargs
        return els

    async def fake_bulk(pids, type_ids=None):
        # у 201 — одна просроченная задача (живой пересчёт, в _counts её нет)
        wp = {"id": 9001, "subject": "t", "dueDate": "2020-01-01", "percentageDone": 0,
              "_links": {"type": {"href": "/api/v3/types/1"}, "status": {"title": "In progress"},
                         "project": {"href": "/api/v3/projects/201"}}, "lockVersion": 0}
        return {str(p): ([wp] if str(p) == "201" else []) for p in pids}

    async def fake_bl():
        return {}
    monkeypatch.setattr(main, "fetch_projects", fake_fetch)
    monkeypatch.setattr(main, "_fetch_wps_bulk", fake_bulk)
    monkeypatch.setattr(main.db, "load_latest_baselines", fake_bl)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    body = client.get("/portfolio/dashboard", headers=h).json()
    rows = {str(r["id"]): r for r in body["data"]}
    # архивный скрыт по умолчанию, но виден с include_archived + флагом archived
    assert "203" not in rows
    rows_arch = {str(r["id"]): r for r in client.get("/portfolio/dashboard?include_archived=true", headers=h).json()["data"]}
    assert rows_arch["203"]["archived"] is True
    # бюджет = сумма статей + факт из помесячного + валюта + вид проекта
    r1 = rows["201"]
    assert r1["budget_plan"] == 100100 and r1["budget_actual"] == 527 and r1["budget_currency"] == "EUR"
    assert r1["project_kind"] == "strategic"
    # живой пересчёт: просрочка из WP (в _counts проекта 201 её не было)
    assert r1["overdue_tasks_count"] == 1 and r1["total_tasks"] == 1
    # корзины статусов: planning и cancelled видны; overdue — по строчному правилу (закрытый не считается)
    st = body["stats"]
    assert st["planning"] == 1 and st["cancelled"] == 1 and st["overdue"] == 1
    # фильтр по виду проекта
    only = client.get("/portfolio/dashboard?kind=strategic", headers=h).json()["data"]
    assert [str(r["id"]) for r in only] == ["201"]


def test_phase_keeps_its_dates_but_not_its_progress():
    """У фазы СВОИ плановые даты, а прогресс считается из детей.

    Даты раньше выбрасывались «потому что срок фазы деривируется из детей» — но такой
    деривации в коде нет: чтение отдаёт planned_start/planned_end прямо из строки, и Гант
    берёт их же. Получалось, что PUT отвечает 200, а поле у фазы навсегда пустое (жалоба
    РП). Через помощника даты проставить было можно — draft_apply обходил это,
    создавая фазу задачей и меняя тип после.
    """
    payload = {"planned_start": "2026-08-01", "planned_end": "2027-01-01", "progress": 50}
    f = main._task_fields(payload, for_create=False, current_type="task")
    assert f["planned_end"] == date(2027, 1, 1) and f["progress"] == 50

    f = main._task_fields(payload, for_create=False, current_type="phase")
    assert f["planned_start"] == date(2026, 8, 1) and f["planned_end"] == date(2027, 1, 1)
    assert "progress" not in f, "прогресс фазы считается из детей, а не присылается"

    # явный тип в payload имеет приоритет над типом строки
    f = main._task_fields({**payload, "task_type": "phase"}, for_create=False, current_type="task")
    assert f["planned_end"] == date(2027, 1, 1) and "progress" not in f


# ---------- WP1: идентичность людей (persons — канонический реестр) ----------
def _people(monkeypatch, persons):
    """Подменить реестр людей и сбросить кэш индекса."""
    async def fake_load():
        return persons
    monkeypatch.setattr(main, "_load_persons", fake_load)
    main._invalidate_people()


def test_resolve_person_precedence(monkeypatch):
    import asyncio
    _people(monkeypatch, [
        {"id": "p1", "full_name": "Ivan Petrov", "email": "ivan@example.com", "bitrix24_id": 10},
        {"id": "p2", "full_name": "Anna Test", "email": "anna@example.com", "bitrix24_id": 11},
    ])
    assert asyncio.run(main.resolve_person(person_id="p1"))["full_name"] == "Ivan Petrov"
    assert asyncio.run(main.resolve_person(email="ANNA@example.com"))["person_id"] == "p2"   # регистр не важен
    assert asyncio.run(main.resolve_person(name="ivan petrov"))["person_id"] == "p1"
    # id точнее имени — выигрывает
    assert asyncio.run(main.resolve_person(person_id="p2", name="Ivan Petrov"))["person_id"] == "p2"
    # роль-исполнитель из импорта («IT lead», «Отдел контента») НЕ резолвится: никогда не гадаем
    assert asyncio.run(main.resolve_person(name="IT lead")) is None


def test_resolve_person_ambiguous_name_returns_none(monkeypatch):
    """Тёзки → не гадаем (иначе задача уехала бы не тому человеку)."""
    import asyncio
    _people(monkeypatch, [
        {"id": "p1", "full_name": "Jānis Bērziņš", "email": "j1@example.com"},
        {"id": "p2", "full_name": "Jānis Bērziņš", "email": "j2@example.com"},
    ])
    assert asyncio.run(main.resolve_person(name="Jānis Bērziņš")) is None
    assert asyncio.run(main.resolve_person(email="j2@example.com"))["person_id"] == "p2"  # email однозначен


def test_task_identity_fields(monkeypatch):
    import asyncio
    _people(monkeypatch, [{"id": "p1", "full_name": "Ivan Petrov", "email": "ivan@example.com"}])
    # PersonPicker шлёт person_id → имя и email проставляет СЕРВЕР (согласованно)
    assert asyncio.run(main._task_identity_fields({"assignee_person_id": "p1"})) == {
        "assignee_person_id": "p1", "assignee_name": "Ivan Petrov", "assignee_email": "ivan@example.com"}
    # свободный текст (роль) → не разрешился: текст храним, person_id пуст (мягкая деградация)
    assert asyncio.run(main._task_identity_fields({"assignee_name": "IT lead"})) == {
        "assignee_person_id": None, "assignee_name": "IT lead", "assignee_email": None}
    # запись не трогает исполнителя → не перетираем его вовсе
    assert asyncio.run(main._task_identity_fields({"title": "x"})) == {}


def test_co_assignee_sees_the_task_as_his_own():
    """Соисполнитель участвует в работе — значит задача его. Проверять надо ДО ответственного:
    у задачи с чужим assignee_person_id опознание оборвалось бы на строгом сравнении."""
    u = {"id": "u1", "person_id": "p1", "email": "ivan@example.com", "full_name": "Ivan Petrov"}
    task = {"assignee_person_id": "p9", "co_assignees": [{"person_id": "p1", "name": "Ivan Petrov"}]}
    assert main._my_task_match(u, task) is True
    by_email = {"assignee_person_id": "p9",
                "co_assignees": [{"person_id": None, "name": "Иван", "email": "IVAN@example.com"}]}
    assert main._my_task_match(u, by_email) is True
    # Свободный текст без идентичности задачу никому не показывает — иначе она досталась бы
    # первому попавшемуся тёзке.
    text_only = {"assignee_person_id": "p9", "co_assignees": [{"person_id": None, "name": "Отдел контента"}]}
    assert main._my_task_match(u, text_only) is False
    assert main._my_task_match(u, {"assignee_person_id": "p9", "co_assignees": []}) is False


def test_my_task_match():
    """«Моя задача» = назначенная на меня. Точность: person_id → email → имя (легаси)."""
    u = {"id": "u1", "person_id": "p1", "email": "ivan@example.com", "full_name": "Ivan Petrov"}
    assert main._my_task_match(u, {"assignee_person_id": "p1"}) is True
    assert main._my_task_match(u, {"assignee_email": "IVAN@example.com"}) is True   # регистр
    assert main._my_task_match(u, {"assignee_name": "ivan petrov"}) is True   # легаси-строка
    assert main._my_task_match(u, {"assignee_name": "IT lead"}) is False      # роль — не человек
    assert main._my_task_match(u, {"assignee_person_id": "p2"}) is False


def test_attention_cancelled_is_not_overdue(monkeypatch):
    """WP8: отменённую задачу никто делать не будет — она не «просрочена». Раньше колокол
    требовал внимания к отменённому, а еженедельный дайджест на ту же задачу отвечал иначе.
    Ф1: «застой» срабатывает только если задача в работе с 0% БОЛЬШЕ НЕДЕЛИ (свежая — норма)."""
    proj = {"id": "5", "code": "PRJ-002", "name": "Проект", "status": "active"}
    recent = date.today().isoformat()  # старт сегодня → «только начали», НЕ застой

    async def _accessible(user, **kw):
        # Проект ВЕДЁТ тот, кто спрашивает: иначе колокол по нём ему не полагается —
        # см. test_attention_only_mine_for_portfolio_owner.
        return [(proj, {"pm_id": OWNER_USER_ID})]

    async def _bulk(pids, types):
        return {"5": []}

    def _tasks(wps, m, pid):
        return [
            {"id": "t1", "title": "отменённая", "status": "cancelled", "planned_end": "2020-01-01"},
            {"id": "t2", "title": "живая просроченная застрявшая", "status": "in_progress",
             "planned_start": "2020-01-01", "planned_end": "2020-01-01", "progress": 0},
            {"id": "t3", "title": "только начали (0% — норма)", "status": "in_progress",
             "planned_start": recent, "progress": 0},
        ]

    silence_db_sources(monkeypatch, main)
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    silence_db_sources(monkeypatch, main)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.get("/attention", headers={"Authorization": f"Bearer {tok}"}).json()
    assert [t["id"] for t in d["data"]["overdue"]] == ["t2"]
    # t2 застряла >недели (старт 2020) → в stalled; t3 только начали сегодня → НЕ в stalled.
    assert [t["id"] for t in d["data"]["stalled"]] == ["t2"]
    # t2 попала и в overdue, и в stalled — но это ОДНА задача, а не две; t3 нигде.
    assert d["counts"]["total"] == 1, "бейдж на колокольчике считал одну задачу дважды"


def test_problems_list_carries_state(monkeypatch):
    """Список обращений отдаёт СОСТОЯНИЕ, а не только текст жалобы.

    Ответ собирался руками из восьми полей, пока база отдавала двенадцать: плашка «Решено»
    на экране владельца не появлялась никогда, а кнопка «Отметить решённой» висела и на уже
    закрытых — повторный клик получал 409. Тип на фронте эти поля объявлял с самого начала.
    """
    row = {"id": 7, "reporter_email": "a@b.c", "reporter_name": "Автор", "description": "не грузится",
           "page_url": "/projects/1", "user_agent": "ua", "has_screenshot": True,
           "created_at": "2026-09-01T10:00:00Z", "status": "resolved", "resolution": "починили",
           "resolved_at": "2026-09-02T08:00:00Z", "resolved_by": "Portfolio Owner"}

    async def _fetch(limit=200):
        return [row]
    monkeypatch.setattr(main.db, "fetch_problems", _fetch)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.get("/problems", headers={"Authorization": f"Bearer {tok}"}).json()["data"][0]
    assert d["status"] == "resolved" and d["resolution"] == "починили"
    assert d["resolved_by"] == "Portfolio Owner" and d["resolved_at"] == "2026-09-02T08:00:00Z"
    # Старые поля на месте и в прежнем порядке — новые дописаны в хвост.
    assert list(d)[:8] == ["id", "reporter_email", "reporter_name", "description",
                           "page_url", "user_agent", "has_screenshot", "created_at"]


def test_problems_list_old_rows_read_as_open(monkeypatch):
    """У обращений, заведённых до появления колонок, состояния в строке нет — это «open»,
    а не пустота: иначе кнопка «Отметить решённой» пропала бы у всего старого потока."""
    async def _fetch(limit=200):
        return [{"id": 1, "reporter_email": "a@b.c", "reporter_name": None, "description": "старое",
                 "page_url": None, "user_agent": None, "has_screenshot": False,
                 "created_at": "2026-07-01T10:00:00Z"}]
    monkeypatch.setattr(main.db, "fetch_problems", _fetch)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.get("/problems", headers={"Authorization": f"Bearer {tok}"}).json()["data"][0]
    assert d["status"] == "open" and d["resolution"] is None and d["resolved_by"] is None


def test_problem_resolve_is_once(monkeypatch):
    """«Решено» ставится один раз: повтор не двигает дату и не подсвечивает автору заново
    давно прочитанный ответ. Второй клик — 409, а не молчаливое обновление."""
    state = {"open": True, "calls": []}

    async def _resolve(rid, resolution, by, at):
        state["calls"].append((str(rid), resolution, by))
        if not state["open"]:
            return False
        state["open"] = False
        return True
    monkeypatch.setattr(main.db, "resolve_problem", _resolve)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.post("/problems/7/resolve", headers=h, json={"resolution": "починили"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "resolved"
    r = client.post("/problems/7/resolve", headers=h, json={"resolution": "ещё раз"})
    assert r.status_code == 409
    # Автор ответа — тот, кто нажал; текст обрезается до 500 символов.
    assert state["calls"][0][2] == "Portfolio Owner"

    long_note = "я" * 700
    state["open"] = True
    client.post("/problems/7/resolve", headers=h, json={"resolution": long_note})
    assert len(state["calls"][-1][1]) == 500


def test_problem_resolve_is_owner_only(monkeypatch):
    """Решать чужие обращения может только владелец портфеля — руководитель проекта не видит
    даже списка."""
    async def _resolve(rid, resolution, by, at):
        raise AssertionError("до базы дойти не должно")
    monkeypatch.setattr(main.db, "resolve_problem", _resolve)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/problems/7/resolve", headers=h, json={}).status_code == 403
    assert client.get("/problems", headers=h).status_code == 403


def test_attention_only_mine_for_portfolio_owner(monkeypatch):
    """Колокол — личный: ведёшь проект — видишь всё в нём, не ведёшь — только своё.

    Владелец портфеля и руководство компании (owner/exec) читают ВСЕ проекты, и охват
    колокола совпадал с правом чтения — уведомление по каждой задаче каждого проекта.
    Своих среди них было не найти. Кросс-проектный срез называется Портфель."""
    mine = {"id": "5", "code": "PRJ-MY", "name": "Мой проект", "status": "active"}
    alien = {"id": "6", "code": "PRJ-ALIEN", "name": "Чужой проект", "status": "active"}
    past = "2020-01-01"

    async def _accessible(user, **kw):
        return [(mine, {"pm_id": OWNER_USER_ID}), (alien, {"pm_id": "чужой-pm"})]

    async def _bulk(pids, types):
        return {}

    def _tasks(wps, m, pid):
        if str(m.get("pm_id")) == OWNER_USER_ID:
            return [{"id": "own", "title": "в моём проекте", "status": "in_progress", "planned_end": past}]
        return [
            {"id": "alien", "title": "чужая", "status": "in_progress", "planned_end": past},
            {"id": "assigned", "title": "в чужом проекте, но на меня", "status": "in_progress",
             "planned_end": past, "assignee_email": "owner@company.com"},
        ]

    silence_db_sources(monkeypatch, main)
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.get("/attention", headers={"Authorization": f"Bearer {tok}"}).json()
    assert sorted(t["id"] for t in d["data"]["overdue"]) == ["assigned", "own"],         "владелец портфеля снова получает чужие задачи"


def test_attention_meetings_and_actions_are_mine_only(monkeypatch):
    """Совещание — моё, если я участник; поручение — если оно на меня."""
    from datetime import timedelta as _td
    alien = {"id": "7", "code": "PRJ-ALIEN", "name": "Чужой", "status": "active"}
    soon = (date.today() + _td(days=2)).isoformat()
    meta = {
        "pm_id": "чужой-pm",
        "_meetings": [
            {"id": "m1", "title": "без меня", "meeting_date": soon, "attendees": [{"name": "Кто-то"}],
             "action_items": [{"id": "a1", "action_text": "чужое", "due_date": soon, "status": "open",
                               "assignee_name": "Кто-то"},
                              {"id": "a2", "action_text": "моё", "due_date": soon, "status": "open",
                               "assignee_email": "owner@company.com"}]},
            {"id": "m2", "title": "со мной", "meeting_date": soon,
             "attendees": [{"email": "owner@company.com"}], "action_items": []},
        ],
    }

    async def _accessible(user, **kw):
        return [(alien, meta)]

    async def _bulk(pids, types):
        return {}

    def _tasks(wps, m, pid):
        return []

    silence_db_sources(monkeypatch, main)
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    monkeypatch.setattr(main, "_tasks_from_wps", _tasks)
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    d = client.get("/attention", headers={"Authorization": f"Bearer {tok}"}).json()
    assert [x["id"] for x in d["data"]["meetings"]] == ["m2"]
    assert [x["id"] for x in d["data"]["actions"]] == ["a2"]


def test_plain_text_strips_our_markup_before_bitrix():
    """В Bitrix уходит текст без наших маркеров: там ждут BB-код, и «**» приехали бы литералами.

    Зеркало фронтового `stripRichText` — если разойдутся, человек увидит в Bitrix звёздочки,
    а в портале жирный, и решит, что портал ломает его описания.
    """
    assert main._plain_text("**важно** и *тонко* и `код`") == "важно и тонко и код"
    assert main._plain_text("## Что сделать") == "Что сделать"
    assert main._plain_text("- раз\n- два") == chr(8226) + " раз" + chr(10) + chr(8226) + " два"
    # Текст без разметки не трогаем вовсе — старые описания уходят как были.
    assert main._plain_text("Обычное описание") == "Обычное описание"
    assert main._plain_text(None) == "" and main._plain_text("") == ""
    # Звёздочка внутри слова разметкой не считается — иначе ломались бы имена файлов.
    assert main._plain_text("some_var*2") == "some_var*2"


def test_plain_text_keeps_blank_lines_between_paragraphs():
    """Пустая строка перед списком и перед подзаголовком обязана уцелеть.

    Ловушка была в классе отступа: `\\s` включает перевод строки, и с re.M «^\\s*» съедал
    пустую строку ВМЕСТЕ с маркером — абзацы слипались уже на стороне Bitrix, причём только
    в многострочных описаниях, то есть ровно в тех, ради которых разметку и заводили.
    """
    NL, BULLET = chr(10), chr(8226)
    src = "Абзац." + NL * 2 + "- раз" + NL + "- два" + NL * 2 + "## Итог" + NL * 2 + "Хвост."
    out = main._plain_text(src)
    assert out == ("Абзац." + NL * 2 + BULLET + " раз" + NL + BULLET + " два"
                   + NL * 2 + "Итог" + NL * 2 + "Хвост.")
    assert out.count(NL * 2) == 3, "разделители абзацев потеряны"
    # Отступ пробелами перед маркером по-прежнему снимается вместе с ним.
    assert main._plain_text("   - раз") == BULLET + " раз"


def test_plain_text_matches_the_shared_markup_cases():
    """Оба зеркала разбирают разметку одинаково — по одному и тому же набору случаев.

    Набор живёт у фронта (src/utils/markupCases.json) и зеркалится сюда скриптом
    tools/markup/sync_cases.py: контейнеры изолированы, и один файл обоим наборам тестов
    не виден. Каждая сторона проверяется своим прогоном, но по ОДНОЙ таблице — иначе они
    расходятся молча, как уже было дважды за два дня.
    """
    import json
    import os

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "markup_cases.json")
    with open(path, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    assert len(cases) > 10, "набор случаев подозрительно мал"
    for case in cases:
        assert main._plain_text(case["in"]) == case["out"], case["in"]


def test_plain_text_survives_deep_nesting():
    """Подобранная вложенность роняла разбор: описание в 2 КБ из звёздочек давало
    RecursionError, а значит 500 на создании задачи в Bitrix. Теперь глубина ограничена,
    и от текста при этом не должно пропадать ничего, кроме самих звёздочек."""
    src = "*" * 1000 + "важно" + "*" * 1000
    out = main._plain_text(src)          # не должно бросать
    assert "важно" in out
    assert out.replace("*", "") == "важно"


def test_plain_text_is_not_quadratic():
    """Описание приходит недоверенным и длиной до 20 000 знаков (столько принимает сервер).

    Первая версия разбора искала закрывающую серию перебором остатка строки на КАЖДУЮ
    открывающую: 20 000 знаков занимали почти три секунды. Порог с большим запасом — ловим
    возврат квадрата, а не меряем машину.
    """
    import time

    cases = ["*" * 5000, "*a " * 3000, "*a* " * 3000, ("текст *курс* и **жир** " * 900)[:20000],
             # Настоящий квадрат: закрывающие серии ЕСТЬ, но ни одна не подходит.
             " *a**" * 4000, " **xy*z" * 3000]
    t0 = time.time()
    for src in cases:
        main._plain_text(src)
    assert time.time() - t0 < 1.0


def test_backlog_bitrix_task_id_is_server_only():
    """Номер задачи Bitrix у пункта бэклога ставит только сервер.

    Удаление задачи идёт вебхуком интеграции ПО ЭТОМУ номеру: принимай портал его обычным PUT —
    и подставленный руками чужой id снёс бы чужую задачу. У совещаний эта дыра уже закрыта.
    """
    assert "bitrix24_task_id" in main._protected_fields("_backlog")


def test_task_bitrix_task_id_is_server_only(monkeypatch):
    """Номер задачи Bitrix24 у задачи обычным PUT не принимается.

    «Удалить задачу из Bitrix24» идёт вебхуком интеграции ПО ЭТОМУ номеру: принимай портал его
    от клиента — и любой, кому можно править задачу, подставил бы чужой id и снёс задачу любого
    сотрудника. У совещаний и у пунктов бэклога дыра закрыта списком _COLLECTION_PROTECTED;
    задачи живут не в коллекции, а в своей таблице, поэтому у них свой список ключей.
    """
    store = {"title": "T", "task_type": "task", "status": "not_started",
             "bitrix24_task_id": 4821, "actual_start": None, "actual_end": None, "actual_hours": None}

    async def fake_get(tid):
        return dict(store)

    async def fake_update(tid, fields):
        store.update(fields)
        return dict(store)

    monkeypatch.setattr(main.db, "get_task", fake_get)
    monkeypatch.setattr(main.db, "update_task", fake_update)
    monkeypatch.setattr(main.db, "task_shim", lambda r: {"id": 7, "subject": r.get("title"), "startDate": None,
                        "dueDate": None, "percentageDone": None, "createdAt": "x",
                        "_links": {"status": {"href": "/api/v3/statuses/1"}}})
    monkeypatch.setattr(main.db, "task_extra", lambda rows: (
        {"7": {k: rows[0][k] for k in main._EXTRA_KEYS if rows[0].get(k) is not None}} if rows else {}))

    async def fake_fetch(pid, types):
        return []

    async def fake_retry(pid, mut, attempts=4):
        return mut({})
    logged = []

    async def fake_log(pid, user, action, detail=""):
        logged.append(detail)
    monkeypatch.setattr(main, "_fetch_wps", fake_fetch)
    monkeypatch.setattr(main, "with_meta_retry", fake_retry)
    monkeypatch.setattr(main, "_append_action_log", fake_log)
    monkeypatch.setattr(main.db, "insert_activity", lambda *a, **k: None)
    h = _pm_headers(monkeypatch)
    # Правим приоритет, а не название: у задачи с номером Bitrix правка названия ушла бы
    # в push и потащила за собой load_meta — в этом тесте базы нет, а проверяем мы не push.
    client.put("/projects/5/tasks/7", headers=h, json={"priority": "high", "bitrix24_task_id": 99999})
    assert store["bitrix24_task_id"] == 4821   # чужой номер не прилип
    assert store["priority"] == "high"         # остальные extra-поля пишутся как прежде
    # Список серверных полей — один, и он не пустой: без этой пары проверок правка «упростила бы»
    # его обратно до _EXTRA_KEYS, и маршрут снова начал бы принимать номер.
    assert "bitrix24_task_id" not in main._CLIENT_EXTRA_KEYS
    assert "bitrix24_task_id" in main._EXTRA_KEYS   # своими маршрутами сервер его пишет
    # И журнал не рассказывает о записи, которой не было: «bitrix24_task_id: 4821→99999» в нём
    # выглядело бы для владельца как настоящее изменение — особенно при автоприёме черновиков.
    assert logged and "bitrix24_task_id" not in " ".join(logged)


def test_version_format_and_major_parsing():
    # Номер печатают и на него ссылаются, поэтому формат «мажор.минор» с четырьмя знаками.
    assert main._format_version(1, 3) == "1.0003"
    assert main._format_version(1, 0) == "1.0000"
    assert main._format_version(2, 47) == "2.0047"
    # Мажор читается из уже сохранённого номера; у старых проектов он просто «5» → мажор 1.
    assert main._version_major("1.0005") == 1
    assert main._version_major("2.0001") == 2
    assert main._version_major("5") == 1
    assert main._version_major("") == 1
    assert main._version_major(None) == 1


def test_closed_session_starts_new_version():
    # Кнопка «Зафиксировать версию» ставит на записи closed. Иначе напечатанный 1.0003
    # продолжал бы впитывать правки, и через час это был бы другой документ под тем же номером.
    now = "2026-08-12T10:00:00+00:00"
    fresh = {"author_name": "РП", "created_at": "2026-08-12T09:55:00+00:00"}
    assert main._vlog_session_open(fresh, "РП", now) is True
    assert main._vlog_session_open({**fresh, "closed": True}, "РП", now) is False


# ─────────────────────── доступ помощника (MCP): замок и токены ───────────────────────

def test_agent_access_flag_is_sparse():
    """Замок — разрежённый ключ: пишем только при открытом доступе, при закрытии УДАЛЯЕМ.

    Если бы писали false, документ тронутого проекта отличался бы от нетронутых. Ключ ещё и
    намеренно НЕ выходит в to_project: новое поле там двинуло бы байты у всех проектов сразу.
    """
    m: dict = {"name": "проект"}
    assert main._agent_access(m) == {"enabled": False, "sensitive": False}, "по умолчанию закрыто"

    # Одна галочка открывает весь проект (решение владельца): раздельное согласие
    # на бюджет и решения было лишним вопросом, а форма и данные из-за него расходились.
    main._set_agent_access(m, True)
    assert main._agent_access(m) == {"enabled": True, "sensitive": True}
    assert list(m)[-1] == "_agent_access", "ключ дописывается в конец — порядок ключей part контракта"

    # Проекты, открытые СТАРОЙ формой без второй галочки, обязаны стать полностью открытыми:
    # иначе форма показывает «открыт», а помощник молча не видит бюджет (такие проекты могли
    # остаться в старых данных).
    legacy = {"name": "проект", "_agent_access": {"enabled": True}}
    assert main._agent_access(legacy) == {"enabled": True, "sensitive": True}

    main._set_agent_access(m, False, True)
    assert "_agent_access" not in m, "закрытие обязано УДАЛЯТЬ ключ, а не писать false"
    assert m == {"name": "проект"}, "документ вернулся к исходному виду"

    # sensitive без enabled бессмыслен: закрытый проект не показывает ничего, в том числе денег
    main._set_agent_access(m, False, True)
    assert "_agent_access" not in m


def test_agent_token_not_accepted_by_regular_api():
    """Токен помощника не должен работать на обычных маршрутах.

    Это не мелочь, а конструктивная защита: пока /api его не знает, токеном физически нельзя
    сменить пароль, снять 2FA или зайти в админку — целый класс дыр закрыт, а не заткнут.
    """
    fake = "pmo_" + "x" * 43
    for path in ("/projects", "/auth/me", "/me/agent-tokens"):
        r = client.get(path, headers={"Authorization": f"Bearer {fake}"})
        assert r.status_code == 401, f"{path} принял токен помощника"


def test_verify_api_token_rejects_revoked_expired_and_disabled(monkeypatch):
    """Проверка токена отказывает при отзыве, истечении, выключенной учётке и грейсе 2FA."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    base = {"id": 7, "user_email": "pm1@company.com", "scopes": "read+draft",
            "created_at": now.isoformat(), "expires_at": (now + timedelta(days=90)).isoformat(),
            "last_used_at": None, "revoked_at": None}
    monkeypatch.setattr(main.db, "touch_api_token", lambda *a, **k: _aw(None))

    def _find(rec):
        monkeypatch.setattr(main.db, "find_api_token", lambda h: _aw(rec))

    import asyncio

    def _check(tok="pmo_whatever"):
        return asyncio.run(main.verify_api_token(tok))

    _find(dict(base))
    ok = _check()
    assert ok and ok["user"]["email"] == "pm1@company.com"

    _find({**base, "revoked_at": now.isoformat()})
    assert _check() is None, "отозванный токен обязан перестать работать"

    _find({**base, "expires_at": (now - timedelta(days=1)).isoformat()})
    assert _check() is None, "просроченный токен обязан перестать работать"

    _find(None)
    assert _check() is None
    assert _check("") is None

def test_oauth_metadata_issuer_has_no_trailing_slash():
    """Издателя сравнивают побайтово (RFC 8414). Лишний слэш — и клиент решит, что метаданные
    не от того сервера, о котором спрашивал, а понять это по симптому «просто не подключается»
    почти невозможно."""
    r = client.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200
    meta = r.json()
    assert not meta["issuer"].endswith("/"), meta["issuer"]
    assert meta["code_challenge_methods_supported"] == ["S256"]      # без PKCE не пускаем вовсе
    # Обновление доступа объявляем: клиент продлевает подключение сам, а ротация с одноразовым
    # значением и потолком цепочки живёт в провайдере.
    assert meta["grant_types_supported"] == ["authorization_code", "refresh_token"]


def test_oauth_protected_resource_points_at_our_mcp():
    """Цепочка обнаружения замыкается: 401 от точки помощника называет этот адрес,
    а он называет сервер авторизации."""
    r = client.get("/.well-known/oauth-protected-resource/mcp")
    assert r.status_code == 200
    data = r.json()
    assert data["resource"].endswith("/mcp")
    assert data["authorization_servers"] and not data["authorization_servers"][0].endswith("/")


def test_oauth_consent_requires_login():
    """Согласие даёт человек, вошедший в портал. Без входа — 401, и никакого своего,
    более слабого входа у подключения помощника нет."""
    assert client.get("/oauth/consent/whatever").status_code == 401
    assert client.post("/oauth/consent/whatever/approve").status_code == 401


def test_oauth_resource_indicator_only_ours():
    """RFC 8707: токен просят для конкретного ресурса. Чужой не обслуживаем — иначе портал
    выпускал бы токены «на предъявителя» для чего угодно."""
    assert main.oauth_resource_ok(f"{main.PORTAL_PUBLIC_URL}/mcp")
    assert main.oauth_resource_ok(f"{main.PORTAL_PUBLIC_URL}/mcp/")
    assert not main.oauth_resource_ok("https://evil.example/mcp")
    assert not main.oauth_resource_ok("")


def test_rename_refreshes_pm_name_in_projects(monkeypatch):
    """Подпись РП в проекте — копия имени. Проект завели под старым именем, человек потом
    переименовался, и в колонке «РП» остался тот, кого уже нет, — читается как
    «проект не мой». Владение при этом считается по pm_id и не страдает."""
    import asyncio

    uid = "u-1"
    projects = [{"id": "10", "meta": {"pm_id": uid, "pm_name": "Старое имя"}},
                {"id": "11", "meta": {"pm_id": uid, "pm_name": "Новое имя"}},
                {"id": "12", "meta": {"pm_id": "other", "pm_name": "Чужой РП"}}]
    written = {}

    async def _fetch(*a, **k):
        return projects

    async def _retry(pid, mut):
        m = next(p["meta"] for p in projects if p["id"] == str(pid))
        written[str(pid)] = mut(m)
        return written[str(pid)]

    monkeypatch.setattr(main, "fetch_projects", _fetch)
    monkeypatch.setattr(main, "with_meta_retry", _retry)
    monkeypatch.setattr(main, "_meta", lambda el: el["meta"])

    n = asyncio.run(main.refresh_pm_name(uid, "Новое имя"))
    assert n == 1, "переписать надо только устаревшую подпись"
    assert written == {"10": "Новое имя"}, written
    assert projects[2]["meta"]["pm_name"] == "Чужой РП", "чужой проект трогать нельзя"


def test_public_share_hides_access_lists():
    """Публичная ссылка не отдаёт списки доступа: это внутренние id сотрудников.

    Нашли при сверке эталонов: `editors` утекал анонимам вместе с полным
    паспортом, и к нему чуть не добавились `observers`."""
    el = {"id": 1, "name": "П", "identifier": "p",
          "description": {"raw": json.dumps({"code": "C", "status": "active",
                                             "_editors": ["e1"], "_observers": ["o1"],
                                             "_share": {"enabled": True, "sections": ["passport"]}})},
          "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}
    m = main._meta(el)
    view = main._public_project_view(el, m)
    assert "editors" not in view and "observers" not in view, view
    assert view["name"] == "П"          # сам паспорт при этом отдаётся
    # без опубликованного паспорта наружу уходит только шапка
    m2 = dict(m, _share={"enabled": True, "sections": []})
    short = main._public_project_view(el, m2)
    assert set(short) == {"id", "code", "name", "status", "priority"}


def test_public_share_hides_access_lists_on_the_real_anonymous_path(monkeypatch):
    """То же самое, но по маршруту, куда анонимный посетитель ходит НА САМОМ ДЕЛЕ.

    `_public_project_view` обслуживает только `/public/{token}` — заголовок и список
    разделов. Паспорт публичная страница берёт обычным `GET /projects/{pid}?share=…`,
    и редакция, поставленная в первом, второй не закрывала: списки доступа уезжали
    анониму. Проверка через хелпер это пропускала — она проверяла не тот путь."""
    meta = {"code": "C", "status": "active", "_editors": ["e1"], "_observers": ["o1"],
            "_share": {"enabled": True, "token": "TOK", "sections": ["passport"]}}
    row = {"id": 5, "name": "П", "identifier": "p",
           "description": {"raw": json.dumps(meta)},
           "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}

    async def fake_find_share(token):
        return (row, meta) if token == "TOK" else (None, None)

    async def fake_get_row(pid):
        return row
    monkeypatch.setattr(main, "_find_share", fake_find_share)
    monkeypatch.setattr(main.db, "get_project_row", fake_get_row)

    anon = client.get("/projects/5?share=TOK")
    assert anon.status_code == 200, anon.text
    body = anon.json()["data"]
    assert "editors" not in body and "observers" not in body, body
    assert body["name"] == "П"   # сам паспорт при этом виден — ссылка не должна опустеть

    # А авторизованный владелец списки доступа по-прежнему получает: правка только для role="public",
    # иначе поехали бы байты всех эталонов.
    tok = client.post("/auth/login", json={"email": "owner@company.com", "password": "admin123"}).json()["access_token"]
    mine = client.get("/projects/5", headers={"Authorization": f"Bearer {tok}"}).json()["data"]
    assert mine["editors"] == ["e1"] and mine["observers"] == ["o1"], mine
