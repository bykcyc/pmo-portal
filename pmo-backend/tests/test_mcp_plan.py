# -*- coding: utf-8 -*-
"""Разбор плана проекта для MCP: иерархия задач и честный отчёт.

Проверяем ровно эти ловушки: вложенные задачи
исчезали без ошибки, иерархия из кодов ИСР не строилась, а отчёт молчал о потере.
"""
import asyncio
from typing import Any, cast

import draft_apply
import main


def test_nested_tasks_are_expanded():
    """Дерево «фаза → задачи»: раньше десять детей уезжали внутрь данных фазы и терялись."""
    plan = {"tasks": [
        {"title": "Фаза 1", "task_type": "phase", "planned_start": "2026-03-02",
         "tasks": [{"title": "Задача 1.1"}, {"title": "Задача 1.2"}]},
        {"title": "Фаза 2", "task_type": "phase", "tasks": [{"title": "Задача 2.1"}]},
    ]}
    items, rejected = draft_apply.plan_items(plan)
    assert rejected == []
    assert len(items) == 5, "потеряны вложенные задачи"
    titles = [i["data"]["title"] for i in items]
    assert titles == ["Фаза 1", "Задача 1.1", "Задача 1.2", "Фаза 2", "Задача 2.1"]
    # Родитель назван ссылкой на элемент этого же приёма, а не «настоящим» id, которого ещё нет.
    child = next(i for i in items if i["data"]["title"] == "Задача 1.1")
    parent = next(i for i in items if i["data"]["title"] == "Фаза 1")
    assert child["parent_ref"] == parent["id"]
    # Служебный ключ не должен уехать в данные задачи — сервер его молча отбросит.
    assert "tasks" not in parent["data"]


def test_flat_plan_with_wbs_codes_builds_hierarchy():
    """Плоский список с кодами ИСР: «1.1» — ребёнок «1». Раньше parent_id оставался пустым у всех."""
    plan = {"tasks": [
        {"title": "Фаза", "wbs_code": "1", "task_type": "phase"},
        {"title": "Первая", "wbs_code": "1.1"},
        {"title": "Вторая", "wbs_code": "1.2"},
        {"title": "Отдельная", "wbs_code": "2"},
    ]}
    items, _ = draft_apply.plan_items(plan)
    by_title = {i["data"]["title"]: i for i in items}
    assert by_title["Первая"]["parent_ref"] == by_title["Фаза"]["id"]
    assert by_title["Вторая"]["parent_ref"] == by_title["Фаза"]["id"]
    assert "parent_ref" not in by_title["Отдельная"], "корневая задача не должна получить родителя"


def test_explicit_parent_wbs_wins():
    plan = {"tasks": [
        {"title": "Аналитика", "wbs_code": "A"},
        {"title": "Интервью", "parent_wbs": "A"},
    ]}
    items, _ = draft_apply.plan_items(plan)
    by_title = {i["data"]["title"]: i for i in items}
    assert by_title["Интервью"]["parent_ref"] == by_title["Аналитика"]["id"]


def test_children_are_applied_after_parents():
    """Порядок применения: родитель обязан быть создан раньше ребёнка на любой глубине."""
    plan = {"tasks": [{"title": "Ф", "task_type": "phase",
                       "tasks": [{"title": "Д", "tasks": [{"title": "Внук"}]}]}]}
    items, _ = draft_apply.plan_items(plan)
    order = [i["data"]["title"] for i in draft_apply.plan_order(draft_apply.normalize_items(items))]
    assert order.index("Ф") < order.index("Д") < order.index("Внук")


def test_normalize_items_keeps_parent_ref():
    """Элемент пересобирается по белому списку ключей — ссылка на родителя обязана уцелеть."""
    items, _ = draft_apply.plan_items({"tasks": [{"title": "Ф", "tasks": [{"title": "Д"}]}]})
    out = draft_apply.normalize_items(items)
    child = next(i for i in out if i["data"]["title"] == "Д")
    assert child.get("parent_ref"), "ссылка на родителя потеряна при нормализации"


def test_broken_rows_are_reported_not_dropped():
    """Всё, что разобрать нельзя, обязано вернуться поимённо. Молчаливая потеря — худший исход."""
    plan = {"tasks": ["строка вместо объекта"], "kpis": {"name": "объект вместо списка"}}
    items, rejected = draft_apply.plan_items(plan)
    assert items == []
    assert len(rejected) == 2
    assert any("не объект" in r["why"] for r in rejected)
    assert any("список" in r["why"] for r in rejected)


def test_depth_limit_rejects_instead_of_recursing():
    row: dict = {"title": "L0"}
    node = row
    for i in range(1, 12):
        child: dict = {"title": f"L{i}"}
        node["tasks"] = [child]
        node = child
    items, rejected = draft_apply.plan_items({"tasks": [row]})
    assert rejected, "слишком глубокое дерево должно попасть в отчёт, а не уйти в рекурсию"
    assert len(items) <= draft_apply._MAX_TASK_DEPTH + 1


# ── Отчёт приёма ────────────────────────────────────────────────────────────────

class _Api:
    """Минимальный двойник фасада main для apply_draft."""

    class _Logger:
        def warning(self, *a, **kw):
            pass

    logger = _Logger()

    # Область дат черновика (см. main.draft_date_scope): каскад не двигает то, что черновик
    # задаёт явно. Берём НАСТОЯЩУЮ реализацию — своя разошлась бы с порталом молча.
    draft_date_scope = staticmethod(main.draft_date_scope)
    draft_owns_task = staticmethod(main.draft_owns_task)

    def __init__(self):
        self.created = []

    async def tasks_create(self, pid, payload, user):
        self.created.append(payload)
        return {"data": {"id": f"srv{len(self.created)}"}}

    async def tasks_update(self, pid, tid, payload, user):
        return {"data": {"id": tid}}


def test_report_counts_requested_and_balances():
    """В отчёте видно, сколько элементов пошло в приём, и сумма исходов обязана сойтись."""
    items, _ = draft_apply.plan_items({"tasks": [{"title": "Ф", "task_type": "phase",
                                                  "tasks": [{"title": "Д"}]}]})
    draft = {"items": draft_apply.normalize_items(items)}
    api = _Api()
    report = asyncio.run(draft_apply.apply_draft(cast(Any, api), "5", draft, {"id": "u1"}))
    assert report["requested"] == 2
    assert len(report["created"]) == 2 and report["failed"] == []
    # Ребёнок получил настоящий id родителя, а не черновую ссылку.
    assert api.created[1]["parent_id"] == "srv1"


def test_orphan_child_is_named_in_report():
    """Родитель не создан → ребёнок обязан попасть в failed с понятной причиной."""
    class _Failing(_Api):
        async def tasks_create(self, pid, payload, user):
            if payload.get("title") == "Ф":
                raise ValueError("сервер отказал")
            return await super().tasks_create(pid, payload, user)

    items, _ = draft_apply.plan_items({"tasks": [{"title": "Ф", "task_type": "phase",
                                                  "tasks": [{"title": "Д"}]}]})
    report = asyncio.run(draft_apply.apply_draft(cast(Any, _Failing()), "5",
                                                 {"items": draft_apply.normalize_items(items)}, {"id": "u1"}))
    assert len(report["failed"]) == 2
    assert any("родительская задача не создана" in f["why"] for f in report["failed"])
    assert report["requested"] == 2
