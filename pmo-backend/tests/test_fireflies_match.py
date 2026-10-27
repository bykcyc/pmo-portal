"""Ядро сопоставления Fireflies ↔ Битрикс/PMO (перенос prototype/test_matching.py из meeting-sync).

Данные синтетические: ни одного живого протокола, ссылки и имена выдуманы.
"""
from datetime import datetime, timedelta, timezone

import pytest

import fireflies_match as mt
from fireflies_match import MeetingKey, normalize_link, extract_links, names_match, name_tokens

UTC = timezone.utc
ZID = "84512345678"


# ---------------- normalize_link ----------------

@pytest.mark.parametrize("url", [
    "https://us06web.zoom.us/j/{}?pwd=AbCdEf.1".format(ZID),
    "https://zoom.us/j/{}".format(ZID),
    "https://acme.zoom.us/w/{}?tk=x".format(ZID),
    "https://zoom.us/s/{}".format(ZID),
    "https://us02web.zoom.us/wc/join/{}".format(ZID),
    "https://zoom.us/wc/{}/join?pwd=x".format(ZID),
    "https://zoomgov.com/j/{}".format(ZID),
    "https://agency.zoomgov.com/j/{}".format(ZID),
    "zoommtg://zoom.us/join?action=join&confno={}&pwd=x".format(ZID),
    "us06web.zoom.us/j/{}".format(ZID),
    "https://www.zoom.us/j/{}.".format(ZID),
])
def test_zoom_variants(url):
    assert normalize_link(url) == MeetingKey("zoom", ZID)


def test_meet():
    k = MeetingKey("meet", "abc-defg-hij")
    assert normalize_link("https://meet.google.com/abc-defg-hij") == k
    assert normalize_link("https://meet.google.com/ABC-DEFG-HIJ?authuser=1&hs=122") == k
    assert normalize_link("meet.google.com/abc-defg-hij") == k
    assert normalize_link("https://meet.google.com/lookup/abcdef") is None


TEAMS_THREAD = "19:meeting_ZjA4MDk2YTgtYmY0Yi00@thread.v2"
TEAMS_ID = TEAMS_THREAD.lower()
TEAMS_URL = (
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZjA4MDk2YTgtYmY0Yi00%40thread.v2/0"
    "?context=%7b%22Tid%22%3a%22abc%22%2c%22Oid%22%3a%22def%22%7d"
)


def test_teams_meetup_join():
    assert normalize_link(TEAMS_URL) == MeetingKey("teams", TEAMS_ID)


def test_teams_double_encoded():
    url = "https://teams.microsoft.com/l/meetup-join/19%253ameeting_ZjA4MDk2YTgtYmY0Yi00%2540thread.v2/0?context=x"
    assert normalize_link(url) == MeetingKey("teams", TEAMS_ID)


def test_teams_fragment_and_meet():
    url = "https://teams.microsoft.com/v2/?meetingjoin=true#/l/meetup-join/19%3ameeting_ZjA4MDk2YTgtYmY0Yi00%40thread.v2/0"
    assert normalize_link(url) == MeetingKey("teams", TEAMS_ID)
    assert normalize_link("https://teams.microsoft.com/meet/3561234567890?p=xyz") == MeetingKey("teams", "meet:3561234567890")
    assert normalize_link("https://teams.live.com/meet/9876543210") == MeetingKey("teams", "meet:9876543210")


def test_safelinks():
    from urllib.parse import quote
    wrapped = "https://eur02.safelinks.protection.outlook.com/?url={}&data=05%7C01&reserved=0".format(quote(TEAMS_URL, safe=""))
    assert normalize_link(wrapped) == MeetingKey("teams", TEAMS_ID)
    wrapped_zoom = "https://nam12.safelinks.protection.outlook.com/?url={}&data=x".format(
        quote("https://us06web.zoom.us/j/{}?pwd=z".format(ZID), safe=""))
    assert normalize_link(wrapped_zoom) == MeetingKey("zoom", ZID)


