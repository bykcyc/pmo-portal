# -*- coding: utf-8 -*-
"""Зонтик и подпроекты: наследование прав по дереву.

Правило считает SQL (db._TREE_CTE) и приносит в транзиентном `_tree`; решают два места —
`_owns_item` и `_observes_item`. Здесь проверяется ровно это: что решатели дерево видят, что
в мету оно не просачивается, что наследование НЕ даёт управления доступом, и что все читающие
сводки узнают о зонтике одинаково — по образцу test_observer_project_reaches_every_read_aggregator,
потому что именно там на прошлой неделе разъехались три копии одного фильтра.
"""
import asyncio
import json

import main
from fastapi.testclient import TestClient

client = TestClient(main.app)

UID = "u-child-pm"
UMB_PM = "u-umbrella-pm"


def _shim(pid, meta, tree=None):
    """Строка проекта в форме db.project_shim: мета строкой в description.raw, дерево рядом."""
    return {"id": pid, "name": "P%s" % pid, "identifier": "p%s" % pid,
            "description": {"raw": json.dumps(meta)},
            "createdAt": "2026-09-01T00:00:00Z", "updatedAt": "2026-09-01T00:00:00Z",
            "parent_id": (tree or {}).get("parent_id"),
            "_tree": {"parent_id": None, "parent_code": None, "parent_name": None,
                      "parent_budget_rate": None, "subprojects_count": 0,
                      "inherited_editors": [], "inherited_observers": [], **(tree or {})}}


# ─────────────────────────── решатели прав ───────────────────────────

def test_umbrella_pm_writes_the_subproject():
    """Право РП зонтика на подпроект — то, ради чего заводили дерево (решение владельца)."""
    child = {"pm_id": "someone", "_editors": [], "_tree": {"inherited_editors": [UMB_PM]}}
    assert main._owns_item({"id": UMB_PM}, child) is True
    assert main._can_read_item({"id": UMB_PM}, child) is True
    assert main._owns_item({"id": "чужой"}, child) is False


def test_subproject_pm_reads_the_tree_but_never_writes_it():
    """Обратное направление: участники подпроектов читают зонтик и соседей — и только читают."""
    umbrella = {"pm_id": "someone", "_editors": [], "_tree": {"inherited_observers": [UID]}}
    assert main._can_read_item({"id": UID}, umbrella) is True
    assert main._owns_item({"id": UID}, umbrella) is False, "наследование на чтение дало право писать"


def test_deciders_read_both_shapes():
    """Форма API (`to_project`) и сырая мета (`_tree`) дают один ответ.

    Тот же двойной приём, что у editors/_editors: списки приходят в решатели в разной форме,
    поэтому проверяем оба входа.
    """
    api_shape = {"pm_id": "x", "inherited_editors": [UID], "inherited_observers": []}
    meta_shape = {"pm_id": "x", "_tree": {"inherited_editors": [UID], "inherited_observers": []}}
    assert main._owns_item({"id": UID}, api_shape) is True
    assert main._owns_item({"id": UID}, meta_shape) is True
    assert main._owns_item({"id": ""}, {"pm_id": None, "inherited_editors": [""]}) is False


def test_inheritance_does_not_grant_access_management():
    """РП зонтика правит подпроект, но со-РП в нём не раздаёт.

    Иначе он тихо менял бы состав доступа в чужом проекте. Перевернуть — одна строка,
    но это отдельное решение владельца, а не побочный эффект.
    """
    child_meta = {"pm_id": "someone", "_tree": {"inherited_editors": [UMB_PM]}}
    u = {"id": UMB_PM, "role": "pm"}
    assert main._owns_item(u, child_meta) is True
    assert main._is_primary_pm_or_owner(u, child_meta) is False


# ─────────────────────────── дерево не попадает в данные ───────────────────────────

