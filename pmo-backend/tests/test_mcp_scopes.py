# -*- coding: utf-8 -*-
"""Право «draft» проверяется на самом деле, а не на словах.

Токен выпускается либо на чтение (`read`), либо на чтение и предложения (`read+draft`) —
человек выбирает это в портале осознанно. До сих пор выбор был декорацией: `required_scopes`
у сервера требовал только `read`, а больше `scopes` не читал НИКТО — токен «только чтение»
преспокойно звал `propose_changes` и `create_project`.

Пока черновик ждал нажатия «Принять», цена ошибки была ограничена. С автоприёмом у владельца
портала (cd2dc7d) read-only токен пишет и удаляет НЕМЕДЛЕННО, без отмены и без корзины.

Харнесс тот же, что в test_mcp_auto_apply.py, плюс `scopes` у поддельного токена: в бою их
кладёт verify_token обоих проверяющих, и тесты обязаны быть похожи на бой.
"""
import asyncio
import json
from typing import Any, cast

import mcp_server
import main
from mcp.server.mcpserver.exceptions import ToolError

OWNER = "owner@example.com"
PM = "pm@example.com"

READ_ONLY = ["read"]
READ_DRAFT = ["read", "draft"]


class _Tok:
    def __init__(self, email=PM, role="pm", scopes=READ_DRAFT):
        self.claims = {"user": {"email": email, "id": "u1", "role": role}, "token_id": "t1"}
        self.scopes = list(scopes)


class _Db:
    def __init__(self):
        self.drafts: list = []
        self.mcp_log: list = []
        self._next = 100

    async def fetch_drafts(self, pid=None, status=None, author=None):
        return [d for d in self.drafts if not status or d.get("status") == status]

    async def insert_draft(self, pid, author, source, title, items, at):
        self._next += 1
        self.drafts.append({"id": str(self._next), "project_id": pid, "author": author,
                            "status": "open", "items": list(items)})
        return str(self._next)

    async def update_draft_items(self, did, items):
        for d in self.drafts:
            if str(d["id"]) == str(did):
                d["items"] = list(items)
        return True

    async def append_mcp_log(self, at, email, token_id, tool, pid, ok, detail):
        self.mcp_log.append({"tool": tool, "ok": ok, "detail": detail})


class _Api:
    """Фасад main в объёме, который трогают инструменты записи."""

    class _Logger:
        def warning(self, *a, **kw):
            pass

    logger = _Logger()

    # Область дат черновика (см. main.draft_date_scope): каскад не двигает то, что черновик
    # задаёт явно. Берём НАСТОЯЩУЮ реализацию — своя разошлась бы с порталом молча.
    draft_date_scope = staticmethod(main.draft_date_scope)
    draft_owns_task = staticmethod(main.draft_owns_task)

    def __init__(self, db=None, auto_apply=False):
        self.db = db or _Db()
        self._auto = auto_apply
        self.accepted: list = []
        self.projects: list = []
        self.tasks: list = []
        self.logged: list = []

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    async def _append_action_log(self, pid, user, action, detail=""):
        self.logged.append((pid, action))

    async def load_meta(self, pid):
        return {"id": pid}, {}

    def _owns_item(self, user, m):
        return True

    def _agent_access(self, m):
        return {"enabled": True, "sensitive": True}

    def _mcp_auto_apply(self):
        return self._auto

    def to_project(self, el):
        return {"id": str(el.get("id")), "name": "Проект"}

    async def draft_accept(self, did, user):
        self.accepted.append(str(did))
        return {"data": {"id": str(did), "status": "accepted",
                         "report": {"created": [], "updated": [], "deleted": [],
                                    "failed": [], "requested": 0}}}

    # ── то, что нужно create_project ────────────────────────────────────────────
    async def project_create(self, payload, user):
        self.projects.append(payload)
        return {"data": {"id": "9"}}

    async def with_meta_retry(self, pid, fn):
        return fn({})

    def _set_agent_access(self, m, enabled, sensitive):
        return m

    async def tasks_create(self, pid, payload, user):
        self.tasks.append(payload)
        return {"data": {"id": f"srv{len(self.tasks)}"}}


def _call(api, tool, args, monkeypatch, tok):
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: tok)
    srv = mcp_server.build(cast(Any, api))
    res = asyncio.run(srv.call_tool(tool, args))
    return json.loads("".join(getattr(c, "text", "") for c in (res.content or [])))


