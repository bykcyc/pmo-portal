# -*- coding: utf-8 -*-
"""ASGI-обёртка: грузит .env ДО импорта приложения, чтобы main.py оставался
свободным от side-effect на импорте (правило CLAUDE.md «keep module imports side-effect free»).

`import main` (тесты, инструменты, golden-харнесс) больше не делает файлового I/O на импорте.
В контейнере .env отсутствует (.dockerignore) → load_dotenv здесь безвредный no-op, а конфиг берётся
из окружения; на хост-разработке .env заполняет пробелы окружения. Запуск: `uvicorn asgi:app`.
"""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from main import app  # noqa: E402  — импорт ПОСЛЕ load_dotenv, в этом весь смысл обёртки
from security import install_access_log_redaction  # noqa: E402

# Журнал доступа uvicorn пишет строку запроса целиком — с токеном публичной ссылки. Фильтр
# ставим здесь, в точке входа сервера: uvicorn настраивает логирование ДО импорта приложения,
# и повешенный после фильтр уже никто не снимет.
install_access_log_redaction()

__all__ = ["app"]
