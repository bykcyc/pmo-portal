# -*- coding: utf-8 -*-
"""Запрос доступа наблюдателем: человек просит, руководитель проекта решает.

Здесь проверяется то, чего не видно в коде по отдельности: ПОРЯДОК действий при подтверждении
(сначала закрыть запрос, потом выдать доступ), что решать может только основной РП или owner,
что отказ действительно означает паузу, и что запросы доезжают до колокольчика — единственная
группа, которая приходит не из проектов, а из своей таблицы.
"""
import json
from datetime import datetime, timedelta, timezone

import main
from attention_stubs import silence_db_sources
from fastapi.testclient import TestClient

client = TestClient(main.app)

OWNER = main.USERS["owner@company.com"]["id"]
PM1 = main.USERS["pm1@company.com"]["id"]
STRANGER = "u-stranger"


def _tok(email: str, password: str) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": password}).json()
    return {"Authorization": "Bearer %s" % r["access_token"]}


def _row(pid, meta):
    return {"id": pid, "name": "Проект %s" % pid, "identifier": "p%s" % pid,
            "description": {"raw": json.dumps(meta)},
            "createdAt": "2026-09-01T00:00:00Z", "updatedAt": "2026-09-01T00:00:00Z",
            "parent_id": None,
            "_tree": {"parent_id": None, "parent_code": None, "parent_name": None,
                      "parent_budget_rate": None, "subprojects_count": 0,
                      "inherited_editors": [], "inherited_observers": []}}


def _request(rid="1", pid="5", requester=PM1, status="open", **kw):
    r = {"id": rid, "project_id": pid, "requester_id": requester,
         "requester_name": "Project Manager 1", "requester_email": "pm1@company.com",
         "note": "веду соседний модуль", "status": status,
         "created_at": "2026-09-10T08:00:00+00:00", "decided_at": None, "decided_by": None}
    r.update(kw)
    return r


class _Db:
    """Заглушка таблицы запросов: пишет, что её просили сделать, и в каком порядке."""

    def __init__(self, monkeypatch, row=None, existing=None, last=None, decide=True):
        self.calls = []
        self.row = row if row is not None else _row(5, {"code": "PRJ-005", "pm_id": OWNER})
        self.existing = existing or []
        self.last = last
        self.decide_result = decide
        self.granted: dict = {}

        async def get_project_row(pid):
            return self.row if str(pid) == str(self.row["id"]) else None

        async def insert_access_request(pid, uid, name, email, note, at):
            self.calls.append("insert")
            return None if self.existing else _request(pid=str(pid), requester=str(uid), note=note)

        async def last_access_decision(pid, uid):
            return self.last

        async def fetch_access_requests(**kw):
            return list(self.existing)

        async def get_access_request(rid):
            return next((r for r in self.existing if str(r["id"]) == str(rid)), None)

        async def decide_access_request(rid, status, by, at):
            self.calls.append("decide:%s" % status)
            return self.decide_result

        for fn in (get_project_row, insert_access_request, last_access_decision,
                   fetch_access_requests, get_access_request, decide_access_request):
            monkeypatch.setattr(main.db, fn.__name__, fn)

        async def fake_projects(*a, **kw):
            return [self.row]

        async def append_log(pid, user, action, detail=""):
            self.calls.append("log:%s" % action)

        async def with_meta_retry(pid, mutate, attempts=4):
            self.calls.append("grant")
            self.granted = main._meta(self.row)
            return mutate(self.granted)

        async def load_meta(pid):
            return (self.row, main._meta(self.row))
        monkeypatch.setattr(main, "fetch_projects", fake_projects)
        monkeypatch.setattr(main, "_append_action_log", append_log)
        monkeypatch.setattr(main, "with_meta_retry", with_meta_retry)
        monkeypatch.setattr(main, "load_meta", load_meta)
        monkeypatch.setattr(main, "_invalidate_after_membership_change", lambda *a, **kw: self.calls.append("cache"))



def _only_incoming(d):
    """Заглушка таблицы: входящие руководителю отдаёт, «мои решённые» — пусто.

    Колокольчик спрашивает одну и ту же функцию дважды с разными аргументами; тесту про
    входящие ответ на СВОЙ запрос только мешал бы.
    """
    async def fetch(**kw):
        return list(d.existing) if kw.get("project_ids") is not None else []
    return fetch