def test_tree_reaches_meta_and_never_reaches_the_blob():
    """`_tree` входит через parse и снимается перед записью — рядом с `_counts`.

    Сохранись он хоть раз, первая же правка со-РП впечатала бы наследование в данные навсегда,
    и «вычисляемые права» стали бы материализованными, с ручной поддержкой на каждой передаче.
    """
    import project_meta
    el = _shim(7, {"code": "C", "pm_id": "x"}, {"inherited_editors": [UID], "subprojects_count": 2})
    m = main._meta(el)
    assert m["_tree"]["inherited_editors"] == [UID] and m["_tree"]["subprojects_count"] == 2

    async def _no_baselines(*a, **kw):
        return None
    raw = json.loads(asyncio.run(project_meta.raw_for_save(
        "7", m, ensure_baselines=_no_baselines, serialize_meta=lambda _pid, mm: json.dumps(mm))))
    assert "_tree" not in raw, "вычисляемое дерево уехало в сохраняемую мету"
    assert "_counts" not in raw     # контроль: рядом с ним и снимаем
    assert raw["code"] == "C"


def test_to_project_appends_tree_fields_last_and_in_order():
    """Байты паспорта — контракт: новые поля строго в хвосте и в фиксированном порядке."""
    el = _shim(7, {"code": "C", "status": "active"},
               {"parent_id": 3, "parent_code": "UMB", "parent_name": "Зонтик",
                "subprojects_count": 0, "inherited_editors": ["a"], "inherited_observers": ["b"]})
    p = main.to_project(el)
    assert list(p.keys())[-6:] == ["parent_id", "parent_code", "parent_name",
                                   "subprojects_count", "inherited_editors", "inherited_observers"]
    assert p["parent_id"] == "3", "id наружу обязан быть строкой, как везде в контракте"
    assert main.to_project(_shim(7, {"code": "C"}))["parent_id"] is None


def test_public_share_shows_no_tree_at_all(monkeypatch):
    """Ссылка публикует ОДИН проект — ни списков доступа, ни навигации по дереву.

    Списки — это внутренние id сотрудников (у зонтика со множеством подпроектов там были бы
    все их руководители разом). Навигация не безобиднее: `parent_name` назвал бы анониму
    зонтик, которого владелец ссылки не публиковал, а `subprojects_count` выдал бы размер
    программы. Поймано сверкой эталонов — публичная выдача выросла ровно на эти поля.
    """
    for f in ("editors", "observers", "inherited_editors", "inherited_observers",
              "parent_id", "parent_code", "parent_name", "subprojects_count"):
        assert f in main._PUBLIC_HIDDEN_FIELDS, f

    # И по РЕАЛЬНОМУ пути анонима: паспорт он берёт обычным маршрутом с ?share=, а не /public.
    meta = {"code": "C", "status": "active", "_editors": ["e1"],
            "_share": {"enabled": True, "token": "TOK", "sections": ["passport"]}}
    row = _shim(5, meta, {"parent_id": 3, "parent_code": "UMB", "parent_name": "Зонтик",
                          "subprojects_count": 4, "inherited_editors": ["a"]})

    async def fake_find(token):
        return (row, meta) if token == "TOK" else (None, None)

    async def fake_row(pid):
        return row
    monkeypatch.setattr(main, "_find_share", fake_find)
    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    body = client.get("/projects/5?share=TOK").json()["data"]
    assert body["name"] and "parent_name" not in body and "subprojects_count" not in body, body
    assert "inherited_editors" not in body


# ─────────────────────────── читающие сводки ───────────────────────────

