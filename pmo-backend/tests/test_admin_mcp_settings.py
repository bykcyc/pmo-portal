# -*- coding: utf-8 -*-
"""Тумблер автоприёма: только владелец портала, по умолчанию выключен."""
import asyncio

import main

OWNER = {"id": "u1", "email": "owner@company.com", "role": "owner"}


def test_auto_apply_is_off_by_default(monkeypatch):
    monkeypatch.setattr(main, "_settings", lambda: {})
    assert main._mcp_auto_apply() is False


def test_auto_apply_reads_the_setting(monkeypatch):
    monkeypatch.setattr(main, "_settings", lambda: {"mcp": {"auto_apply": True}})
    assert main._mcp_auto_apply() is True


def test_garbage_in_the_setting_means_off(monkeypatch):
    """Испорченная настройка обязана значить «выключено»: тумблер снимает предохранитель."""
    for junk in ("да", 1, None, {"auto_apply": "нет"}):
        monkeypatch.setattr(main, "_settings", lambda j=junk: {"mcp": j})
        assert main._mcp_auto_apply() is False


def test_route_is_owner_only():
    """Проверка не на вызове, а на объявлении: зависимость обязана быть require_owner."""
    import inspect
    sig = inspect.signature(main.put_mcp_settings)
    assert sig.parameters["user"].default.dependency is main.require_owner


class _FakeDb:
    """Общего журнала админских действий в проекте нет — след пишется в mcp_access_log."""

    def __init__(self):
        self.mcp_log: list = []

    async def append_mcp_log(self, at, user_email, token_id, tool, project_id, ok, detail=""):
        self.mcp_log.append({"at": at, "user_email": user_email, "token_id": token_id,
                             "tool": tool, "project_id": project_id, "ok": ok, "detail": detail})


def test_toggle_leaves_a_trail_in_the_mcp_access_log(monkeypatch):
    """Включение/выключение автоприёма обязано попасть в журнал обращений помощника —
    он уже выведен в интерфейсе в той же секции «Помощники (MCP)», где живёт сам тумблер,
    так что человек, включивший его, увидит запись рядом с выключателем.
    """
    fake_db = _FakeDb()
    monkeypatch.setattr(main, "db", fake_db)

    async def fake_save_settings(s):  # реальную БД настроек не трогаем
        pass
    monkeypatch.setattr(main, "_save_settings", fake_save_settings)
    monkeypatch.setattr(main, "_settings", lambda: {})

    asyncio.run(main.put_mcp_settings({"auto_apply": True}, user=OWNER))
    assert len(fake_db.mcp_log) == 1
    on_entry = fake_db.mcp_log[0]
    assert on_entry["tool"] == "settings.auto_apply"
    assert on_entry["user_email"] == "owner@company.com"
    assert "включён" in on_entry["detail"]

    asyncio.run(main.put_mcp_settings({"auto_apply": False}, user=OWNER))
    assert len(fake_db.mcp_log) == 2
    off_entry = fake_db.mcp_log[1]
    assert off_entry["tool"] == "settings.auto_apply"
    assert off_entry["user_email"] == "owner@company.com"
    assert "выключен" in off_entry["detail"]
