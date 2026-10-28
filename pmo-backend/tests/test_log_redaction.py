"""Секреты в адресах не должны оседать в журналах.

Токен публичной ссылки — это и есть доступ: он стоит в пути (/public/<токен>) и в ?share= на
каждом запросе публичной страницы. Журналы доступа (Caddy и uvicorn) хранятся неделями и
читаются при разборе инцидентов — копия токена там равна копии доступа. Туда же попадал
?token= метрик: теперь он принимается только заголовком.
"""
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import security  # noqa: E402

client = TestClient(main.app)
_CADDYFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "Caddyfile")


@pytest.mark.parametrize("raw, clean", [
    ("/projects/5/wbs?share=AbC-_9xyz&tab=2", "/projects/5/wbs?share=REDACTED&tab=2"),
    ("/projects/5/risks?tab=2&share=AbC", "/projects/5/risks?tab=2&share=REDACTED"),
    ("/metrics?token=s3cr3t", "/metrics?token=REDACTED"),
    ("/public/AbC-_9xyz", "/public/REDACTED"),
    ("/api/public/AbC-_9xyz?x=1", "/api/public/REDACTED?x=1"),
    # не секреты — не трогаем
    ("/projects/5/tasks?page=2", "/projects/5/tasks?page=2"),
    ("/x?tokens=1&shared=1", "/x?tokens=1&shared=1"),
    ("/oauth/authorize?state=abc&code_challenge=xyz", "/oauth/authorize?state=abc&code_challenge=xyz"),
])
def test_redact_url(raw, clean):
    assert security.redact_url(raw) == clean


def test_uvicorn_access_line_loses_the_token():
    # Ровно так uvicorn пишет строку доступа: шаблон + аргументы.
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                            ("93.184.216.34:5000", "GET", "/projects/5/wbs?share=AbC-_9xyz", "1.1", 200), None)
    assert security.RedactAccessLog().filter(rec) is True
    line = rec.getMessage()
    assert "AbC-_9xyz" not in line and "share=REDACTED" in line and "93.184.216.34:5000" in line


def test_redaction_installs_once():
    name = "test.redaction.target"
    security.install_access_log_redaction(name)
    security.install_access_log_redaction(name)
    assert sum(isinstance(f, security.RedactAccessLog) for f in logging.getLogger(name).filters) == 1


def test_asgi_entrypoint_installs_the_redaction():
    """Импортировать asgi здесь нельзя (он читает .env и поменял бы окружение соседних
    тестов) — проверяем, что точка входа uvicorn ставит фильтр."""
    with open(os.path.join(os.path.dirname(main.__file__), "asgi.py"), encoding="utf-8") as fh:
        assert "install_access_log_redaction(" in fh.read()


# ── метрики: токен только заголовком ─────────────────────────────────────────────

def test_metrics_token_is_not_accepted_from_the_query(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "m3tr1cs")
    assert client.get("/metrics?token=m3tr1cs").status_code == 403


def test_metrics_token_from_bearer_header(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "m3tr1cs")
    assert client.get("/metrics", headers={"Authorization": "Bearer m3tr1cs"}).status_code == 200
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 403
    assert client.get("/metrics").status_code == 403


def test_metrics_non_ascii_token_is_403_not_500(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "m3tr1cs")
    r = client.get("/metrics", headers={"Authorization": "Bearer ключ".encode("utf-8")})
    assert r.status_code == 403


# ── Caddyfile: потолок тела на каждом пути к бэкенду и фильтр журнала ────────────

def _caddy_handles():
    """Блоки `handle …`/`handle_path …` сайта: (заголовок, тело). Простой разбор по скобкам —
    Caddyfile здесь наш и плоский."""
    text = open(_CADDYFILE, encoding="utf-8").read()
    text = "\n".join(line.split("#", 1)[0] if line.lstrip().startswith("#") else line
                     for line in text.splitlines())
    out = []
    for m in re.finditer(r"^\t(handle(?:_path)?\b[^{\n]*)\{", text, re.M):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        out.append((m.group(1).strip(), text[m.end():i - 1]))
    return text, out


@pytest.mark.skipif(not os.path.exists(_CADDYFILE), reason="deploy/ не смонтирован (прогон в контейнере)")
def test_every_proxied_route_has_a_body_cap():
    _, handles = _caddy_handles()
    proxied = [(h, body) for h, body in handles if "reverse_proxy" in body]
    assert len(proxied) >= 5
    for head, body in proxied:
        assert re.search(r"request_body\s*\{[^}]*max_size\s+\S+", body), f"без потолка тела: {head}"


@pytest.mark.skipif(not os.path.exists(_CADDYFILE), reason="deploy/ не смонтирован (прогон в контейнере)")
def test_caddy_access_log_redacts_the_same_secrets():
    text, _ = _caddy_handles()
    log = text[text.index("\tlog {"):]
    assert "format filter" in log
    for field in ("request>uri", "request>headers>Referer"):
        m = re.search(re.escape(field) + r'\s+regexp\s+"([^"]+)"\s+"([^"]+)"', log)
        assert m, f"нет фильтра для {field}"
        pattern, repl = m.group(1), m.group(2)
        # Тот же шаблон, что и в бэкенде (security._SECRET_IN_URL), и та же замена.
        assert pattern == security._SECRET_IN_URL.pattern
        assert repl == "${1}${2}REDACTED"