def test_umbrella_reaches_every_read_aggregator_for_a_subproject_pm(monkeypatch):
    """Зеркало наблюдательского теста: у портфеля, поиска и колокольчика СВОИ копии фильтра.

    Ровно на них 08.09 разъехалось правило наблюдателя. Проверяем каждую точку отдельно:
    тест «ничего не утекло» такую потерю не ловит — там пусто и на исправном коде, и на сломанном.
    """
    uid = main.USERS["pm1@company.com"]["id"]

    async def fake_projects(*a, **kw):
        return [_shim(7, {"code": "UMB", "status": "active", "pm_id": "чужой"},
                      {"subprojects_count": 1, "inherited_observers": [uid]})]

    async def empty(*a, **kw):
        return {}
    monkeypatch.setattr(main, "fetch_projects", fake_projects)
    monkeypatch.setattr(main, "_fetch_wps_bulk", empty)
    monkeypatch.setattr(main.db, "load_latest_baselines", empty)
    monkeypatch.setattr(main, "_load_snapshots", empty)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": "Bearer %s" % tok}

    assert [i["id"] for i in client.get("/projects", headers=h).json()["data"]] == ["7"]
    assert [r["id"] for r in client.get("/portfolio/dashboard", headers=h).json()["data"]] == ["7"]
    found = client.get("/search?q=UMB", headers=h).json()["data"]
    assert [p["project_id"] for p in found["projects"]] == ["7"]


def test_write_guard_sees_inheritance_through_the_db_row(monkeypatch):
    """rbac на записи ходит через `_user_owns_project`, а тот читает ОДНУ строку из БД.

    Значит дерево обязано приезжать и этим путём — иначе РП зонтика видел бы подпроект
    в списке, но получал 403 на любую попытку что-то в нём изменить.
    """
    async def fake_row(pid):
        return _shim(int(pid), {"pm_id": "someone"}, {"inherited_editors": [UMB_PM]})
    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    main._OWNS_TTL.clear()
    assert asyncio.run(main._user_owns_project({"id": UMB_PM}, "7")) is True
    assert asyncio.run(main._user_can_read_project({"id": UMB_PM}, "7")) is True
    main._OWNS_TTL.clear()
    assert asyncio.run(main._user_owns_project({"id": "чужой"}, "7")) is False


def test_tree_events_clear_the_whole_access_cache():
    """Точечная чистка невозможна: затронуты зонтик, все подпроекты и все их участники, а
    `_OWNS_TTL` о дереве ничего не знает. События дерева редки — чистим целиком."""
    main._OWNS_TTL[("u1", "42")] = (True, 9e9)
    main._OWNS_TTL[("u2", "43", "read")] = (True, 9e9)
    main._invalidate_tree_access()
    assert main._OWNS_TTL == {}


def test_membership_change_in_a_tree_clears_the_cache_of_OTHER_projects(monkeypatch):
    """Снятый со-РП зонтика не должен ещё полминуты править подпроекты.

    Точечная чистка ищет ключи по ЭТОМУ проекту, а протухают записи с ДРУГИМИ id — зонтик,
    все подпроекты, все соседи. До дерева этого случая не существовало, поэтому старые
    инвалидаторы его и не покрывают: доступ снимают у зонтика, а остаётся он на детях.
    Stale positive на запись — худший вид протухания, поэтому проверяем именно снятие.
    """
    calls = {"tree": 0}
    monkeypatch.setattr(main, "_invalidate_tree_access", lambda: calls.__setitem__("tree", calls["tree"] + 1))

    # Проект в дереве: у зонтика есть дети → правка состава задевает и их.
    main._invalidate_after_membership_change("5", {"_tree": {"subprojects_count": 3}}, "alice")
    assert calls["tree"] == 1, "смена состава в дереве не сбросила кэш других проектов"

    # Подпроект: правка его состава меняет читающих у зонтика и соседей.
    main._invalidate_after_membership_change("7", {"_tree": {"parent_id": 5}}, "bob")
    assert calls["tree"] == 2

    # Обычный проект вне дерева — общий сброс не нужен, хватает точечного.
    main._invalidate_after_membership_change("9", {"_tree": {"parent_id": None, "subprojects_count": 0}}, "carol")
    assert calls["tree"] == 2, "у одиночного проекта сбросили кэш всем без нужды"
    main._invalidate_after_membership_change("9", {}, "carol")
    assert calls["tree"] == 2


