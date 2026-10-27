"""SQL очереди fireflies_sync на живом PostgreSQL — ТОЛЬКО по явному PMO_PG_TEST_URL.

Всё выполняется на одном соединении внутри внешней транзакции, которая в конце откатывается:
таблица создаётся DDL из schema.sql и исчезает вместе с откатом, данные базы не меняются.
Без PMO_PG_TEST_URL тест пропускается (в CI Postgres нет).
"""
import asyncio
import os
import re
from contextlib import asynccontextmanager

import pytest

import db

PG_URL = os.environ.get("PMO_PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="нужен PMO_PG_TEST_URL (живой PostgreSQL)")

T0 = "2026-10-21T08:00:00.000Z"
T1 = "2026-10-21T08:01:00.000Z"
T9 = "2026-10-21T09:00:00.000Z"


def _ff_ddl() -> str:
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema.sql")
    sql = open(path, encoding="utf-8").read()
    start = sql.index("CREATE TABLE IF NOT EXISTS fireflies_sync")
    end = sql.index("COMMIT;", start)
    return re.sub(r"--[^\n]*", "", sql[start:end])


class _OneConnPool:
    def __init__(self, con):
        self.con = con

    @asynccontextmanager
    async def acquire(self):
        yield self.con


async def _scenario():
    import asyncpg
    con = await asyncpg.connect(PG_URL)
    tr = con.transaction()
    await tr.start()
    saved = db._pool
    db._pool = _OneConnPool(con)  # type: ignore[assignment]
    try:
        await con.execute(_ff_ddl())
        assert await db.fireflies_sync_receive("m1", "meeting.summarized", None, T0) == "new"
        assert await db.fireflies_sync_receive("m1", "meeting.summarized", None, T1) == "duplicate"

        due = await db.fireflies_sync_due(T1)
        assert [r["meeting_id"] for r in due] == ["m1"]
        row = await db.fireflies_sync_claim("m1", T1, T9)
        assert row and row["status"] == "processing"
        assert await db.fireflies_sync_due(T1) == []           # аренда ещё не истекла

        ok = await db.fireflies_sync_update("m1", {"status": "done", "pmo_status": "done", "bitrix_status": "waiting_method",
                                                   "candidates": {"bitrix": [], "pmo": []}, "attempts": 0},
                                            T1, expect_reprocessed=None)
        assert ok
        assert await db.fireflies_sync_due(T9) == []
        assert [r["meeting_id"] for r in await db.fireflies_sync_due(T9, waiting_bitrix=True)] == ["m1"]

        # resend: новее → снова в очереди, протокол PMO снова в работе, Битрикс не трогаем
        assert await db.fireflies_sync_receive("m1", "meeting.summarized", "1792998000000", T1) == "resend"
        got = await db.fireflies_sync_get("m1")
        assert got and got["status"] == "received" and got["pmo_status"] == "pending"
        assert got["bitrix_status"] == "waiting_method" and got["candidates"] == {"bitrix": [], "pmo": []}
        assert await db.fireflies_sync_receive("m1", "meeting.summarized", "1792998000000", T1) == "duplicate"

        # итог устаревшего прогона (до resend) не записывается
        assert not await db.fireflies_sync_update("m1", {"status": "done"}, T1, expect_reprocessed=None)
        assert await db.fireflies_sync_update("m1", {"status": "failed"}, T1, expect_reprocessed="1792998000000")

        assert [r["meeting_id"] for r in await db.fireflies_sync_list("failed")] == ["m1"]
        assert await db.fireflies_sync_retry("m1", T9)
        assert (await db.fireflies_sync_get("m1") or {})["status"] == "received"
        assert not await db.fireflies_sync_retry("nope", T9)
    finally:
        db._pool = saved
        await tr.rollback()
        await con.close()


def test_fireflies_sync_sql_roundtrip():
    asyncio.run(_scenario())
