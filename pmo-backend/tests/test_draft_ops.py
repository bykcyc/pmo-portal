# -*- coding: utf-8 -*-
"""Операция, которую сервер не понял, не должна создавать данные.

Раньше любая нераспознанная операция приводилась к «add», причём target_id сохранялся:
помощник писал «update», а в черновике появлялась строка «добавить „Разработка ТЗ“».
Название знакомое — человек жал «Принять» и получал дубль. С автоприёмом жать некому,
и дубль ушёл бы в проект молча.
"""
import asyncio
from typing import Any, cast

import draft_apply
import main


def _one(op, **extra):
    return draft_apply.normalize_items([{"section": "tasks", "op": op,
                                         "data": {"title": "Разработка ТЗ"}, **extra}])[0]


def test_update_is_understood_as_edit():
    assert _one("update", target_id="551")["op"] == "edit"


def test_remove_is_understood_as_delete():
    assert _one("remove", target_id="551")["op"] == "delete"


def test_synonyms_cover_the_usual_wordings():
    for word, canon in (("modify", "edit"), ("change", "edit"), ("patch", "edit"),
                        ("create", "add"), ("insert", "add"), ("drop", "delete")):
        assert _one(word, target_id="551")["op"] == canon, f"синоним {word} не разобран"


def test_unknown_op_becomes_clash_not_add():
    it = _one("чтототакое", target_id="551")
    assert it["op"] == "clash", "нераспознанная операция не имеет права создавать данные"
    assert "чтототакое" in it["note"], "человек должен видеть, что именно сервер не понял"


def test_clash_is_never_applied():
    """Даже с ЯВНОЙ галочкой: человек может отметить клэш вручную через PATCH /drafts/{did},
    где op не проверяется, и тогда проверка операции в selected_items — единственная защита."""
    it = _one("чтототакое", target_id="551")
    it["selected"] = True
    assert draft_apply.selected_items({"items": [it]}) == []


def test_missing_op_still_means_add():
    """Пустая операция — это по-прежнему «добавить»: так работает разбор плана проекта."""
    assert draft_apply.normalize_items([{"section": "tasks", "data": {"title": "Т"}}])[0]["op"] == "add"


def test_unclear_op_cannot_blow_up_the_note():
    """Название операции приходит извне: длина не должна быть неограниченной."""
    it = _one("ы" * 5000, target_id="551")
    assert it["op"] == "clash"
    assert len(it["note"]) < 600, "мусор из поля op уехал в черновик целиком"


class _ApiDel:
    """Фасад в объёме, который трогает удаление из коллекции."""

    def __init__(self):
        self.meta = {"_risks_reg": [{"id": "7", "title": "Старый риск"}]}

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    def _coll(self, m, key):
        return m.get(key) or []

    def _item_label(self, item):
        return str(item.get("title") or item.get("name") or item.get("id") or "")

    def _protected_fields(self, key):
        return main._protected_fields(key)   # НЕ свой список: два списка разъедутся

    def _log_action(self, m, user, action, label):
        pass

    async def with_meta_retry(self, pid, mut):
        return mut(self.meta)


def test_deleted_item_carries_its_name():
    """«Удалено 12» человеку ничего не говорит — особенно когда удалял не он."""
    api = _ApiDel()
    res = asyncio.run(draft_apply._apply_coll(
        cast(Any, api), "5", "_risks_reg", "decisions", "delete",
        {"target_id": "7"}, {}, {"email": "owner@example.com"}))
    assert res["id"] == "7"
    assert res["title"] == "Старый риск", "в отчёте об удалении обязано быть название"


