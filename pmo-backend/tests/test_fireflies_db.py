"""Очередь связки Fireflies (таблица fireflies_sync): чистые части слоя БД.

SQL целиком проверяет tests/test_fireflies_db_pg.py — он запускается только при заданном
PMO_PG_TEST_URL и всё делает внутри транзакции с откатом.
"""
import asyncio

import pytest

import db


# ── дедуп resend: по докам Fireflies — последний reprocessed_at на пару (meeting_id, event) ──

def test_first_delivery_without_reprocessed_is_not_newer_than_anything():
    assert db.fireflies_reprocessed_newer(None, None) is False
    assert db.fireflies_reprocessed_newer("", "1792998000000") is False


def test_resend_is_newer_than_original_delivery():
    assert db.fireflies_reprocessed_newer("1792998000000", None) is True
    assert db.fireflies_reprocessed_newer("2026-10-21T08:00:00Z", "") is True


def test_same_or_older_resend_is_duplicate():
    assert db.fireflies_reprocessed_newer("1792998000000", "1792998000000") is False
    assert db.fireflies_reprocessed_newer("1792997000000", "1792998000000") is False
    assert db.fireflies_reprocessed_newer("2026-10-21T08:00:00Z", "2026-10-21T08:00:00.000Z") is False


def test_newer_resend_by_number_and_iso():
    assert db.fireflies_reprocessed_newer("1792998000001", "1792998000000") is True
    assert db.fireflies_reprocessed_newer("2026-10-21T08:00:01Z", "2026-10-21T08:00:00Z") is True
    # число в мс и ISO-строка сравниваются по времени, а не как строки
    assert db.fireflies_reprocessed_newer("2026-10-21T08:00:00Z", "1791000000000") is True  # 1791000000000 мс = 03.10.2026
    assert db.fireflies_reprocessed_newer("2026-10-21T08:00:00Z", "1792998000000") is False  # 26.10.2026


def test_reprocessed_value_is_normalized_to_text():
    assert db.fireflies_reprocessed_text(1792998000000) == "1792998000000"
    assert db.fireflies_reprocessed_text(None) is None
    assert db.fireflies_reprocessed_text("  2026-10-21T08:00:00Z ") == "2026-10-21T08:00:00Z"


# ── запись строк: только известные колонки ──

def test_update_rejects_unknown_column_before_touching_db():
    with pytest.raises(ValueError):
        asyncio.run(db.fireflies_sync_update("m1", {"minutes_content": "x"}, "2026-10-21T08:00:00.000Z"))


def test_row_shape_parses_candidates():
    row = {"meeting_id": "m1", "event": "meeting.summarized", "reprocessed_at": None, "status": "unmatched",
           "pmo_status": "none", "bitrix_status": "unmatched", "decision": "queue", "basis": None,
           "reason": "r", "pmo_project_id": None, "pmo_meeting_id": None,
           "bitrix_event_id": None, "bitrix_comment_id": None,
           "candidates": '{"bitrix": [{"event_id": "10"}], "pmo": []}', "attempts": 0,
           "next_attempt_at": None, "last_error": None, "created_at": "t", "updated_at": "t"}
    full = db._ff_row(row)
    assert full["candidates"] == {"bitrix": [{"event_id": "10"}], "pmo": []}
    assert full["meeting_id"] == "m1" and set(full) == set(db._FF_COLS)