@pytest.mark.parametrize("url", [
    None, "", "   ", "просто текст", "https://example.com/j/84512345678",
    "https://zoom.us/my/someone", "https://zoom.us/j/abc", "https://zoom.us/j/123",
    "https://teams.microsoft.com/l/channel/19%3aabc%40thread.tacv2/General",
    "ftp://zoom.us/j/84512345678", "https://evilzoom.us/j/84512345678",
    "https://bitrix.example.com/calendar/?EVENT_ID=1",
])
def test_garbage(url):
    assert normalize_link(url) is None


# ---------------- extract_links ----------------

def test_extract_bb_html_plain_amp():
    text = (
        "Повестка: [URL=https://us06web.zoom.us/j/{z}?pwd=a&amp;b=c]Zoom[/URL]\n"
        "[url]https://meet.google.com/abc-defg-hij[/url] и ещё раз https://zoom.us/j/{z}.\n"
        '<a href="{t}">Teams</a> <a href=\'https://teams.live.com/meet/9876543210\'>x</a>'
    ).format(z=ZID, t=TEAMS_URL.replace("&", "&amp;"))
    keys = extract_links(text)
    assert keys == [
        MeetingKey("zoom", ZID),
        MeetingKey("meet", "abc-defg-hij"),
        MeetingKey("teams", TEAMS_ID),
        MeetingKey("teams", "meet:9876543210"),
    ]


def test_extract_plain_and_bare():
    assert extract_links("Место: meet.google.com/xyz-abcd-efg, каб. 3") == [MeetingKey("meet", "xyz-abcd-efg")]
    assert extract_links("Переговорная 2, 3 этаж") == []
    assert extract_links(None) == []
    assert extract_links("(https://zoom.us/j/{})".format(ZID)) == [MeetingKey("zoom", ZID)]


def test_extract_html_entities_double():
    text = '<a href="https://zoom.us/j/{}?pwd=1&amp;amp;x=2">z</a>'.format(ZID)
    assert extract_links(text) == [MeetingKey("zoom", ZID)]


# ---------------- names ----------------

def test_name_tokens_translit():
    assert name_tokens("Юрий Сидоренко") == frozenset({"jurij", "sidorenko"})
    assert name_tokens("Mārta Kalačkina") == frozenset({"marta", "kalackina"})
    assert name_tokens("Щукин Яков Ёжиков") == frozenset({"sukin", "jakov", "jozikov"})  # ё в начале слова -> jo
    assert name_tokens("Al Bo") == frozenset()


def test_names_match_cyr_lat():
    assert names_match("Юрий Сидоренко", "Jurijs Sidorenko")
    assert names_match("Jurijs Sidorenko", "Сидоренко Юрий")
    assert names_match("Марта Калачкина", "Mārta Kalačkina")
    assert names_match("Sidorenko", "Jurijs Sidorenko")          # ник = фамилия
    assert names_match("Jura Sidorenko", "Jurijs Sidorenko")      # уменьшительное, те же 2 буквы
    assert names_match("Jānis Bērziņš", "Janis Berzins")


def test_names_match_levenshtein():
    assert names_match("Kalackina", "Kalatskina") is False   # 2 правки
    assert names_match("Kalačkina", "Kalackyna")             # 1 правка, длина ≥5


def test_names_namesakes():
    assert not names_match("Jurijs Sidorenko", "Jurijs Petrovs")   # тёзки: совпало только имя
    assert not names_match("Юрий Петров", "Jurijs Sidorenko")
    assert not names_match("", "Jurijs Sidorenko")
    assert not names_match("iPhone", "Jurijs Sidorenko")


# ---------------- bitrix_event_start ----------------

def test_bitrix_dst():
    e1 = {"DATE_FROM": "24.10.2026 10:00:00", "TZ_FROM": "Europe/Riga", "DT_SKIP_TIME": "N"}
    e2 = {"DATE_FROM": "26.10.2026 10:00:00", "TZ_FROM": "Europe/Riga", "DT_SKIP_TIME": "N"}
    assert mt.bitrix_event_start(e1) == datetime(2026, 10, 24, 7, 0, tzinfo=UTC)
    assert mt.bitrix_event_start(e2) == datetime(2026, 10, 26, 8, 0, tzinfo=UTC)