class _ApiDraft:
    """Фасад в объёме, который трогает apply_draft на путях задач и рисков."""

    logger = type("L", (), {"warning": staticmethod(lambda *a: None)})()

    # Область дат черновика — НЕ своя реализация: заглушка отдаёт ту самую, которой
    # пользуется портал, иначе тест проверял бы сам себя.
    draft_date_scope = staticmethod(main.draft_date_scope)
    draft_owns_task = staticmethod(main.draft_owns_task)

    def __init__(self):
        self.meta_reads = 0
        self.deleted: list = []
        self.deps_deleted: list = []
        self.db = _Deps([{"id": "d-1", "task_id": "11", "depends_on_id": "12"}])

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    async def load_meta(self, pid):
        self.meta_reads += 1
        return {}, {}

    async def _wp_tasks(self, pid, m):
        return [{"id": "11", "title": "Разработка ТЗ"}, {"id": "12", "title": "Согласование"}]

    async def _wp_risks(self, pid, m):
        return [{"id": "22", "title": "Срыв поставки"}]

    async def tasks_delete(self, pid, tid, user):
        self.deleted.append(str(tid))

    async def risks_delete(self, pid, rid, user):
        self.deleted.append(str(rid))

    async def tasks_create(self, pid, payload, user):
        return {"data": {"id": "99"}}

    def _coll(self, m, key):
        return []

    def _item_label(self, item):
        return str(item.get("title") or item.get("id") or "")

    def _log_action(self, m, user, action, label):
        pass

    async def with_meta_retry(self, pid, mut):
        return mut({})

    async def dep_delete(self, pid, did, user):
        self.deps_deleted.append(str(did))
        return {"data": {"id": did}}


class _Deps:
    """Только то, из чего приём узнаёт о связях: их список."""

    def __init__(self, deps):
        self.deps = deps

    async def fetch_deps(self, pid):
        return list(self.deps)


def _draft(*items):
    return {"items": [dict(it, selected=True, id=it.get("id") or f"i{n}")
                      for n, it in enumerate(items, 1)]}


def test_apply_draft_names_deleted_task_and_risk():
    """Главный путь механизма: карта строится в apply_draft и доходит до обеих веток."""
    api = _ApiDraft()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "tasks", "op": "delete", "target_id": "11", "data": {}},
               {"section": "risks", "op": "delete", "target_id": "22", "data": {}}),
        {"email": "owner@example.com"}))
    assert [d["title"] for d in rep["deleted"]] == ["Разработка ТЗ", "Срыв поставки"]
    assert rep["failed"] == []


def test_map_is_not_built_without_deletions():
    """Карта читает все задачи и риски проекта — строить её зря дорого."""
    api = _ApiDraft()
    asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "tasks", "op": "add", "data": {"title": "Новая"}}),
        {"email": "owner@example.com"}))
    assert api.meta_reads == 0


def test_map_is_not_built_for_collection_only_deletions():
    """Удаление из коллекции карту не потребляет: у него запись уже прочитана."""
    api = _ApiDraft()
    asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "team", "op": "delete", "target_id": "7", "data": {}}),
        {"email": "owner@example.com"}))
    assert api.meta_reads == 0


def test_task_created_and_deleted_in_one_draft_keeps_its_name():
    """Созданного в этом же приёме нет в карте, построенной до цикла, — и всё равно должно
    быть названо: при автоприёме отчёт остаётся единственным свидетельством потери."""
    api = _ApiDraft()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"id": "a1", "section": "tasks", "op": "add", "data": {"title": "Времянка"}},
               {"id": "d1", "section": "tasks", "op": "delete", "target_id": "a1", "data": {}}),
        {"email": "owner@example.com"}))
    assert api.deleted == ["99"], "удаление должно резолвиться в id, созданный в этом же приёме"
    assert rep["deleted"][0]["title"] == "Времянка"


# ── Связи: снять можно, и это видно ──────────────────────────────────────────────
# Помощник присылал «удалить связь», портал отвечал «принято» и не делал ничего: приём знал
# у этого раздела только «добавить». Хуже того, обратная связь из того же черновика отбивалась
# как цикл — старая-то была жива.


def test_dependency_delete_is_applied_and_named():
    api = _ApiDraft()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "task-dependencies", "op": "delete", "target_id": "d-1", "data": {}}),
        {"email": "owner@example.com"}))
    assert api.deps_deleted == ["d-1"], "связь обязана быть снята, а не проглочена"
    assert rep["failed"] == []
    assert rep["deleted"][0]["title"] == "Разработка ТЗ ← Согласование", \
        "в отчёте должны быть названия задач, а не два uuid"


