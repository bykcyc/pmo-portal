"""Воркер связки Fireflies → протокол в совещание PMO + комментарий к событию Битрикса.

Все внешние системы — моки: Fireflies — httpx.MockTransport, Битрикс — подменённый bx_call,
PMO — мета в памяти, очередь fireflies_sync — словарь. Тексты протоколов синтетические.

Правила, которые здесь держатся:
  • не уверен — не публикуешь (очередь «не сопоставлено» с кандидатами);
  • один протокол = одна запись в PMO и один комментарий в Битриксе, сколько бы раз ни прогнали;
  • протокол, который вписал человек, не перетирается никогда (статус conflict);
  • намерение пишется ДО внешнего вызова, id результата — после;
  • в логах — только id и статусы.
"""
import asyncio
import copy
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest

import app_runtime
import db
import fireflies_match as fm
import fireflies_sync as ffs
import main

KEY = "ff-test-key-123"
ZID = "84512345678"
ZOOM = f"https://us06web.zoom.us/j/{ZID}?pwd=x"
SECRET_NOTE = "Совершенно секретная строка протокола 7f3a"   # не должна попасть в логи

PERSONS = [
    {"person_id": "p1", "full_name": "Jurijs Sidorenko", "email": "jurijs@example.com", "bitrix24_id": 7001, "is_active": True},
    {"person_id": "p2", "full_name": "Mārta Kalačkina", "email": "marta@example.com", "bitrix24_id": 7002, "is_active": True},
    {"person_id": "p3", "full_name": "Roberts Ozolins", "email": "roberts@example.com", "bitrix24_id": 7003, "is_active": True},
    # общий ящик: email у двух людей — по нему календарь не выбираем
    {"person_id": "p4", "full_name": "Shop One", "email": "shop@example.com", "bitrix24_id": 501, "is_active": True},
    {"person_id": "p5", "full_name": "Shop Two", "email": "shop@example.com", "bitrix24_id": 502, "is_active": True},
]


def transcript(**kw):
    t = {
        "id": "ffm1", "title": "Синк по проекту", "date": 1792998000000, "dateString": "2026-10-21T07:00:20.000Z",
        "duration": 30, "organizer_email": "jurijs@example.com", "user": {"email": "jurijs@example.com"},
        "meeting_link": ZOOM, "privacy": "link",
        "meeting_attendance": [{"name": "Юрий Сидоренко", "join_time": None, "leave_time": None},
                               {"name": "Марта Калачкина", "join_time": None, "leave_time": None}],
        "meeting_info": {"summary_status": "processed", "fred_joined": True},
        "transcript_url": "https://app.fireflies.ai/view/ffm1",
        "summary": {
            "overview": "- **Решили** запускать пилот (00:05)\n- Сроки сдвинуты на неделю",
            "action_items": "**Юрий Сидоренко**\nПодготовить план запуска (01:10)\n",
            "notes": "## Итоги\n- **Пилот**: запуск в ноябре\n- " + SECRET_NOTE + "\n## Риски\n- Нехватка людей",
        },
    }
    t.update(kw)
    return t


def bx_event(eid="500", parent=None, date_from="21.10.2026 10:00:00", description=f"Zoom: https://zoom.us/j/{ZID}",
             attendees=(7001, 7002), name="Синк"):
    return {"ID": eid, "PARENT_ID": parent or eid, "NAME": name, "DATE_FROM": date_from, "DATE_TO": "",
            "TZ_FROM": "Europe/Riga", "DT_SKIP_TIME": "N", "LOCATION": "", "DESCRIPTION": description,
            "ATTENDEE_LIST": [{"id": a, "status": "Y"} for a in attendees]}


def pmo_meeting(mid="mt1", location=f"https://zoom.us/j/{ZID}", minutes="", **kw):
    m = {"id": mid, "title": "Синк", "meeting_date": "2026-10-21", "meeting_time": "10:00", "location": location,
         "minutes_content": minutes, "attendees": [], "actions": [], "decisions": []}
    m.update(kw)
    return m