def test_removing_an_umbrella_copm_kills_write_access_to_children_at_once(monkeypatch):
    """Тот же случай, но целиком: от кэшированного доступа до его исчезновения.

    Проверяем не вызов хелпера, а НАБЛЮДАЕМОЕ поведение гарда — иначе тест доказывал бы
    только то, что мы кого-то позвали.
    """
    umbrella_editors = ["alice"]

    async def fake_child_row(pid):
        # Ребёнок наследует правящих от зонтика — так же, как это считает db._TREE_CTE.
        return _shim(int(pid), {"pm_id": "someone"}, {"inherited_editors": list(umbrella_editors)})
    monkeypatch.setattr(main.db, "get_project_row", fake_child_row)

    main._OWNS_TTL.clear()
    assert asyncio.run(main._user_owns_project({"id": "alice"}, "7")) is True   # доступ есть и закэширован
    umbrella_editors.clear()                                                    # сняли со-РП у зонтика
    assert asyncio.run(main._user_owns_project({"id": "alice"}, "7")) is True, "кэш ещё держит — так и должно быть"
    main._invalidate_after_membership_change("5", {"_tree": {"subprojects_count": 1}}, "alice")
    assert asyncio.run(main._user_owns_project({"id": "alice"}, "7")) is False,         "после снятия со-РП зонтика доступ к подпроекту обязан пропасть сразу"


def test_list_item_carries_the_umbrella_name(monkeypatch):
    """Карточка списка пишет «Часть проекта: КОД Название» — значит имя обязано приезжать.

    Без него в карточке оставался код и висячий пробел: человек шёл за понятным названием
    программы и не получал его. Поймано разбором диффа, а не глазами.
    """
    el = _shim(7, {"code": "C", "status": "active"},
               {"parent_id": 3, "parent_code": "UMB", "parent_name": "Внедрение ERP"})
    item = main.to_list_item(el)
    assert item["parent_code"] == "UMB" and item["parent_name"] == "Внедрение ERP"


# ─────────────────────────── маршруты привязки ───────────────────────────

def _wire(monkeypatch, umbrella_meta, child_meta, code="ok", calls=None):
    async def fake_load(pid):
        return ({"id": pid}, umbrella_meta)

    async def fake_row(pid):
        return _shim(int(pid), child_meta, {"parent_id": child_meta.get("_parent")})

    async def fake_set(child, parent):
        if calls is not None:
            calls.append((str(child), parent))
        return code

    async def fake_log(*a, **kw):
        return None
    monkeypatch.setattr(main, "load_meta", fake_load)
    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    monkeypatch.setattr(main.db, "set_project_parent", fake_set)
    monkeypatch.setattr(main, "_append_action_log", fake_log)


def _h(email, pw):
    tok = client.post("/auth/login", json={"email": email, "password": pw}).json()["access_token"]
    return {"Authorization": "Bearer %s" % tok}


def _owner_h():
    return _h("owner@company.com", "admin123")


def _pm_h():
    return _h("pm1@company.com", "pm123")


def test_link_requires_owning_both_sides(monkeypatch):
    """Привязка раздаёт права, поэтому она не может быть способом ПРИСВОИТЬ чужой проект.

    РП зонтика, не ведущий подпроект, получает отказ: связал бы — и получил полный доступ
    на чужую работу. Владелец портфеля вправе связать что угодно, он и так правит всё.
    """
    pm1 = main.USERS["pm1@company.com"]["id"]
    _wire(monkeypatch, {"pm_id": pm1, "code": "UMB"}, {"pm_id": "чужой", "code": "CHD"})
    assert client.post("/projects/7/subprojects", headers=_pm_h(), json={"project_id": "8"}).status_code == 403
    assert client.post("/projects/7/subprojects", headers=_owner_h(), json={"project_id": "8"}).status_code == 200