def test_bitrix_fallback_format_and_allday():
    e = {"DATE_FROM": "10/21/2026 01:30:00 pm", "TZ_FROM": "Europe/Riga"}
    assert mt.bitrix_event_start(e) == datetime(2026, 10, 21, 10, 30, tzinfo=UTC)
    assert mt.bitrix_event_start({"DATE_FROM": "21.10.2026 00:00:00", "DT_SKIP_TIME": "Y"}) is None
    assert mt.bitrix_event_start({"DATE_FROM": "мусор"}) is None
    # без TZ_FROM — Рига
    assert mt.bitrix_event_start({"DATE_FROM": "21.10.2026 13:00:00"}) == datetime(2026, 10, 21, 10, 0, tzinfo=UTC)


# ---------------- score / decide ----------------

ZOOM_URL = "https://us06web.zoom.us/j/{}?pwd=x".format(ZID)


def ff(start=datetime(2026, 10, 21, 7, 0, 30, tzinfo=UTC), link=ZOOM_URL, names=()):
    return mt.FFMeeting(id="ff1", start=start, duration_min=30, meeting_link=link, title="Standup", attendance_names=tuple(names))


def ev(eid, riga_from, location="", parent=None, name="Standup", attendees=()):
    return mt.BxEvent.from_api({
        "ID": eid, "PARENT_ID": parent or eid, "NAME": name, "DATE_FROM": riga_from, "TZ_FROM": "Europe/Riga",
        "LOCATION": location, "ATTENDEE_LIST": [{"id": a, "status": "Y"} for a in attendees],
    }, owner_id="7001", names_by_id={"1": "Jurijs Sidorenko", "2": "Mārta Kalačkina"})


def test_publish_link_and_time():
    m = mt.score(ff(), ev("10", "21.10.2026 10:00:00", location="https://zoom.us/j/{}".format(ZID)))
    assert m.link_match and m.time_delta_min < 1 and m.confidence >= 0.85
    d = mt.decide([m])
    assert d.kind == "publish" and d.best is m


def test_names_bonus():
    e = ev("10", "21.10.2026 10:00:00", location=ZOOM_URL, attendees=("1", "2"))
    m = mt.score(ff(names=("Юрий Сидоренко", "Марта")), e)
    assert any("имена: 2/2" in r for r in m.reasons)


def test_series_nearest_instance_publish():
    loc = "Zoom: " + ZOOM_URL
    a = ev("55", "21.10.2026 10:00:00", location=loc)   # тот же ID у экземпляров серии
    b = ev("55", "22.10.2026 10:00:00", location=loc)
    d = mt.decide([mt.score(ff(), a), mt.score(ff(), b)])
    assert d.kind == "publish"
    assert d.best.event.start == datetime(2026, 10, 21, 7, 0, tzinfo=UTC)


def test_series_equal_distance_queue():
    loc = ZOOM_URL
    a = ev("55", "21.10.2026 09:45:00", location=loc)
    b = ev("55", "21.10.2026 10:15:00", location=loc)
    d = mt.decide([mt.score(ff(start=datetime(2026, 10, 21, 7, 0, tzinfo=UTC)), x) for x in (a, b)])
    assert d.kind == "queue" and len(d.candidates) == 2


def test_copies_in_several_calendars_are_one_meeting():
    parent = ev("100", "21.10.2026 10:00:00", location=ZOOM_URL)
    copy = ev("101", "21.10.2026 10:00:00", location=ZOOM_URL, parent="100")
    d = mt.decide([mt.score(ff(), copy), mt.score(ff(), parent)])
    assert d.kind == "publish" and d.best.event.id == "100"


def test_link_but_far_time_queue():
    e = ev("10", "21.10.2026 12:00:00", location=ZOOM_URL)
    d = mt.decide([mt.score(ff(), e)])
    assert d.kind == "queue"


def test_no_link_queue():
    e = ev("10", "21.10.2026 10:00:00", location="Переговорная 1")
    d = mt.decide([mt.score(ff(), e)])
    assert d.kind == "queue" and not d.best.link_match
    d2 = mt.decide([mt.score(ff(link=None), ev("11", "21.10.2026 10:05:00", location=ZOOM_URL))])
    assert d2.kind == "queue"