# ─────────────────────────── попросить ───────────────────────────

def test_asking_for_a_project_you_already_see_is_refused(monkeypatch):
    """Иначе запрос повис бы у РП навсегда: решать нечего, доступ и так есть."""
    _Db(monkeypatch, row=_row(5, {"code": "PRJ-005", "pm_id": PM1}))
    r = client.post("/access-requests", json={"project_id": "5"}, headers=_tok("pm1@company.com", "pm123"))
    assert r.status_code == 422, r.text


def test_second_request_while_the_first_waits_is_refused_by_the_index(monkeypatch):
    """Дубликат ловит частичный уникальный индекс, а не предварительный SELECT: два
    одновременных клика прошли бы проверку оба."""
    d = _Db(monkeypatch, existing=[_request()])
    r = client.post("/access-requests", json={"project_id": "5"}, headers=_tok("pm1@company.com", "pm123"))
    assert r.status_code == 409 and "insert" in d.calls


def test_rejection_holds_for_two_months_and_then_lets_go(monkeypatch):
    """Отказ должен что-то значить: при паузе в сутки он превращается в ежедневную просьбу.
    Сам запрос при этом не истекает — он ждёт решения сколько угодно, пауза считается
    только ПОСЛЕ отказа."""
    import access_routes
    assert access_routes.REJECT_COOLDOWN_HOURS == 24 * 60
    fresh = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    d = _Db(monkeypatch, last=_request(status="rejected", decided_at=fresh))
    r = client.post("/access-requests", json={"project_id": "5"}, headers=_tok("pm1@company.com", "pm123"))
    assert r.status_code == 429 and "insert" not in d.calls

    d.last = _request(status="rejected",
                      decided_at=(datetime.now(timezone.utc) - timedelta(days=61)).isoformat())
    assert client.post("/access-requests", json={"project_id": "5"},
                       headers=_tok("pm1@company.com", "pm123")).status_code == 200

    # Кривая дата в старой записи не должна запирать человека навсегда.
    d.last = _request(status="rejected", decided_at="позавчера")
    assert client.post("/access-requests", json={"project_id": "5"},
                       headers=_tok("pm1@company.com", "pm123")).status_code == 200


def test_approval_does_not_start_a_cooldown(monkeypatch):
    """Пауза — следствие ОТКАЗА. Одобренный когда-то и потом снятый наблюдатель просит снова
    без ожидания."""
    _Db(monkeypatch, last=_request(status="approved",
                                   decided_at=datetime.now(timezone.utc).isoformat()))
    assert client.post("/access-requests", json={"project_id": "5"},
                       headers=_tok("pm1@company.com", "pm123")).status_code == 200


def test_template_and_archive_take_no_requests(monkeypatch):
    """Шаблон — заготовка, архив — история: наблюдать там нечего, а запрос всё равно ждал бы
    решения."""
    d = _Db(monkeypatch, row=_row(5, {"code": "PRJ-005", "pm_id": OWNER, "_is_template": True}))
    assert client.post("/access-requests", json={"project_id": "5"},
                       headers=_tok("pm1@company.com", "pm123")).status_code == 422
    d.row = _row(5, {"code": "PRJ-005", "pm_id": OWNER, "_archived": True})
    assert client.post("/access-requests", json={"project_id": "5"},
                       headers=_tok("pm1@company.com", "pm123")).status_code == 422


def test_note_is_trimmed_not_refused(monkeypatch):
    """Длинная просьба — не ошибка ввода: режем, а не отказываем (человек не поймёт, что не так)."""
    d = _Db(monkeypatch)
    body = client.post("/access-requests", json={"project_id": "5", "note": "я" * 2000},
                       headers=_tok("pm1@company.com", "pm123")).json()["data"]
    assert len(body["note"]) == main_note_max()


def main_note_max():
    import access_routes
    return access_routes.NOTE_MAX


# ─────────────────────────── решить ───────────────────────────