class World:
    """Состояние всех систем в одном месте + журнал вызовов в порядке их выполнения."""

    def __init__(self):
        self.rows: dict = {}
        self.log: list = []                       # [(kind, detail)] — порядок шагов
        self.ff_responses: list = []              # очередь ответов Fireflies (status, json, headers)
        self.ff_requests: list = []
        self.events_by_owner: dict = {"7001": [bx_event()]}
        self.bx_errors: dict = {}                 # ownerId -> текст ошибки
        self.comment_result = {"result": {"id": 77, "status": "created", "eventId": 500,
                                          "xmlId": "EVENT_500_2026-10-21", "date": "2026-10-21"}}
        self.comment_error = ""
        self.projects: dict = {"5": {"_meetings": [pmo_meeting()], "_pending_action_log": []}}
        self.writes: list = []

    # ── очередь fireflies_sync ──
    def add_row(self, mid="ffm1", **kw):
        row = {c: None for c in db._FF_COLS}
        row.update({"meeting_id": mid, "event": "meeting.summarized", "status": "processing", "attempts": 0,
                    "created_at": "t0", "updated_at": "t0"})
        row.update(kw)
        self.rows[mid] = row
        return dict(row)

    async def update(self, mid, fields, now, expect_reprocessed=db._ANY):
        bad = set(fields) - db._FF_WRITABLE
        assert not bad, bad
        row = self.rows[mid]
        if expect_reprocessed is not db._ANY and row.get("reprocessed_at") != expect_reprocessed:
            self.log.append(("db.stale", dict(fields)))
            return False
        self.log.append(("db.update", dict(fields)))
        row.update(copy.deepcopy(fields))
        row["updated_at"] = now
        return True

    async def due(self, now, limit=20, waiting_bitrix=False):
        out = [dict(r) for r in self.rows.values()
               if (r["status"] in ("received", "processing") and (r.get("next_attempt_at") or "") <= now)
               or (waiting_bitrix and r["status"] == "done" and r.get("bitrix_status") == "waiting_method")]
        return out[:limit]

    async def claim(self, mid, now, lease_until, waiting_bitrix=False):
        self.rows[mid].update(status="processing", next_attempt_at=lease_until)
        return dict(self.rows[mid])

    # ── Fireflies ──
    def ff_handler(self, request: httpx.Request) -> httpx.Response:
        self.ff_requests.append(request)
        self.log.append(("fireflies", None))
        status, js, headers = self.ff_responses.pop(0) if self.ff_responses else (200, {"data": {"transcript": transcript()}}, {})
        return httpx.Response(status, json=js, headers=headers)

    # ── Битрикс ──
    async def bx_call(self, method, payload=None):
        payload = dict(payload or {})
        self.log.append(("bx:" + method, payload))
        if method == "calendar.event.get":
            owner = str(payload.get("ownerId"))
            if owner in self.bx_errors:
                return None, self.bx_errors[owner]
            return {"result": copy.deepcopy(self.events_by_owner.get(owner, []))}, ""
        if method == ffs.BITRIX_COMMENT_METHOD:
            if self.comment_error:
                return None, self.comment_error
            return self.comment_result, ""
        raise AssertionError(f"неожиданный метод Битрикса {method}")

    # ── PMO ──
    async def fetch_projects(self, with_docs=True, user=None):
        return [{"id": int(pid), "_m": m} for pid, m in self.projects.items()]

    async def load_meta(self, pid):
        return ({"id": pid, "lockVersion": 1}, self.projects[str(pid)])

    async def with_meta_retry(self, pid, mut, attempts=4):
        res = mut(self.projects[str(pid)])
        self.writes.append(pid)
        self.log.append(("pmo.write", pid))
        return res

    async def people_index(self):
        by_id = {p["person_id"]: dict(p) for p in PERSONS}
        by_bx = {str(p["bitrix24_id"]): dict(p) for p in PERSONS}
        return {"by_id": by_id, "by_email": {}, "by_name": {}, "by_bx": by_bx}


@pytest.fixture
def world(monkeypatch):
    w = World()
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", True)
    monkeypatch.setattr(main, "FIREFLIES_API_KEY", KEY)
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", False)
    monkeypatch.setattr(main, "FIREFLIES_ALLOWED_PROJECTS", ())
    monkeypatch.setattr(main, "FIREFLIES_ALLOWED_HOSTS", ())
    monkeypatch.setattr(main, "FIREFLIES_EXTRA_BITRIX_USERS", ())
    monkeypatch.setattr(main, "PORTAL_PUBLIC_URL", "https://pm.example")
    monkeypatch.setattr(main, "_bitrix_url", lambda: "https://bx.example/rest/1/t")
    monkeypatch.setattr(main, "bx_call", w.bx_call)
    monkeypatch.setattr(main, "fetch_projects", w.fetch_projects)
    monkeypatch.setattr(main, "_meta", lambda e: e["_m"])
    monkeypatch.setattr(main, "load_meta", w.load_meta)
    monkeypatch.setattr(main, "with_meta_retry", w.with_meta_retry)
    monkeypatch.setattr(main, "_people_index", w.people_index)
    monkeypatch.setattr(db, "fireflies_sync_update", w.update)
    monkeypatch.setattr(db, "fireflies_sync_due", w.due)
    monkeypatch.setattr(db, "fireflies_sync_claim", w.claim)
    monkeypatch.setattr(ffs, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(w.ff_handler)))
    return w


def run(w, mid="ffm1", **row):
    return asyncio.run(ffs.process_one(main, w.add_row(mid, **row)))


def meeting(w, pid="5", mid="mt1"):
    return next(x for x in w.projects[pid]["_meetings"] if x["id"] == mid)


# ═══════════════════════ тексты: markdown Fireflies → BB-код / простой текст ═══════════════════════

def test_md_to_bbcode_bold_heading_and_lists():
    md = "## Итоги\n- **Пилот**: запуск\n- второй пункт\nобычная строка\n* звёздочка-пункт"
    assert ffs.md_to_bbcode(md) == (
        "[B]Итоги[/B]\n[LIST][*][B]Пилот[/B]: запуск\n[*]второй пункт[/LIST]\nобычная строка\n[LIST][*]звёздочка-пункт[/LIST]")


def test_md_to_bbcode_neutralizes_bbcode_from_meeting_text():
    """Текст встречи — данные: [URL=…] или [USER=…] из протокола не должны стать живыми тегами."""
    out = ffs.md_to_bbcode("- см. [URL=https://evil.example]тут[/URL] и [user=1]x[/user], таймкод [00:12]\n"
                           "[PROJECT=7]группа[/PROJECT] [PUT=/команда]жми[/PUT] [CALL=+371]x[/CALL] [ATTACH=1] [BR]")
    # Любая «[» из текста встречи — полноширинная: живых тегов из протокола нет вовсе, только наши.
    assert "[" not in out.replace("[LIST]", "").replace("[/LIST]", "").replace("[*]", "")
    assert "［URL=https://evil.example]" in out and "［PUT=/команда]" in out
    assert "［00:12]" in out                  # таймкод виден глазами