ROW = {"section": "tasks", "op": "add", "data": {"title": "Разработка ТЗ"}}


def _propose(api, monkeypatch, tok):
    return _call(api, "propose_changes", {
        "project_id": "5", "source": "проверка", "title": "Пачка", "items": json.dumps([ROW]),
    }, monkeypatch, tok)


def _create(api, monkeypatch, tok):
    return _call(api, "create_project", {
        "name": "Новый", "code": "NEW", "plan": json.dumps({"tasks": [{"title": "Задача"}]}),
    }, monkeypatch, tok)


# ── отказ токену только для чтения ──────────────────────────────────────────────

def test_read_only_token_cannot_propose_changes(monkeypatch):
    """Главный случай: токен выпущен на чтение — предлагать изменения он не вправе."""
    api = _Api()
    try:
        _propose(api, monkeypatch, _Tok(scopes=READ_ONLY))
    except ToolError as exc:
        assert "только для чтения" in str(exc)
        assert "draft" in str(exc)
    else:
        raise AssertionError("токен без права «draft» обязан получить отказ")
    assert api.db.drafts == [], "черновик не должен появиться вовсе"


def test_read_only_token_cannot_create_project(monkeypatch):
    """Новый проект — тоже запись: ломать нечего, но мусор в портале остаётся человеку."""
    api = _Api()
    try:
        _create(api, monkeypatch, _Tok(scopes=READ_ONLY))
    except ToolError as exc:
        assert "только для чтения" in str(exc)
    else:
        raise AssertionError("токен без права «draft» не должен заводить проекты")
    assert api.projects == [], "проект не должен быть создан"


def test_read_only_owner_token_does_not_auto_apply(monkeypatch):
    """Ради этого всё и делалось: с автоприёмом отказ обязан случиться ДО записи.

    У владельца портала черновик применяется немедленно — здесь read-only токен без гейта
    писал и удалял бы в проекте без единого подтверждения.
    """
    api = _Api(auto_apply=True)
    try:
        _propose(api, monkeypatch, _Tok(email=OWNER, role="owner", scopes=READ_ONLY))
    except ToolError as exc:
        assert "только для чтения" in str(exc)
    else:
        raise AssertionError("автоприём не отменяет проверку прав токена")
    assert api.accepted == [], "ничего не должно быть применено"
    assert api.db.drafts == []
    assert api.logged == [], "в журнал проекта тоже писать нечего"


def test_token_without_scopes_at_all_is_refused(monkeypatch):
    """Неизвестные права — не повод считать их полными: отказ по умолчанию."""
    api = _Api()
    tok = _Tok()
    tok.scopes = []
    try:
        _propose(api, monkeypatch, tok)
    except ToolError as exc:
        assert "только для чтения" in str(exc)
    else:
        raise AssertionError("пустой список прав обязан читаться как «нельзя»")


def test_refusal_is_visible_in_the_mcp_log(monkeypatch):
    """Отказ обязан оставить след: иначе владелец не узнает, что помощник упёрся в права."""
    api = _Api()
    try:
        _propose(api, monkeypatch, _Tok(scopes=READ_ONLY))
    except ToolError:
        pass
    assert [r for r in api.db.mcp_log if r["tool"] == "propose_changes" and not r["ok"]]


# ── сторож против чрезмерного гейта ─────────────────────────────────────────────

def test_draft_scope_still_proposes(monkeypatch):
    """Обычный токен «read+draft» обязан работать как прежде."""
    api = _Api()
    out = _propose(api, monkeypatch, _Tok(scopes=READ_DRAFT))
    assert out["draft_id"] == "101"
    assert len(api.db.drafts) == 1


def test_draft_scope_still_creates_project(monkeypatch):
    api = _Api()
    out = _create(api, monkeypatch, _Tok(scopes=READ_DRAFT))
    assert out["project_id"] == "9"
    assert api.projects and api.projects[0]["code"] == "NEW"


def test_read_only_token_still_reads(monkeypatch):
    """Гейт закрывает запись, а не чтение — иначе он ломает то, ради чего токен выпускали."""
    api = _Api()
    out = _call(api, "project_card", {"project_id": "5"}, monkeypatch, _Tok(scopes=READ_ONLY))
    assert out["project"]["id"] == "5"