def test_other_link_same_time_queue():
    e = ev("10", "21.10.2026 10:00:00", location="https://meet.google.com/abc-defg-hij")
    assert mt.decide([mt.score(ff(), e)]).kind == "queue"


def test_nothing_none():
    far = ev("10", "21.10.2026 15:00:00", location="Переговорная")
    assert mt.decide([mt.score(ff(), far)]).kind == "none"
    assert mt.decide([]).kind == "none"


def test_queue_top3():
    evs = [ev(str(i), "21.10.2026 10:{:02d}:00".format(i * 5)) for i in range(5)]
    d = mt.decide([mt.score(ff(), e) for e in evs])
    assert d.kind == "queue" and len(d.candidates) == 3


# ---------------- pmo_match ----------------

def test_pmo_match():
    meetings = [
        {"id": "a", "title": "Синк", "meeting_date": "2026-10-21", "meeting_time": "10:00",
         "location": "https://zoom.us/j/{}".format(ZID)},
        {"id": "b", "title": "Синк", "meeting_date": "2026-10-22", "meeting_time": "10:00",
         "location": "https://zoom.us/j/{}".format(ZID)},
        {"id": "c", "title": "Другое", "meeting_date": "2026-10-21", "meeting_time": "10:00", "location": "каб. 3"},
        {"id": "d", "title": "Старый формат", "meeting_date": "21.10.2026", "meeting_time": "10.15",
         "location": "Zoom " + ZOOM_URL},
    ]
    assert [m["id"] for m in mt.pmo_match(ff(), meetings)] == ["a", "d"]
    assert mt.pmo_match(ff(link=None), meetings) == []


def test_pmo_match_reusable_link_needs_the_time_too():
    """Личная ссылка (Zoom PMI) — одна на весь день: закрытая встреча в 10:00 по той же ссылке не
    должна попасть в совещание проекта, назначенное на 14:00."""
    meetings = [{"id": "proj", "meeting_date": "2026-10-21", "meeting_time": "14:00", "location": ZOOM_URL}]
    assert mt.pmo_match(ff(), meetings) == []                                        # встреча в 10:00
    at_14 = ff(start=datetime(2026, 10, 21, 11, 5, tzinfo=UTC))                      # 14:05 по Риге
    assert [m["id"] for m in mt.pmo_match(at_14, meetings)] == ["proj"]
    assert mt.pmo_match(ff(start=datetime(2026, 10, 21, 11, 31, tzinfo=UTC)), meetings) == []   # 14:31 — мимо


def test_pmo_match_without_meeting_time_is_only_a_candidate():
    meetings = [{"id": "a", "meeting_date": "2026-10-21", "meeting_time": "", "location": ZOOM_URL},
                {"id": "b", "meeting_date": "2026-10-21", "location": ZOOM_URL},
                {"id": "c", "meeting_date": "2026-10-21", "meeting_time": "10:00", "location": ZOOM_URL},
                {"id": "x", "meeting_date": "2026-10-21", "meeting_time": "25:99", "location": ZOOM_URL}]
    assert [m["id"] for m in mt.pmo_match(ff(), meetings)] == ["c"]
    assert [m["id"] for m in mt.pmo_match_untimed(ff(), meetings)] == ["a", "b", "x"]
    assert mt.pmo_time_delta_min(ff(), meetings[2]) == pytest.approx(0.5)


def test_ff_from_api():
    t = {"id": "X", "dateString": "2026-10-21T06:59:37.000Z", "date": 1792998000000, "duration": 23.19,
         "meeting_link": ZOOM_URL, "user": {"email": "a@b.lv"},
         "meeting_attendance": [{"name": "Юрий"}, {"name": "Юрий"}, {"name": None}]}
    m = mt.FFMeeting.from_api(t)
    assert m.start == datetime(2026, 10, 21, 6, 59, 37, tzinfo=UTC)
    assert m.attendance_names == ("Юрий",) and m.owner_email == "a@b.lv" and m.key == MeetingKey("zoom", ZID)


# ================= исправления по ревью =================