def test_long_bitrix_comment_is_cut_without_broken_markup():
    items = "\n".join(f"- **Пункт {i}** очень длинный текст обзора встречи" for i in range(2000))
    text = ffs.bitrix_comment_text(transcript(summary={"overview": items, "action_items": "- **x** y", "notes": ""}),
                                   "https://pm.example/projects/5/meetings")
    body = text.split("\n\nПолный протокол:")[0]
    assert len(body) <= ffs.BITRIX_COMMENT_MAX - 600 and len(text) <= ffs.BITRIX_COMMENT_MAX
    assert body.count("[B]") == body.count("[/B]") and body.count("[LIST]") == body.count("[/LIST]")
    assert "…" in body
    assert "[URL=https://app.fireflies.ai/view/ffm1]Fireflies[/URL]" in text   # ссылки целы


@pytest.mark.parametrize("cut", range(0, 60))
def test_cap_bb_never_leaves_a_half_tag(cut):
    src = "[B]Обзор[/B]\n[LIST][*][B]Решили[/B]: запуск\n[*]второй пункт[/LIST]\nхвост" * 3
    out = ffs._cap_bb(src, 46 + cut)
    assert len(out) <= 46 + cut
    assert out.count("[B]") == out.count("[/B]") and out.count("[LIST]") == out.count("[/LIST]")
    import re
    assert not re.search(r"\[[^\]]*$", out)


def test_bitrix_comment_is_short_with_links():
    t = transcript()
    text = ffs.bitrix_comment_text(t, "https://pm.example/projects/5/meetings")
    assert "[B]Решили[/B]" in text and "Подготовить план запуска" in text
    assert SECRET_NOTE not in text                       # краткий формат: notes не входят
    assert "[URL=https://app.fireflies.ai/view/ffm1]" in text
    assert "[URL=https://pm.example/projects/5/meetings]" in text
    no_pmo = ffs.bitrix_comment_text(t, None)
    assert "pm.example" not in no_pmo


def test_bitrix_comment_drops_unsafe_links():
    t = transcript(transcript_url="javascript:alert(1)")
    text = ffs.bitrix_comment_text(t, "https://pm.example/x]y")
    assert "javascript" not in text and "x]y" not in text


def test_pmo_minutes_full_notes_plus_actions_as_plain_text():
    text = ffs.pmo_minutes_text(transcript())
    assert SECRET_NOTE in text and "Нехватка людей" in text and "Подготовить план запуска" in text
    assert "**" not in text and "##" not in text and "[B]" not in text
    assert "• Пилот: запуск в ноябре" in text
    assert "https://app.fireflies.ai/view/ffm1" in text


def test_pmo_minutes_are_capped():
    big = transcript(summary={"notes": "- " + "а" * 30000, "action_items": "", "overview": ""})
    assert len(ffs.pmo_minutes_text(big)) <= ffs.PMO_MINUTES_MAX


# ═══════════════════════ Fireflies GraphQL ═══════════════════════

def test_fireflies_request_shape(world):
    t = asyncio.run(ffs.fetch_transcript(main, "ffm1"))
    assert t["id"] == "ffm1"
    req = world.ff_requests[0]
    assert str(req.url) == "https://api.fireflies.ai/graphql"
    assert req.headers["authorization"] == "Bearer " + KEY
    import json
    body = json.loads(req.content)
    assert body == {"query": ffs.FF_QUERY, "variables": {"id": "ffm1"}}
    for field in ("meeting_link", "meeting_attendance", "summary_status", "transcript_url", "notes", "action_items"):
        assert field in ffs.FF_QUERY
    assert "mutation" not in ffs.FF_QUERY


def test_real_client_does_not_follow_redirects():
    c = ffs._client()
    try:
        assert c.follow_redirects is False and c.timeout.read is not None
    finally:
        asyncio.run(c.aclose())


def test_fireflies_429_carries_retry_after(world):
    world.ff_responses.append((429, {"errors": [{"message": "slow down"}]}, {"Retry-After": "120"}))
    with pytest.raises(ffs.StepError) as e:
        asyncio.run(ffs.fetch_transcript(main, "ffm1"))
    assert e.value.retry_after == 120 and not e.value.permanent


def test_fireflies_redirect_is_an_error_not_followed(world):
    world.ff_responses.append((302, {}, {"Location": "https://evil.example/steal"}))
    with pytest.raises(ffs.StepError):
        asyncio.run(ffs.fetch_transcript(main, "ffm1"))
    assert len(world.ff_requests) == 1


def test_fireflies_not_found_is_permanent(world):
    world.ff_responses.append((200, {"errors": [{"message": "x", "extensions": {"code": "object_not_found"}}],
                                     "data": None}, {}))
    with pytest.raises(ffs.StepError) as e:
        asyncio.run(ffs.fetch_transcript(main, "ffm1"))
    assert e.value.permanent


