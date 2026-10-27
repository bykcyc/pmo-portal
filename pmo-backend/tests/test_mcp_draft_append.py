# -*- coding: utf-8 -*-
"""Черновик помощника: вторая пачка ДОПИСЫВАЕТСЯ, а не отбивается.

Большой перенос не влезает в один вызов — клиент не отдаёт строку в 50+ КБ. Раньше сервер
отвечал «уже есть незакрытый черновик», и помощник упирался: разрезать нельзя, целиком
не отправить. Теперь пачки от ТОГО ЖЕ автора копятся в одном черновике, а человек принимает
его один раз. Чужой открытый черновик по-прежнему блокирует — это и есть тот конфликт двух
источников, ради которого ограничение вводилось.
"""
import asyncio
import json
from typing import Any, cast

import mcp_server
from mcp.server.mcpserver.exceptions import ToolError

AUTHOR = "pm@example.com"


class _Tok:
    def __init__(self, email=AUTHOR):
        self.claims = {"user": {"email": email, "id": "u1", "role": "pm"}, "token_id": "t1"}
        # Права токена: в бою их кладёт verify_token, и без «draft» инструменты записи
        # отказывают (test_mcp_scopes). Здесь проверяется другое — токен полноправный.
        self.scopes = ["read", "draft"]


class _Db:
    def __init__(self, drafts=()):
        self.drafts = [dict(d) for d in drafts]
        self._next = 100
        self.updated: list = []
        self.closed_between = False   # имитация «человек принял черновик прямо сейчас»

    async def fetch_drafts(self, pid=None, status=None, author=None):
        return [d for d in self.drafts if not status or d.get("status") == status]

    async def insert_draft(self, pid, author, source, title, items, at):
        self._next += 1
        self.drafts.append({"id": str(self._next), "project_id": pid, "author": author,
                            "status": "open", "items": list(items)})
        return str(self._next)

    async def update_draft_items(self, did, items):
        if self.closed_between:
            return False
        self.updated.append((str(did), list(items)))
        for d in self.drafts:
            if str(d["id"]) == str(did):
                d["items"] = list(items)
        return True

    async def append_mcp_log(self, *a):
        pass

    async def load_persons(self):
        return []


class _Api:
    def __init__(self, db):
        self.db = db

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    async def load_meta(self, pid):
        return {"id": pid}, {}

    def _owns_item(self, user, m):
        return True

    def _agent_access(self, m):
        return {"enabled": True, "sensitive": True}


def _propose(api, items, monkeypatch, email=AUTHOR, pid="5"):
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: _Tok(email))
    srv = mcp_server.build(cast(Any, api))
    res = asyncio.run(srv.call_tool("propose_changes", {
        "project_id": pid, "source": "проверка", "title": "Пачка", "items": json.dumps(items),
    }))
    return json.loads("".join(getattr(c, "text", "") for c in (res.content or [])))


ROW = {"section": "team", "op": "add", "data": {"name": "Иванов", "role": "аналитик"}}


def test_first_batch_creates_draft(monkeypatch):
    api = _Api(_Db())
    out = _propose(api, [ROW], monkeypatch)
    assert out["draft_id"] == "101"
    assert "appended" not in out


def test_second_batch_appends_to_same_draft(monkeypatch):
    db = _Db([{"id": "7", "project_id": "5", "author": AUTHOR, "status": "open", "items": [dict(ROW, id="1")]}])
    out = _propose(_Api(db), [ROW, ROW], monkeypatch)
    assert out["draft_id"] == "7"          # тот же черновик, а не отказ
    assert out["appended"] == 2
    assert len(db.updated[-1][1]) == 3     # один прежний + два новых
    # id раздаются заново, иначе в одном черновике окажутся два элемента с одинаковым id
    assert len({str(i["id"]) for i in db.updated[-1][1]}) == 3
    assert "принять" in out["next"].lower()


def test_foreign_draft_still_blocks(monkeypatch):
    db = _Db([{"id": "7", "project_id": "5", "author": "other@example.com", "status": "open", "items": []}])
    try:
        _propose(_Api(db), [ROW], monkeypatch)
    except ToolError as exc:
        assert "другого автора" in str(exc)
    else:
        raise AssertionError("чужой открытый черновик обязан блокировать")


def test_cap_stops_endless_growth(monkeypatch):
    big = [dict(ROW, id=str(i)) for i in range(mcp_server._DRAFT_ITEMS_CAP)]
    db = _Db([{"id": "7", "project_id": "5", "author": AUTHOR, "status": "open", "items": big}])
    try:
        _propose(_Api(db), [ROW], monkeypatch)
    except ToolError as exc:
        assert str(mcp_server._DRAFT_ITEMS_CAP) in str(exc)
    else:
        raise AssertionError("рост черновика обязан упираться в потолок")


def test_draft_accepted_mid_flight_is_reported(monkeypatch):
    """Человек принял черновик, пока готовилась пачка: молча терять её нельзя."""
    db = _Db([{"id": "7", "project_id": "5", "author": AUTHOR, "status": "open", "items": []}])
    db.closed_between = True
    try:
        _propose(_Api(db), [ROW], monkeypatch)
    except ToolError as exc:
        assert "закрыли" in str(exc)
    else:
        raise AssertionError("гонка с принятием черновика обязана быть видимой")
