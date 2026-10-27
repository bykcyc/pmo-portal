# -*- coding: utf-8 -*-
"""Реестр проектов переходного периода: болванка → привязка → живые данные.

Смысл экрана в одном: пока часть проектов живёт вне портала (например, в Excel), портфель показывает половину картины.
Строка реестра закрывает дыру, но обязана честно различать три состояния — «проект ещё не
заведён», «заведён, вот его живые цифры» и «ссылка есть, а проекта уже нет».
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(main.app)
OWNER = {"id": "u1", "email": "owner@company.com", "role": "owner"}

ROWS = [
    {"id": "1", "pm_name": "Ольга Лебедева", "name": "Новый сайт", "kind": "операционный",
     "rag": "красный", "customer": None, "phase": "не решён", "note": None,
     "project_id": None, "sort_order": 0, "created_at": "2026-08-17", "updated_at": None},
    {"id": "2", "pm_name": "Юрий Сидоренко", "name": "Складской учёт", "kind": "стратегический",
     "rag": "зелёный", "customer": None, "phase": "реализация", "note": None,
     "project_id": "142", "sort_order": 1, "created_at": "2026-08-17", "updated_at": None},
    {"id": "3", "pm_name": "Кто-то", "name": "Удалённый проект", "kind": None, "rag": None,
     "customer": None, "phase": None, "note": None,
     "project_id": "999", "sort_order": 2, "created_at": "2026-08-17", "updated_at": None},
]

PORTFOLIO = {"data": [{"id": "142", "code": "prj-1", "name": "Складской учёт в ERP", "status": "active",
                       "rag_status": "red", "progress": 40, "pm_name": "Юрий Сидоренко",
                       "planned_end": "2026-12-31", "overdue_tasks_count": 2}]}


def _patch(monkeypatch, rows=None):
    async def _fetch():
        return [dict(r) for r in (rows if rows is not None else ROWS)]

    async def _portfolio(**kw):
        return PORTFOLIO
    monkeypatch.setattr(main.db, "fetch_registry", _fetch)
    monkeypatch.setattr(main, "portfolio", _portfolio)


def test_linked_row_shows_live_numbers(monkeypatch):
    """Привязанная строка берёт цифры из портфеля — иначе реестр и соседний экран разойдутся."""
    _patch(monkeypatch)
    rows = asyncio.run(main.registry_list(user=OWNER))["data"]
    plain, linked, broken = rows
    assert plain["live"] is None and plain["link_broken"] is False, "незаведённый — просто болванка"
    assert linked["live"]["rag"] == "red" and linked["live"]["progress"] == 40
    assert linked["live"]["code"] == "prj-1"


def test_dangling_link_is_named_not_hidden(monkeypatch):
    """Ссылка есть, а проекта нет: молчать нельзя — владелец будет считать проект заведённым."""
    _patch(monkeypatch)
    broken = asyncio.run(main.registry_list(user=OWNER))["data"][2]
    assert broken["link_broken"] is True and broken["live"] is None


def test_create_requires_name(monkeypatch):
    _patch(monkeypatch, rows=[])
    try:
        asyncio.run(main.registry_create({"pm_name": "Кто-то"}, user=OWNER))
        raise AssertionError("строка без названия не имеет смысла")
    except Exception as exc:  # HTTPException
        assert "азвание" in str(getattr(exc, "detail", exc))


def test_link_to_missing_project_is_refused(monkeypatch):
    """Опечатка в id дала бы вечную «болванку со ссылкой», неотличимую от незаведённого проекта."""
    _patch(monkeypatch)

    async def _no_project(pid):
        return None
    monkeypatch.setattr(main.db, "get_project_row", _no_project)
    try:
        asyncio.run(main.registry_update("1", {"project_id": "777"}, user=OWNER))
        raise AssertionError("привязка к несуществующему проекту должна быть отвергнута")
    except Exception as exc:
        assert "нет" in str(getattr(exc, "detail", exc))


def test_only_portfolio_manager_sees_the_registry(monkeypatch):
    """Реестр — личный список владельца на время перехода. РП его не видит вовсе."""
    async def _no_projects(*a, **kw):
        return []
    monkeypatch.setattr(main, "fetch_projects", _no_projects)
    tok = client.post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/portfolio/registry", headers=h).status_code == 403
    assert client.post("/portfolio/registry", headers=h, json={"name": "x"}).status_code == 403
