"""WP6: подбор общего слота. Алгоритм — чистая функция, поэтому проверяем арифметику,
а не интеграцию: ошибка здесь стоит совещания, на которое кто-то не придёт.
"""
from datetime import datetime, timedelta

from domain import find_free_slots

MON = datetime(2026, 7, 13, 0, 0)        # понедельник


def _at(day_offset: int, h: int, m: int = 0) -> datetime:
    return MON + timedelta(days=day_offset, hours=h, minutes=m)


def test_finds_common_window_and_respects_work_hours():
    busy = {1: [(_at(0, 9), _at(0, 12))], 2: [(_at(0, 13), _at(0, 18))]}
    res = find_free_slots(busy, MON, MON + timedelta(days=1), duration_min=60)
    assert res["conflict_free"] is True
    first = datetime.fromisoformat(res["slots"][0]["from"])
    assert first == _at(0, 12)             # единственное общее окно 12:00–13:00
    for s in res["slots"]:
        b, e = datetime.fromisoformat(s["from"]), datetime.fromisoformat(s["to"])
        assert b.hour >= 9 and e.hour <= 18, "слот вне рабочего окна 9–18"


def test_weekend_is_never_offered():
    res = find_free_slots({1: []}, _at(5, 0), _at(6, 23), duration_min=60)   # сб + вс
    assert res["slots"] == []


def test_touching_meetings_do_not_conflict():
    """Встреча 10:00–11:00 и слот 11:00–12:00 НЕ пересекаются. Иначе календарь,
    забитый встречами впритык, выглядел бы полностью занятым."""
    busy = {1: [(_at(0, 10), _at(0, 11))]}
    res = find_free_slots(busy, _at(0, 11), _at(0, 23), duration_min=60)
    assert res["conflict_free"] is True
    assert datetime.fromisoformat(res["slots"][0]["from"]) == _at(0, 11)


def test_past_slots_are_not_offered():
    """«Давайте сегодня в 16:00», когда уже 17:00, — не предложение, а издевательство."""
    now = _at(0, 17)
    res = find_free_slots({1: []}, now, now + timedelta(days=1), duration_min=60)
    assert all(datetime.fromisoformat(s["from"]) >= now for s in res["slots"])


def test_no_free_window_returns_best_effort_not_emptiness():
    """Если совсем свободного окна нет, отдаём лучший компромисс с числом конфликтов:
    «слотов нет» — бесполезный ответ, календарь никогда не бывает пустым."""
    busy = {1: [(_at(0, 9), _at(0, 18))],          # занят весь день
            2: [(_at(0, 9), _at(0, 10))],
            3: []}
    res = find_free_slots(busy, MON, MON + timedelta(hours=23), duration_min=60)
    assert res["conflict_free"] is False
    assert res["slots"], "пустой ответ вместо компромисса"
    best = res["slots"][0]
    assert best["conflicts"] == 1 and best["free_count"] == 2 and best["total_count"] == 3
    assert best["busy_user_ids"] == [1]
    # компромиссы отсортированы по числу конфликтов — сначала те, где занят один
    assert [s["conflicts"] for s in res["slots"]] == sorted(s["conflicts"] for s in res["slots"])


def test_morning_window_wins_at_equal_conflicts():
    """При равном числе конфликтов утро 10–12 предпочтительнее: на него охотнее соглашаются."""
    res = find_free_slots({1: []}, MON, MON + timedelta(hours=23), duration_min=60)
    first = datetime.fromisoformat(res["slots"][0]["from"])
    assert 10 <= first.hour < 12, f"первым предложено {first.hour}:00, а не утреннее окно"


def test_duration_is_honoured():
    """Двухчасовая встреча не должна влезать в полуторачасовую щель."""
    busy = {1: [(_at(0, 9), _at(0, 12)), (_at(0, 13, 30), _at(0, 18))]}   # щель 12:00–13:30
    res = find_free_slots(busy, MON, MON + timedelta(hours=23), duration_min=120)
    assert res["conflict_free"] is False, "двухчасовая встреча не влезает в 1.5 часа"
