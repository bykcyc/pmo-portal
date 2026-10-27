"""Ядро сопоставления встреч Fireflies с событиями Битрикса и совещаниями PMO.

Перенесено из прототипа meeting-sync (prototype/matching.py) без изменения логики.
Только чистые функции и dataclasses: без I/O, без сети, без секретов — сеть и БД
живут в fireflies_sync.py.

Правило «не уверен — не публикуй» (решение владельца), decide():
  * basis 'link'   — ссылка на видеовстречу совпала + старт ±30 мин + в окне нет второго
                     события с той же ссылкой;
  * basis 'strong' — без ссылки: старт ±10 мин, ≥80 % имён посещаемости среди участников
                     (минимум 3 имени), число участников ±1, в событии нет ссылки ДРУГОЙ встречи,
                     других кандидатов в ±30 мин нет;
  * иначе 'queue' (топ-3 кандидата) или 'none'; не все календари прочитаны → 'queue'.
Время события Битрикса — DATE_FROM в поясе TZ_FROM; DATE_FROM_TS_UTC не используется
(бывает сдвинут на −3 ч, у серий — старт серии). Экземпляры серии приходят с одним ID.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from urllib.parse import parse_qs, unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

RIGA = ZoneInfo("Europe/Riga")
UTC = timezone.utc

# Пороги (минуты) и веса — держим на виду, формула прозрачная.
STRONG_MIN = 10.0
WEAK_MIN = 30.0
MAX_NO_LINK_MIN = 90.0
PUBLISH_MAX_MIN = 30.0
# Сильное совпадение без ссылки (решение владельца): время ±10 мин, ≥80% имён (минимум 3),
# число участников ±1, ссылки другой встречи в событии нет, второго кандидата в ±30 мин нет.
STRONG_NAMES_SHARE = 0.8
STRONG_MIN_NAMES = 3
STRONG_COUNT_DIFF = 1

W_LINK = 0.60
W_TIME_STRONG = 0.25
W_TIME_WEAK = 0.15
W_TIME_FAR = 0.05
W_NAMES = 0.10
W_COUNT = 0.03
W_TITLE = 0.02


# --------------------------------------------------------------------------
# Ссылки на видеовстречи
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class MeetingKey:
    platform: str  # 'zoom' | 'meet' | 'teams'
    id: str

    @property
    def tail(self) -> str:
        """Хвост ключа для отчёта (последние 4 символа)."""
        return self.id[-4:]


_ZOOM_PATHS = (  # путь сравнивается в нижнем регистре; после цифр — «/» или конец
    re.compile(r"^/j/(\d+)(?:/|$)"),
    re.compile(r"^/w/(\d+)(?:/|$)"),
    re.compile(r"^/s/(\d+)(?:/|$)"),
    re.compile(r"^/wc/join/(\d+)(?:/|$)"),
    re.compile(r"^/wc/(\d+)/join(?:/|$)"),
)
_ZOOM_ID = re.compile(r"^\d{9,13}$")  # ID встречи Zoom: 9–11 цифр (с запасом)
_MEET_CODE = re.compile(r"^/([a-z]{3}-[a-z]{4}-[a-z]{3})/?$")
_TEAMS_THREAD = re.compile(r"^19:[^/@\s]+@thread\.[a-z0-9]+$")
_TRAIL = ".,;:!?)]}>'\"»"


def _is_zoom_host(host: str) -> bool:
    return (
        host == "zoom.us"
        or host.endswith(".zoom.us")
        or host == "zoomgov.com"
        or host.endswith(".zoomgov.com")
    )


def normalize_link(url: Optional[str], _depth: int = 0) -> Optional[MeetingKey]:
    """Ссылка на встречу -> MeetingKey (ID встречи на платформе) или None."""
    if not url or not isinstance(url, str) or _depth > 3:
        return None
    s = html.unescape(url.strip()).strip(_TRAIL + " \t\r\n")
    if not s:
        return None
    low = s.lower()

    # zoommtg://zoom.us/join?confno=123...
    if low.startswith("zoommtg://"):
        q = parse_qs(urlsplit(s).query)
        confno = (q.get("confno") or [""])[0]
        return MeetingKey("zoom", confno) if _ZOOM_ID.match(confno) else None

    if "://" not in s:
        if re.match(r"^[\w.-]+\.[a-z]{2,}/", low):
            s = "https://" + s
        else:
            return None
    try:
        parts = urlsplit(s)
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path or "/"

    # Обёртка Outlook Safe Links
    if host.endswith("safelinks.protection.outlook.com"):
        inner = (parse_qs(parts.query).get("url") or [""])[0]
        return normalize_link(inner, _depth + 1)

    if _is_zoom_host(host):
        for rx in _ZOOM_PATHS:
            m = rx.match(path.lower())
            if m and _ZOOM_ID.match(m.group(1)):
                return MeetingKey("zoom", m.group(1))
        return None

    if host == "meet.google.com":
        m = _MEET_CODE.match(path.lower())
        return MeetingKey("meet", m.group(1)) if m else None

    if host in ("teams.microsoft.com", "teams.live.com"):
        # /meet/<цифры>
        m = re.match(r"^/meet/(\d+)", path)
        if m:
            return MeetingKey("teams", "meet:" + m.group(1))
        # /l/meetup-join/<thread>/... ; бывает во фрагменте: /v2/?meetingjoin=true#/l/meetup-join/...
        cand = path
        if "/l/meetup-join/" not in cand and parts.fragment:
            cand = parts.fragment
        idx = cand.find("/l/meetup-join/")
        if idx >= 0:
            seg = cand[idx + len("/l/meetup-join/"):].split("/", 1)[0]
            thread = seg
            for _ in range(2):
                if "%" in thread:
                    thread = unquote(thread)
            thread = thread.strip().lower()
            if _TEAMS_THREAD.match(thread):
                return MeetingKey("teams", thread)
        return None

    return None


_URL_RX = re.compile(
    r"(?:https?://|zoommtg://)[^\s<>\"'\[\]]+"
    r"|(?<![\w/.@-])(?:[\w-]+\.)*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)/[^\s<>\"'\[\]]+",
    re.IGNORECASE,
)
_BB_URL_ATTR = re.compile(r"\[url=([\"']?)(.+?)\1\]", re.IGNORECASE | re.DOTALL)
_BB_URL_BODY = re.compile(r"\[url\](.+?)\[/url\]", re.IGNORECASE | re.DOTALL)
_HREF = re.compile(r"href\s*=\s*([\"'])(.+?)\1", re.IGNORECASE | re.DOTALL)


def extract_links(text: Optional[str]) -> list[MeetingKey]:
    """Все ссылки на видеовстречи в тексте (простой текст, BB-код, HTML), без дублей, по порядку."""
    if not text:
        return []
    s = str(text)
    for _ in range(2):  # &amp;amp; -> &amp; -> &
        s2 = html.unescape(s)
        if s2 == s:
            break
        s = s2
    found: list[tuple[int, str]] = []
    for rx, grp in ((_BB_URL_ATTR, 2), (_BB_URL_BODY, 1), (_HREF, 2)):
        for m in rx.finditer(s):
            found.append((m.start(grp), m.group(grp)))
    for m in _URL_RX.finditer(s):
        found.append((m.start(), m.group(0)))
    found.sort(key=lambda x: x[0])
    out: list[MeetingKey] = []
    seen: set[MeetingKey] = set()
    for _, raw in found:
        key = normalize_link(raw)
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


# --------------------------------------------------------------------------
# Имена
# --------------------------------------------------------------------------

_LV = str.maketrans({
    "ā": "a", "č": "c", "ē": "e", "ģ": "g", "ī": "i", "ķ": "k",
    "ļ": "l", "ņ": "n", "š": "s", "ū": "u", "ž": "z", "ō": "o", "ŗ": "r",
})
_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "z", "з": "z", "и": "i", "й": "j", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "ш": "s", "щ": "s", "ъ": "",
    "ы": "i", "ь": "", "э": "e", "ю": "ju", "я": "ja",
}
_RU_TR = str.maketrans(_RU)


# е/ё в начале слова и после гласной/ь/ъ звучат «йе/йо» — латышское написание je/jo
# (Евгений -> jevgenij ~ Jevgenijs, Егор -> jegor ~ Jegors, Андреев -> andrejev).
_RU_IOTATED = re.compile(r"(?:(?<![а-яё])|(?<=[аеёиоуыэюяьъ]))([её])")


def _translit(s: str) -> str:
    t = s.lower().translate(_LV)
    t = _RU_IOTATED.sub(lambda m: "je" if m.group(1) == "е" else "jo", t)
    return t.translate(_RU_TR)


def name_tokens(s: Optional[str]) -> frozenset[str]:
    if not s:
        return frozenset()
    t = _translit(str(s))
    return frozenset(tok for tok in re.split(r"[^a-z0-9]+", t) if len(tok) >= 3)


def _levenshtein_le1(a: str, b: str) -> bool:
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        return sum(1 for x, y in zip(a, b) if x != y) <= 1
    if la > lb:
        a, b = b, a
    # b длиннее на 1: одна вставка
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    return a[i:] == b[i + 1:]


def _tok_eq(a: str, b: str, _strip_j: bool = True) -> bool:
    if a == b:
        return True
    # запасной путь: начальная «j» (Jegors ↔ Egor, если транслит дал «e»)
    if _strip_j and (a[:1] == "j") != (b[:1] == "j"):
        a2 = a[1:] if a[:1] == "j" else a
        b2 = b[1:] if b[:1] == "j" else b
        if len(a2) >= 3 and len(b2) >= 3 and _tok_eq(a2, b2, False):
            return True
    # префикс: «общая длина ≥4» трактуем как «короткий токен ≥4» (Jurij ↔ Jurijs)
    if min(len(a), len(b)) >= 4 and (a.startswith(b) or b.startswith(a)):
        return True
    if min(len(a), len(b)) >= 5 and _levenshtein_le1(a, b):
        return True
    return False


def names_match(a: Optional[str], b: Optional[str]) -> bool:
    """Похоже ли, что это один человек.

    Совпадение токенов: равны / префикс (короткий ≥4) / Левенштейн ≤1 (длина ≥5).
    Если у обоих имён ≥2 токенов, одного совпавшего токена мало (тёзки): нужны 2 совпадения,
    либо 1 совпадение + среди оставшихся короткий токен (≤4, уменьшительное: Jura ↔ Jurijs)
    с общими первыми 3 буквами. Две длинные разные фамилии (Sidorenko ↔ Sidorovs) — не совпадение.
    """
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    pairs = [(x, y) for x in ta for y in tb if _tok_eq(x, y)]
    if not pairs:
        return False
    if len(ta) < 2 or len(tb) < 2:
        return True
    used_a = {x for x, _ in pairs}
    used_b = {y for _, y in pairs}
    if len(used_a) >= 2 and len(used_b) >= 2:
        return True
    rest_a, rest_b = ta - used_a, tb - used_b
    return any(min(len(x), len(y)) <= 4 and x[:3] == y[:3] for x in rest_a for y in rest_b)


# --------------------------------------------------------------------------
# Время события Битрикса
# --------------------------------------------------------------------------

def _bx_parse(value: Any, tz_name: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    naive = None
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p"):
        try:
            naive = datetime.strptime(v, fmt)
            break
        except ValueError:
            continue
    if naive is None:
        return None
    try:
        tz = ZoneInfo(tz_name) if tz_name else RIGA
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        tz = RIGA
    return naive.replace(tzinfo=tz).astimezone(UTC)


def bitrix_event_start(event: dict) -> Optional[datetime]:
    """Старт события (aware UTC) из DATE_FROM в поясе TZ_FROM. Весь день -> None.

    DATE_FROM_TS_UTC не используется: бывает сдвинут на −3 ч, у серии — старт серии.
    """
    if str(event.get("DT_SKIP_TIME") or "").upper() == "Y":
        return None
    return _bx_parse(event.get("DATE_FROM"), event.get("TZ_FROM"))


def bitrix_event_day(event: dict) -> Optional[str]:
    """Дата экземпляра (YYYY-MM-DD) прямо из DATE_FROM — по часам TZ_FROM, без перевода в Ригу.

    Так её считает Битрикс (EVENT_<id>_<дата> в GetEventCommentXmlId) и метод
    custom.calendar.comment.add. Есть и у события на весь день.
    """
    v = event.get("DATE_FROM")
    if not v or not isinstance(v, str):
        return None
    head = v.strip().split(" ", 1)[0]
    for fmt in ("%d.%m.%Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(head, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def bitrix_event_end(event: dict) -> Optional[datetime]:
    if str(event.get("DT_SKIP_TIME") or "").upper() == "Y":
        return None
    return _bx_parse(event.get("DATE_TO"), event.get("TZ_TO") or event.get("TZ_FROM"))


# --------------------------------------------------------------------------
# Модель
# --------------------------------------------------------------------------

def parse_iso(s: Any) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    v = s.strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(v)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.astimezone(UTC)


@dataclass(frozen=True)
class FFMeeting:
    id: str
    start: Optional[datetime]  # фактический старт (dateString), UTC
    duration_min: float = 0.0
    meeting_link: Optional[str] = None
    owner_email: Optional[str] = None
    title: str = ""
    attendance_names: tuple[str, ...] = ()

    @property
    def key(self) -> Optional[MeetingKey]:
        return normalize_link(self.meeting_link)

    @property
    def local_day(self) -> Optional[date]:
        return self.start.astimezone(RIGA).date() if self.start else None

    @classmethod
    def from_api(cls, t: dict) -> "FFMeeting":
        start = parse_iso(t.get("dateString"))
        if start is None and isinstance(t.get("date"), (int, float)):
            start = datetime.fromtimestamp(t["date"] / 1000, tz=UTC)  # округлён до слота
        owner = ((t.get("user") or {}).get("email")) or t.get("organizer_email")
        names = []
        for a in t.get("meeting_attendance") or []:
            n = (a or {}).get("name")
            if n and n not in names:
                names.append(n)
        try:
            dur = float(t.get("duration") or 0)
        except (TypeError, ValueError):
            dur = 0.0
        return cls(
            id=str(t.get("id") or ""),
            start=start,
            duration_min=dur,
            meeting_link=t.get("meeting_link"),
            owner_email=owner,
            title=str(t.get("title") or ""),
            attendance_names=tuple(names),
        )


@dataclass(frozen=True)
class BxEvent:
    id: str
    parent_id: str
    name: str
    start: Optional[datetime]  # UTC; None = весь день
    location: str = ""
    description: str = ""
    attendee_ids: tuple[str, ...] = ()
    attendee_names: tuple[str, ...] = ()
    owner_id: str = ""
    rrule: bool = False
    day: Optional[str] = None  # дата экземпляра из DATE_FROM (часы TZ_FROM), есть и у «весь день»

    @property
    def identity(self) -> tuple[str, Optional[datetime]]:
        """Одна и та же встреча в разных календарях: родитель + экземпляр (старт)."""
        return (self.parent_id or self.id, self.start)

    @property
    def links(self) -> list[MeetingKey]:
        return extract_links((self.location or "") + "\n" + (self.description or ""))

    @classmethod
    def from_api(cls, e: dict, owner_id: str = "", names_by_id: Optional[dict] = None) -> "BxEvent":
        names_by_id = names_by_id or {}
        ids = []
        for a in e.get("ATTENDEE_LIST") or []:
            aid = str((a or {}).get("id") or "")
            if aid and aid not in ids:
                ids.append(aid)
        return cls(
            id=str(e.get("ID") or ""),
            parent_id=str(e.get("PARENT_ID") or ""),
            name=str(e.get("NAME") or ""),
            start=bitrix_event_start(e),
            location=str(e.get("LOCATION") or ""),
            description=str(e.get("DESCRIPTION") or ""),
            attendee_ids=tuple(ids),
            attendee_names=tuple(names_by_id[i] for i in ids if names_by_id.get(i)),
            owner_id=str(owner_id or ""),
            rrule=bool(e.get("RRULE")),
            day=bitrix_event_day(e),
        )


@dataclass
class Match:
    event: BxEvent
    confidence: float
    reasons: list[str] = field(default_factory=list)
    link_match: bool = False
    time_delta_min: float = float("inf")  # |Δt| в минутах; inf — время неизвестно
    names_hit: int = 0      # имён посещаемости FF, найденных среди участников события
    names_total: int = 0    # имён посещаемости FF (непустых)
    ff_count: int = 0       # участников по посещаемости FF
    ev_count: int = 0       # участников события
    other_link: bool = False  # в событии ссылка ДРУГОЙ встречи

    @property
    def is_candidate(self) -> bool:
        return self.link_match or self.time_delta_min <= MAX_NO_LINK_MIN

    @property
    def is_strong(self) -> bool:
        """Сильное совпадение без ссылки: время, имена, число участников; ссылка другой встречи — запрет."""
        return (not self.link_match and not self.other_link
                and self.time_delta_min <= STRONG_MIN
                and self.names_total >= STRONG_MIN_NAMES
                and self.names_hit / self.names_total >= STRONG_NAMES_SHARE
                and self.ev_count > 0 and abs(self.ff_count - self.ev_count) <= STRONG_COUNT_DIFF)


@dataclass
class Decision:
    kind: str  # 'publish' | 'queue' | 'none'
    best: Optional[Match]
    candidates: list[Match]
    reason: str
    basis: str = ""  # для publish: 'link' (ссылка + время) | 'strong' (сильное совпадение без ссылки)


# --------------------------------------------------------------------------
# Оценка и решение
# --------------------------------------------------------------------------

def _names_share(ff_names: Iterable[str], ev_names: Iterable[str]) -> tuple[int, int]:
    ffl = [n for n in ff_names if name_tokens(n)]
    evl = list(ev_names)
    hit = sum(1 for n in ffl if any(names_match(n, m) for m in evl))
    return hit, len(ffl)


def score(ff: FFMeeting, ev: BxEvent) -> Match:
    reasons: list[str] = []
    conf = 0.0

    key = ff.key
    link_match = bool(key and key in ev.links)
    if link_match and key is not None:
        conf += W_LINK
        reasons.append("ссылка совпала ({} …{})".format(key.platform, key.tail))

    if ff.start is None or ev.start is None:
        dt = float("inf")
        reasons.append("событие на весь день — время не сравнить" if ev.start is None else "нет времени встречи Fireflies")
    else:
        dt = abs((ev.start - ff.start).total_seconds()) / 60.0
        if dt <= STRONG_MIN:
            conf += W_TIME_STRONG
            reasons.append("время ±{:.0f} мин (сильно)".format(dt))
        elif dt <= WEAK_MIN:
            conf += W_TIME_WEAK
            reasons.append("время ±{:.0f} мин (слабо)".format(dt))
        elif dt <= MAX_NO_LINK_MIN:
            conf += W_TIME_FAR
            reasons.append("время ±{:.0f} мин (далеко)".format(dt))
        else:
            reasons.append("время ±{:.0f} мин (вне окна)".format(dt))

    if not link_match and dt > MAX_NO_LINK_MIN:
        return Match(ev, 0.0, reasons + ["не кандидат"], False, dt)

    hit, total = _names_share(ff.attendance_names, ev.attendee_names)
    if total and ev.attendee_names:
        conf += W_NAMES * hit / total
        reasons.append("имена: {}/{} совпали".format(hit, total))

    a, b = len(ff.attendance_names), len(ev.attendee_ids)
    if a and b:
        closeness = 1.0 - abs(a - b) / max(a, b)
        conf += W_COUNT * closeness
        reasons.append("участников: FF {} / событие {}".format(a, b))

    ta, tb = name_tokens(ff.title), name_tokens(ev.name)
    if ta and tb:
        j = len(ta & tb) / len(ta | tb)
        if j > 0:
            conf += W_TITLE * j
            reasons.append("название похоже ({:.0%})".format(j))

    other_link = bool(not link_match and key and ev.links)
    if not link_match:
        reasons.append("ссылки нет в событии" if not ev.links else "в событии другая ссылка")
    return Match(ev, round(min(conf, 1.0), 3), reasons, link_match, dt,
                 names_hit=hit, names_total=total, ff_count=a, ev_count=b, other_link=other_link)


def _dedupe(matches: Iterable[Match]) -> list[Match]:
    """Одна встреча в календарях разных людей (родитель + копии) -> одна запись (предпочтение родителю)."""
    best: dict[tuple, Match] = {}
    for m in matches:
        k = m.event.identity
        cur = best.get(k)
        if cur is None:
            best[k] = m
            continue
        cur_parent = cur.event.id == cur.event.parent_id
        new_parent = m.event.id == m.event.parent_id
        if (new_parent and not cur_parent) or (new_parent == cur_parent and m.confidence > cur.confidence):
            best[k] = m
    return list(best.values())


def decide(matches: Iterable[Match], data_complete: bool = True) -> Decision:
    """data_complete=False (не все календари прочитаны) -> 'publish' понижается до 'queue'."""
    d = _decide(matches)
    if not data_complete and d.kind == "publish":
        return Decision("queue", d.best, d.candidates, d.reason + "; но данные неполные (часть календарей не прочитана) — не публикуем")
    return d


def search_days(ff: "FFMeeting", margin_min: float = MAX_NO_LINK_MIN) -> Optional[tuple[date, date]]:
    """Диапазон дней (Рига) для calendar.event.get: [старт−90 мин; конец+90 мин], to = последний день + 1."""
    if ff.start is None:
        return None
    lo = (ff.start - timedelta(minutes=margin_min)).astimezone(RIGA).date()
    hi = (ff.start + timedelta(minutes=(ff.duration_min or 0) + margin_min)).astimezone(RIGA).date()
    return lo, hi + timedelta(days=1)


def _decide(matches: Iterable[Match]) -> Decision:
    cands = [m for m in _dedupe(matches) if m.is_candidate]
    if not cands:
        return Decision("none", None, [], "нет событий ни по ссылке, ни по времени (±{:.0f} мин)".format(MAX_NO_LINK_MIN))
    cands.sort(key=lambda m: (-m.confidence, m.time_delta_min))
    best = cands[0]
    top = cands[:3]
    in_window = [m for m in cands if m.link_match and m.time_delta_min <= PUBLISH_MAX_MIN]
    if best.link_match and best.time_delta_min <= PUBLISH_MAX_MIN:
        if len(in_window) == 1:
            others = [m for m in cands if m.link_match and m is not best]
            extra = " (ещё {} экз. серии вне окна)".format(len(others)) if others else ""
            return Decision("publish", best, [best], "ссылка + время ±{:.0f} мин, единственный кандидат{}".format(best.time_delta_min, extra), "link")
        return Decision("queue", best, in_window[:3], "{} событий с той же ссылкой в окне ±{:.0f} мин — неоднозначно".format(len(in_window), PUBLISH_MAX_MIN))
    if best.link_match:
        return Decision("queue", best, top, "ссылка совпала, но время ±{} — не публикуем".format(
            "?" if best.time_delta_min == float("inf") else "{:.0f} мин".format(best.time_delta_min)))
    strong = [m for m in cands if m.is_strong]
    if strong:
        s = min(strong, key=lambda m: m.time_delta_min)
        rivals = [m for m in cands if m is not s and m.time_delta_min <= PUBLISH_MAX_MIN]
        if not rivals:
            return Decision("publish", s, [s], "сильное совпадение без ссылки: время ±{:.0f} мин, имена {}/{}, участников {}/{}, других событий в ±{:.0f} мин нет".format(
                s.time_delta_min, s.names_hit, s.names_total, s.ff_count, s.ev_count, PUBLISH_MAX_MIN), "strong")
        return Decision("queue", s, [s] + rivals[:2], "сильное совпадение без ссылки, но ещё {} событий в ±{:.0f} мин — неоднозначно".format(len(rivals), PUBLISH_MAX_MIN))
    return Decision("queue", best, top, "без совпадения ссылки — только кандидаты по времени")


# --------------------------------------------------------------------------
# PMO
# --------------------------------------------------------------------------

def _parse_day(v: Any) -> Optional[date]:
    if not v or not isinstance(v, str):
        return None
    v = v.strip()[:10]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def pmo_meeting_day(m: dict) -> Optional[date]:
    """Дата совещания PMO (meeting_date: ISO или ДД.ММ.ГГГГ) или None."""
    return _parse_day((m or {}).get("meeting_date"))


_HHMM = re.compile(r"^\s*(\d{1,2})[:.](\d{2})(?!\d)")


def pmo_time_delta_min(ff: FFMeeting, m: dict) -> Optional[float]:
    """|старт Fireflies − (meeting_date + meeting_time по Риге)| в минутах.
    None — у совещания нет (разборчивого) времени или у встречи нет старта."""
    day = pmo_meeting_day(m)
    hm = _HHMM.match(str((m or {}).get("meeting_time") or ""))
    if ff.start is None or day is None or not hm:
        return None
    h, mi = int(hm.group(1)), int(hm.group(2))
    if h > 23 or mi > 59:
        return None
    local = datetime(day.year, day.month, day.day, h, mi, tzinfo=RIGA)
    return abs((ff.start - local).total_seconds()) / 60.0


def _pmo_link_day(ff: FFMeeting, meetings: Iterable[dict]) -> list[dict]:
    """Та же ссылка в «Месте» (location) и та же дата (Рига)."""
    key, day = ff.key, ff.local_day
    if key is None or day is None:
        return []
    out = []
    for m in meetings:
        loc = str((m or {}).get("location") or "")
        keys = extract_links(loc)
        k1 = normalize_link(loc)
        if k1 and k1 not in keys:
            keys.append(k1)
        if key in keys and _parse_day(m.get("meeting_date")) == day:
            out.append(m)
    return out


def pmo_match(ff: FFMeeting, meetings: Iterable[dict], window_min: float = PUBLISH_MAX_MIN) -> list[dict]:
    """Точное совпадение: та же ссылка в «Месте», та же дата (Рига) и время совещания в ±window_min
    от старта встречи. Ссылки многоразовые (Zoom PMI, постоянная комната Teams/Meet): по одной
    ссылке в один день идут и закрытая встреча, и совещание проекта — без времени их не различить."""
    out = []
    for m in _pmo_link_day(ff, meetings):
        d = pmo_time_delta_min(ff, m)
        if d is not None and d <= window_min:
            out.append(m)
    return out


def pmo_match_untimed(ff: FFMeeting, meetings: Iterable[dict]) -> list[dict]:
    """Та же ссылка и дата, но у совещания нет времени: только кандидат для человека, не публикация."""
    return [m for m in _pmo_link_day(ff, meetings) if pmo_time_delta_min(ff, m) is None]


__all__ = [
    "MeetingKey", "normalize_link", "extract_links", "name_tokens", "names_match",
    "bitrix_event_start", "bitrix_event_day", "bitrix_event_end", "parse_iso", "FFMeeting", "BxEvent",
    "Match", "Decision", "score", "decide", "search_days", "pmo_match", "pmo_match_untimed",
    "pmo_meeting_day", "pmo_time_delta_min", "RIGA", "UTC",
]