def test_dependency_delete_of_missing_link_is_reported_not_silently_ok():
    """Роут удаления отвечает успехом и на несуществующий id — отчёт не имеет права врать."""
    api = _ApiDraft()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "task-dependencies", "op": "delete", "target_id": "нет-такой", "data": {}}),
        {"email": "owner@example.com"}))
    assert api.deps_deleted == []
    assert rep["deleted"] == [] and len(rep["failed"]) == 1
    assert "не найдена" in rep["failed"][0]["why"]


def test_dependency_edit_says_what_to_do_instead():
    """Правки связи у портала нет. Молчать об этом нельзя — помощник повторит то же самое."""
    api = _ApiDraft()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "task-dependencies", "op": "edit", "target_id": "d-1",
                "data": {"lag_days": 3}}),
        {"email": "owner@example.com"}))
    assert len(rep["failed"]) == 1 and "снимите старую" in rep["failed"][0]["why"]


def test_link_swap_in_one_draft_removes_before_it_adds():
    """Смена направления связи возможна только в этом порядке: пока жива старая, новую
    отбивают как цикл. Поэтому у связей удаление идёт ПЕРВЫМ — вопреки общему правилу."""
    order = draft_apply.plan_order([
        {"section": "task-dependencies", "op": "add", "data": {"task_id": "12", "depends_on_id": "11"}},
        {"section": "task-dependencies", "op": "delete", "target_id": "d-1"},
    ])
    assert [it["op"] for it in order] == ["delete", "add"]


def test_other_sections_still_delete_last():
    """Общее правило не сломано: ссылка на только что удалённую задачу оборвалась бы."""
    order = draft_apply.plan_order([
        {"section": "tasks", "op": "delete", "target_id": "11"},
        {"section": "tasks", "op": "add", "data": {"title": "Новая"}},
    ])
    assert [it["op"] for it in order] == ["add", "delete"]


# ── Даты: явное значение черновика сильнее каскада ────────────────────────────────
# Большой черновик задавал даты десяткам задач. Каскад от каждой правки уезжал по всей
# цепочке зависимостей и ложился поверх значений, которые тот же черновик назначал дальше по
# списку: около половины задач получили даты, которых не было ни в одном элементе.


class _CascadeApi(_ApiDraft):
    """Правка задачи ведёт себя как роут: изменение дат зовёт НАСТОЯЩИЙ каскад портала."""

    def __init__(self, delta=5):
        super().__init__()
        self.delta = delta
        self.updated: list = []

    async def tasks_update(self, pid, tid, payload, user):
        self.updated.append((str(tid), dict(payload)))
        if "planned_start" in payload or "planned_end" in payload:
            await main._cascade_shift_successors(pid, str(tid), self.delta)
        return {"data": {"id": str(tid)}}


class _CascadeDb:
    """Связи и запись дат — тот кусок базы, который трогает каскад."""

    def __init__(self):
        self.deps = [{"id": "d-1", "task_id": "12", "depends_on_id": "11"},
                     {"id": "d-2", "task_id": "13", "depends_on_id": "12"}]
        self.written: list = []

    async def fetch_deps(self, pid):
        return list(self.deps)

    async def update_task(self, tid, fields):
        self.written.append((str(tid), dict(fields)))


_ROWS = [{"id": "11", "title": "Первая", "planned_start": "2026-01-01", "planned_end": "2026-01-10"},
         {"id": "12", "title": "Вторая", "planned_start": "2026-02-01", "planned_end": "2026-02-05"},
         {"id": "13", "title": "Третья", "planned_start": "2026-03-01", "planned_end": "2026-03-05"}]


async def _done(value):
    return value


def _wire_cascade(monkeypatch):
    """Каскад живёт в main и ходит в модульные же db/load_meta/_wp_tasks — подменяем их,
    а не свой слой: иначе проверялась бы заглушка, а не портал."""
    dbs = _CascadeDb()
    monkeypatch.setattr(main, "db", dbs)
    monkeypatch.setattr(main, "load_meta", lambda pid: _done(({}, {})))
    monkeypatch.setattr(main, "_wp_tasks", lambda pid, m: _done(list(_ROWS)))
    return dbs


