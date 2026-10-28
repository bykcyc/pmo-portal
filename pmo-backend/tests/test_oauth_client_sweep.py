# -*- coding: utf-8 -*-
"""Уборка клиентов OAuth, которые зарегистрировались и так и не подключились.

Регистрация анонимна по стандарту (RFC 7591): POST /oauth/register может прислать кто угодно,
и каждая регистрация — строка в oauth_clients. Здесь проверяются две катастрофы:
  1) уборки нет — таблица растёт без предела, сколько бы суток ни шёл поток регистраций;
  2) уборка жадная — уходит клиент живого или бывшего подключения, и обмен кода, обновление
     доступа или отзыв спотыкаются о «неизвестного клиента».

Запрос — настоящий, тот же текст из db.py, только выполняет его sqlite в памяти: NOT EXISTS
и сравнение строк у него ведут себя как у Postgres.
"""
import asyncio
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import db
import main
import oauth_provider

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"


def _client_refs() -> dict:
    """Где схема хранит id клиента: {таблица: [колонки]}. Берётся из schema.sql, а не списком
    в тесте: новая таблица со следом клиента сама попадёт под проверку и уронит её, если уборка
    про эту таблицу не знает."""
    text = SCHEMA.read_text(encoding="utf-8")
    refs: dict = {}
    for table, body in re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+) \((.*?)\n\);", text, re.S):
        for col in re.findall(r"^\s+(\w*client_id)\s", body, re.M):
            refs.setdefault(table, []).append(col)
    for table, col in re.findall(r"ALTER TABLE (\w+) ADD COLUMN (?:IF NOT EXISTS )?(\w*client_id)\s", text):
        refs.setdefault(table, []).append(col)
    refs.pop("oauth_clients", None)  # сама таблица клиентов — не след, а то, что убирают
    return refs


class _SqlitePool:
    """Пул asyncpg поверх sqlite в памяти: запрос из db.py выполняется как есть."""

    def __init__(self):
        self.con = sqlite3.connect(":memory:")

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, sql, *args):
        cur = self.con.execute(sql, {str(i): v for i, v in enumerate(args, 1)})
        return f"{sql.split()[0].upper()} {cur.rowcount}"


def test_only_old_clients_without_any_trace_go(monkeypatch):
    refs = _client_refs()
    # Разбор схемы не ослеп: эти четыре следа есть сегодня.
    assert {"oauth_requests", "oauth_codes", "oauth_refresh_tokens", "api_tokens"} <= set(refs), refs

    fake = _SqlitePool()
    fake.con.execute("CREATE TABLE oauth_clients (client_id TEXT, created_at TEXT, last_used_at TEXT)")
    for table, cols in refs.items():
        fake.con.execute(f"CREATE TABLE {table} ({', '.join(c + ' TEXT' for c in cols)})")
    monkeypatch.setattr(db, "pool", lambda: fake)

    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=3)).isoformat()
    clients = {
        "брошенный": (old, None),                                   # зарегистрировался и пропал
        "подключается": ((now - timedelta(hours=1)).isoformat(), None),  # человек ещё на согласии
        "подключался": (old, (now - timedelta(days=2)).isoformat()),     # код уже обменивал
    }
    # По клиенту на каждый след: запрос согласия, код, цепочка обновления, выданный доступ
    # (даже отозванный — по нему «Отозвать» в Профиле и журнал помощника).
    for table, cols in refs.items():
        for col in cols:
            cid = f"след {table}.{col}"
            clients[cid] = (old, None)
            fake.con.execute(f"INSERT INTO {table} ({col}) VALUES (?)", (cid,))
    # Токен, выписанный руками в Профиле, клиента не имеет: NULL не должен ни защищать, ни ломать.
    fake.con.execute("INSERT INTO api_tokens (oauth_client_id) VALUES (NULL)")
    fake.con.executemany("INSERT INTO oauth_clients VALUES (?, ?, ?)",
                         [(cid, at, used) for cid, (at, used) in clients.items()])

    cutoff = (now - timedelta(days=oauth_provider.UNUSED_CLIENT_TTL_DAYS)).isoformat()
    gone = asyncio.run(db.delete_unused_oauth_clients(cutoff))
    left = {r[0] for r in fake.con.execute("SELECT client_id FROM oauth_clients")}
    assert left == set(clients) - {"брошенный"}, f"ушли: {sorted(set(clients) - left)}"
    assert gone == 1
    # Идемпотентно: второй проход ничего не находит.
    assert asyncio.run(db.delete_unused_oauth_clients(cutoff)) == 0


def test_sweep_forgets_unused_clients_after_ttl_and_never_breaks_snapshot(monkeypatch):
    calls = []

    def _rec(name, result=None):
        async def fn(before):
            calls.append((name, before))
            return result
        return fn

    monkeypatch.setattr(main.db, "delete_old_drafts", _rec("drafts", 0))
    monkeypatch.setattr(main.db, "delete_expired_oauth", _rec("expired"))
    monkeypatch.setattr(main.db, "delete_unused_oauth_clients", _rec("clients", 0))
    asyncio.run(main._sweep_expired())
    names = [n for n, _ in calls]
    # Сначала просроченные запросы и коды: брошенная попытка не держит клиента лишние сутки.
    assert names.index("expired") < names.index("clients"), names
    ttl = timedelta(days=oauth_provider.UNUSED_CLIENT_TTL_DAYS)
    age = datetime.now(timezone.utc) - datetime.fromisoformat(dict(calls)["clients"])
    assert ttl <= age < ttl + timedelta(minutes=1)
    # Срок с запасом длиннее окна согласия: человек над «Разрешить» клиента не теряет.
    assert ttl > timedelta(minutes=oauth_provider.REQUEST_TTL_MINUTES)

    async def _boom(before):
        raise RuntimeError("база недоступна")
    monkeypatch.setattr(main.db, "delete_unused_oauth_clients", _boom)
    asyncio.run(main._sweep_expired())  # сбой уборки не всплывает в снимок портфеля
