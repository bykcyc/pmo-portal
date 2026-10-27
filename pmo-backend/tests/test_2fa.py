"""Двухфакторная аутентификация (TOTP): настройка, двухшаговый вход, admin-сброс, грейс-гейт.

Без живого Postgres — _save_users замокан (как остальные write-тесты мокают слой db).
Пользователь owner@company.com общий на процесс, поэтому фикстура снимает 2FA-поля после каждого теста.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
import pyotp  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(main.app)

_TWOFA_KEYS = ("twofa_secret", "twofa_pending_secret", "twofa_enabled",
               "twofa_enrolled_at", "first_login_at")


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    main._LOGIN_ATTEMPTS.clear()

    async def _noop_save(*a, **k):  # _save_users требует пул БД — в юнит-харнессе его нет
        return None

    monkeypatch.setattr(main, "_save_users", _noop_save)
    main._TWOFA_FAILS.clear()
    _clear_2fa()
    yield
    _clear_2fa()
    main._LOGIN_ATTEMPTS.clear()
    main._TWOFA_FAILS.clear()


def _clear_2fa():
    for u in main.USERS.values():
        for k in _TWOFA_KEYS:
            u.pop(k, None)


def _login(email="owner@company.com", pw="admin123"):
    return client.post("/auth/login", json={"email": email, "password": pw}).json()


def _owner_h():
    return {"Authorization": f"Bearer {_login()['access_token']}"}


def _enroll(h, pw="admin123"):
    """setup + enable (с re-auth паролем) → возвращает base32-секрет включённой 2FA."""
    secret = client.post("/me/2fa/setup", headers=h).json()["data"]["secret"]
    r = client.post("/me/2fa/enable", headers=h, json={"code": pyotp.TOTP(secret).now(), "password": pw})
    assert r.status_code == 200 and r.json()["data"]["twofa_enabled"] is True
    return secret


def test_login_without_2fa_returns_token():
    r = _login()
    assert "access_token" in r and not r.get("twofa_required")


def test_setup_returns_secret_and_qr():
    s = client.post("/me/2fa/setup", headers=_owner_h())
    assert s.status_code == 200
    d = s.json()["data"]
    assert len(d["secret"]) == 32
    assert d["otpauth_uri"].startswith("otpauth://totp/")
    assert d["qr_data_uri"].startswith("data:image/svg+xml;base64,")


def test_setup_enable_and_two_step_login():
    h = _owner_h()
    secret = _enroll(h)
    # /auth/me теперь показывает статус
    assert client.get("/auth/me", headers=h).json()["twofa_enabled"] is True
    # вход стал двухшаговым: пароль → challenge (без access_token)
    step1 = _login()
    assert step1.get("twofa_required") is True and "access_token" not in step1
    # второй шаг: challenge + код → полноценный токен
    step2 = client.post("/auth/login/totp",
                        json={"challenge": step1["challenge"], "code": pyotp.TOTP(secret).now()})
    assert step2.status_code == 200 and "access_token" in step2.json()


def test_enable_with_wrong_code_400():
    h = _owner_h()
    client.post("/me/2fa/setup", headers=h)
    r = client.post("/me/2fa/enable", headers=h, json={"code": "000000", "password": "admin123"})
    assert r.status_code == 400


def test_enable_without_setup_400():
    r = client.post("/me/2fa/enable", headers=_owner_h(), json={"code": "123456", "password": "admin123"})
    assert r.status_code == 400


def test_enable_wrong_password_403():
    h = _owner_h()
    secret = client.post("/me/2fa/setup", headers=h).json()["data"]["secret"]
    r = client.post("/me/2fa/enable", headers=h, json={"code": pyotp.TOTP(secret).now(), "password": "wrong"})
    assert r.status_code == 403  # re-auth паролем обязателен (симметрично disable)


def test_totp_lockout_after_repeated_wrong_codes():
    h = _owner_h()
    secret = _enroll(h)
    step1 = _login()
    ch = step1["challenge"]
    # 5 подряд неверных кодов → срабатывает локаут; 6-я попытка блокируется (429), даже с верным кодом
    for _ in range(5):
        assert client.post("/auth/login/totp", json={"challenge": ch, "code": "000000"}).status_code == 401
    r = client.post("/auth/login/totp", json={"challenge": ch, "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 429


def test_login_totp_wrong_code_401():
    h = _owner_h()
    _enroll(h)
    step1 = _login()
    r = client.post("/auth/login/totp", json={"challenge": step1["challenge"], "code": "000000"})
    assert r.status_code == 401


def test_login_totp_bad_challenge_401():
    r = client.post("/auth/login/totp", json={"challenge": "garbage.sig", "code": "123456"})
    assert r.status_code == 401


def test_challenge_token_not_usable_as_bearer():
    h = _owner_h()
    _enroll(h)
    challenge = _login()["challenge"]
    # промежуточный mfa-токен нельзя предъявить как access-Bearer
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {challenge}"})
    assert r.status_code == 401


def test_disable_requires_password():
    h = _owner_h()
    _enroll(h)
    assert client.post("/me/2fa/disable", headers=h, json={"password": "wrong"}).status_code == 403
    ok = client.post("/me/2fa/disable", headers=h, json={"password": "admin123"})
    assert ok.status_code == 200 and ok.json()["data"]["twofa_enabled"] is False
    assert not main.USERS["owner@company.com"].get("twofa_enabled")


def test_grace_gate_blocks_after_expiry(monkeypatch):
    """Личные семь дней вышли — и общий пол уже позади: блокируем.

    Пол сдвигают вперёд, когда людям надо дать время, поэтому тест
    отодвигает его в прошлое: проверяется правило блокировки, а не текущее значение даты.
    """
    monkeypatch.setattr(main, "_TWOFA_GRACE_FLOOR_ISO", "2020-01-01T00:00:00+00:00")
    u = main.USERS["owner@company.com"]
    u["first_login_at"] = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    u.pop("twofa_enabled", None)
    h = {"Authorization": f"Bearer {main.make_token('owner@company.com')}"}
    # обычный эндпоинт заблокирован сервером (middleware отвечает до роута → db не трогается)
    blocked = client.get("/projects", headers=h)
    assert blocked.status_code == 403 and blocked.json()["detail"] == "twofa_setup_required"
    # но путь настройки 2FA и чтение статуса — доступны
    assert client.get("/auth/me", headers=h).status_code == 200
    assert client.post("/me/2fa/setup", headers=h).status_code == 200


def test_grace_floor_keeps_everyone_in_until_the_common_date(monkeypatch):
    """Общий пол держит человека в грейсе, даже когда личные семь дней давно вышли.

    Без пола истёкший личный срок даёт 403 на ЛЮБОЕ действие — это читается как поломка
    портала. Пол — одна дата на всех, после
    которой правило само вернётся к личным семи дням.
    """
    monkeypatch.setattr(main, "_TWOFA_GRACE_FLOOR_ISO", "2099-01-01T00:00:00+00:00")
    u = main.USERS["owner@company.com"]
    u["first_login_at"] = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    u.pop("twofa_enabled", None)
    h = {"Authorization": f"Bearer {main.make_token('owner@company.com')}"}
    me = client.get("/auth/me", headers=h)
    assert me.status_code == 200
    assert me.json()["twofa_grace_until"].startswith("2099"), "дедлайн должен быть общим полом"


def test_grace_floor_never_shortens_a_longer_personal_deadline(monkeypatch):
    """Пол — это пол, а не потолок: у кого личный срок дальше, тот его и сохраняет."""
    monkeypatch.setattr(main, "_TWOFA_GRACE_FLOOR_ISO", "2020-01-01T00:00:00+00:00")
    u = main.USERS["owner@company.com"]
    u["first_login_at"] = datetime.now(timezone.utc).isoformat()
    u.pop("twofa_enabled", None)
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {main.make_token('owner@company.com')}"})
    assert me.status_code == 200
    assert me.json()["twofa_grace_until"] > datetime.now(timezone.utc).isoformat()


def test_grace_gate_allows_within_grace():
    u = main.USERS["owner@company.com"]
    u["first_login_at"] = datetime.now(timezone.utc).isoformat()
    u.pop("twofa_enabled", None)
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {main.make_token('owner@company.com')}"})
    assert me.status_code == 200 and me.json()["twofa_grace_until"]


def test_admin_reset_2fa_clears_and_refreshes_grace():
    h = _owner_h()
    _enroll(h)
    uid = main.USERS["owner@company.com"]["id"]
    r = client.delete(f"/admin/users/{uid}/2fa", headers=h)
    assert r.status_code == 200 and r.json()["data"]["twofa_enabled"] is False
    assert not main.USERS["owner@company.com"].get("twofa_enabled")
    assert main.USERS["owner@company.com"].get("first_login_at")  # свежий грейс выдан


def test_me_and_admin_view_expose_twofa_enabled():
    h = _owner_h()
    assert "twofa_enabled" in client.get("/auth/me", headers=h).json()
    rows = client.get("/admin/users", headers=h).json()["data"]
    assert rows and all("twofa_enabled" in row for row in rows)
