"""Связка Fireflies → протокол в совещание PMO + комментарий к событию Битрикса (воркер).

Импорт без побочных эффектов: ни сети, ни БД, ни чтения окружения. Конфиг (FIREFLIES_*)
читает main.py; воркер обращается к нему и к хелперам портала через `api` (модуль main)
во время вызова — как роут-модули, поэтому монкейпатчи тестов на main.* остаются в силе.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Iterable, Optional

import httpx

import fireflies_match as mt

if TYPE_CHECKING:
    from pmo_api import PmoApi

_TRUE = frozenset({"1", "true", "yes", "on"})

# Статусы строки очереди fireflies_sync (общий ход). Шаги PMO/Битрикса — свои статусы, см. schema.sql.
STATUSES = ("received", "processing", "done", "unmatched", "conflict", "failed", "skipped")
# id транскрипта Fireflies: буквы, цифры, «-», «_». Всё прочее — не их id, а мусор или попытка инъекции.
# Только через .fullmatch: «$» в Python допускает хвостовой перевод строки («abc\n» прошёл бы .match).
MEETING_ID_RX = re.compile(r"[A-Za-z0-9_-]{1,128}")


def env_flag(value: Optional[str]) -> bool:
    """Флаг окружения: включён только явным 1/true/yes/on. Всё прочее (и пусто) — выключен."""
    return str(value or "").strip().lower() in _TRUE


def env_list(value: Optional[str], lower: bool = False) -> tuple[str, ...]:
    """Список через запятую/точку с запятой → кортеж без пустых и без повторов (порядок сохраняется)."""
    out: list[str] = []
    for part in re.split(r"[,;]", str(value or "")):
        s = part.strip()
        if lower:
            s = s.lower()
        if s and s not in out:
            out.append(s)
    return tuple(out)


def _uniq(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def now_iso(dt: Optional[datetime] = None) -> str:
    """Таймстемп в формате портала (как db._op_now): 2026-10-21T08:00:00.000Z — сравним строкой."""
    dt = (dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def signature_ok(raw: bytes, header: Optional[str], secret: str) -> bool:
    """X-Hub-Signature вебхука Fireflies V2: sha256=<hex HMAC-SHA256 СЫРОГО тела>, сравнение
    timing-safe. Без секрета или без заголовка — всегда отказ."""
    if not secret or not header:
        return False
    got = header.strip()
    if got.lower().startswith("sha256="):
        got = got[len("sha256="):]
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(got.strip().lower().encode("utf-8"), expected.encode("ascii"))


def _client() -> httpx.AsyncClient:
    """HTTP-клиент к Fireflies: таймаут и БЕЗ редиректов (иначе Bearer-ключ уехал бы на адрес из
    Location). Точка подмены для тестов."""
    return httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=False)



# ══════════════════════════════ константы ══════════════════════════════

FF_URL = "https://api.fireflies.ai/graphql"
# Единственный документ, который воркер шлёт в Fireflies: только чтение одного транскрипта.
FF_QUERY = (
    "query Transcript($id: String!) { transcript(id: $id) { "
    "id title date dateString duration organizer_email user { email } meeting_link privacy "
    "meeting_attendance { name join_time leave_time } meeting_info { summary_status fred_joined } "
    "transcript_url summary { overview action_items notes } } }"
)
# Метод комментария к событию календаря — не стандартный REST Битрикса, а метод собственного
# серверного модуля (custom.main), которого на портале может не быть. Поэтому шаг Битрикса стоит
# за флагом FIREFLIES_BITRIX_COMMENTS: пока флаг выключен, шаг ждёт ('waiting_method').
BITRIX_COMMENT_METHOD = "custom.calendar.comment.add"
# Видимость встречи в Fireflies, при которой протокол можно публиковать в PMO и Битрикс (белый
# список; значения — fireflies-api.md §2; на реальном API встречается 'link'). owner, participants,
# participatingteammates и всё неизвестное/пустое — приватно: пропускаем.
PUBLIC_PRIVACY = frozenset({"link", "teammates", "teammatesandparticipants"})
# Паузы перед повторами (минуты): 1, 5, 15, 60, 180 — то есть 5 повторов после первой неудачи;
# неудача после последнего повтора (6-я подряд) — failed. Буквальное «failed после 5 неудач»
# оставило бы паузу 180 мин неиспользованной — расхождение в задании, решение за владельцем.
RETRY_DELAYS_MIN = (1, 5, 15, 60, 180)
# Аренда строки на время прогона: упади воркер посреди — строку подберёт следующий прогон.
LEASE_MIN = 10
PMO_MINUTES_MAX = 20000      # лимит протокола в REST портала (main: 20 000 символов)
BITRIX_COMMENT_MAX = 15000   # короткий формат; запас до 20 000 у сообщений Битрикса
# Синтетический актор журнала проекта: _log_action читает только id и full_name.
ACTOR = {"id": "fireflies", "full_name": "Fireflies"}


class Superseded(Exception):
    """Пока шёл прогон, пришёл resend (reprocessed_at сменился): прогон устарел, строка уже снова
    в очереди — ничего больше не пишем."""


class _NoWrite(Exception):
    """Сигнал из mut внутри with_meta_retry: писать нечего (вердикт не 'write') — мету не сохранять."""

    def __init__(self, verdict: str):
        super().__init__(verdict)
        self.verdict = verdict


class StepError(Exception):
    """Ошибка шага без секретов и без текстов встречи. permanent — повторять бессмысленно;
    retry_after — пауза (с), которую попросил внешний сервис (429 Retry-After)."""

    def __init__(self, message: str, *, permanent: bool = False, retry_after: Optional[float] = None):
        super().__init__(message)
        self.permanent = permanent
        self.retry_after = retry_after


# ══════════════════════════════ тексты ══════════════════════════════
# Протокол Fireflies — markdown («## раздел», «- пункт», **жирный**). В Битрикс — BB-код,
# в PMO — простой текст (форма совещания показывает minutes_content как есть, pre-wrap).
# Текст встречи — ДАННЫЕ: BB-теги, пришедшие в протоколе, обезвреживаются.

_BULLET = re.compile(r"^\s*[-*•]\s+(.*)$")
_HEADING = re.compile(r"^\s*#{1,6}\s+(.*?)\s*#*\s*$")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_SAFE_URL = re.compile(r"^https://[^\s\[\]\"'<>]+$")


def _neutralize_bb(text: str) -> str:
    """Любая «[» из текста встречи → «［» (полноширинная): «[URL=…]», «[USER=…]», «[PROJECT=…]»,
    «[PUT=…]» видно глазами, но живым тегом не станет. Без чёрного списка имён — Битрикс разбирает
    больше тегов, чем перечислишь. Наши теги ([B], [LIST], [*], [URL]) добавляются ПОСЛЕ."""
    return text.replace("[", "［")


def md_to_bbcode(md: Optional[str]) -> str:
    out: list[str] = []
    items: list[str] = []

    def flush() -> None:
        if items:
            out.append("[LIST]" + "\n".join("[*]" + it for it in items) + "[/LIST]")
            items.clear()

    for raw in str(md or "").splitlines():
        line = _neutralize_bb(raw.rstrip())
        b = _BULLET.match(line)
        if b:
            items.append(_BOLD.sub(r"[B]\1[/B]", b.group(1).strip()))
            continue
        flush()
        h = _HEADING.match(line)
        if h:
            title = _BOLD.sub(r"\1", h.group(1))
            if title:
                out.append(f"[B]{title}[/B]")
        elif line.strip():
            out.append(_BOLD.sub(r"[B]\1[/B]", line.strip()))
    flush()
    return "\n".join(out)


def md_to_plain(md: Optional[str]) -> str:
    out: list[str] = []
    for raw in str(md or "").splitlines():
        line = raw.rstrip()
        b = _BULLET.match(line)
        if b:
            out.append("• " + _BOLD.sub(r"\1", b.group(1).strip()))
            continue
        h = _HEADING.match(line)
        if h:
            if out and out[-1] != "":
                out.append("")
            out.append(_BOLD.sub(r"\1", h.group(1)))
        elif line.strip():
            out.append(_BOLD.sub(r"\1", line.strip()))
    return "\n".join(out).strip()


def _safe_url(url: Any) -> Optional[str]:
    s = str(url or "").strip()
    return s if _SAFE_URL.match(s) else None


def _cap(text: str, limit: int, tail: str = "\n…") -> str:
    return text if len(text) <= limit else text[: max(0, limit - len(tail))].rstrip() + tail


_BB_PARTIAL = re.compile(r"\[[^\]\n]*$")
_BB_OPEN = re.compile(r"\[(/?)(B|LIST)\]")


def _cap_bb(text: str, limit: int) -> str:
    """Обрезка готового BB-кода без битой разметки: недописанный хвост «[…» убирается, открытые
    [B]/[LIST] закрываются в обратном порядке. В тексте только наши теги — текст встречи
    обезврежен (_neutralize_bb), поэтому разбор по [B]/[LIST] надёжен."""
    if len(text) <= limit:
        return text
    reserve = len("…") + len("[/B][/LIST]") * 4
    cut = _BB_PARTIAL.sub("", text[: max(0, limit - reserve)]).rstrip()
    stack: list[str] = []
    for close, tag in _BB_OPEN.findall(cut):
        if not close:
            stack.append(tag)
        elif stack and stack[-1] == tag:
            stack.pop()
    out = cut + "…" + "".join(f"[/{t}]" for t in reversed(stack))
    return out[:limit] if len(out) > limit else out


def _summary(t: dict) -> dict:
    s = t.get("summary")
    return s if isinstance(s, dict) else {}


_EXTERNAL_KEY = re.compile(r"^[A-Za-z0-9:_.-]{1,128}$")   # контракт custom.calendar.comment.add


def external_key(ff_id: str) -> str:
    """Ключ идемпотентности комментария в Битриксе. Метод ищет его в тексте уже опубликованных
    комментариев события, поэтому ключ обязан входить в text (bitrix_comment_text)."""
    key = f"fireflies:{ff_id}"
    if not _EXTERNAL_KEY.match(key):
        raise StepError("Битрикс: id встречи Fireflies не годится для externalKey", permanent=True)
    return key


def bitrix_comment_text(t: dict, pmo_url: Optional[str], ext_key: Optional[str] = None) -> str:
    """Краткий формат (решение владельца): обзор + поручения + ссылки на Fireflies и совещание PMO.
    ext_key — служебная последняя строка «[I]fireflies:<id>[/I]»: по ней метод Битрикса узнаёт
    уже опубликованный комментарий (контракт: externalKey обязан входить в text)."""
    sm = _summary(t)
    parts = ["[B]Протокол встречи (Fireflies)[/B]"]
    if str(sm.get("overview") or "").strip():
        parts.append("[B]Обзор[/B]\n" + md_to_bbcode(sm.get("overview")))
    if str(sm.get("action_items") or "").strip():
        parts.append("[B]Поручения[/B]\n" + md_to_bbcode(sm.get("action_items")))
    body = _cap_bb("\n\n".join(parts), BITRIX_COMMENT_MAX - 600)
    links = []
    ff_url = _safe_url(t.get("transcript_url"))
    if ff_url:
        links.append(f"Полный протокол: [URL={ff_url}]Fireflies[/URL]")
    pm = _safe_url(pmo_url)
    if pm:
        links.append(f"Совещание в PMO: [URL={pm}]открыть[/URL]")
    if ext_key:
        links.append(f"[I]{ext_key}[/I]")
    return body + ("\n\n" + "\n".join(links) if links else "")


def pmo_minutes_text(t: dict) -> str:
    """Протокол в совещание PMO (решение владельца): notes (полный) + поручения, простым текстом."""
    sm = _summary(t)
    notes = md_to_plain(sm.get("notes")) or md_to_plain(sm.get("overview"))
    parts = [notes] if notes else []
    actions = md_to_plain(sm.get("action_items"))
    if actions:
        parts.append("Поручения:\n" + actions)
    ff_url = _safe_url(t.get("transcript_url"))
    link = f"\n\nПолный протокол в Fireflies: {ff_url}" if ff_url else ""
    return _cap("\n\n".join(parts), PMO_MINUTES_MAX - len(link)) + link


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ══════════════════════════════ Fireflies ══════════════════════════════

async def fetch_transcript(api: "PmoApi", meeting_id: str) -> dict:
    key = api.FIREFLIES_API_KEY
    if not key:
        raise StepError("Fireflies: не задан FIREFLIES_API_KEY")
    try:
        async with _client() as c:
            r = await c.post(FF_URL, json={"query": FF_QUERY, "variables": {"id": meeting_id}},
                             headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    except httpx.HTTPError as e:  # без str(e): в сообщении бывают адрес и заголовки
        raise StepError(f"Fireflies: сеть недоступна ({type(e).__name__})") from None
    if r.status_code == 429:
        try:
            wait: Optional[float] = float(r.headers.get("retry-after") or "")
        except ValueError:
            wait = None
        raise StepError("Fireflies: HTTP 429 (лимит запросов)", retry_after=wait)
    if 300 <= r.status_code < 400:
        raise StepError(f"Fireflies: HTTP {r.status_code} — редирект, не следуем")
    try:
        js = r.json()
    except ValueError:
        raise StepError(f"Fireflies: HTTP {r.status_code} без JSON") from None
    js = js if isinstance(js, dict) else {}
    errors = js.get("errors")
    if errors:
        err = errors[0] if isinstance(errors, list) and errors and isinstance(errors[0], dict) else {}
        code = str((err.get("extensions") or {}).get("code") or "error")
        permanent = code in ("object_not_found", "forbidden", "not_in_team", "require_elevated_privilege")
        raise StepError(f"Fireflies: HTTP {r.status_code} {code}", permanent=permanent)
    if r.status_code != 200:
        raise StepError(f"Fireflies: HTTP {r.status_code}")
    data = js.get("data")
    t = data.get("transcript") if isinstance(data, dict) else None
    if not isinstance(t, dict) or not t.get("id"):
        raise StepError("Fireflies: транскрипт не найден", permanent=True)
    return t


# ══════════════════════════════ Битрикс: сопоставление ══════════════════════════════

@dataclass
class BitrixMatch:
    status: str                         # 'ok' | 'skipped' (Битрикс не настроен) | 'no_calendars'
    decision: Optional[mt.Decision] = None
    calendars: list = field(default_factory=list)
    failed: list = field(default_factory=list)
    note: str = ""


def _persons(idx: dict) -> list:
    return [p for p in (idx.get("by_id") or {}).values() if p.get("is_active", True) is not False]


def _bx_id(p: Optional[dict]) -> str:
    v = str((p or {}).get("bitrix24_id") or "").strip()
    return v if v.isdigit() else ""


async def _calendars(api: "PmoApi", ff: mt.FFMeeting) -> list:
    """В чьих календарях искать: владелец встречи (email → persons, только единственное совпадение),
    участники по именам посещаемости (только единственный похожий человек), плюс доп. список."""
    persons = _persons(await api._people_index())
    out: list[str] = []
    email = (ff.owner_email or "").strip().casefold()
    if email:
        hits = [p for p in persons if str(p.get("email") or "").strip().casefold() == email]
        if len(hits) == 1:
            out.append(_bx_id(hits[0]))
    for name in ff.attendance_names:
        hits = [p for p in persons if p.get("full_name") and mt.names_match(name, p.get("full_name"))]
        if len(hits) == 1:
            out.append(_bx_id(hits[0]))
    out.extend(str(x).strip() for x in (api.FIREFLIES_EXTRA_BITRIX_USERS or ()) if str(x).strip().isdigit())
    return _uniq(out)


async def match_bitrix(api: "PmoApi", ff: mt.FFMeeting) -> BitrixMatch:
    if not api._bitrix_url():
        return BitrixMatch("skipped", note="Битрикс не настроен")
    cals = await _calendars(api, ff)
    if not cals:
        return BitrixMatch("no_calendars", note="не в чьём календаре искать: владелец и участники не найдены в справочнике")
    win = mt.search_days(ff)
    if win is None:
        return BitrixMatch("ok", mt.Decision("none", None, [], "у встречи нет времени старта"), cals)
    d_from, d_to = win[0].isoformat(), win[1].isoformat()
    raw: list[tuple[str, dict]] = []
    failed: list[str] = []
    for uid in cals:
        data, err = await api.bx_call("calendar.event.get", {"type": "user", "ownerId": uid, "from": d_from, "to": d_to})
        res = (data or {}).get("result") if not err else None
        if err or not isinstance(res, list):
            failed.append(uid)
            continue
        raw.extend((uid, e) for e in res if isinstance(e, dict))
    if len(failed) == len(cals):
        raise StepError(f"Битрикс: не прочитан ни один календарь ({len(cals)})")
    names = {k: str(v.get("full_name") or "") for k, v in ((await api._people_index()).get("by_bx") or {}).items()}
    seen: set = set()
    events: list[mt.BxEvent] = []
    for owner, e in raw:
        k = (str(e.get("ID")), str(e.get("DATE_FROM")), owner)
        if k in seen:
            continue
        seen.add(k)
        events.append(mt.BxEvent.from_api(e, owner, names))
    dec = mt.decide([mt.score(ff, ev) for ev in events], data_complete=not failed)
    return BitrixMatch("ok", dec, cals, failed)


def _iso(d: Optional[datetime]) -> Optional[str]:
    return now_iso(d) if d else None


def _bx_candidates(dec: Optional[mt.Decision]) -> list:
    if dec is None:
        return []
    out = []
    for m in dec.candidates[:3]:
        ev = m.event
        out.append({"event_id": ev.id, "parent_id": ev.parent_id, "owner_id": ev.owner_id, "name": ev.name[:120],
                    "start": _iso(ev.start),
                    "delta_min": None if m.time_delta_min == float("inf") else round(m.time_delta_min, 1),
                    "confidence": m.confidence, "link_match": m.link_match, "reasons": m.reasons[:8]})
    return out


# ══════════════════════════════ PMO ══════════════════════════════

def _meetings_of(api: "PmoApi", m: dict) -> list:
    return [x for x in api._coll(m, "_meetings") if isinstance(x, dict)]


async def pmo_targets(api: "PmoApi", ff: mt.FFMeeting, event: Optional[mt.BxEvent]) -> list:
    """Совещания PMO для протокола, по точности: уже связанное с этой встречей (fireflies_meeting_id)
    → то, для которого портал создал найденное событие (bitrix_event_id = ID/PARENT_ID) и той же
    даты → с той же ссылкой в «Месте», той же датой (Рига) и временем в ±30 мин. Совещание с той
    же ссылкой и датой, но без времени — только кандидат (via 'link_no_time'): по одной лишь
    многоразовой ссылке протокол не пишем. Совещание само НЕ создаётся никогда."""
    allowed = {str(x) for x in (api.FIREFLIES_ALLOWED_PROJECTS or ())}
    ev_ids = {x for x in ((event.id, event.parent_id) if event else ()) if x}
    day = ff.local_day
    linked: list = []
    found: dict = {}
    for e in await api.fetch_projects():
        pid = str(e.get("id"))
        m = api._meta(e)
        if not isinstance(m, dict) or m.get("_archived") or m.get("_is_template"):
            continue
        if allowed and pid not in allowed:
            continue
        meetings = _meetings_of(api, m)
        for x in meetings:
            ref = {"project_id": pid, "meeting_id": str(x.get("id") or ""), "title": str(x.get("title") or "")[:120],
                   "meeting_date": x.get("meeting_date")}
            if not ref["meeting_id"]:
                continue
            if str(x.get("fireflies_meeting_id") or "") == ff.id:
                linked.append({**ref, "via": "fireflies"})
            elif (ev_ids and str(x.get("bitrix_event_id") or "") in ev_ids
                  and day is not None and mt.pmo_meeting_day(x) == day):
                # Экземпляры серии Битрикса приходят с одним ID: без даты протокол недели 3 лёг бы
                # в совещание первой недели.
                found.setdefault((pid, ref["meeting_id"]), {**ref, "via": "bitrix_event"})
        for via, hits in (("link", mt.pmo_match(ff, meetings)), ("link_no_time", mt.pmo_match_untimed(ff, meetings))):
            for x in hits:
                mid = str(x.get("id") or "")
                if mid and str(x.get("fireflies_meeting_id") or "") != ff.id:
                    found.setdefault((pid, mid), {"project_id": pid, "meeting_id": mid, "via": via,
                                                  "title": str(x.get("title") or "")[:120],
                                                  "meeting_date": x.get("meeting_date")})
    return linked if linked else list(found.values())


def _minutes_verdict(target: Optional[dict], ff_id: str, text: str) -> str:
    """'write' | 'unchanged' | 'conflict' | 'gone'. Протокол, вписанный человеком, не трогаем:
    чужой fireflies_meeting_id, непустой протокол без нашего id, или наш текст, который правили.
    Хеш нашего текста лежит в самом совещании (fireflies_minutes_sha) и пишется той же
    version-checked записью, что и протокол: потерянная отметка шага в очереди не превратит
    наш текст в «чужой», а правка человека не пропадёт под resend."""
    if target is None:
        return "gone"
    cur_ff = str(target.get("fireflies_meeting_id") or "")
    cur = str(target.get("minutes_content") or "")
    if cur_ff and cur_ff != ff_id:
        return "conflict"
    if not cur_ff and cur.strip():
        return "conflict"
    if cur_ff == ff_id and cur.strip():
        if cur == text:
            return "unchanged"
        if _sha(cur) != str(target.get("fireflies_minutes_sha") or ""):
            return "conflict"
    return "write"


def _find(api: "PmoApi", m: dict, mid: str) -> Optional[dict]:
    return next((x for x in _meetings_of(api, m) if str(x.get("id") or "") == mid), None)


async def write_minutes(api: "PmoApi", pid: str, mid: str, ff_id: str, t: dict, text: str) -> str:
    _, m0 = await api.load_meta(pid)
    verdict = _minutes_verdict(_find(api, m0, mid), ff_id, text)
    if verdict != "write":
        return verdict   # ничего не пишем: ни версии, ни журнала
    url = _safe_url(t.get("transcript_url"))

    def mut(m: dict) -> str:
        target = _find(api, m, mid)
        v = _minutes_verdict(target, ff_id, text)
        if v != "write" or target is None:
            # На повторной попытке (после конфликта версии) писать стало нечего: выходим ДО
            # update_project_meta — холостая запись подняла бы версию проекта и дала бы ложный 409
            # человеку, правящему проект параллельно.
            raise _NoWrite(v)
        target["minutes_content"] = text
        target["fireflies_meeting_id"] = ff_id
        target["transcript_url"] = url
        target["fireflies_minutes_sha"] = _sha(text)
        api._log_action(m, ACTOR, "meetings.fireflies", f"{target.get('title') or mid}: протокол из Fireflies")
        return "done"

    try:
        return await api.with_meta_retry(pid, mut)
    except _NoWrite as nw:
        return nw.verdict


# ══════════════════════════════ прогон одной встречи ══════════════════════════════

_BX_REJECTED = re.compile(r"^[A-Z][A-Z0-9_]{2,}:")   # «КОД_ОШИБКИ: описание» — ответ самого Битрикса


def _bx_not_posted(err: str) -> bool:
    """Ошибка bx_call, при которой комментария точно нет: Битрикс ответил кодом ошибки, портал не
    настроен или соединение не установилось. Таймаут чтения, пустой ответ и прочее — исход
    неизвестен (комментарий мог появиться)."""
    return bool(_BX_REJECTED.match(err)) or err.startswith("Bitrix24 не настроен") or err == "ConnectTimeout"


# Коды ошибок custom.calendar.comment.* (RestException), при которых повтор бессмыслен: нужен
# человек. FORUM (сбой записи форума) и сетевые ошибки — повтор с паузой, как прежде.
BX_COMMENT_PERMANENT = {
    "ARGUMENT": "неверные параметры вызова",
    "NOT_FOUND": "событие календаря не найдено",
    "FORBIDDEN": "у пользователя вебхука нет прав администратора",
    "CONFIG": "в модуле custom.main не задан автор комментариев или форум",
}


def _bx_error_code(err: str) -> str:
    m = _BX_REJECTED.match(err)
    return err[: m.end() - 1] if m else ""


def _event_local_date(event: mt.BxEvent) -> Optional[str]:
    """Дата экземпляра для метода: дата из DATE_FROM по часам TZ_FROM события (не по Риге) —
    по ней Битрикс строит тему экземпляра EVENT_<id>_<дата>. Есть и у события на весь день.
    Запасной путь (day не разобран) — рижская дата старта."""
    if event.day:
        return event.day
    return event.start.astimezone(mt.RIGA).date().isoformat() if event.start else None


def _pmo_url(api: "PmoApi", pid: Optional[str]) -> Optional[str]:
    return f"{str(api.PORTAL_PUBLIC_URL).rstrip('/')}/projects/{pid}/meetings" if pid else None


async def _run(api: "PmoApi", row: dict) -> dict:
    """Шаги одной встречи. Готовые шаги (done) не повторяются. Возвращает итоговые поля строки."""
    mid = row["meeting_id"]

    async def upd(fields: dict, now: str) -> None:
        # Отметки шагов — с той же защитой, что и итог: пришёл resend — этот прогон устарел.
        if not await api.db.fireflies_sync_update(mid, fields, now, expect_reprocessed=row.get("reprocessed_at")):
            raise Superseded()

    t = await fetch_transcript(api, mid)
    status = str((t.get("meeting_info") or {}).get("summary_status") or "")
    if status in ("failed", "skipped"):
        return {"status": "skipped", "reason": f"Fireflies: протокола не будет (summary_status={status})"}
    if status != "processed":
        raise StepError(f"Fireflies: протокол ещё не готов (summary_status={status or '—'})")
    privacy = str(t.get("privacy") or "").strip().lower()
    if privacy not in PUBLIC_PRIVACY:
        # Владелец ограничил доступ в Fireflies (owner/participants/…): совещание PMO видят команда
        # и наблюдатели проекта, комментарий в Битриксе — все приглашённые. Не публикуем.
        return {"status": "skipped", "reason": f"Fireflies: приватная встреча (privacy={privacy[:40] or '—'})"}
    ff = mt.FFMeeting.from_api(t)
    hosts = tuple(api.FIREFLIES_ALLOWED_HOSTS or ())
    if hosts and (ff.owner_email or "").strip().lower() not in hosts:
        return {"status": "skipped", "reason": "владелец встречи не в FIREFLIES_ALLOWED_HOSTS"}
    if not any(str(_summary(t).get(k) or "").strip() for k in ("notes", "overview", "action_items")):
        return {"status": "skipped", "reason": "Fireflies: протокол пуст"}

    # 1. Битрикс: сопоставление (только чтение календарей)
    bx = await match_bitrix(api, ff)
    dec = bx.decision
    event = dec.best.event if dec is not None and dec.kind == "publish" and dec.best is not None else None

    # 2. PMO: протокол в совещание. Порядок записи: намерение → запись → id/хеш результата.
    pmo_status = row.get("pmo_status")
    pid, pmid = row.get("pmo_project_id"), row.get("pmo_meeting_id")
    pmo_cands: list = []
    pmo_note = ""
    if pmo_status != "done":
        targets = await pmo_targets(api, ff, event)
        if len(targets) == 1 and targets[0].get("via") == "link_no_time":
            pmo_status, pmo_cands = "unmatched", targets
            pmo_note = "PMO: совещание с той же ссылкой и датой, но без времени — по одной ссылке не пишем"
            pid = pmid = None
        elif len(targets) == 1:
            pid, pmid = targets[0]["project_id"], targets[0]["meeting_id"]
            text = pmo_minutes_text(t)
            await upd({"pmo_status": "writing", "pmo_project_id": pid, "pmo_meeting_id": pmid}, now_iso())
            res = await write_minutes(api, pid, pmid, ff.id, t, text)
            if res in ("done", "unchanged"):
                pmo_status = "done"
                await upd({"pmo_status": "done"}, now_iso())
            elif res == "gone":
                raise StepError("PMO: совещание исчезло между чтением и записью")
            else:
                pmo_status, pmo_note = "conflict", "PMO: в совещании уже есть протокол, вписанный человеком"
                pmo_cands = targets
        elif targets:
            pmo_status, pmo_note, pmo_cands = "unmatched", f"PMO: подходят {len(targets)} совещания", targets
            pid = pmid = None
        else:
            pmo_status, pmo_note = "none", "PMO: совещания с этой встречей нет — только Битрикс"
            pid = pmid = None

    # 3. Битрикс: комментарий к событию. Намерение (posting + id события) → вызов → id комментария.
    bitrix_status = row.get("bitrix_status")
    comment_id = row.get("bitrix_comment_id")
    event_id = row.get("bitrix_event_id")
    bx_note = ""
    if bitrix_status == "posting":
        # Намерение записано, а исхода вызова нет (таймаут, падение воркера, потерянная отметка):
        # комментарий мог уже появиться. Вслепую НЕ публикуем — ни в сохранённое событие, ни тем
        # более в заново найденное (оно могло смениться). Идемпотентность метода по externalKey —
        # пока предположение. Решает человек: проверить событие и повторить с bitrix_reset=true.
        bx_note = (f"Битрикс: исход публикации комментария к событию {event_id or '—'} неизвестен — "
                   "проверьте событие; если комментария нет, повтор с bitrix_reset=true")
    elif bitrix_status != "done":
        if bx.status == "skipped":
            bitrix_status = "skipped"
        elif event is None:
            bitrix_status = "unmatched"
        else:
            # ID найденного экземпляра (копия участника или событие организатора): метод сам
            # приводит его к PARENT_ID; дата выбирает экземпляр повторяющейся встречи.
            event_id = event.id
            if not api.FIREFLIES_BITRIX_COMMENTS:
                bitrix_status = "waiting_method"
            else:
                ext_key = external_key(ff.id)
                text = bitrix_comment_text(t, _pmo_url(api, pid) if pmo_status == "done" else None, ext_key)
                payload: dict = {"eventId": event_id, "text": text, "externalKey": ext_key}
                ev_date = _event_local_date(event)
                if ev_date:
                    payload["date"] = ev_date
                await upd({"bitrix_status": "posting", "bitrix_event_id": event_id}, now_iso())
                data, err = await api.bx_call(BITRIX_COMMENT_METHOD, payload)
                if err:
                    if _bx_not_posted(err):
                        # Битрикс ответил отказом (код ошибки) или вызов не ушёл: комментария точно
                        # нет — снимаем намерение, следующий прогон опубликует. Отметка — без
                        # проверки reprocessed_at: это факт о Битриксе, а не итог прогона.
                        await api.db.fireflies_sync_update(mid, {"bitrix_status": None}, now_iso())
                    code = _bx_error_code(err)
                    if code in BX_COMMENT_PERMANENT:
                        # Повтор не поможет: в failed с понятной причиной, разбирает человек.
                        raise StepError(f"Битрикс {BITRIX_COMMENT_METHOD}: {BX_COMMENT_PERMANENT[code]} "
                                        f"(событие {event_id}) — {err}"[:300], permanent=True)
                    raise StepError(f"Битрикс {BITRIX_COMMENT_METHOD}: {err}"[:300])
                res = (data or {}).get("result")
                res = res if isinstance(res, dict) else {}
                cid = res.get("id")
                if not cid or isinstance(cid, bool) or res.get("status") not in ("created", "exists"):
                    raise StepError(f"Битрикс {BITRIX_COMMENT_METHOD}: ответ без id комментария "
                                    "или с неизвестным status")
                comment_id, bitrix_status = str(cid), "done"   # 'exists' — тоже успех (идемпотентность)
                if res.get("eventId") and not isinstance(res.get("eventId"), bool):
                    event_id = str(res["eventId"])               # PARENT_ID, к которому лёг комментарий
                # Комментарий уже существует: отметка — СРАЗУ и без проверки reprocessed_at. Пришёл
                # resend посреди прогона — итог прогона отбросится, но этот факт терять нельзя,
                # иначе следующий прогон опубликовал бы второй комментарий.
                await api.db.fireflies_sync_update(mid, {"bitrix_status": "done", "bitrix_comment_id": comment_id,
                                                         "bitrix_event_id": event_id}, now_iso())

    if pmo_status == "conflict" or bitrix_status == "posting":
        overall = "conflict"
    elif pmo_status == "unmatched" or bitrix_status == "unmatched":
        overall = "unmatched"
    else:
        overall = "done"
    bx_reason = f"Битрикс: {dec.reason}" if dec is not None else (f"Битрикс: {bx.note}" if bx.note else "")
    reason = "; ".join(r for r in (bx_note, bx_reason, pmo_note) if r)
    published = dec is not None and dec.kind == "publish"
    return {
        "status": overall, "pmo_status": pmo_status, "bitrix_status": bitrix_status,
        "decision": dec.kind if dec is not None else None, "basis": (dec.basis or None) if dec is not None else None,
        "reason": reason[:500] or None,
        "pmo_project_id": pid, "pmo_meeting_id": pmid,
        "bitrix_event_id": event_id, "bitrix_comment_id": comment_id,
        "candidates": {"bitrix": [] if published else _bx_candidates(dec), "pmo": pmo_cands},
    }


async def process_one(api: "PmoApi", row: dict, now: Optional[datetime] = None) -> str:
    """Одна встреча из очереди: шаги → итог в строку (с защитой от гонки с resend) → статус."""
    mid = str(row["meeting_id"])
    started = now or datetime.now(timezone.utc)
    try:
        fields = await _run(api, row)
        fields.update({"attempts": 0, "next_attempt_at": None, "last_error": None})
    except Superseded:
        api.logger.info("Fireflies: встреча %s — пока шла обработка, пришла правка заметок; повторим", mid)
        return "superseded"
    except Exception as e:  # noqa: BLE001 — любая ошибка = повтор с паузой; текст — только наш
        se = e if isinstance(e, StepError) else StepError(f"внутренняя ошибка ({type(e).__name__})")
        attempts = int(row.get("attempts") or 0) + 1
        if se.permanent or attempts > len(RETRY_DELAYS_MIN):
            fields = {"status": "failed", "attempts": attempts, "next_attempt_at": None, "last_error": str(se)[:300]}
            api.logger.warning("Fireflies: встреча %s — failed после %d попыток, нужен разбор", mid, attempts)
        else:
            delay = max(RETRY_DELAYS_MIN[attempts - 1] * 60.0, float(se.retry_after or 0))
            fields = {"status": "received", "attempts": attempts,
                      "next_attempt_at": now_iso(started + timedelta(seconds=delay)), "last_error": str(se)[:300]}
            api.logger.info("Fireflies: встреча %s — повтор %d через %.0f мин", mid, attempts, delay / 60)
    written = await api.db.fireflies_sync_update(mid, fields, now_iso(), expect_reprocessed=row.get("reprocessed_at"))
    if not written:
        api.logger.info("Fireflies: встреча %s — пока шла обработка, пришла правка заметок; повторим", mid)
    else:
        api.logger.info("Fireflies: встреча %s — %s (PMO %s, Битрикс %s)", mid, fields.get("status"),
                        fields.get("pmo_status") or "—", fields.get("bitrix_status") or "—")
    return str(fields.get("status"))


async def run_due(api: "PmoApi", limit: int = 20) -> dict:
    """Джоба планировщика (раз в минуту, под advisory-lock): разобрать подошедшие строки очереди."""
    if not api.FIREFLIES_ENABLED:
        return {"skipped": "disabled"}
    waiting = bool(api.FIREFLIES_BITRIX_COMMENTS)
    now = datetime.now(timezone.utc)
    stats: dict = {}
    for r in await api.db.fireflies_sync_due(now_iso(now), limit, waiting):
        lease = now_iso(now + timedelta(minutes=LEASE_MIN))
        row = await api.db.fireflies_sync_claim(r["meeting_id"], now_iso(), lease, waiting)
        if not row:
            continue
        st = await process_one(api, row)
        stats[st] = stats.get(st, 0) + 1
    return stats