def test_a_co_manager_decides_but_a_stranger_does_not(monkeypatch):
    """Со-РП решает: он правит проект целиком, и запрещать ему пустить человека ПОСМОТРЕТЬ —
    правило, которое пришлось бы объяснять. Ручная выдача наблюдателей ему по-прежнему
    закрыта: там он раздаёт доступ по своему усмотрению, здесь — отвечает на конкретную просьбу."""
    d = _Db(monkeypatch, row=_row(5, {"code": "PRJ-005", "pm_id": "кто-то", "_editors": [PM1]}),
            existing=[_request(requester=STRANGER)])
    r = client.post("/access-requests/1/approve", headers=_tok("pm1@company.com", "pm123"))
    assert r.status_code == 200, r.text
    assert "grant" in d.calls

    # Посторонний — нет.
    d2 = _Db(monkeypatch, row=_row(5, {"code": "PRJ-005", "pm_id": "кто-то"}),
             existing=[_request(requester=STRANGER)])
    r = client.post("/access-requests/1/approve", headers=_tok("pm1@company.com", "pm123"))
    assert r.status_code == 403, r.text
    assert "grant" not in d2.calls


def test_approve_closes_the_request_before_granting(monkeypatch):
    """Порядок — единственная защита от двойной выдачи. Наоборот было бы хуже: доступ выдан,
    а закрыть запрос не удалось — и второй нажавший выдал бы его ещё раз."""
    d = _Db(monkeypatch, existing=[_request()])
    r = client.post("/access-requests/1/approve", headers=_tok("owner@company.com", "admin123"))
    assert r.status_code == 200 and r.json()["data"]["status"] == "approved"
    assert d.calls.index("decide:approved") < d.calls.index("grant"), d.calls
    assert d.granted["_observers"] == [PM1]
    assert d.calls[-1] == "cache", "кэш доступа не сброшен — 30 секунд человек всё ещё без доступа"
    # Журнал складывается в транзиентный _pending_action_log и доливается ПОСЛЕ записи меты
    # (см. _log_action: прямая мутация _action_log затирала бы параллельный append).
    assert [a for a in d.granted.get("_pending_action_log", [])
            if a.get("action") == "project.observer_add"]


def test_second_approve_grants_nothing(monkeypatch):
    """Двойной клик и два РП на одном запросе — один и тот же случай. Условный апдейт вернул
    ноль строк → выдачи не происходит вовсе."""
    d = _Db(monkeypatch, existing=[_request()], decide=False)
    r = client.post("/access-requests/1/approve", headers=_tok("owner@company.com", "admin123"))
    assert r.status_code == 409 and "grant" not in d.calls


def test_approving_an_existing_editor_does_not_demote_him(monkeypatch):
    """Пока запрос ждал, человека могли сделать со-РП. Дописать его в наблюдатели — значит
    выдать ему ДВЕ роли и запутать список доступа; права при этом решает _owns_item."""
    d = _Db(monkeypatch, row=_row(5, {"code": "PRJ-005", "pm_id": OWNER, "_editors": [PM1]}),
            existing=[_request()])
    r = client.post("/access-requests/1/approve", headers=_tok("owner@company.com", "admin123"))
    assert r.status_code == 200 and d.granted["_observers"] == []


def test_reject_closes_the_request_and_leaves_a_trace(monkeypatch):
    """Отказ — тоже решение проекта: в журнале должно остаться, кто и кому отказал."""
    d = _Db(monkeypatch, existing=[_request()])
    r = client.post("/access-requests/1/reject", headers=_tok("owner@company.com", "admin123"))
    assert r.status_code == 200 and r.json()["data"]["status"] == "rejected"
    assert "decide:rejected" in d.calls and "log:access.reject" in d.calls
    assert "grant" not in d.calls


def test_unknown_request_is_404_not_403(monkeypatch):
    _Db(monkeypatch, existing=[])
    assert client.post("/access-requests/777/approve",
                       headers=_tok("owner@company.com", "admin123")).status_code == 404


# ─────────────────────────── увидеть ───────────────────────────

def test_list_splits_incoming_from_outgoing_and_names_the_project(monkeypatch):
    """По одному коду ни проситель, ни решающий не поймут, о чём речь — подписи обязательны."""
    d = _Db(monkeypatch, existing=[_request()])

    async def by_ids(ids):
        return [d.row]
    monkeypatch.setattr(main.db, "fetch_project_rows_by_ids", by_ids)
    body = client.get("/access-requests", headers=_tok("owner@company.com", "admin123")).json()["data"]
    assert [r["id"] for r in body["incoming"]] == ["1"]
    assert body["incoming"][0]["project_name"] == "Проект 5"
    assert body["incoming"][0]["project_code"] == "PRJ-005"
    assert isinstance(body["outgoing"], list)