def test_link_reports_every_refusal_of_the_transaction(monkeypatch):
    """Коды исхода db.set_project_parent → статусы. Тексты отказов — часть контракта."""
    for code, status in (("parent_has_parent", 422), ("child_has_children", 422),
                         ("child_already_linked", 409), ("missing", 404), ("self", 422)):
        _wire(monkeypatch, {"pm_id": "x", "code": "UMB"}, {"pm_id": "y", "code": "CHD"}, code=code)
        r = client.post("/projects/7/subprojects", headers=_owner_h(), json={"project_id": "8"})
        assert r.status_code == status, (code, r.status_code, r.text)
        assert r.json()["detail"]


def test_link_refuses_templates_and_archived_umbrella(monkeypatch):
    _wire(monkeypatch, {"pm_id": "x", "_is_template": True}, {"pm_id": "y"})
    assert client.post("/projects/7/subprojects", headers=_owner_h(), json={"project_id": "8"}).status_code == 422
    _wire(monkeypatch, {"pm_id": "x", "_archived": True}, {"pm_id": "y"})
    assert client.post("/projects/7/subprojects", headers=_owner_h(), json={"project_id": "8"}).status_code == 422
    _wire(monkeypatch, {"pm_id": "x"}, {"pm_id": "y", "_is_template": True})
    assert client.post("/projects/7/subprojects", headers=_owner_h(), json={"project_id": "8"}).status_code == 422


def test_unlink_is_for_the_umbrella_not_the_child(monkeypatch):
    """РП подпроекта не отвязывается сам: иначе он выходил бы из-под надзора зонтика по
    собственному усмотрению — ровно то, ради чего связь и заводят."""
    calls = []
    pm1 = main.USERS["pm1@company.com"]["id"]
    _wire(monkeypatch, {"pm_id": "чужой", "code": "UMB"}, {"pm_id": pm1, "_parent": 7}, calls=calls)
    assert client.delete("/projects/7/subprojects/8", headers=_pm_h()).status_code == 403
    assert calls == [], "отказ случился уже ПОСЛЕ записи в базу"
    _wire(monkeypatch, {"pm_id": pm1, "code": "UMB"}, {"pm_id": "кто-то", "_parent": 7}, calls=calls)
    assert client.delete("/projects/7/subprojects/8", headers=_pm_h()).status_code == 200
    assert calls == [("8", None)]


def test_unlink_refuses_a_project_from_another_umbrella(monkeypatch):
    """Иначе «отвязать» стало бы способом трогать чужое дерево по угаданному id."""
    _wire(monkeypatch, {"pm_id": "x", "code": "UMB"}, {"pm_id": "y", "_parent": 999})
    assert client.delete("/projects/7/subprojects/8", headers=_owner_h()).status_code == 404


def test_subprojects_list_returns_portfolio_rows_sorted(monkeypatch):
    """Сводка подпроектов — те же строки, что в портфеле: РП зонтика смотрит одним взглядом."""
    async def fake_ids(pid):
        return ["9", "8"]

    async def fake_rows(ids):
        return [_shim(9, {"code": "B-2", "status": "active", "pm_id": "p2"}),
                _shim(8, {"code": "A-1", "status": "active", "pm_id": "p1"})]

    async def empty(*a, **kw):
        return {}
    monkeypatch.setattr(main.db, "child_project_ids", fake_ids)
    monkeypatch.setattr(main.db, "fetch_project_rows_by_ids", fake_rows)
    monkeypatch.setattr(main.db, "load_project_docs_for", empty)
    monkeypatch.setattr(main, "_fetch_wps_bulk", empty)
    monkeypatch.setattr(main.db, "load_latest_baselines", empty)
    rows = client.get("/projects/7/subprojects", headers=_owner_h()).json()["data"]
    assert [r["code"] for r in rows] == ["A-1", "B-2"], "порядок по коду, а не по id"
    assert {"progress", "overdue_tasks_count", "rag_status", "budget_plan", "pm_id"} <= set(rows[0])
