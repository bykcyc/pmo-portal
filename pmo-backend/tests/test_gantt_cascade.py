"""F4.2: каскадный сдвиг связанных задач. Обход по зависимостям требует БД, но арифметика дат —
чистые функции, и именно в ней была ошибка (строка vs date для asyncpg). Проверяем её."""
from datetime import date

import main


def test_iso_delta_counts_days():
    assert main._iso_delta("2026-08-08", "2026-08-05") == 3     # сдвиг вперёд
    assert main._iso_delta("2026-08-01", "2026-08-05") == -4    # назад
    assert main._iso_delta("2026-08-05", "2026-08-05") == 0     # без изменений


def test_iso_delta_tolerates_empty_and_time_suffix():
    assert main._iso_delta(None, "2026-08-05") == 0
    assert main._iso_delta("2026-08-05", None) == 0
    assert main._iso_delta("2026-08-08T10:00:00", "2026-08-05") == 3   # берём только дату


def test_shift_returns_date_object_not_string():
    # asyncpg для DATE-колонки принимает date, а не строку — из-за этого падал первый вариант.
    out = main._shift_date_days("2026-08-10", 3)
    assert out == date(2026, 8, 13)
    assert isinstance(out, date)


def test_shift_empty_passthrough():
    assert main._shift_date_days(None, 5) is None
    assert main._shift_date_days("", 5) == ""
