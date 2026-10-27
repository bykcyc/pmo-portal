"""Приём вебхука Fireflies V2 и ручки владельца портала для очереди связки.

Вебхук: подпись X-Hub-Signature = sha256=<hex HMAC-SHA256 СЫРОГО тела>, без флага/секрета —
как будто ручки нет (404), ответ 2xx сразу, и в запросе — НИ ОДНОГО вызова наружу.
"""
import asyncio
import hashlib
import hmac
import inspect
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import db
import fireflies_sync as ffs
import main

client = TestClient(main.app)
SECRET = "test-signing-secret"
OWNER = {"id": "u1", "email": "owner@company.com", "full_name": "Owner", "role": "owner"}


def _sig(raw: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


@pytest.fixture
def wired(monkeypatch):
    """Флаг включён, секрет задан, БД очереди — в памяти, любой выход наружу — падение теста."""
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", True)
    monkeypatch.setattr(main, "FIREFLIES_WEBHOOK_SECRET", SECRET)
    calls = []

    async def fake_receive(meeting_id, event, reprocessed_at, now):
        calls.append((meeting_id, event, reprocessed_at, now))
        return "new"

    async def no_bitrix(*a, **k):
        raise AssertionError("вебхук не должен ходить в Битрикс")

    def no_http(*a, **k):
        raise AssertionError("вебхук не должен ходить в Fireflies")

    monkeypatch.setattr(db, "fireflies_sync_receive", fake_receive)
    monkeypatch.setattr(main, "bx_call", no_bitrix)
    monkeypatch.setattr(ffs, "_client", no_http)
    return calls


def _post(raw: bytes, sig=None):
    headers = {"Content-Type": "application/json"}
    if sig is not None:
        headers["X-Hub-Signature"] = sig
    return client.post("/webhooks/fireflies", content=raw, headers=headers)


BODY = json.dumps({"event": "meeting.summarized", "timestamp": 1792998000000, "meeting_id": "01K8ABCdef_-9"}).encode()


def test_flag_off_means_no_endpoint(monkeypatch, wired):
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", False)
    assert _post(BODY, _sig(BODY)).status_code == 404
    assert wired == []


def test_without_secret_endpoint_is_off_even_with_flag(monkeypatch, wired):
    monkeypatch.setattr(main, "FIREFLIES_WEBHOOK_SECRET", "")
    assert _post(BODY, _sig(BODY, "")).status_code == 404
    assert wired == []


def test_missing_or_wrong_signature_is_401(wired):
    assert _post(BODY).status_code == 401
    assert _post(BODY, _sig(BODY, "other-secret")).status_code == 401
    assert _post(BODY, "sha256=zz").status_code == 401
    assert _post(BODY, _sig(BODY + b" ")).status_code == 401   # подпись чужого тела
    assert wired == []


def test_signature_is_over_raw_bytes_not_reserialized_json(wired):
    raw = b'{ "meeting_id" : "m-1",\n  "event": "meeting.summarized" }'
    r = _post(raw, _sig(raw))
    assert r.status_code == 200 and r.json() == {"result": "new"}
    assert wired[0][:3] == ("m-1", "meeting.summarized", None)


def test_signature_header_without_prefix_and_uppercase_hex(wired):
    hexd = hmac.new(SECRET.encode(), BODY, hashlib.sha256).hexdigest().upper()
    assert _post(BODY, hexd).status_code == 200


def test_broken_json_is_400(wired):
    for raw in (b"{not json", b"[1, 2]", b'"str"'):
        assert _post(raw, _sig(raw)).status_code == 400
    assert wired == []


def test_other_events_are_acknowledged_and_ignored(wired):
    raw = json.dumps({"event": "meeting.transcribed", "meeting_id": "m1"}).encode()
    r = _post(raw, _sig(raw))
    assert r.status_code == 200 and r.json() == {"result": "ignored"}
    assert wired == []


def test_bad_meeting_id_is_400(wired):
    for mid in ("", None, 42, "a/b", "x" * 200, "id with space", "abc\n"):
        raw = json.dumps({"event": "meeting.summarized", "meeting_id": mid}).encode()
        assert _post(raw, _sig(raw)).status_code == 400
    assert wired == []


def test_queued_with_reprocessed_at_and_timestamp_is_not_a_key(wired):
    raw = json.dumps({"event": "meeting.summarized", "timestamp": 1, "meeting_id": "m1",
                      "reprocessed_at": 1792998000000, "client_reference_id": None}).encode()
    r = _post(raw, _sig(raw))
    assert r.status_code == 200
    mid, event, rp, now = wired[0]
    assert (mid, event, rp) == ("m1", "meeting.summarized", 1792998000000)
    assert now.endswith("Z") and len(now) == len("2026-10-21T08:00:00.000Z")


def test_duplicate_delivery_still_200(monkeypatch, wired):
    async def dup(*a):
        return "duplicate"
    monkeypatch.setattr(db, "fireflies_sync_receive", dup)
    r = _post(BODY, _sig(BODY))
    assert r.status_code == 200 and r.json() == {"result": "duplicate"}


def test_oversized_body_is_rejected(wired):
    raw = json.dumps({"event": "meeting.summarized", "meeting_id": "m1", "pad": "x" * 70000}).encode()
    assert _post(raw, _sig(raw)).status_code == 413
    assert wired == []


def test_chunked_body_without_content_length_is_capped_while_reading(wired):
    """Chunked-запрос без Content-Length: тело читается потоком и обрывается на потолке —
    до проверки подписи и без чтения всего потока в память."""
    sent = {"chunks": 0}

    class ChunkedRequest:              # как Starlette Request: заголовки + поток тела
        headers = {"x-hub-signature": "sha256=00", "transfer-encoding": "chunked"}

        async def stream(self):
            for _ in range(1000):      # 1000 × 8 КиБ = 8 МиБ, если бы читали всё
                sent["chunks"] += 1
                yield b"x" * 8192

        async def body(self):
            raise AssertionError("тело целиком в память не читаем")

    with pytest.raises(HTTPException) as e:
        asyncio.run(main.fireflies_webhook(ChunkedRequest()))
    assert e.value.status_code == 413
    assert wired == []
    assert sent["chunks"] == 9         # 9 × 8 КиБ > 64 КиБ — дальше поток не вычитывался
    # и через настоящий HTTP-стек chunked-тело без Content-Length тоже упирается в потолок
    r = client.post("/webhooks/fireflies", content=(b"x" * 8192 for _ in range(20)),
                    headers={"X-Hub-Signature": "sha256=00"})
    assert r.status_code == 413


def test_caddy_caps_fireflies_webhook_without_touching_bitrix():
    from pathlib import Path
    caddy = (Path(__file__).resolve().parents[2] / "deploy" / "Caddyfile").read_text(encoding="utf-8")
    block = caddy.split("handle /webhooks/fireflies {", 1)[1].split("reverse_proxy", 1)[0]
    assert "max_size 64KB" in block
    general = caddy.split("handle /webhooks/* {", 1)[1].split("reverse_proxy", 1)[0]
    assert "max_size" not in general


# ── ручки владельца портала ──────────────────────────────────────────────────

def test_admin_routes_are_owner_only():
    for fn in (main.fireflies_sync_list, main.fireflies_sync_retry):
        assert inspect.signature(fn).parameters["user"].default.dependency is main.require_owner
    assert client.get("/admin/fireflies/sync").status_code == 401
    assert client.post("/admin/fireflies/sync/m1/retry").status_code == 401


def _row(**kw):
    base = {"meeting_id": "m1", "event": "meeting.summarized", "reprocessed_at": None, "status": "unmatched",
            "pmo_status": "none", "bitrix_status": "unmatched", "decision": "queue", "basis": None, "reason": "r",
            "pmo_project_id": None, "pmo_meeting_id": None,
            "bitrix_event_id": None, "bitrix_comment_id": None, "candidates": {"bitrix": [], "pmo": []},
            "attempts": 0, "next_attempt_at": None, "last_error": None, "created_at": "t", "updated_at": "t"}
    base.update(kw)
    return base


def test_admin_list_filters_by_status(monkeypatch):
    seen = {}

    async def fake_list(status=None, limit=200):
        seen["status"] = status
        return [_row()]
    monkeypatch.setattr(db, "fireflies_sync_list", fake_list)
    out = asyncio.run(main.fireflies_sync_list(status="unmatched", user=OWNER))
    assert seen["status"] == "unmatched"
    assert out["data"][0]["meeting_id"] == "m1"
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.fireflies_sync_list(status="whatever", user=OWNER))
    assert e.value.status_code == 422


def test_admin_retry_requeues_or_404(monkeypatch):
    rows = {"m1": _row(status="failed", attempts=6)}
    seen = []

    async def fake_retry(mid, now, reset_bitrix_posting=False):
        seen.append((mid, reset_bitrix_posting))
        if mid not in rows:
            return False
        rows[mid].update(status="received", attempts=0)
        return True

    async def fake_get(mid):
        return rows.get(mid)
    monkeypatch.setattr(db, "fireflies_sync_retry", fake_retry)
    monkeypatch.setattr(db, "fireflies_sync_get", fake_get)
    out = asyncio.run(main.fireflies_sync_retry("m1", user=OWNER))
    assert out["data"]["status"] == "received"
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.fireflies_sync_retry("nope", user=OWNER))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.fireflies_sync_retry("m1\n", user=OWNER))     # «$» пропустил бы хвостовой \n
    assert e.value.status_code == 404
    asyncio.run(main.fireflies_sync_retry("m1", bitrix_reset=True, user=OWNER))
    assert seen == [("m1", False), ("nope", False), ("m1", True)]