def test_bell_shows_the_request_as_a_decidable_item(monkeypatch):
    """Запросы — единственная группа колокольчика не из проектов (автор к проекту доступа не
    имеет) и единственная, по которой можно ДЕЙСТВОВАТЬ прямо из уведомления."""
    d = _Db(monkeypatch, existing=[_request()])

    async def _accessible(user, **kw):
        return [({"id": "5", "code": "PRJ-005", "name": "Проект 5", "status": "active"},
                 {"pm_id": OWNER})]

    async def _bulk(pids, types):
        return {"5": []}
    silence_db_sources(monkeypatch, main)
    monkeypatch.setattr(main.db, "fetch_access_requests", _only_incoming(d))
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)
    body = client.get("/attention", headers=_tok("owner@company.com", "admin123")).json()
    item = body["data"]["access"][0]
    assert item["kind"] == "access_request" and item["request_id"] == "1"
    assert item["title"] == "Project Manager 1" and item["note"]
    assert body["counts"]["access"] == 1 and body["counts"]["total"] == 1


def test_the_bell_asks_about_projects_you_lead_not_about_your_role(monkeypatch):
    """Владелец портфеля решить может, но получать запросы по ВСЕМ чужим проектам ему
    незачем: свои среди них не найти. Поэтому список входящих строится по тому, кто ВЕДЁТ
    проект (РП и со-РП), а не по роли."""
    _Db(monkeypatch, existing=[])
    silence_db_sources(monkeypatch, main)
    asked = []

    async def fetch(**kw):
        asked.append(kw)
        return []
    monkeypatch.setattr(main.db, "fetch_access_requests", fetch)

    async def _accessible(user, **kw):
        return [({"id": "5", "code": "PRJ-005", "name": "П", "status": "active"}, {"pm_id": PM1}),
                ({"id": "6", "code": "PRJ-006", "name": "Ч", "status": "active"}, {"pm_id": "чужой"})]

    async def _bulk(pids, types):
        return {}
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)

    asked.clear()
    client.get("/attention", headers=_tok("pm1@company.com", "pm123"))
    incoming = [k for k in asked if k.get("project_ids") is not None]
    assert incoming and incoming[0]["project_ids"] == ["5"], "РП спросили не про его проект"

    asked.clear()
    client.get("/attention", headers=_tok("owner@company.com", "admin123"))
    incoming = [k for k in asked if k.get("project_ids") is not None]
    assert not incoming, "владельцу портфеля собрали чужие входящие"
    # Но СВОИ решённые запросы спрашиваются у всех — это ответ просителю.
    assert [k for k in asked if k.get("requester_id")], "ответ на свой запрос не спрашивается"


def test_the_asker_learns_the_decision(monkeypatch):
    """Раньше просьба уходила в тишину: подтверждение человек замечал по появившемуся проекту,
    а отказ не узнавал никогда — и спрашивал снова."""
    decided = _request(status="rejected", decided_at=main._now_iso(), decided_by="Portfolio Owner")
    d = _Db(monkeypatch)

    async def fetch(**kw):
        return [decided] if kw.get("requester_id") else []

    async def by_ids(ids):
        return [d.row]

    async def _accessible(user, **kw):
        return []

    async def _bulk(pids, types):
        return {}
    silence_db_sources(monkeypatch, main)
    monkeypatch.setattr(main.db, "fetch_access_requests", fetch)
    monkeypatch.setattr(main.db, "fetch_project_rows_by_ids", by_ids)
    monkeypatch.setattr(main, "_accessible_projects", _accessible)
    monkeypatch.setattr(main, "_fetch_wps_bulk", _bulk)

    body = client.get("/attention", headers=_tok("pm1@company.com", "pm123")).json()
    item = body["data"]["access_decided"][0]
    assert item["kind"] == "access_decision" and item["status"] == "rejected"
    assert item["project_name"] and item["decided_by"] == "Portfolio Owner"
    assert body["counts"]["total"] >= 1, "ответ не попал в бейдж"