def test_fireflies_network_error_message_has_no_key(world, monkeypatch):
    def boom(request):
        raise httpx.ConnectError("connect failed to " + KEY)
    monkeypatch.setattr(ffs, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    with pytest.raises(ffs.StepError) as e:
        asyncio.run(ffs.fetch_transcript(main, "ffm1"))
    assert KEY not in str(e.value) and "ConnectError" in str(e.value)


# ═══════════════════════ полный прогон ═══════════════════════

def test_happy_path_link_match_writes_pmo_and_waits_for_bitrix_method(world, caplog):
    caplog.set_level(logging.DEBUG)
    assert run(world) == "done"
    row = world.rows["ffm1"]
    assert (row["status"], row["pmo_status"], row["bitrix_status"]) == ("done", "done", "waiting_method")
    assert (row["decision"], row["basis"]) == ("publish", "link")
    assert (row["pmo_project_id"], row["pmo_meeting_id"], row["bitrix_event_id"]) == ("5", "mt1", "500")
    assert row["bitrix_comment_id"] is None
    mt = meeting(world)
    assert SECRET_NOTE in mt["minutes_content"]
    assert mt["fireflies_minutes_sha"] == ffs._sha(mt["minutes_content"])   # хеш — в той же записи
    assert mt["fireflies_meeting_id"] == "ffm1" and mt["transcript_url"] == "https://app.fireflies.ai/view/ffm1"
    log = world.projects["5"]["_pending_action_log"]
    assert log[-1]["user_name"] == "Fireflies" and log[-1]["action"] == "meetings.fireflies"
    assert SECRET_NOTE not in log[-1]["detail"]
    assert not any(k == "bx:" + ffs.BITRIX_COMMENT_METHOD for k, _ in world.log)   # без флага — не зовём
    assert SECRET_NOTE not in caplog.text and "Подготовить план" not in caplog.text


def test_intent_is_recorded_before_pmo_write(world):
    run(world)
    kinds = [(k, d) for k, d in world.log if k in ("db.update", "pmo.write")]
    i_intent = next(i for i, (k, d) in enumerate(kinds) if k == "db.update" and (d or {}).get("pmo_status") == "writing")
    i_write = next(i for i, (k, _) in enumerate(kinds) if k == "pmo.write")
    i_done = next(i for i, (k, d) in enumerate(kinds) if k == "db.update" and (d or {}).get("pmo_status") == "done")
    assert i_intent < i_write < i_done
    assert world.log[[k for k, _ in world.log].index("db.update")][1]["pmo_meeting_id"] == "mt1"


def test_bitrix_comment_when_flag_on_intent_then_call_then_id(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.events_by_owner["7001"] = [bx_event(eid="501", parent="500")]   # копия в календаре участника
    assert run(world) == "done"
    row = world.rows["ffm1"]
    assert (row["bitrix_status"], row["bitrix_comment_id"], row["bitrix_event_id"]) == ("done", "77", "500")
    i_post = next(i for i, (k, d) in enumerate(world.log) if k == "db.update" and (d or {}).get("bitrix_status") == "posting")
    i_call = next(i for i, (k, _) in enumerate(world.log) if k == "bx:" + ffs.BITRIX_COMMENT_METHOD)
    i_done = next(i for i, (k, d) in enumerate(world.log) if k == "db.update" and (d or {}).get("bitrix_status") == "done")
    assert i_post < i_call < i_done
    payload = world.log[i_call][1]
    assert payload["eventId"] == "501"                      # найденный экземпляр; к PARENT_ID приводит метод
    assert payload["date"] == "2026-10-21"                  # дата экземпляра из DATE_FROM (часы TZ_FROM)
    assert payload["externalKey"] == "fireflies:ffm1"       # идемпотентность на стороне Битрикса
    assert payload["text"].endswith("\n[I]fireflies:ffm1[/I]")   # контракт: ключ входит в text
    assert "[URL=https://pm.example/projects/5/meetings]" in payload["text"]


def test_comment_text_carries_external_key_last_line():
    text = ffs.bitrix_comment_text(transcript(), None, ffs.external_key("ffm1"))
    assert "fireflies:ffm1" in text and text.splitlines()[-1] == "[I]fireflies:ffm1[/I]"
    assert "fireflies:ffm1" not in ffs.bitrix_comment_text(transcript(), None)


def test_external_key_rejects_ids_outside_contract():
    with pytest.raises(ffs.StepError) as e:
        ffs.external_key("bad id[1]")
    assert e.value.permanent
    with pytest.raises(ffs.StepError):
        ffs.external_key("x" * 120)                         # > 128 символов с префиксом


def test_event_local_date_is_riga_day_not_utc():
    ev = fm.BxEvent.from_api(bx_event(date_from="22.10.2026 00:30:00"), "7001")
    assert ev.start is not None and ev.start.date().isoformat() == "2026-10-21"   # в UTC ещё 21-е
    assert ffs._event_local_date(ev) == "2026-10-22"


def test_event_local_date_is_day_of_date_from_in_tz_from_not_riga():
    # Как Битрикс строит EVENT_<id>_<дата>: по часам TZ_FROM. 23:30 UTC 21.10 — в Риге уже 22.10.
    e = bx_event(date_from="21.10.2026 23:30:00")
    e["TZ_FROM"] = "UTC"
    ev = fm.BxEvent.from_api(e, "7001")
    assert ev.start is not None and ev.start.astimezone(fm.RIGA).date().isoformat() == "2026-10-22"
    assert ffs._event_local_date(ev) == "2026-10-21"


def test_event_local_date_for_all_day_event():
    e = bx_event(date_from="21.10.2026")
    e["DT_SKIP_TIME"] = "Y"
    ev = fm.BxEvent.from_api(e, "7001")
    assert ev.start is None
    assert ffs._event_local_date(ev) == "2026-10-21"        # серия «на весь день» — тоже с date


def test_comment_exists_is_success(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_result = {"result": {"id": 41, "status": "exists", "eventId": 500,
                                       "xmlId": "EVENT_500", "date": None}}
    assert run(world) == "done"
    row = world.rows["ffm1"]
    assert (row["bitrix_status"], row["bitrix_comment_id"], row["bitrix_event_id"]) == ("done", "41", "500")


def test_comment_response_without_known_status_is_not_done(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_result = {"result": {"id": 41, "status": "weird"}}
    assert run(world) == "received"
    assert world.rows["ffm1"]["bitrix_status"] == "posting"   # исход неизвестен — вслепую не повторяем


@pytest.mark.parametrize("code", ["ARGUMENT", "NOT_FOUND", "FORBIDDEN", "CONFIG"])
def test_comment_contract_errors_fail_without_retry(world, monkeypatch, code):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_error = f"{code}: описание"
    assert run(world) == "failed"
    row = world.rows["ffm1"]
    assert row["bitrix_status"] is None and row["next_attempt_at"] is None   # комментария нет, повтора нет
    assert code in row["last_error"] and ffs.BX_COMMENT_PERMANENT[code] in row["last_error"]
    assert len(_comment_calls(world)) == 1


def test_comment_forum_error_is_retried(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_error = "FORUM: ошибка записи"
    assert run(world) == "received"
    row = world.rows["ffm1"]
    assert row["bitrix_status"] is None and row["attempts"] == 1 and row["next_attempt_at"]


def test_second_run_writes_nothing_twice(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    run(world)
    first = dict(world.rows["ffm1"])
    world.log.clear()
    world.writes.clear()
    assert asyncio.run(ffs.process_one(main, dict(first))) == "done"
    assert world.writes == []
    assert not any(k == "bx:" + ffs.BITRIX_COMMENT_METHOD for k, _ in world.log)
    assert world.rows["ffm1"]["bitrix_comment_id"] == "77"


def test_waiting_method_row_gets_comment_once_flag_is_on(world, monkeypatch):
    run(world)
    assert world.rows["ffm1"]["bitrix_status"] == "waiting_method"
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.writes.clear()
    stats = asyncio.run(ffs.run_due(main))
    assert stats.get("done") == 1
    assert world.rows["ffm1"]["bitrix_status"] == "done" and world.writes == []


def test_human_minutes_are_never_overwritten(world):
    world.projects["5"]["_meetings"] = [pmo_meeting(minutes="Протокол, который написал РП")]
    assert run(world) == "conflict"
    row = world.rows["ffm1"]
    assert row["pmo_status"] == "conflict" and row["pmo_meeting_id"] == "mt1"
    assert meeting(world)["minutes_content"] == "Протокол, который написал РП"
    assert "fireflies_meeting_id" not in meeting(world) and world.writes == []


def test_other_fireflies_protocol_already_there_is_conflict(world):
    world.projects["5"]["_meetings"] = [pmo_meeting(minutes="чужой", fireflies_meeting_id="other")]
    assert run(world) == "conflict"
    assert meeting(world)["minutes_content"] == "чужой"


def test_resend_rewrites_our_text_but_not_a_human_edit(world):
    run(world)
    # resend с правленым протоколом: наш текст никто не трогал → перезаписываем
    world.ff_responses.append((200, {"data": {"transcript": transcript(summary={
        "overview": "", "action_items": "", "notes": "- Уточнённый протокол"})}}, {}))
    assert run(world, pmo_status="pending", pmo_project_id="5", pmo_meeting_id="mt1",
               bitrix_status="waiting_method", reprocessed_at="1792998000000") == "done"
    assert "Уточнённый протокол" in meeting(world)["minutes_content"]
    # человек поправил наш текст → следующий resend его не трогает
    meeting(world)["minutes_content"] += "\nДописал РП"
    assert run(world, pmo_status="pending", reprocessed_at="1792998000001") == "conflict"
    assert meeting(world)["minutes_content"].endswith("Дописал РП")


def test_lost_step_result_does_not_turn_our_text_into_a_human_edit(world):
    """Протокол записан, а отметка шага в очередь не легла (сбой/гонка): следующий прогон
    обязан узнать СВОЙ текст по хешу в самом совещании, а не объявить его чужим."""
    run(world)
    world.ff_responses.append((200, {"data": {"transcript": transcript(summary={
        "overview": "", "action_items": "", "notes": "- Версия 2"})}}, {}))
    assert run(world, pmo_status="writing", reprocessed_at="1792998000000") == "done"
    assert "Версия 2" in meeting(world)["minutes_content"]


def test_meeting_without_project_goes_only_to_bitrix(world):
    world.projects["5"]["_meetings"] = [pmo_meeting(location="Переговорная 3")]
    assert run(world) == "done"
    row = world.rows["ffm1"]
    assert row["pmo_status"] == "none" and row["bitrix_status"] == "waiting_method" and world.writes == []


def test_meeting_is_never_created_automatically(world):
    world.projects["5"]["_meetings"] = []
    run(world)
    assert world.projects["5"]["_meetings"] == []


def test_two_pmo_meetings_with_same_link_and_date_go_to_queue(world):
    world.projects["7"] = {"_meetings": [pmo_meeting(mid="mt9")], "_pending_action_log": []}
    assert run(world) == "unmatched"
    row = world.rows["ffm1"]
    assert row["pmo_status"] == "unmatched" and world.writes == []
    assert {(c["project_id"], c["meeting_id"]) for c in row["candidates"]["pmo"]} == {("5", "mt1"), ("7", "mt9")}


def test_pmo_meeting_found_by_bitrix_event_id(world):
    world.projects["5"]["_meetings"] = [pmo_meeting(location="", bitrix_event_id=500)]
    assert run(world) == "done"
    assert world.rows["ffm1"]["pmo_meeting_id"] == "mt1" and meeting(world)["fireflies_meeting_id"] == "ffm1"


def test_already_linked_meeting_wins_over_link_search(world):
    """После первой записи ключ — fireflies_meeting_id: перенос даты/ссылки не теряет совещание."""
    world.projects["5"]["_meetings"] = [pmo_meeting(location="", meeting_date="2026-10-28", minutes="",
                                                    fireflies_meeting_id="ffm1")]
    world.projects["7"] = {"_meetings": [pmo_meeting(mid="mt9")], "_pending_action_log": []}
    assert run(world) == "done"
    assert (world.rows["ffm1"]["pmo_project_id"], world.rows["ffm1"]["pmo_meeting_id"]) == ("5", "mt1")


def test_allowed_projects_limit_pmo_search(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_ALLOWED_PROJECTS", ("7",))
    assert run(world) == "done"
    assert world.rows["ffm1"]["pmo_status"] == "none" and world.writes == []


def test_archived_and_template_projects_are_skipped(world):
    world.projects["5"]["_archived"] = True
    run(world)
    assert world.rows["ffm1"]["pmo_status"] == "none"


def test_allowed_hosts_skip_foreign_meetings(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_ALLOWED_HOSTS", ("someone@example.com",))
    assert run(world) == "skipped"
    assert not any(k.startswith("bx:") for k, _ in world.log) and world.writes == []


def test_ambiguous_bitrix_events_go_to_queue_with_candidates(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.events_by_owner["7001"] = [bx_event("500", date_from="21.10.2026 09:50:00"),
                                    bx_event("600", date_from="21.10.2026 10:10:00")]
    assert run(world) == "unmatched"
    row = world.rows["ffm1"]
    assert row["decision"] == "queue" and row["bitrix_status"] == "unmatched"
    assert {c["event_id"] for c in row["candidates"]["bitrix"]} == {"500", "600"}
    assert not any(k == "bx:" + ffs.BITRIX_COMMENT_METHOD for k, _ in world.log)
    assert row["pmo_status"] == "done"   # PMO по ссылке в «Месте» — отдельный точный путь


def test_calendars_searched_owner_attendance_names_and_extra(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_EXTRA_BITRIX_USERS", ("999",))
    run(world)
    owners = [d["ownerId"] for k, d in world.log if k == "bx:calendar.event.get"]
    assert owners == ["7001", "7002", "999"]       # владелец (email), Марта (имя), доп.
    d = next(d for k, d in world.log if k == "bx:calendar.event.get")
    assert (d["type"], d["from"], d["to"]) == ("user", "2026-10-21", "2026-10-22")


def test_shared_mailbox_owner_does_not_pick_a_calendar(world):
    world.ff_responses.append((200, {"data": {"transcript": transcript(
        user={"email": "shop@example.com"}, organizer_email="shop@example.com", meeting_attendance=[])}}, {}))
    assert run(world) == "unmatched"
    assert not any(k == "bx:calendar.event.get" for k, _ in world.log)
    assert world.rows["ffm1"]["bitrix_status"] == "unmatched"


def test_partial_calendar_read_failure_is_queue_not_publish(world):
    world.events_by_owner["7002"] = []
    world.bx_errors["7002"] = "ACCESS_DENIED"
    assert run(world) == "unmatched"
    assert world.rows["ffm1"]["decision"] == "queue" and "неполные" in world.rows["ffm1"]["reason"]


def test_all_calendars_failed_is_retry(world):
    world.bx_errors.update({"7001": "ConnectTimeout", "7002": "ConnectTimeout"})
    assert run(world) == "received"
    row = world.rows["ffm1"]
    assert row["attempts"] == 1 and "Битрикс" in row["last_error"]
    assert world.writes == []


def test_bitrix_not_configured_still_does_pmo_by_link(world, monkeypatch):
    monkeypatch.setattr(main, "_bitrix_url", lambda: "")
    assert run(world) == "done"
    row = world.rows["ffm1"]
    assert row["bitrix_status"] == "skipped" and row["pmo_status"] == "done"


def test_summary_not_ready_is_postponed(world):
    world.ff_responses.append((200, {"data": {"transcript": transcript(
        meeting_info={"summary_status": "processing"})}}, {}))
    assert run(world) == "received"
    assert world.rows["ffm1"]["attempts"] == 1 and world.writes == []


def test_summary_failed_is_skipped(world):
    world.ff_responses.append((200, {"data": {"transcript": transcript(
        meeting_info={"summary_status": "failed"})}}, {}))
    assert run(world) == "skipped"


def test_comment_rejected_by_bitrix_is_retried(world, monkeypatch):
    """Битрикс ответил кодом ошибки — комментария точно нет: намерение снято, повтор опубликует."""
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_error = "ERROR_METHOD_NOT_FOUND: "
    assert run(world) == "received"
    row = world.rows["ffm1"]
    assert row["bitrix_status"] is None and row["bitrix_event_id"] == "500"
    assert row["pmo_status"] == "done"            # готовый шаг не теряется
    assert "custom.calendar.comment.add" in row["last_error"]
    world.comment_error = ""
    assert asyncio.run(ffs.process_one(main, dict(world.rows["ffm1"]))) == "done"
    assert world.rows["ffm1"]["bitrix_comment_id"] == "77"


def _comment_calls(w):
    return [d for k, d in w.log if k == "bx:" + ffs.BITRIX_COMMENT_METHOD]


def test_comment_timeout_is_not_reposted_blindly(world, monkeypatch, caplog):
    """Таймаут чтения: комментарий мог появиться. Следующий прогон НЕ публикует второй раз —
    строка уходит человеку (conflict) с понятной причиной."""
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.comment_error = "ReadTimeout"
    assert run(world) == "received"
    assert world.rows["ffm1"]["bitrix_status"] == "posting"
    world.comment_error = ""
    assert asyncio.run(ffs.process_one(main, dict(world.rows["ffm1"]))) == "conflict"
    row = world.rows["ffm1"]
    assert len(_comment_calls(world)) == 1
    assert row["bitrix_status"] == "posting" and "bitrix_reset" in row["reason"]


def test_posting_row_never_goes_to_a_newly_matched_event(world, monkeypatch):
    """Намерение было для события A; теперь сопоставление находит B. Вызова нет ни в A, ни в B."""
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    assert run(world, bitrix_status="posting", bitrix_event_id="A") == "conflict"
    row = world.rows["ffm1"]
    assert _comment_calls(world) == [] and row["bitrix_event_id"] == "A"


def test_comment_id_survives_a_resend_that_arrives_mid_run(world, monkeypatch):
    """Комментарий создан, а итог прогона отброшен resend'ом: id комментария всё равно в строке,
    и следующий прогон второго комментария не публикует."""
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    real = world.bx_call

    async def bx_then_resend(method, payload=None):
        res = await real(method, payload)
        if method == ffs.BITRIX_COMMENT_METHOD:
            world.rows["ffm1"]["reprocessed_at"] = "1792998000000"    # resend посреди прогона
        return res
    monkeypatch.setattr(main, "bx_call", bx_then_resend)
    run(world, reprocessed_at=None)
    row = world.rows["ffm1"]
    assert (row["bitrix_status"], row["bitrix_comment_id"]) == ("done", "77")
    world.rows["ffm1"]["status"] = "received"
    asyncio.run(ffs.process_one(main, dict(row)))
    assert len(_comment_calls(world)) == 1


# ═══════════════════════ видимость встречи и сопоставление PMO ═══════════════════════

@pytest.mark.parametrize("privacy", ["owner", "participants", "participatingteammates", "", None, "OWNER"])
def test_private_meeting_is_not_published_anywhere(world, monkeypatch, privacy):
    monkeypatch.setattr(main, "FIREFLIES_BITRIX_COMMENTS", True)
    world.ff_responses.append((200, {"data": {"transcript": transcript(privacy=privacy)}}, {}))
    assert run(world) == "skipped"
    assert "приватная" in world.rows["ffm1"]["reason"]
    assert world.writes == [] and not any(k.startswith("bx:") for k, _ in world.log)


@pytest.mark.parametrize("privacy", ["link", "teammates", "teammatesandparticipants", "Teammates"])
def test_team_visible_meeting_is_published(world, privacy):
    world.ff_responses.append((200, {"data": {"transcript": transcript(privacy=privacy)}}, {}))
    assert run(world) == "done" and world.rows["ffm1"]["pmo_status"] == "done"


def test_reusable_link_same_day_other_time_does_not_hit_project_meeting(world):
    """Личная ссылка Zoom (PMI): закрытая встреча в 10:00 и совещание проекта в 14:00 по той же
    ссылке. Протокол закрытой встречи в проект не пишется."""
    world.projects["5"]["_meetings"] = [pmo_meeting(meeting_time="14:00")]
    run(world)
    row = world.rows["ffm1"]
    assert row["pmo_status"] == "none" and world.writes == []
    assert "fireflies_meeting_id" not in meeting(world)


def test_link_match_without_meeting_time_goes_to_queue(world):
    world.projects["5"]["_meetings"] = [pmo_meeting(meeting_time="")]
    assert run(world) == "unmatched"
    row = world.rows["ffm1"]
    assert row["pmo_status"] == "unmatched" and world.writes == []
    assert [(c["meeting_id"], c["via"]) for c in row["candidates"]["pmo"]] == [("mt1", "link_no_time")]


def test_bitrix_event_id_of_a_series_needs_the_same_date(world):
    """Экземпляры серии Битрикса приходят с одним ID: совещание первой недели с bitrix_event_id
    этой серии не принимает протокол другой недели."""
    world.projects["5"]["_meetings"] = [pmo_meeting(location="", meeting_date="2026-10-14", bitrix_event_id=500)]
    run(world)
    assert world.rows["ffm1"]["pmo_status"] == "none" and world.writes == []


def test_no_idle_meta_write_when_retry_finds_nothing_to_write(world, monkeypatch):
    """Конфликт версии → повторная попытка видит, что протокол уже вписал человек: мета не
    сохраняется (холостая запись подняла бы версию и дала ложный 409 человеку)."""
    saves = []

    async def retry_after_human_edit(pid, mut, attempts=4):
        meeting(world)["minutes_content"] = "Вписал РП, пока шла запись"   # первая попытка проиграла гонку
        res = mut(world.projects[str(pid)])
        saves.append(pid)                                                   # сюда доходит только запись
        return res
    monkeypatch.setattr(main, "with_meta_retry", retry_after_human_edit)
    res = asyncio.run(ffs.write_minutes(main, "5", "mt1", "ffm1", transcript(), "текст"))
    assert res == "conflict" and saves == []
    assert meeting(world)["minutes_content"] == "Вписал РП, пока шла запись"


def test_retry_schedule_and_failed_after_limit(world, caplog):
    caplog.set_level(logging.WARNING)
    world.bx_errors.update({"7001": "ConnectTimeout", "7002": "ConnectTimeout"})
    t0 = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)
    delays = []
    for attempts in range(len(ffs.RETRY_DELAYS_MIN)):
        st = asyncio.run(ffs.process_one(main, world.add_row(attempts=attempts), now=t0))
        assert st == "received"
        nxt = datetime.fromisoformat(world.rows["ffm1"]["next_attempt_at"].replace("Z", "+00:00"))
        delays.append(round((nxt - t0).total_seconds() / 60))
    assert delays == [1, 5, 15, 60, 180]
    st = asyncio.run(ffs.process_one(main, world.add_row(attempts=len(ffs.RETRY_DELAYS_MIN)), now=t0))
    assert st == "failed" and world.rows["ffm1"]["status"] == "failed"
    assert "ffm1" in caplog.text and SECRET_NOTE not in caplog.text


def test_retry_after_from_fireflies_stretches_the_pause(world):
    world.ff_responses.append((429, {}, {"Retry-After": "600"}))
    t0 = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)
    asyncio.run(ffs.process_one(main, world.add_row(), now=t0))
    nxt = datetime.fromisoformat(world.rows["ffm1"]["next_attempt_at"].replace("Z", "+00:00"))
    assert nxt - t0 == timedelta(minutes=10)


def test_permanent_error_fails_at_once(world):
    world.ff_responses.append((200, {"errors": [{"extensions": {"code": "object_not_found"}}]}, {}))
    assert run(world) == "failed"


def test_run_stops_when_a_newer_resend_arrived(world):
    """Пока воркер работал, пришёл resend: устаревший прогон не пишет ни шаги, ни итог —
    строка уже снова в очереди и разберётся со свежими заметками."""
    row = world.add_row(reprocessed_at=None)
    world.rows["ffm1"]["reprocessed_at"] = "1792998000000"   # resend пришёл в середине прогона
    world.rows["ffm1"]["status"] = "received"
    assert asyncio.run(ffs.process_one(main, row)) == "superseded"
    assert any(k == "db.stale" for k, _ in world.log)
    assert world.writes == [] and world.rows["ffm1"]["status"] == "received"


def test_unexpected_exception_is_retried_without_message(world, monkeypatch):
    async def boom():
        raise ValueError(SECRET_NOTE)
    monkeypatch.setattr(main, "_people_index", boom)
    assert run(world) == "received"
    assert SECRET_NOTE not in (world.rows["ffm1"]["last_error"] or "")


# ═══════════════════════ run_due и планировщик ═══════════════════════

def test_run_due_is_noop_when_disabled(world, monkeypatch):
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", False)
    world.add_row(status="received", next_attempt_at="2000-01-01T00:00:00.000Z")
    assert asyncio.run(ffs.run_due(main)) == {"skipped": "disabled"}
    assert world.ff_requests == []


def test_run_due_processes_due_rows(world):
    world.add_row("ffm1", status="received", next_attempt_at="2000-01-01T00:00:00.000Z")
    world.add_row("later", status="received", next_attempt_at="2999-01-01T00:00:00.000Z")
    stats = asyncio.run(ffs.run_due(main))
    assert stats == {"done": 1}
    assert world.rows["later"]["status"] == "received"


def test_scheduled_job_uses_job_lock_and_respects_flag(monkeypatch):
    seen = {}

    async def fake_lock(key, fn, *args):
        seen["key"], seen["fn"], seen["args"] = key, fn, args
        return {"ok": 1}
    monkeypatch.setattr(main.db, "run_with_job_lock", fake_lock)
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", False)
    assert asyncio.run(main._scheduled_fireflies()) is None and seen == {}
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", True)
    assert asyncio.run(main._scheduled_fireflies()) == {"ok": 1}
    assert seen["key"] == main._JOB_FIREFLIES and seen["fn"] is ffs.run_due and seen["args"] == (main,)
    assert main._JOB_FIREFLIES not in (main._JOB_SNAPSHOT, main._JOB_DIGEST, main._JOB_LEADERSHIP, main._JOB_BX_PEOPLE)


class _FakeScheduler:
    jobs: list = []

    def __init__(self, timezone=None):
        _FakeScheduler.jobs = []

    def add_job(self, fn, trigger, **kw):
        _FakeScheduler.jobs.append((fn, trigger, kw))

    def start(self):
        pass

    def shutdown(self, wait=False):
        pass


class _FakeDbModule:
    async def init_pool(self):
        pass

    async def apply_schema(self):
        pass

    async def load_users(self):
        return {}

    async def load_settings(self):
        return {}

    async def close_pool(self):
        pass


def _lifespan_jobs(monkeypatch, env, fireflies):
    import apscheduler.schedulers.asyncio as aps
    monkeypatch.setattr(aps, "AsyncIOScheduler", _FakeScheduler)

    async def noop(*a, **k):
        return None

    async def go():
        async with app_runtime.lifespan(
            db_module=_FakeDbModule(), environment=env, logger=logging.getLogger("t"),
            apply_loaded_state=lambda u, s: None, apply_smtp=lambda: None, enforce_prod_secrets=lambda: None,
            take_portfolio_snapshot=noop, run_digests=noop, run_leadership_digest=noop, fireflies_sync=fireflies):
            pass
    asyncio.run(go())
    return {kw.get("id"): (fn, trigger, kw) for fn, trigger, kw in _FakeScheduler.jobs}


def test_lifespan_adds_minutely_fireflies_job(monkeypatch):
    async def job():
        return None
    jobs = _lifespan_jobs(monkeypatch, {}, job)
    fn, trigger, kw = jobs["fireflies_sync"]
    assert fn is job and trigger == "interval" and kw["minutes"] == 1
    assert kw.get("max_instances") == 1 and kw.get("coalesce") is True


def test_lifespan_without_fireflies_has_no_job(monkeypatch):
    assert "fireflies_sync" not in _lifespan_jobs(monkeypatch, {}, None)


def test_scheduler_disabled_means_no_fireflies_job(monkeypatch):
    _FakeScheduler.jobs = []

    async def job():
        return None
    assert _lifespan_jobs(monkeypatch, {"SCHEDULER_DISABLED": "1"}, job) == {}


# ═══════════════════════ серверные поля совещания ═══════════════════════

def test_fireflies_fields_are_server_only():
    prot = main._protected_fields("_meetings")
    assert {"fireflies_meeting_id", "transcript_url", "fireflies_minutes_sha"} <= set(prot)
    assert "bitrix_event_id" in prot          # прежние на месте


def test_pmo_match_helper_is_the_ported_core():
    assert ffs.mt is fm