def test_zoom_path_case_and_delimiter():
    assert normalize_link("https://zoom.us/J/12345678901") == MeetingKey("zoom", "12345678901")
    assert normalize_link("https://zoom.us/WC/JOIN/12345678901") == MeetingKey("zoom", "12345678901")
    assert normalize_link("https://zoom.us/j/12345678901/") == MeetingKey("zoom", "12345678901")
    assert normalize_link("https://zoom.us/j/12345678901abc") is None
    assert normalize_link("https://zoom.us/wc/12345678901/joinx") is None
    assert extract_links("см. zoom.us/j/12345678901abc") == []


def test_names_iotated_e():
    assert name_tokens("Евгений") == frozenset({"jevgenij"})
    assert name_tokens("Андреев Сергей") == frozenset({"andrejev", "sergej"})
    assert names_match("Евгений Петров", "Jevgenijs Petrovs")
    assert names_match("Егор Смирнов", "Jegors Smirnovs")
    assert names_match("Андреев", "Andrejevs")
    # запасной путь: начальная j (латиница без j ↔ с j)
    assert names_match("Egors Smirnovs", "Jegors Smirnovs")


def test_names_rest_rule_not_too_loose():
    assert names_match("Jurijs Sidorenko", "Juris Sidorovs") is False
    assert names_match("Jura Sidorenko", "Jurijs Sidorenko")      # обе фамилии совпали
    assert names_match("Jura Sidorenko", "Sidorenko Jurijs")
    assert names_match("Sidorenko Jura", "Sidorenko Jurijs")      # ник ≤4 + общие 3 буквы


def test_bitrix_dst_transition_day():
    riga = {"TZ_FROM": "Europe/Riga"}
    assert mt.bitrix_event_start({"DATE_FROM": "25.10.2026 10:00:00", **riga}) == datetime(2026, 10, 25, 8, 0, tzinfo=UTC)
    # неоднозначный час 03:00–04:00: политика fold=0 (ещё летнее время, EEST)
    assert mt.bitrix_event_start({"DATE_FROM": "25.10.2026 03:30:00", **riga}) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)


def test_bitrix_ignores_ts_utc_and_empty_tz():
    e = {"DATE_FROM": "21.10.2026 10:00:00", "TZ_FROM": "Europe/Riga", "DATE_FROM_TS_UTC": "1792990800"}
    assert mt.bitrix_event_start(e) == datetime(2026, 10, 21, 7, 0, tzinfo=UTC)
    assert mt.bitrix_event_start({"DATE_FROM": "21.10.2026 10:00:00", "TZ_FROM": ""}) == datetime(2026, 10, 21, 7, 0, tzinfo=UTC)


def _allday(eid, location=""):
    return mt.BxEvent.from_api({"ID": eid, "PARENT_ID": eid, "NAME": "Весь день", "DATE_FROM": "21.10.2026 00:00:00",
                                "DT_SKIP_TIME": "Y", "TZ_FROM": "Europe/Riga", "LOCATION": location})


def test_allday_same_link_queue_never_publish():
    m = mt.score(ff(), _allday("7", ZOOM_URL))
    assert m.link_match and m.time_delta_min == float("inf")
    assert mt.decide([m]).kind == "queue"


def test_allday_no_link_none():
    assert mt.decide([mt.score(ff(), _allday("8", "каб. 3"))]).kind == "none"


def test_ff_without_link_and_attendance():
    f = mt.FFMeeting.from_api({"id": "x", "dateString": "2026-10-21T07:00:00.000Z", "meeting_attendance": None})
    assert f.attendance_names == () and f.key is None
    m = mt.score(f, ev("10", "21.10.2026 10:00:00", location=ZOOM_URL))
    assert m.link_match is False and mt.decide([m]).kind == "queue"


def test_ff_from_api_date_ms_fallback():
    f = mt.FFMeeting.from_api({"id": "x", "date": 1792998000000})
    assert f.start == datetime.fromtimestamp(1792998000, tz=UTC)


def test_pmo_match_without_link_or_start():
    meetings = [{"id": "a", "meeting_date": "2026-10-21", "location": ZOOM_URL}]
    assert mt.pmo_match(ff(link=None), meetings) == []
    assert mt.pmo_match(ff(start=None), meetings) == []