def test_cascade_does_not_touch_dates_the_draft_sets_itself(monkeypatch):
    dbs = _wire_cascade(monkeypatch)
    api = _CascadeApi()
    api.db = dbs
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "tasks", "op": "edit", "target_id": "11",
                "data": {"planned_start": "2026-01-06", "planned_end": "2026-01-15"}},
               {"section": "tasks", "op": "edit", "target_id": "12",
                "data": {"planned_start": "2026-02-06", "planned_end": "2026-02-10"}}),
        {"email": "owner@example.com"}))
    moved = [tid for tid, _f in dbs.written]
    assert "12" not in moved, "каскад переписал дату, которую черновик задал явно"
    assert moved == ["13"], "всё, чего в черновике нет, каскад по-прежнему двигает"
    assert rep["failed"] == []


def test_cascaded_tasks_are_reported_by_name(monkeypatch):
    """Сдвиг соседей человек не заказывал: без списка он узнаёт о нём, только сверив даты."""
    dbs = _wire_cascade(monkeypatch)
    api = _CascadeApi()
    api.db = dbs
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "tasks", "op": "edit", "target_id": "11",
                "data": {"planned_end": "2026-01-15"}}),
        {"email": "owner@example.com"}))
    names = {row["id"]: row["title"] for row in rep["cascaded"]}
    assert names == {"12": "Вторая", "13": "Третья"}
    moved = {row["id"]: row["planned_end"] for row in rep["cascaded"]}
    assert moved["12"] == "2026-02-10", "новые даты должны быть в отчёте"


def test_quiet_draft_has_no_cascade_section(monkeypatch):
    """Ничего не поехало — лишнего ключа в отчёте нет: пустой список читается как событие."""
    _wire_cascade(monkeypatch)
    api = _CascadeApi()
    rep = asyncio.run(draft_apply.apply_draft(
        cast(Any, api), "5",
        _draft({"section": "tasks", "op": "edit", "target_id": "11", "data": {"progress": 40}}),
        {"email": "owner@example.com"}))
    assert "cascaded" not in rep


# ── Обещание помощнику и то, что приём делает на самом деле ───────────────────────


def test_unappliable_names_the_reason_before_the_button_is_pressed():
    """Помощник узнавал о невыполнимом элементе только после «Принять». Теперь — сразу."""
    stuck = draft_apply.unappliable([
        {"id": "i1", "section": "task-dependencies", "op": "edit"},
        {"id": "i2", "section": "выдуманный", "op": "add"},
    ])
    assert [x["item"] for x in stuck] == ["i1", "i2"]
    assert "невозможна" in stuck[0]["why"] and "delete" in stuck[0]["why"]
    assert "не поддерживается" in stuck[1]["why"]


def test_skipped_and_clashing_items_are_not_called_unappliable():
    """Пропуск и противоречие не применяются осознанно — это не поломка черновика."""
    assert draft_apply.unappliable([{"id": "i1", "section": "tasks", "op": "skip"},
                                    {"id": "i2", "section": "tasks", "op": "clash"}]) == []


def test_promise_matches_what_the_apply_really_refuses():
    """Два места, которые обязаны совпадать: список APPLIABLE_OPS и ветки приёма. Разойдутся —
    помощник снова услышит «принято» о том, чего портал не делает."""
    for section, op in (("task-dependencies", "edit"), ("baselines", "edit"),
                        ("baselines", "delete"), ("passport", "delete"), ("выдуманный", "add")):
        assert draft_apply.unappliable([{"id": "i1", "section": section, "op": op}]), \
            f"{section}/{op} обещан выполнимым"
        api = _ApiDraft()
        rep = asyncio.run(draft_apply.apply_draft(
            cast(Any, api), "5",
            _draft({"section": section, "op": op, "target_id": "11", "data": {}}),
            {"email": "owner@example.com"}))
        assert len(rep["failed"]) == 1 and not rep["created"] and not rep["updated"] \
            and not rep["deleted"], f"{section}/{op} приём почему-то выполнил"


def test_everything_the_promise_allows_is_dispatched_somewhere():
    """Обратная сторона: раздел из обещания обязан иметь ветку в приёме."""
    branches = {"passport", "tasks", "risks", "task-dependencies", "baselines",
                *draft_apply._COLL_BY_SECTION}
    assert set(draft_apply.APPLIABLE_OPS) == branches
