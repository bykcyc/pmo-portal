"""Учётка и помощник: смена пароля, деактивация, удаление, возврат уволенного.

Токены помощника (MCP) живут отдельно от токена входа — 90 дней, в БД. Смена пароля гасила
только токены входа (pw_changed_at), а помощник продолжал работать: украденный токен
переживал ровно ту меру, которой человек от кражи и защищается.
"""
import asyncio
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)
PM = "pm1@company.com"
OWNER = "owner@company.com"


async def _aret(v):
    return v


@pytest.fixture
def revoked(monkeypatch):
    """Шов — слой БД под _revoke_agent_access: так проверяется и маршрут, и сам помощник."""
    calls = []

    async def _chains(email, at):
        calls.append(("chains", email))
        return 0

    async def _tokens(email, at):
        calls.append(("tokens", email))
        return 0

    monkeypatch.setattr(main.db, "revoke_refresh_chains_by_user", _chains)
    monkeypatch.setattr(main.db, "revoke_api_tokens_by_user", _tokens)
    monkeypatch.setattr(main, "_save_users", lambda *a, **k: _aret(None))
    # Копии сид-учёток: пароль и флаги меняются в тесте и не должны утечь в соседние.
    monkeypatch.setitem(main.USERS, PM, dict(main.USERS[PM]))
    monkeypatch.setitem(main.USERS, OWNER, dict(main.USERS[OWNER]))
    main._LOGIN_ATTEMPTS.clear()
    yield calls
    main._LOGIN_ATTEMPTS.clear()


def _h(email):
    return {"Authorization": f"Bearer {main.make_token(email)}"}


def _assert_all_gone(calls, email):
    assert calls.index(("chains", email)) < calls.index(("tokens", email)), \
        "сначала цепочки: иначе клиент успеет выписать себе новый доступ"


def test_own_password_change_revokes_the_assistant(revoked):
    r = client.put("/me/password", headers=_h(PM),
                   json={"current_password": "pm123", "new_password": "N3w-passw0rd"})
    assert r.status_code == 200, r.text
    _assert_all_gone(revoked, PM)


def test_admin_password_reset_revokes_the_assistant(revoked):
    uid = main.USERS[PM]["id"]
    r = client.put(f"/admin/users/{uid}/password", headers=_h(OWNER), json={"new_password": "N3w-passw0rd"})
    assert r.status_code == 200, r.text
    _assert_all_gone(revoked, PM)


def test_deactivation_revokes_personal_tokens_too(revoked):
    """Раньше гасились только цепочки OAuth; личный токен из Профиля «воскресал» в тот миг,
    когда учётку возвращали."""
    uid = main.USERS[PM]["id"]
    r = client.put(f"/admin/users/{uid}", headers=_h(OWNER), json={"is_active": False})
    assert r.status_code == 200, r.text
    _assert_all_gone(revoked, PM)


def test_deleted_login_takes_its_tokens_along(revoked):
    """Иначе новый логин с тем же email получил бы чужие живые токены."""
    uid = main.USERS[PM]["id"]
    assert client.delete(f"/admin/users/{uid}", headers=_h(OWNER)).status_code == 200
    _assert_all_gone(revoked, PM)


def test_failed_revocation_does_not_turn_a_done_password_change_into_500(revoked, monkeypatch):
    """Пароль уже записан — 500 после этого только запутал бы. Доступ при сбое всё равно
    закрыт проверкой pw_changed_at на каждом запросе (следующий тест)."""
    async def _db_down(email, at):
        raise RuntimeError("БД недоступна")

    monkeypatch.setattr(main.db, "revoke_refresh_chains_by_user", _db_down)
    r = client.put("/me/password", headers=_h(PM),
                   json={"current_password": "pm123", "new_password": "N3w-passw0rd"})
    assert r.status_code == 200, r.text


def test_assistant_token_issued_before_password_change_is_dead(revoked, monkeypatch):
    """Второй рубеж: даже если строку не отозвали (сбой БД посреди смены пароля), токен,
    выпущенный до смены, не принимается — как и токен входа в current_user."""
    main.USERS[PM]["pw_changed_at"] = int(time.time())
    rec = {"id": 1, "user_email": PM, "scopes": "read", "revoked_at": None, "oauth_client_id": None,
           "expires_at": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
           "created_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}
    monkeypatch.setattr(main.db, "find_api_token", lambda h: _aret(rec))
    monkeypatch.setattr(main.db, "touch_api_token", lambda tid, at: _aret(None))
    assert asyncio.run(main.verify_api_token("pmo_x")) is None
    rec["created_at"] = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
    got = asyncio.run(main.verify_api_token("pmo_x"))
    assert got and got["user"]["email"] == PM, "токен, выпущенный после смены, рабочий"


def test_owner_can_bring_back_an_offboarded_login(revoked):
    """Вернул руками — флаг увольнения снят, и ночной синк больше не спорит с владельцем."""
    u = main.USERS[PM]
    u.update(is_active=False, offboarded_at="2026-10-28T03:00:00+00:00", bitrix24_user_id=2)
    r = client.put(f"/admin/users/{u['id']}", headers=_h(OWNER), json={"is_active": True})
    assert r.status_code == 200, r.text
    assert "offboarded_at" not in u and u["offboard_exempt_bx"] == 2
    assert "offboarded_at" not in r.json()["data"]


def test_plain_reactivation_sets_no_exemption(revoked):
    u = main.USERS[PM]
    u.update(is_active=False, bitrix24_user_id=2)
    assert client.put(f"/admin/users/{u['id']}", headers=_h(OWNER), json={"is_active": True}).status_code == 200
    assert "offboard_exempt_bx" not in u


def test_admin_list_flags_offboarded_logins_only():
    plain = main._admin_view("a@example.com", {"id": "1", "role": "pm", "is_active": True})
    assert "offboarded_at" not in plain, "у всех остальных — прежние байты /admin/users (эталоны API)"
    flagged = main._admin_view("b@example.com", {"id": "2", "role": "pm", "is_active": False,
                                           "offboarded_at": "2026-10-28T03:00:00+00:00"})
    assert flagged["offboarded_at"] == "2026-10-28T03:00:00+00:00"
    assert list(flagged)[:len(plain)] == list(plain), "прежние ключи — в прежнем порядке"
