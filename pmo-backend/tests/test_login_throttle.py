"""Анонимные точки входа: per-IP лимит и потолок на bcrypt.

Per-email лимит не мешал ни перебору по многим адресам, ни bcrypt-DoS: несуществующий email
тоже стоит честного bcrypt (dummy_verify), так что поток входов с ротацией email может занять
все ядра хоста. Здесь проверяются три вещи:
  1) с одного адреса больше лимита не пройти — и лишний запрос не доходит до bcrypt;
  2) лимит НИКОГДА не превращается в общий на всех (прокси не опознан → адрес приватный);
  3) все bcrypt идут через один поток с ограниченной очередью.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import security  # noqa: E402

PUBLIC_IP = "93.184.216.34"
OTHER_IP = "8.8.4.4"


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    main._LOGIN_ATTEMPTS.clear()
    main._IP_ATTEMPTS.clear()
    monkeypatch.setattr(main, "_IP_LIMITS", {"login": (3, 60.0), "oauth": (2, 60.0)})
    yield
    main._LOGIN_ATTEMPTS.clear()
    main._IP_ATTEMPTS.clear()


def _client(ip):
    return TestClient(main.app, client=(ip, 50000))


def _login(c, n):
    # Каждый раз новый email: per-email лимит не должен маскировать per-IP.
    return c.post("/auth/login", json={"email": f"nobody{n}@example.com", "password": "x"})


def test_login_is_limited_per_client_ip(monkeypatch):
    burned = []
    monkeypatch.setattr(main, "_dummy_verify", lambda pw: burned.append(pw) or False)
    c = _client(PUBLIC_IP)
    assert [_login(c, n).status_code for n in range(3)] == [401, 401, 401]
    r = _login(c, 3)
    assert r.status_code == 429
    assert r.headers.get("retry-after") == "60"
    assert len(burned) == 3, "запрос сверх лимита не должен доходить до bcrypt"


def test_limit_of_one_address_does_not_touch_another(monkeypatch):
    monkeypatch.setattr(main, "_dummy_verify", lambda pw: False)
    c = _client(PUBLIC_IP)
    for n in range(4):
        _login(c, n)
    assert _login(_client(OTHER_IP), 99).status_code == 401


def test_totp_step_shares_the_login_bucket(monkeypatch):
    monkeypatch.setattr(main, "_dummy_verify", lambda pw: False)
    c = _client(PUBLIC_IP)
    for n in range(3):
        _login(c, n)
    assert c.post("/auth/login/totp", json={"challenge": "x", "code": "1"}).status_code == 429


@pytest.mark.parametrize("ip", ["testclient", "172.18.0.4", "10.0.0.7", "127.0.0.1", "192.168.1.5"])
def test_unrecognised_proxy_never_becomes_a_global_limit(monkeypatch, ip):
    """Приватный адрес = uvicorn не опознал прокси (или IPv6 пришёл через docker-proxy): тогда
    ВСЕ запросы приходят с одного адреса Caddy. Считать их одним ведром нельзя — первый же
    перебор запер бы вход всем (ровно этот глобальный лок-аут убрали в аудите 6b)."""
    monkeypatch.setattr(main, "_dummy_verify", lambda pw: False)
    c = _client(ip)
    assert {_login(c, n).status_code for n in range(10)} == {401}


def test_authenticated_routes_are_not_ip_limited():
    c = _client(PUBLIC_IP)
    assert {c.get("/auth/me").status_code for _ in range(10)} == {401}


def test_oauth_endpoints_are_ip_limited():
    c = _client(PUBLIC_IP)
    codes = [c.get("/.well-known/oauth-authorization-server").status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_client_rate_key():
    assert security.client_rate_key("93.184.216.34") == "93.184.216.34"
    # IPv6: одному абоненту обычно выдают целую /64 — по одиночному адресу лимит обходился бы
    assert security.client_rate_key("2001:4860:4860:1::1") == security.client_rate_key("2001:4860:4860:1::ffff")
    assert security.client_rate_key("2001:4860:4860:1::1") != security.client_rate_key("2001:4860:4860:2::1")
    assert security.client_rate_key("::ffff:93.184.216.34") == "93.184.216.34"
    for not_public in ("172.18.0.4", "10.1.2.3", "127.0.0.1", "::1", "fd00::1", "testclient", "", None):
        assert security.client_rate_key(not_public) is None


# ── bcrypt: один поток, ограниченная очередь ─────────────────────────────────────

def test_bcrypt_runs_in_its_single_worker(monkeypatch):
    seen = []

    def _spy(pw):
        import threading
        seen.append(threading.current_thread().name)
        return False

    monkeypatch.setattr(main, "_dummy_verify", _spy)
    _login(_client(OTHER_IP), 1)
    assert seen and seen[0].startswith("bcrypt")
    assert main._BCRYPT_POOL._max_workers == 1


def test_full_bcrypt_queue_sheds_load_with_429(monkeypatch):
    """Очередь полна → сразу 429: ожидающие не копятся, а bcrypt не трогается вовсе."""
    burned = []
    monkeypatch.setattr(main, "_dummy_verify", lambda pw: burned.append(pw) or False)
    monkeypatch.setattr(main, "_BCRYPT_PENDING", main._BCRYPT_QUEUE_MAX)
    r = _login(_client(OTHER_IP), 1)
    assert r.status_code == 429
    assert burned == []


def test_real_login_still_works_through_the_pool(monkeypatch):
    async def _noop_save(*a, **k):
        return None

    monkeypatch.setattr(main, "_save_users", _noop_save)
    monkeypatch.setitem(main.USERS, "pm1@company.com", dict(main.USERS["pm1@company.com"]))
    r = _client(PUBLIC_IP).post("/auth/login", json={"email": "pm1@company.com", "password": "pm123"})
    assert r.status_code == 200 and r.json().get("access_token")