def test_decide_incomplete_data_downgrades_publish():
    m = mt.score(ff(), ev("10", "21.10.2026 10:00:00", location=ZOOM_URL))
    assert mt.decide([m]).kind == "publish"
    d = mt.decide([m], data_complete=False)
    assert d.kind == "queue" and "неполные" in d.reason
    # queue/none не меняются
    assert mt.decide([], data_complete=False).kind == "none"


def test_search_days_near_midnight():
    # 00:20 Риги 22.10 (21:20Z 21.10, EEST) -> нужен и предыдущий день
    f = ff(start=datetime(2026, 10, 21, 21, 20, tzinfo=UTC))
    lo, hi = mt.search_days(f)
    assert lo.isoformat() == "2026-10-21" and hi.isoformat() == "2026-10-23"
    # 23:00 Риги, 30 мин + 90 -> захватывает следующий день
    f2 = ff(start=datetime(2026, 10, 21, 20, 0, tzinfo=UTC))
    assert [d.isoformat() for d in mt.search_days(f2)] == ["2026-10-21", "2026-10-23"]
    # днём — один день
    assert [d.isoformat() for d in mt.search_days(ff())] == ["2026-10-21", "2026-10-22"]
    assert mt.search_days(ff(start=None)) is None


# ---------------- сильное совпадение без ссылки (решение владельца) ----------------

NAMES4 = {"1": "Jurijs Sidorenko", "2": "Mārta Kalačkina", "3": "Roberts Ozolins", "4": "Zane Strautmane",
          "5": "Pēteris Ozols", "6": "Anna Liepa"}
FF4 = ("Юрий Сидоренко", "Марта Калачкина", "Roberts Ozolins", "Zane Strautmane")


def ev_n(eid, riga_from, attendees, location="", parent=None):
    return mt.BxEvent.from_api({
        "ID": eid, "PARENT_ID": parent or eid, "NAME": "Weekly sync", "DATE_FROM": riga_from, "TZ_FROM": "Europe/Riga",
        "LOCATION": location, "ATTENDEE_LIST": [{"id": a, "status": "Y"} for a in attendees],
    }, owner_id="7001", names_by_id=NAMES4)


def test_strong_without_link_publishes():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "3", "4")))
    assert not m.link_match and m.is_strong and (m.names_hit, m.names_total) == (4, 4)
    d = mt.decide([m])
    assert d.kind == "publish" and d.basis == "strong" and d.best is m


def test_link_publish_has_link_basis():
    m = mt.score(ff(), ev("10", "21.10.2026 10:00:00", location="https://zoom.us/j/{}".format(ZID)))
    assert mt.decide([m]).basis == "link"


def test_strong_with_rival_in_window_is_queue():
    a = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "3", "4")))
    b = mt.score(ff(names=FF4), ev_n("21", "21.10.2026 10:20:00", ("5", "6")))
    d = mt.decide([a, b])
    assert d.kind == "queue" and d.best is a


def test_strong_requires_80_percent_names():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "5", "6")))
    assert (m.names_hit, m.names_total) == (2, 4) and not m.is_strong
    assert mt.decide([m]).kind == "queue"


def test_strong_blocked_by_other_meeting_link():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "3", "4"), location="https://meet.google.com/abc-defg-hij"))
    assert m.other_link and not m.is_strong
    assert mt.decide([m]).kind == "queue"


def test_strong_requires_min_names():
    m = mt.score(ff(names=FF4[:2]), ev_n("20", "21.10.2026 10:00:00", ("1", "2")))
    assert (m.names_hit, m.names_total) == (2, 2) and not m.is_strong
    assert mt.decide([m]).kind == "queue"


def test_strong_requires_close_participant_count():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "3", "4", "5", "6")))
    assert m.names_hit == 4 and not m.is_strong
    assert mt.decide([m]).kind == "queue"


def test_strong_requires_tight_time():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:15:00", ("1", "2", "3", "4")))
    assert not m.is_strong and mt.decide([m]).kind == "queue"


def test_strong_incomplete_data_is_queue():
    m = mt.score(ff(names=FF4), ev_n("20", "21.10.2026 10:00:00", ("1", "2", "3", "4")))
    assert mt.decide([m], data_complete=False).kind == "queue"
