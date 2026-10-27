"""PMO backend.

Implements the API consumed by RDProject/frontend. Canonical data lives in PostgreSQL;
legacy OpenProject-shaped dictionaries remain internal compatibility shims only.
"""
import asyncio
import json
import logging
import os
import bisect
import re
import secrets
import sys
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Optional, cast

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from pmo_api import PmoApi

# Типизированная ссылка на сам модуль main: build_router(api: PmoApi) получает его, а pyright
# проверяет api.* по протоколу PmoApi. cast — рантайм-ноуп (api остаётся модулем main).
_API = cast("PmoApi", sys.modules[__name__])

import bcrypt
import httpx  # нужен для bx() (Bitrix24)

import db
import app_runtime as app_runtime_ops
import access_routes
import admin_routes
import attachments_routes
import auth_routes
import bitrix_calendar_routes
import bitrix_routes
import collections_routes
import directory_routes
import drafts_routes
import fireflies_routes
import fireflies_sync
import portfolio_routes
import mcp_server
import oauth_provider
import oauth_routes
import problems_routes
import registry_routes
import project_meta as project_meta_ops
import project_ops_routes
import projects_routes
import risks_routes
import security as security_ops
import task_ops_routes
import tasks_routes
import share_notes_routes
import system_routes

# .env грузит asgi.py ДО импорта main (no import-time I/O здесь). Прямой `import main`
# (тесты/инструменты) работает на окружении контейнера, без чтения .env.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # не шуметь каждым запросом
logger = logging.getLogger("pmo-adapter")

from fastapi import APIRouter, Body, Depends, FastAPI, File, Header, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, Response, StreamingResponse  # noqa: E402

import mailer  # noqa: E402 — email-транспорт (dry-run outbox, если SMTP не настроен)
import domain  # noqa: E402 — нужен как модуль: из него берутся значения порогов по умолчанию
from domain import (_compute_critical, _num, _budget_aggregates, _budget_planned, _budget_actual, _workdays,  # noqa: E402 — чистые вычисления вынесены
                    _workload_from_tasks, _ics_esc, find_free_slots, dep_conflict)

SECRET = os.environ.get("ADAPTER_SECRET", "pmo-adapter-secret").encode()

# Шифрование секретов-at-rest (Bitrix-вебхук override + SMTP-пароль в settings). Fernet, ключ
# выведен из ADAPTER_SECRET. Без cryptography — плейнтекст (dev) с предупреждением; маркер "enc:".
_FERNET = security_ops.build_fernet(SECRET)


def _encrypt_secret(s: str) -> str:
    return security_ops.encrypt_secret(s, _FERNET)


def _decrypt_secret(s: str) -> str:
    return security_ops.decrypt_secret(s, _FERNET)


# --- Двухфакторная аутентификация (TOTP) — тонкие обёртки, зовутся из route-модулей как api.<name>.
# TOTP-секрет хранится в users.doc зашифрованным тем же Fernet (_encrypt_secret), что SMTP-пароль.
def _totp_new_secret() -> str:
    return security_ops.totp_new_secret()


def _totp_provisioning_uri(secret: str, email: str) -> str:
    return security_ops.totp_provisioning_uri(secret, email)


def _totp_verify(secret: str, code: str) -> bool:
    return security_ops.totp_verify(secret, code)


def _totp_qr_data_uri(uri: str) -> str:
    return security_ops.totp_qr_data_uri(uri)


def make_mfa_challenge(email: str) -> str:
    """Короткоживущий токен второго шага входа (2FA). Флаг mfa=True не даёт использовать его как access."""
    return security_ops.make_mfa_challenge(email, SECRET)


def read_mfa_challenge(tok: str) -> Optional[dict]:
    return security_ops.read_mfa_challenge(tok, SECRET)


# 2FA обязательна для всех: 7 дней от ПЕРВОГО входа на настройку, потом блок.
# Для существующих пользователей отсчёт пойдёт от первого входа ПОСЛЕ деплоя (first_login_at
# проставляется в /auth/login), чтобы не залочить всех разом.
_TWOFA_GRACE_DAYS = 7

# Общий пол для всех: до этой даты не блокируем никого, даже если личные семь дней вышли.
#
# Иначе истёкший личный срок даёт 403 на ЛЮБОЕ действие, и это выглядит как поломка портала,
# а не как «подключите вход по коду». Дата абсолютная и одна на всех — так
# видно, когда именно наступит блокировка, и не приходится править `first_login_at`, то есть
# врать про то, когда человек впервые вошёл.
#
# После этой даты правило само вернётся к личным семи дням. Убирать эту константу — значит
# залочить всех, кто к тому моменту 2FA не включил: сначала предупредить людей.
_TWOFA_GRACE_FLOOR_ISO = "2026-12-31T23:59:59+00:00"


def _twofa_grace_deadline(u: dict) -> Optional[float]:
    """epoch-дедлайн грейса без 2FA; None если 2FA уже включена ИЛИ ещё не было первого входа.

    Дедлайн — ПОЗДНЯЯ из двух дат: личные семь дней от первого входа и общий пол
    `_TWOFA_GRACE_FLOOR_ISO`. Пол не сокращает срок тем, у кого личный дедлайн дальше.
    """
    if u.get("twofa_enabled"):
        return None
    first = u.get("first_login_at")
    if not first:
        return None
    floor = datetime.fromisoformat(_TWOFA_GRACE_FLOOR_ISO).timestamp()
    try:
        return max(datetime.fromisoformat(first).timestamp() + _TWOFA_GRACE_DAYS * 86400, floor)
    except Exception:  # noqa: BLE001 - кривая дата = как будто грейса нет (не блокируем)
        return None


def _twofa_grace_until_iso(u: dict) -> Optional[str]:
    dl = _twofa_grace_deadline(u)
    return datetime.fromtimestamp(dl, timezone.utc).isoformat() if dl is not None else None


def _twofa_must_enroll(u: dict) -> bool:
    """True = грейс истёк и 2FA не настроена → всё, кроме страницы настройки/логаута, блокируется."""
    dl = _twofa_grace_deadline(u)
    return dl is not None and time.time() > dl


# Локаут перебора 6-значного TOTP-кода СВЕРХ общего rate-limit (тот сбрасывался каждые 60с и давал
# ~10/мин бесконечно). N подряд неверных кодов → короткая блокировка второго шага. В памяти (как
# _LOGIN_ATTEMPTS): переживать рестарт не нужно — рестарт и так обнуляет, а сброс идёт на успешном коде.
_TWOFA_FAILS: dict = {}
_TWOFA_MAX_FAILS = int(os.environ.get("TWOFA_MAX_FAILS", "5") or 5)
_TWOFA_LOCK_SEC = float(os.environ.get("TWOFA_LOCK_SEC", "900") or 900)  # 15 минут


def _twofa_locked(email: str) -> bool:
    rec = _TWOFA_FAILS.get(email)
    return bool(rec and rec.get("until", 0) > time.time())


def _twofa_fail(email: str) -> None:
    rec = _TWOFA_FAILS.setdefault(email, {"n": 0, "until": 0.0})
    rec["n"] += 1
    if rec["n"] >= _TWOFA_MAX_FAILS:
        rec["until"] = time.time() + _TWOFA_LOCK_SEC  # достигли порога → блок на окно
        rec["n"] = 0


def _twofa_pass(email: str) -> None:
    _TWOFA_FAILS.pop(email, None)  # верный код — сбросить счётчик и блок

# Bitrix24 — вебхук перенесён из оригинальной системы (RDProject); интеграция задач/бэклога.
BITRIX_URL = os.environ.get("BITRIX24_WEBHOOK_URL", "").rstrip("/")


def _bitrix_url() -> str:
    """Эффективный Bitrix-вебхук: переопределение из настроек портала (хранится шифрованным)
    имеет приоритет над env BITRIX24_WEBHOOK_URL. Позволяет админу менять вебхук из UI без правки .env."""
    v = _settings().get("bitrix_webhook")
    if v:
        return _decrypt_secret(v).rstrip("/")
    return BITRIX_URL
BITRIX_DEFAULT_RESP = int(os.environ.get("BITRIX24_DEFAULT_RESPONSIBLE_ID", "1") or 1)

# Пользователи: грузятся из таблицы users (реальные из Postgres оригинала, проверка по bcrypt-хэшу).
# Фолбэк (если БД не загружена/пуста) — два сид-пользователя оригинала с паролями по умолчанию.
_USERS_FALLBACK = True  # True → активны дефолтные сид-креды; _lifespan снимет флаг после загрузки из БД


def _seed_users() -> dict:
    return app_runtime_ops.seed_users()


# USERS перезагружается из БД в _lifespan; до этого — сид (нужно тестам без живого Postgres).
USERS = _seed_users()


def _verify_password(u: dict, pw: str) -> bool:
    return security_ops.verify_password(u, pw)


def _dummy_verify(pw: str) -> bool:
    """Timing equalizer: run one bcrypt verify for missing/inactive accounts (always False)."""
    return security_ops.dummy_verify(pw)


# --- простой in-memory rate-limit на /auth/login (защита от перебора паролей) ---
_LOGIN_ATTEMPTS: dict = {}
_LOGIN_MAX = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "10") or 10)
_LOGIN_WINDOW = 60.0
# Прим.: глобальный login-счётчик убран (аудит-6b) — он был tenant-wide login-DoS (любой перебор
# разными email держал общий счётчик на потолке → 429 всем, включая легитимных) и O(n²) на event-loop.
# Защита от распределённого bcrypt-DoS — забота reverse proxy (per-IP rate-limit на краю, перед
# приложением; в поставляемом deploy/Caddyfile его нет — см. DEPLOY.md, раздел 5); здесь только
# per-email лимит ниже.

# Отозванные токены (logout): сигнатура токена -> exp. In-memory (один воркер).
_REVOKED: dict = {}


def _token_sig(tok: str) -> str:
    return security_ops.token_signature(tok)


def _prune_revoked():
    security_ops.prune_revoked(_REVOKED)


def _login_rate_ok(email: str) -> bool:
    return security_ops.login_rate_ok(
        email,
        _LOGIN_ATTEMPTS,
        window=_LOGIN_WINDOW,
        max_attempts=_LOGIN_MAX,
    )


# --- Redis-опционально: общий стор для отзыва токенов и rate-limit (включает multi-worker).
# REDIS_URL не задан → in-memory (один воркер — рекомендуемый режим для небольшой команды).
_REDIS = None
if os.environ.get("REDIS_URL"):
    try:
        import redis.asyncio as _aioredis  # pyright: ignore[reportMissingImports]  # опциональная зависимость
        _REDIS = _aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
        logger.info("Redis включён — общий стор для multi-worker")
    except Exception as e:  # noqa: BLE001
        logger.warning("Redis недоступен (%s) — in-memory режим (1 воркер)", e)
        _REDIS = None


async def _revoke_token(sig: str, exp: float):
    await security_ops.revoke_token(
        sig,
        exp,
        redis_client=_REDIS,
        revoked=_REVOKED,
        logger=logger,
        db_revoke=db.revoke_token_row,  # durable: logout переживает рестарт
    )


def _apply_revoked(revoked: dict) -> None:
    """Прогрев _REVOKED из Postgres на старте — отзыв токенов переживает рестарт,
    при этом is_revoked остаётся памятным (без БД-чтения на каждый запрос)."""
    _REVOKED.update(revoked)


async def _is_revoked(sig: str) -> bool:
    return await security_ops.is_revoked(
        sig,
        redis_client=_REDIS,
        revoked=_REVOKED,
        logger=logger,
    )


async def _rate_ok(email: str) -> bool:
    return await security_ops.rate_ok(
        email,
        redis_client=_REDIS,
        window=_LOGIN_WINDOW,
        max_attempts=_LOGIN_MAX,
        fallback=_login_rate_ok,
        logger=logger,
    )


# Inbound-токен для вебхука Bitrix (если задан — вебхук обязан его прислать). Пусто = проверка выключена.
BITRIX_INBOUND_TOKEN = os.environ.get("BITRIX24_INBOUND_TOKEN", "")

# Адрес, под которым портал виден снаружи. Из него строятся ВСЕ адреса, которые портал
# объявляет клиенту помощника: издатель токенов, точки OAuth, идентификатор ресурса. Ошибка
# здесь не ломает интерфейс — она ломает только подключение помощника, и притом молча.
PORTAL_PUBLIC_URL = os.environ.get("PORTAL_PUBLIC_URL", "http://127.0.0.1:8002").rstrip("/")

# Связка Fireflies → протокол в совещание PMO + комментарий к событию Битрикса (fireflies_sync).
# Выключена, пока её не включат явно. Без секрета вебхук отвечает 404 даже при включённом флаге;
# в production включённый флаг без секрета или ключа роняет старт (_enforce_prod_secrets).
FIREFLIES_ENABLED = fireflies_sync.env_flag(os.environ.get("FIREFLIES_ENABLED"))
FIREFLIES_API_KEY = os.environ.get("FIREFLIES_API_KEY", "")
FIREFLIES_WEBHOOK_SECRET = os.environ.get("FIREFLIES_WEBHOOK_SECRET", "")
# Комментарий к событию Битрикса — отдельный флаг: custom.calendar.comment.add не входит
# в стандартный REST Битрикса (его даёт собственный серверный модуль) и есть не на каждом портале.
FIREFLIES_BITRIX_COMMENTS = fireflies_sync.env_flag(os.environ.get("FIREFLIES_BITRIX_COMMENTS"))
# Необязательные ограничения (пусто = без ограничений): id проектов PMO, email владельцев встреч.
FIREFLIES_ALLOWED_PROJECTS = fireflies_sync.env_list(os.environ.get("FIREFLIES_ALLOWED_PROJECTS"))
FIREFLIES_ALLOWED_HOSTS = fireflies_sync.env_list(os.environ.get("FIREFLIES_ALLOWED_HOSTS"), lower=True)
# Доп. календари Битрикса для поиска события (id пользователей), кроме владельца и участников.
FIREFLIES_EXTRA_BITRIX_USERS = fireflies_sync.env_list(os.environ.get("FIREFLIES_EXTRA_BITRIX_USERS"))


def _demo_credentials_live() -> bool:
    """True, если стартовый сид-аккаунт всё ещё принимает пароль по умолчанию.

    Ловит наполненную БД (users_fallback=False), в которой owner@company.com/admin123
    (или pm1@company.com/pm123) не сменили — этого недостаточно проверять только по
    пустоте таблицы users.
    """
    for email, seed in _seed_users().items():
        pw = seed.get("password")
        live = USERS.get(email)
        if pw and live and _verify_password(live, str(pw)):
            return True
    return False


def _enforce_prod_secrets():
    """Fail-fast при ADAPTER_ENV=production с дефолтными/пустыми секретами; в dev — предупреждение."""
    security_ops.enforce_prod_secrets(
        environment=os.environ,
        secret=SECRET,
        users_fallback=_USERS_FALLBACK,
        # ЭФФЕКТИВНЫЙ url (settings ИЛИ env): вебхук пишет статусы наших задач и без inbound-токена
        # публичен. Если Bitrix настроен через UI, а BITRIX24_INBOUND_TOKEN пуст — прод не стартует.
        bitrix_url=_bitrix_url() or BITRIX_URL,
        bitrix_inbound_token=BITRIX_INBOUND_TOKEN,
        logger=logger,
        demo_credentials_live=_demo_credentials_live(),
        fernet_ok=_FERNET is not None,
        fireflies_enabled=FIREFLIES_ENABLED,
        fireflies_api_key=FIREFLIES_API_KEY,
        fireflies_webhook_secret=FIREFLIES_WEBHOOK_SECRET,
    )


def _apply_loaded_state(loaded_users: dict, settings: dict) -> None:
    global USERS, _USERS_FALLBACK, _settings_cache
    if loaded_users:
        USERS = {email: {**user, "email": email} for email, user in loaded_users.items()}
        _USERS_FALLBACK = False
    _settings_cache = settings


# Ключи advisory-lock запланированных задач: при --workers>1 каждую задачу выполняет РОВНО один
# воркер (иначе N воркеров = N дублей снимка/дайджеста). Ручные триггеры (/admin/...) идут в обход.
_JOB_SNAPSHOT, _JOB_DIGEST, _JOB_LEADERSHIP = 0x504D4F01, 0x504D4F02, 0x504D4F03
_JOB_BX_PEOPLE = 0x504D4F04   # синк людей: лок держит и ночная джоба, и кнопка в настройках
_JOB_FIREFLIES = 0x504D4F05   # связка Fireflies: раз в минуту, очередь разбирает один воркер


async def _sweep_expired(*a, **k) -> Any:
    """Уборка того, что живёт по таймеру: нерешённые черновики и брошенные запросы OAuth.

    Едет вместе со снимком портфеля намеренно: заводить ради двух DELETE отдельную джобу
    с отдельным локом — больше движущихся частей, чем пользы. Обе уборки идемпотентны.
    """
    now = datetime.now(timezone.utc)
    try:
        await db.delete_old_drafts((now - timedelta(days=drafts_routes.DRAFT_TTL_DAYS)).isoformat())
        await db.delete_expired_oauth(now.isoformat())
    except Exception:  # noqa: BLE001 — уборка не должна ронять снимок портфеля
        logger.exception("уборка по сроку не удалась")
    return None


async def _scheduled_snapshot(*a, **k) -> Any:
    res = await db.run_with_job_lock(_JOB_SNAPSHOT, _take_portfolio_snapshot, *a, **k)
    await _sweep_expired()
    return res


async def _scheduled_digests(*a, **k) -> Any:
    return await db.run_with_job_lock(_JOB_DIGEST, _run_digests, *a, **k)


async def _scheduled_leadership(*a, **k) -> Any:
    return await db.run_with_job_lock(_JOB_LEADERSHIP, _run_leadership_digest, *a, **k)


async def _scheduled_fireflies(*a, **k) -> Any:
    """Очередь связки Fireflies (раз в минуту). Выключенный флаг — тихий no-op; лок — чтобы при
    --workers>1 одну встречу не разбирали двое."""
    if not FIREFLIES_ENABLED:
        return None
    return await db.run_with_job_lock(_JOB_FIREFLIES, fireflies_sync.run_due, _API)


async def _scheduled_bx_people(*a, **k) -> Any:
    """Ночной синк людей. Сам берёт лок внутри sync_bitrix_people; если Bitrix не настроен —
    тихий no-op. На СТАРТЕ не запускаем (в отличие от снимка портфеля): джоба умеет
    деактивировать людей, и делать это на каждом рестарте контейнера незачем."""
    if not _bitrix_url():
        return None
    return await sync_bitrix_people()


# MCP-сервер портала: внешний помощник (ChatGPT/Claude). Инструменты резолвят хелперы через
# _API на вызове — как и роут-модули, поэтому монкейпатчи в тестах остаются валидными.
_MCP = mcp_server.build(_API)

# Портал сам себе сервер авторизации: коннекторы claude.ai поля для готового токена не имеют
# вовсе и подключаются только по OAuth. Согласие даёт человек на странице /connect портала —
# то есть через обычный вход с паролем и двухфакторкой, а не через отдельную, более слабую дверь.
_OAUTH = oauth_provider.PortalOAuthProvider(_API, f"{PORTAL_PUBLIC_URL}/connect")


@asynccontextmanager
async def _lifespan(_app) -> "AsyncGenerator[None, None]":
    async with app_runtime_ops.lifespan(
        db_module=db,
        environment=os.environ,
        logger=logger,
        apply_loaded_state=_apply_loaded_state,
        apply_smtp=_apply_smtp,
        enforce_prod_secrets=_enforce_prod_secrets,
        take_portfolio_snapshot=_scheduled_snapshot,     # advisory-lock: один воркер на задачу
        run_digests=_scheduled_digests,
        run_leadership_digest=_scheduled_leadership,
        apply_revoked=_apply_revoked,
        sync_bitrix_people=_scheduled_bx_people,
        fireflies_sync=_scheduled_fireflies if FIREFLIES_ENABLED else None,
    ):
        # Session manager MCP обязан быть запущен вместе с приложением: без этого первый же
        # запрос помощника падает с «Task group is not initialized».
        async with _MCP.session_manager.run():
            yield


# В production скрываем интерактивную схему (/docs, /redoc, /openapi.json): она раскрывает
# всю поверхность API. В dev/тестах остаётся включённой (golden-харнесс читает /openapi.json).
_PROD = os.environ.get("ADAPTER_ENV", "").lower() == "production"
app = FastAPI(
    title="PMO API",
    version="1.0.0",
    lifespan=_lifespan,
    docs_url=None if _PROD else "/docs",
    redoc_url=None if _PROD else "/redoc",
    openapi_url=None if _PROD else "/openapi.json",
)
# CORS сужен до конфигурируемых origin (env CORS_ORIGINS, через запятую). По умолчанию — локальный фронт.
_CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:4173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ---------- observability: лёгкие in-memory метрики (Prometheus text, без внешних зависимостей) ----------
_MX = {"count": {}, "sum": {}, "err": {}}  # per-worker (Prometheus скрейпит каждый воркер)


@app.middleware("http")
async def _metrics_mw(request: Request, call_next):
    t0 = time.time()
    status = 500
    try:
        resp = await call_next(request)
        status = resp.status_code
        return resp
    finally:
        route = request.scope.get("route")
        # Шаблон пути (низкая кардинальность). Для несматченных запросов (404/сканеры лезут по
        # произвольным URL) НЕ берём сырой путь — иначе _MX растёт без границы; кладём константу.
        tmpl = getattr(route, "path", None) or "<unmatched>"
        key = f"{request.method} {tmpl}"
        _MX["count"][key] = _MX["count"].get(key, 0) + 1
        _MX["sum"][key] = _MX["sum"].get(key, 0.0) + (time.time() - t0)
        if status >= 500:
            _MX["err"][key] = _MX["err"].get(key, 0) + 1


_TWOFA_ALLOW_EXACT = {"/auth/me", "/auth/logout"}


def _twofa_path_allowed(path: str) -> bool:
    """Пути, доступные даже заблокированному по грейсу: настройка 2FA, чтение статуса, логаут."""
    return path in _TWOFA_ALLOW_EXACT or path.startswith("/me/2fa")


@app.middleware("http")
async def _twofa_gate_mw(request: Request, call_next):
    """Серверный блок доступа после истечения грейса без 2FA (клиентская модалка — второй рубеж).
    Блокирует ТОЛЬКО случай: валидный access-токен активного пользователя, у которого грейс истёк
    и 2FA не настроена, на НЕ-allowlist-пути. Публичные/логин/health токена не несут → проходят;
    mfa-challenge read_token отвергает → тоже мимо."""
    if not _twofa_path_allowed(request.url.path):
        tok = request.headers.get("authorization", "").replace("Bearer ", "").strip()
        if tok:
            data = read_token(tok)
            if data:
                u = USERS.get(data.get("sub"))
                if u and u.get("is_active", True) and _twofa_must_enroll(u):
                    return JSONResponse(status_code=403, content={"detail": "twofa_setup_required"})
    return await call_next(request)


# ---------- token (HMAC, без внешних зависимостей) ----------
def _b64(b: bytes) -> str:
    return security_ops.urlsafe_b64(b)


def make_token(email: str) -> str:
    # jti — уникальный nonce: каждый токен уникален (иначе два входа в одну секунду дают одинаковую
    # подпись, и отзыв одного отзывал бы все). Отзыв (logout) работает по сигнатуре пер-токен.
    return security_ops.make_token(email, SECRET)


def read_token(tok: str) -> Optional[dict]:
    return security_ops.read_token(tok, SECRET)


async def current_user(authorization: str = Header(default="")) -> dict:
    tok = authorization.replace("Bearer ", "").strip()
    data = read_token(tok)
    if not data or data.get("sub") not in USERS:
        raise HTTPException(status_code=401, detail="Unauthorized")
    # S1: деактивированный пользователь не должен работать по ранее выданному токену (до 8ч).
    u0 = USERS[data["sub"]]
    if not u0.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account disabled")
    # Смена пароля отзывает ВСЕ ранее выданные токены: issued-at (= exp - TTL) до момента смены → 401.
    # pw_changed_at живёт в users.doc → переживает рестарт без отдельной инфраструктуры.
    if u0.get("pw_changed_at") and (data.get("exp", 0) - security_ops.TOKEN_TTL) < u0["pw_changed_at"]:
        raise HTTPException(status_code=401, detail="Token revoked")
    if await _is_revoked(_token_sig(tok)):
        raise HTTPException(status_code=401, detail="Token revoked")
    email = data["sub"]
    u = USERS[email]
    # person_id — связь логина с реестром людей: ставит синк людей (по совпадению email) и
    # разовый migrate_identity. POST /admin/users его НЕ проставляет — новый логин живёт с
    # person_id=None до ближайшего синка. Без него `_my_task_match` сравнивает
    # assignee_person_id задачи с пустотой и выходит сразу: «Мои задачи» и ICS молча пусты.
    return {"id": u["id"], "email": email, "full_name": u.get("full_name"), "role": u.get("role"),
            "is_active": u.get("is_active", True), "bitrix24_user_id": u.get("bitrix24_user_id"),
            "person_id": u.get("person_id"),
            # 2FA-статус для фронта (модалка-гейт + секция профиля). Секрет НЕ отдаём.
            "twofa_enabled": bool(u.get("twofa_enabled")),
            "twofa_required": True,
            "twofa_grace_until": _twofa_grace_until_iso(u)}


# Серверный RBAC (модель оригинала, permissions.py):
#   запись (POST/PUT/PATCH/DELETE) — только роль pm И только свои проекты (pm_id==user или со-РП);
#   чтение — owner/viewer видят все проекты, pm — только свои (scope в списках);
#   админ-эндпоинты (Bitrix) — только owner.
# S3: владение определяется ТОЛЬКО по pm_id/editors, НЕ по изменяемому pm_name — иначе любой pm
# мог переименоваться в PUT /me под pm_name легаси-проекта и присвоить его. Легаси-проекты без
# pm_id (импортированные РП без логина) назначаются реальному РП через POST /admin/projects/{pid}/transfer.
# Две роли (WP2). Ключи ролей НЕ переименовываем — только лейблы в UI:
#   owner = «Руководитель портфеля» — видит и ПРАВИТ любой проект + админка;
#   pm    = «Руководитель проекта»  — только свои проекты и те, где он со-РП.
# Роль viewer удалена: чтение без правки дают наблюдатели проекта, чтение всех проектов — роль exec.
WRITE_ROLES = {"owner", "pm", "exec"}   # кто вообще может писать — в СВОИХ проектах
# Роли с ПОРТФЕЛЬНЫМ скоупом: не ограничены владением — ни на чтении, ни на записи.
# ВИДЕТЬ ВСЁ и ПРАВИТЬ ВСЁ — разные права, и это единственная причина, по которой роль
# «Руководство компании» (exec) вообще возможна: она читает любой проект, но правит только свои,
# как обычный РП. Пока множество было одно, добавление роли в «видит всё» автоматически давало
# бы ей право менять чужую работу.
READ_ALL_ROLES = {"owner", "exec"}
WRITE_ALL_ROLES = {"owner"}          # править ЧУЖОЙ проект может только руководитель портфеля


def _tree_of(m: dict) -> dict:
    """Транзиентный блок дерева — ВСЕГДА словарь, даже когда его нет.

    Три места доставали его одной и той же строкой с `isinstance` внутри условного выражения.
    Такая запись читается как проверка, но ею не является: проверяется результат ОДНОГО вызова
    `.get`, а берётся результат другого, и статический анализ справедливо считает значение
    необязательным. Одна функция — и проверка с результатом наконец об одном и том же.
    """
    t = m.get("_tree")
    return t if isinstance(t, dict) else {}


def _tree_list(it: dict, api_key: str, tree_key: str) -> list:
    """Унаследованный по дереву список — из формы API (`to_project`) или из меты (`_tree`).

    Тот же двойной приём, что у editors/_editors: одна функция обслуживает и строку списка,
    и сырую мету. Источник у обоих один — db._TREE_CTE, поэтому разойтись им не на чем.
    """
    v = it.get(api_key)
    if v is None:
        v = _tree_of(it).get(tree_key)
    return [str(x) for x in (v or [])]


def _owns_item(user: dict, it: dict) -> bool:
    """Право ПИСАТЬ в проект: РП, со-РП — либо РП/со-РП ЗОНТИКА над этим проектом.

    Наследование по дереву НЕ ХРАНИТСЯ в мете: его считает SQL (db._TREE_CTE) и приносит в
    транзиентном `_tree`, а project_meta.raw_for_save снимает перед записью. Материализовать
    его в `_editors` нельзя — маршруты со-РП читают тот же список, мутируют и пишут обратно,
    и первая же правка впечатала бы наследование в данные навсегда.

    Управление доступом наследование НЕ даёт: `_is_primary_pm_or_owner` спрашивает только
    pm_id, поэтому РП зонтика правит подпроект, но не раздаёт в нём со-РП.
    """
    uid = str(user.get("id") or "")
    if it.get("pm_id") and str(it["pm_id"]) == uid:
        return True
    # со-РП (co-PM): пользователь в списке _editors проекта тоже владеет им (read+write скоуп).
    # Единственная точка: и rbac (write/read), и _accessible_projects (списки) ходят сюда.
    eds = it.get("editors") if it.get("editors") is not None else it.get("_editors")
    if uid and uid in [str(x) for x in (eds or [])]:
        return True
    if uid and uid in _tree_list(it, "inherited_editors", "inherited_editors"):
        return True
    return False


def _observes_item(user: dict, it: dict) -> bool:
    """Наблюдатель проекта: доступ ТОЛЬКО на чтение.

    Намеренно отдельная функция, а не ещё одна ветка в `_owns_item`: тот отвечает
    на вопрос «можно ли писать», и через него ходят все пять write-гардов
    (project_ops_routes, share_notes_routes, drafts_routes). Положить наблюдателей
    туда — значит молча выдать им право правки везде разом.
    """
    uid = str(user.get("id") or "")
    if not uid:
        return False
    obs = it.get("observers") if it.get("observers") is not None else it.get("_observers")
    if uid in [str(x) for x in (obs or [])]:
        return True
    # По дереву: РП и со-РП подпроектов читают зонтик и соседние подпроекты, а наблюдатели
    # зонтика читают его подпроекты. Тоже вычисляется, а не хранится (см. _owns_item).
    return uid in _tree_list(it, "inherited_observers", "inherited_observers")


def _can_read_item(user: dict, it: dict) -> bool:
    """Единая точка ЧТЕНИЯ проекта: владелец (РП или со-РП) либо наблюдатель.

    Пара к `_owns_item`: тот — про запись, этот — про чтение. Всё, что показывает
    проект или считает по нему аналитику, спрашивает здесь; всё, что меняет, —
    у `_owns_item`.
    """
    return _owns_item(user, it) or _observes_item(user, it)


def _leads_project(user: dict, m: dict) -> bool:
    """Ведёт ли человек ЭТОТ проект: РП, со-РП или руководство зонтика над ним.

    Отличие от `_is_primary_pm_or_owner` — в роли: там owner отвечает True на ЛЮБОЙ проект,
    здесь роль не смотрится вовсе. Нужно там, где решается, кого ПОЗВАТЬ: владелец портфеля не
    должен получать уведомления по всем чужим проектам, чтобы среди них потерять свои.
    """
    return _owns_item(user, m)


def _can_decide_access(user: dict, m: dict) -> bool:
    """Кто вправе решить запрос на просмотр: тот, кто ведёт проект, плюс владелец портфеля.

    Со-РП включён намеренно: он правит проект целиком, и запрещать ему пустить человека
    ПОСМОТРЕТЬ — правило, которое пришлось бы объяснять. Владелец портфеля остаётся как
    запасной путь (РП в отпуске, уволился), но в уведомления ему это не попадает — см.
    `_leads_project`.
    """
    return user.get("role") == "owner" or _leads_project(user, m)


def _is_primary_pm_or_owner(user: dict, m: dict) -> bool:
    """Право управлять со-РП/передачей: owner ИЛИ основной РП проекта (НЕ со-РП — чтобы
    со-РП не плодил со-РП). Отличается от _owns_item, который включает со-РП.
    S3: только pm_id, без изменяемого pm_name (см. _owns_item).
    Роль основного РП должна быть write-способной (pm): если owner разжаловал pm→viewer,
    но не передал проект, прежний pm_id не должен давать управление со-РП/шарингом."""
    if user.get("role") == "owner":
        return True
    if user.get("role") in WRITE_ROLES and m.get("pm_id") and str(m["pm_id"]) == str(user.get("id")):
        return True
    return False


_OWNS_TTL: dict = {}  # (uid,pid) -> (result, ts); кэш владения на ~30с (убирает дубль-запрос при просмотре)


async def _user_owns_project(user: dict, pid: str) -> bool:
    key = (str(user.get("id")), str(pid))
    hit = _OWNS_TTL.get(key)
    if hit and (time.time() - hit[1]) < 30:
        return hit[0]
    el = await db.get_project_row(pid)
    res = _owns_item(user, _meta(el)) if el else False
    if len(_OWNS_TTL) > 2000:
        _OWNS_TTL.clear()
    _OWNS_TTL[key] = (res, time.time())
    return res


async def _user_can_read_project(user: dict, pid: str) -> bool:
    """Право ЧИТАТЬ проект: владение (РП/со-РП) ИЛИ наблюдение.

    Свой ключ в кэше и ОДИН запрос на оба вопроса. Наивный вариант «сначала спросить
    `_user_owns_project`, потом дочитать наблюдателей» стоил бы второго обращения
    к базе на каждом отказе — а отказ на чужом проекте это самый горячий путь RBAC.
    Пара к `_user_owns_project`, который остаётся гардом записи.
    """
    key = (str(user.get("id")), str(pid), "read")
    hit = _OWNS_TTL.get(key)
    if hit and (time.time() - hit[1]) < 30:
        return hit[0]
    el = await db.get_project_row(pid)
    res = _can_read_item(user, _meta(el)) if el else False
    if len(_OWNS_TTL) > 2000:
        _OWNS_TTL.clear()
    _OWNS_TTL[key] = (res, time.time())
    return res


def _invalidate_project_ownership(pid) -> None:
    """Сбросить кэш владения для проекта после transfer/смены со-РП — иначе прежний РП
    сохраняет write-доступ до истечения TTL (30с)."""
    spid = str(pid)
    for k in [k for k in _OWNS_TTL if k[1] == spid]:
        _OWNS_TTL.pop(k, None)


def _invalidate_tree_access() -> None:
    """Сбросить кэш доступа ЦЕЛИКОМ после события дерева (привязка/отвязка, передача зонтика).

    Точечная чистка тут невозможна: затронуты зонтик, все его подпроекты и все их участники,
    а `_OWNS_TTL` о дереве ничего не знает — чтобы вычислить набор ключей, пришлось бы идти
    в базу из функции, которая по замыслу в базу не ходит. События дерева редки, а кэш живёт
    30 секунд: полная очистка стоит одного лишнего запроса на проект.
    """
    _OWNS_TTL.clear()


def _in_tree(m: dict) -> bool:
    """Участвует ли проект в дереве — есть ли у него зонтик или подпроекты."""
    t = _tree_of(m)
    return bool(t.get("parent_id") or t.get("subprojects_count"))


def _invalidate_after_membership_change(pid, m: dict, uid=None) -> None:
    """Сбросить кэш доступа после смены состава прав проекта — с оглядкой на дерево.

    Точечная чистка закрывает ровно пару (человек, проект). Пока дерева не было, этого
    хватало. Теперь та же правка меняет права на ДРУГИХ проектах: со-РП зонтика правит все
    его подпроекты, а РП подпроекта читает зонтик и всех соседей. Ключи тех проектов
    точечный pop не достаёт по построению — он ищет по `pid`, а протухли записи с другими id.
    Снятый со-РП зонтика ещё 30 секунд писал бы во все подпроекты; это stale positive,
    самый неприятный случай.

    Правило живёт ЗДЕСЬ, а не в шести маршрутах: разложить его по местам вызова значило бы
    завести шесть копий одного условия — ровно то, на чём в этом проекте уже трижды
    расходились правила доступа.
    """
    if uid is not None:
        _invalidate_user_access(uid, pid)
    else:
        _invalidate_project_ownership(pid)
    if _in_tree(m):
        _invalidate_tree_access()


def _invalidate_user_access(uid, pid) -> None:
    """Сбросить кэш доступа ОДНОГО человека к проекту — сразу и на запись, и на чтение.

    Ключи у двух гардов разной формы: `(uid, pid)` у владения и `(uid, pid, "read")`
    у чтения. Точечный `pop` по одному ключу оставил бы второй жить до 30 секунд —
    и добавленный со-РП или наблюдатель полминуты не видел бы проект.
    """
    su, sp = str(uid), str(pid)
    for k in [k for k in _OWNS_TTL if k[0] == su and k[1] == sp]:
        _OWNS_TTL.pop(k, None)


# Публичный доступ по share-токену (просмотр без входа). Синтетический пользователь role="public"
# (не в WRITE_ROLES → запись невозможна), read-only, скоуп — только опубликованные разделы проекта.
_PUBLIC_USER = {"id": "public", "email": "", "full_name": "public", "role": "public",
                "is_active": True, "bitrix24_user_id": None}
# endpoint-сегмент → раздел (для проверки, что раздел опубликован). Неизвестный сегмент → None (запрет).
_SECTION_BY_SEG = {
    "tasks": "wbs", "gantt-data": "wbs", "task-dependencies": "wbs",
    "risks": "risks", "risks-summary": "risks",
    "team": "team", "stakeholders": "stakeholders", "assumptions": "assumptions",
    "communication-plan": "comm-plan", "kpis": "kpis", "decisions": "decisions",
    "budget-items": "budget", "budget-summary": "budget",
    "backlog": "backlog", "meetings": "meetings",
    "status-reports": "reports", "baselines": "baseline",
    # S2: `notes` НЕ маппится на public-раздел — внутренние заметки не отдаются по share-ссылке
    # (раньше сегмент notes был привязан к reports и утекал анонимам при публикации отчётов).
}


def _path_section(path: str):
    m = re.match(r"^/projects/[^/]+(?:/([^/?]+))?", path)
    if not m:
        return None
    seg = m.group(1)
    if not seg:                       # GET /projects/{pid} — заголовок/паспорт-скаляры
        return "passport"
    return _SECTION_BY_SEG.get(seg)   # неизвестный сегмент → None (запрет)


def _section_published(sid: str, cfg: dict) -> bool:
    secs = cfg.get("sections") or []
    if sid == "wbs":                  # список задач нужен для WBS/Ганта/Канбана
        return any(s in secs for s in ("wbs", "gantt", "kanban"))
    return sid in secs


async def _resolve_public(token: str, pid: str, path: str):
    el, m = await _find_share(token)
    if not el or str(el["id"]) != str(pid):
        return None
    sid = _path_section(path)
    if sid is None or not _section_published(sid, _share_cfg(m or {})):
        return None
    return dict(_PUBLIC_USER)


async def rbac(request: Request) -> dict:
    pid = request.path_params.get("pid")
    # Публичный share-токен работает только на GET и только к опубликованным разделам своего проекта.
    if request.method == "GET" and pid:
        token = request.query_params.get("share")
        if token:
            pub = await _resolve_public(token, pid, request.url.path)
            if pub:
                return pub
            # невалидный/непубличный share — падаем в обычную авторизацию (вдруг залогинен)
    user = await current_user(request.headers.get("authorization", ""))
    write = request.method in ("POST", "PUT", "PATCH", "DELETE")
    if write and user.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail=f"Роль «{user.get('role')}» — только чтение")
    # Единый гейт владения для чтения И записи: РПП (owner) — портфельный скоуп, проходит везде;
    # РП (pm) — только свои проекты и те, где он со-РП (_owns_item).
    # Тексты detail — часть байт-контракта (лежат в голденах как тела 403), менять нельзя.
    # На запись «сквозная» роль только одна — руководитель портфеля. Руководство компании (exec)
    # читает любой проект, но правит его наравне с РП: только свой.
    # Наблюдатель проекта проходит только на ЧТЕНИЕ: на записи по-прежнему спрашиваем
    # владение (`_user_owns_project`), и наблюдатель получает тот же 403, что и чужой РП.
    scope_roles = WRITE_ALL_ROLES if write else READ_ALL_ROLES
    if pid and user.get("role") not in scope_roles:
        # Порядок важен: без pid и для сквозной роли в базу не ходим вовсе.
        allowed = (await _user_owns_project(user, str(pid)) if write
                   else await _user_can_read_project(user, str(pid)))
        if not allowed:
            raise HTTPException(status_code=403,
                                detail=("Изменять можно только свои проекты" if user.get("role") == "exec"
                                        else "PM может изменять только свои проекты") if write
                                else "PM может просматривать только свои проекты")
    return user


def require_owner(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Доступно только владельцу портфеля (owner)")
    return user


def require_portfolio_view(user: dict = Depends(current_user)) -> dict:
    """Портфель проектов — всем, кто вообще ведёт проекты.

    Данные при этом НЕ становятся общими: каждый портфельный обработчик режет выборку
    через `_accessible_projects`/`fetch_projects(user=...)`, то есть РП увидит ровно свои
    проекты, те, где он со-РП, и те, где он наблюдатель. Гард отвечает только на вопрос
    «пускать ли на страницу», а не «что показать».

    Заменил прежний `require_read_all` (owner + exec), у которого не осталось вызовов:
    два гарда с одинаковым текстом отказа неминуемо разъехались бы. Админские вещи
    (снимки, дайджесты, OUTBOX, люди, настройки, реестр) по-прежнему на `require_owner` —
    это управление порталом, а не взгляд на проекты.

    Роль `viewer` сюда не проходит: смотреть портфель без единого своего проекта незачем,
    а пустая страница выглядит поломкой. Текст отказа прежний — он лежит в голденах.
    """
    if user.get("role") not in READ_ALL_ROLES and user.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Доступно только владельцу портфеля (owner)")
    return user


# ---------- Bitrix24 helpers ----------
def _bx_safe_error(err) -> str:
    """Текст ошибки, пригодный для журнала и UI.

    В сообщении httpx лежит ПОЛНЫЙ URL вызова, а токен вебхука — часть пути
    (…/rest/7001/<СЕКРЕТ>/method.json). Ровно этот журнал показывается в настройках, поэтому
    URL вырезаем: иначе аккуратный `_bitrix_settings_view()`, который никогда не отдаёт токен,
    обесценивается одной строчкой лога.
    """
    msg = str(err or "")
    url = _bitrix_url()
    if url:
        msg = msg.replace(url, "<bitrix>")
    msg = re.sub(r"https?://\S*?/rest/\d+/\w+", "<bitrix>", msg)
    msg = msg[:200]
    # httpx-таймаут даёт ПУСТОЙ str(e) — а пустая строка falsy, и `if err:` её пропустил бы.
    # Для синка людей это смертельно: пустая ошибка выглядела бы как «обход прошёл успешно» →
    # деактивация всех. У исключения с пустым текстом берём хотя бы имя класса (ConnectTimeout).
    # Пустую СТРОКУ не трогаем — это штатное «ошибки нет» (успешный вызов зовёт нас с "").
    if not msg and isinstance(err, BaseException):
        return type(err).__name__
    return msg


async def bx_call(method: str, payload=None) -> tuple[Optional[dict], str]:
    """Единственное место, которое ОТЛИЧАЕТ «Bitrix ответил пусто» от «Bitrix не ответил».

    Прежний bx() возвращал None и при сетевом сбое, и при пустом ответе, а ошибку Bitrix
    ({"error": "QUERY_LIMIT_EXCEEDED"}) отдавал как обычный dict — статус ответа не проверялся.
    Для синка людей это смертельно: один таймаут на третьей странице выглядел бы как
    «этих ста человек в Bitrix больше нет» → массовое увольнение. Возвращаем (данные, ошибка).
    """
    url = _bitrix_url()
    if not url:
        return None, "Bitrix24 не настроен"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{url}/{method}.json", json=payload or {})
            data = r.json() if r.content else None
    except Exception as e:  # noqa: BLE001
        return None, _bx_safe_error(e)
    if not isinstance(data, dict):
        return None, f"Bitrix24 {method}: пустой ответ"
    if data.get("error"):
        return None, _bx_safe_error(f"{data.get('error')}: {data.get('error_description') or ''}")
    return data, ""


async def bx(method: str, payload=None):
    """Совместимый фасад: распарсенный JSON или None. Все прежние вызывающие и так трактовали
    ответ с "error" как отсутствие result — поведение не меняется."""
    data, err = await bx_call(method, payload)
    if err and _bitrix_url():
        logger.warning("Bitrix24 %s failed: %s", method, err)
    return data


async def _bx_log(action: str, status: str, error: str = "",
                  task_id=None, bx_task_id=None) -> None:
    """Строка в журнал синхронизации. Журнал вспомогательный: его сбой не должен ронять
    ни запрос пользователя, ни фоновую джобу."""
    try:
        await db.append_bitrix_log({
            "task_id": task_id, "bitrix24_task_id": bx_task_id, "sync_action": action,
            "status": status, "error_message": _bx_safe_error(error) or None, "synced_at": _now_iso()})
    except Exception as e:  # noqa: BLE001
        logger.warning("Не удалось записать журнал Bitrix24 (%s): %s", action, e)


# Лёгкая разметка описаний — наша, портальная (см. utils/richText.tsx на фронте). Bitrix ждёт
# BB-код, и звёздочки приехали бы туда литералами: «**Важно**» вместо жирного. Снимаем маркеры
# перед отправкой — на той стороне лучше простой текст, чем мусор.
#
# ЗЕРКАЛО `stripRichText`, и это не фигура речи: обе функции обязаны давать один результат на
# одном тексте. Регулярками этого удержать не вышло — «5 * 4» на экране оставалось умножением,
# а сюда приезжало как «5  4»: знак молча пропадал, потому что первая звёздочка открывала
# курсив, а закрывала его звёздочка из совсем другого места. Поэтому здесь тот же разбор, что
# и на фронте: серия звёздочек становится разметкой, только если она годится в пару.
# Маркер строки: сам знак плюс пробелы. Требование «дальше есть текст» проверяем ОБЩИМ
# предикатом `_md_ink`, а не `(?=\S)`: на фронте это `\S`, и наборы пробельных расходятся —
# «## <BOM>Итог» один считал заголовком, другой нет.
_MD_HEADING = re.compile(r"^[ \t]*#{1,3}[ \t]+")
_MD_BULLET = re.compile(r"^[ \t]*[-*][ \t]+")
# Нумерованной строке здесь делать нечего: «1. раз» маркеров не несёт и остаётся собой и в
# портале, и в Bitrix. Регулярка для неё была и не читалась никем — мёртвый код в зеркале
# опаснее обычного: по нему потом «восстанавливают» поведение, которого на второй стороне нет.
# Перед открывающей звёздочкой допустимы начало строки, ПРОБЕЛЬНЫЙ символ и открывающая
# пунктуация: иначе `some_var*2` стало бы разметкой, а это имя переменной.
#
# Пробельность — `isspace()` ПЛЮС U+FEFF: на фронте это регулярка, и наборы расходятся по краям.
# `\s` в JS знает U+FEFF (BOM, приезжает при вставке из файла), а `isspace()` знает U+0085 и
# U+001C..U+001F; зеркала обязаны сойтись на объединении. Обычный неразрывный пробел знают оба,
# и текст с ним приходит из Word постоянно.
_MD_OPEN_PUNCT = set("([{" + chr(0x00AB) + '"' + chr(0x201C) + "'" + chr(0x2014) + chr(0x2013) + "-")


def _md_ws(ch: str) -> bool:
    """Пробельный символ — так же, как его понимает фронт."""
    return bool(ch) and (ch.isspace() or ch == chr(0xFEFF))


def _md_after(line: str, marker):
    """Текст строки после маркера — или None, если это не такая строка."""
    m = marker.match(line)
    if not m:
        return None
    rest = line[m.end():]
    return rest if _md_ink(rest) else None


def _md_ink(text: str) -> bool:
    """Есть ли в куске хоть один НЕпробельный символ.

    Отдельно от `strip()`: он и `trim()` на фронте обрезают разные наборы (U+FEFF против
    U+0085), и пустота внутри обратных кавычек мерялась по-разному — «`\ufeff`» для одного
    зеркала было кодом, для другого текстом.
    """
    return any(not _md_ws(ch) for ch in text)


# Насколько глубоко разрешено вкладывать разметку и сколько серий-кандидатов смотреть в
# поисках закрывающей. Оба предела — против подобранного ввода, а не против живого текста:
# настоящая вложенность это два уровня, а закрывающая находится за единицы кандидатов.
# Без первого описание в 2 КБ из одних звёздочек давало RecursionError и 500; без второго
# 20 000 знаков вида « *a**» разбирались секунду с лишним. Зеркало — richText.tsx.
_MD_MAX_DEPTH = 8
_MD_MAX_CANDIDATES = 64


def _md_runs(line: str):
    """Все серии звёздочек в строке: (позиция, длина). Считаем ОДИН раз на строку —
    поиск закрывающей перебором остатка давал квадрат, а текст приходит недоверенный."""
    runs = []
    i = 0
    n = len(line)
    while i < n:
        if line[i] != "*":
            i += 1
            continue
        k = i
        while k < n and line[k] == "*":
            k += 1
        runs.append((i, k - i))
        i = k
    return runs


def _md_closer(closers, positions, start: int, to: int, want: int) -> int:
    """Позиция закрывающей серии для эмфазы длиной `want` в пределах [start, to), или -1.

    Перед закрывающей серией не должно быть пробела, а серию РОВНО нужной длины предпочитаем
    более длинной, беря из длинной хвост: иначе «**жирный с *курсивом***» разбирался бы с
    висящей звёздочкой. Длину серии обрезаем по границе куска — серия на краю доступна не вся.
    """
    longer = -1
    seen = 0
    for k in range(bisect.bisect_right(positions, start), len(closers)):
        at, run_len = closers[k]
        if at >= to or seen >= _MD_MAX_CANDIDATES:
            break
        seen += 1
        length = min(run_len, to - at)
        if length == want:
            return at
        if length > want and longer < 0:
            longer = at + length - want
    return longer


def _md_range(line: str, start: int, to: int, runs, closers, positions, depth: int) -> str:
    """Кусок строки [start, to) без маркеров эмфазы и кода."""
    if depth >= _MD_MAX_DEPTH:
        return line[start:to]      # глубже некуда: разметка там выдуманная, а рекурсия роняет
    out = []
    i = start
    while i < to:
        ch = line[i]
        if ch == "`":
            close = line.find("`", i + 1)
            inner = line[i + 1:close] if i + 1 < close < to else ""
            if _md_ink(inner):
                out.append(inner)        # внутри кода разметки нет: он и есть «как написано»
                i = close + 1
                continue
            out.append(ch)
            i += 1
            continue
        if ch == "*":
            # Позиция может быть СЕРЕДИНОЙ серии (её начало осталось за границей куска) —
            # тогда доступна одна звёздочка.
            run_len = min(runs.get(i, 1), to - i)
            want = 2 if run_len >= 2 else 1
            # Начало КУСКА считается началом строки: внутри жирного курсив вправе открыться
            # первым же символом («***оба***» — курсив внутри жирного, а не три звёздочки).
            at_start = i == start
            before = "" if at_start else line[i - 1]
            after = line[i + run_len] if i + run_len < to else ""
            can_open = (bool(after) and not _md_ws(after)
                        and (at_start or _md_ws(before) or before in _MD_OPEN_PUNCT))
            if can_open:
                inner_from = i + want
                close = _md_closer(closers, positions, inner_from, to, want)
                if close > inner_from and _md_ink(line[inner_from:close]):
                    out.append(_md_range(line, inner_from, close, runs, closers, positions, depth + 1))
                    i = close + want
                    continue
            out.append(line[i:i + run_len])   # не разметка — обычные звёздочки
            i += run_len
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _md_inline(line: str) -> str:
    """Строка без маркеров эмфазы и кода. Звёздочки, не образующие пару, остаются как есть."""
    if "*" not in line and "`" not in line:
        return line
    runs = _md_runs(line)
    # Закрывающей может быть только серия, перед которой не пробел. Нет таких вовсе — ни одна
    # открывающая не закроется, и перебирать остаток строки незачем.
    closers = [(at, n) for at, n in runs if at > 0 and not _md_ws(line[at - 1])]
    positions = [at for at, _ in closers]
    return _md_range(line, 0, len(line), dict(runs), closers, positions, 0)


def _plain_text(text) -> str:
    """Текст без наших маркеров разметки. Пустое остаётся пустым."""
    # Не `text or ""`: ноль и False — это ложные значения, но не пустой текст, и зеркало на
    # фронте отдаёт на них "0" и "false". Расхождение дешевле убрать, чем потом объяснять.
    src = "" if text is None else str(text)
    if not src:
        return ""
    lines = []
    for line in src.replace("\r\n", "\n").split("\n"):
        head = _md_after(line, _MD_HEADING)
        if head is not None:
            lines.append(_md_inline(head))
            continue
        bullet = _md_after(line, _MD_BULLET)
        if bullet is not None:
            lines.append("\u2022 " + _md_inline(bullet))
            continue
        lines.append(_md_inline(line))
    return "\n".join(lines)



async def bx_find_user(email: Optional[str]) -> Optional[int]:
    if not email:
        return None
    d = await bx("user.search", {"FIND": email})
    us = (d or {}).get("result") or []
    try:
        return int(us[0]["ID"]) if us else None
    except Exception:  # noqa: BLE001
        return None


async def bx_create_task(code: str, title: str, description, responsible_id, deadline, created_by=None) -> Optional[int]:
    fields = {"TITLE": f"[{code}] {title}", "DESCRIPTION": _plain_text(description),
              "RESPONSIBLE_ID": responsible_id, "DEADLINE": deadline or ""}
    if created_by:
        fields["CREATED_BY"] = created_by
    d = await bx("tasks.task.add", {"fields": fields})
    bid = ((d or {}).get("result") or {}).get("task", {}).get("id")
    return int(bid) if bid else None


PORTAL_TZ = "Europe/Riga"   # одна организация — один часовой пояс


def _meeting_start_iso(mt: dict) -> str:
    """Дата и время совещания хранятся раздельно («2026-07-20» + «14:30») — Bitrix ждёт одну
    строку. Без времени берём 10:00: событие на «весь день» вместо встречи — хуже, чем разумный
    дефолт. Без даты не возвращаем ничего: угадывать день совещания нельзя."""
    date = str(mt.get("meeting_date") or "").strip()[:10]
    if len(date) != 10:
        return ""
    tm = str(mt.get("meeting_time") or "").strip() or "10:00"
    return f"{date} {tm[:5]}:00"


def _meeting_end_iso(mt: dict) -> str:
    start = _meeting_start_iso(mt)
    if not start:
        return ""
    try:
        dt = datetime.strptime(start, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return ""
    dur = int(mt.get("duration_minutes") or 60)
    return (dt + timedelta(minutes=max(15, dur))).strftime("%Y-%m-%d %H:%M:%S")


_BX_SECTIONS: dict = {}   # owner_id → section_id: календарь пользователя один и не меняется


async def bx_calendar_section(owner_id: int) -> Optional[int]:
    """ID календаря пользователя. `calendar.event.add` без секции обычно отказывает,
    поэтому резолвим лениво и кэшируем."""
    if owner_id in _BX_SECTIONS:
        return _BX_SECTIONS[owner_id]
    d, err = await bx_call("calendar.section.get", {"type": "user", "ownerId": int(owner_id)})
    if err:
        return None
    secs = (d or {}).get("result") or []
    sid = int(secs[0]["ID"]) if secs and secs[0].get("ID") else None
    _BX_SECTIONS[owner_id] = sid
    return sid


async def bx_add_calendar_event(owner_id: int, name: str, dt_from: str, dt_to: str,
                                description: str = "", attendees=None,
                                location: str = "") -> tuple[Optional[int], str]:
    """Создать событие в календаре Bitrix. Возвращает (id, ошибка) — вызывающий сам решает,
    падать ему или записать провал в статус."""
    fields = {"type": "user", "ownerId": int(owner_id), "name": (name or "")[:255],
              "from": dt_from, "to": dt_to,
              "description": (description or "")[:2000], "location": (location or "")[:255],
              "host": int(owner_id)}
    # Гости получают приглашение ТОЛЬКО если событие оформлено как «совещание»: attendees ВКЛЮЧАЮТ
    # самого хоста, is_meeting="Y" (строка, не bool), и есть блок meeting с notify="Y". Без этого
    # Bitrix заводит событие лишь в календаре организатора и никого не зовёт (id вернёт, статус ok).
    guests = sorted({int(a) for a in (attendees or []) if str(a).isdigit() and int(a) != int(owner_id)})
    if guests:
        fields["attendees"] = [int(owner_id)] + guests
        fields["is_meeting"] = "Y"
        fields["meeting"] = {"notify": "Y", "reinvite": "N", "allow_invite": "N", "hide_guests": "N"}
    sid = await bx_calendar_section(int(owner_id))
    if sid:
        fields["section"] = sid
    d, err = await bx_call("calendar.event.add", fields)
    if err:
        await _bx_log("calendar.event.add", "error", err)
        return None, err
    await _bx_log("calendar.event.add", "ok")
    eid = _bx_parse_event_id((d or {}).get("result"))
    if eid:
        return eid, ""
    # Событие СОЗДАНО, но id не разобрали. Раньше здесь возвращалась пустая ошибка — «успех без
    # id»: вызывающий отвечал 502, а событие оставалось в календаре сиротой, без ссылки из портала.
    # Честнее сказать, что пошло не так: тогда это хотя бы видно в статусе рассылки и в журнале.
    await _bx_log("calendar.event.add", "error", "id не разобран")
    return None, f"событие создано, но id не разобран: {str((d or {}).get('result'))[:60]}"


def _bx_parse_event_id(res) -> Optional[int]:
    """id события из ответа Bitrix. Он приходит числом, строкой или объектом с ID — в разных
    версиях по-разному, поэтому разбираем все три, а не только «строку с цифрами»."""
    if isinstance(res, dict):
        res = res.get("ID") if res.get("ID") is not None else res.get("id")
    try:
        return int(str(res))
    except (TypeError, ValueError):
        return None


# ── сверка совещаний с календарём Bitrix ──────────────────────────────────────
# Связка «протокол ↔ событие» была односторонней и одноразовой: создать можно, а дальше портал
# о событии не знал ничего. Удалённое в Bitrix событие оставалось помеченным в портале навсегда,
# и кнопка «убрать из Bitrix» на нём падала с 502 — человек не мог ни отвязать, ни создать заново.

# «События нет» — это УСПЕХ удаления, а «Bitrix молчит» — повод не трогать связку. Различаем по
# тексту: единого кода ошибки Bitrix для этого случая не даёт.
_BX_EVENT_GONE_RE = re.compile(r"not[ _]?found|no[ _]?such|does not exist|не найден|не существу", re.I)
# «Method not found!» и «user not found» тоже содержат not found, но говорят про МЕТОД и про
# ПОЛЬЗОВАТЕЛЯ, а не про событие. Принять их за «событие удалено» значило бы: отключили права на
# calendar.event.delete — и портал молча рапортует об успешном удалении всего подряд.
_BX_NOT_ABOUT_EVENT_RE = re.compile(r"method|метод|user|пользовател|owner|access|доступ", re.I)


def _bx_event_gone(err: str) -> bool:
    s = str(err or "")
    if not s or _BX_NOT_ABOUT_EVENT_RE.search(s):
        return False
    return bool(_BX_EVENT_GONE_RE.search(s))


async def bx_calendar_event_ids(owner_id: int, dt_from: str, dt_to: str) -> tuple[Optional[set], str]:
    """ID событий календаря за период. `None` = Bitrix НЕ ОТВЕТИЛ — тогда ничего не отвязываем.

    Диапазоном, а не `calendar.event.getbyid`: тот на чужом личном календаре нашим вебхуком не
    проверен, и его пустой ответ неотличим от «нет прав». Ложное «событие удалено» сняло бы
    живую связку, а следующее «Создать в Bitrix» сделало бы дубль в календаре у всех участников.
    """
    d, err = await bx_call("calendar.event.get",
                           {"type": "user", "ownerId": int(owner_id), "from": dt_from, "to": dt_to})
    if err:
        return None, err
    res = (d or {}).get("result")
    # Форма ответа обязана быть СПИСКОМ. Словарь или что-то иное — мы не поняли ответ, и молчаливое
    # «список пуст» здесь означало бы «все события удалены». Тот же урок, что у синка людей:
    # при неполной выборке не деактивируется никто (см. pmo-backend/CLAUDE.md).
    if not isinstance(res, list):
        return None, f"неожиданная форма ответа calendar.event.get: {type(res).__name__}"
    if (d or {}).get("next") is not None:
        return None, "ответ календаря обрезан постраничностью — судить об удалении нельзя"
    ids = set()
    for e in res:
        eid = _bx_parse_event_id((e or {}).get("ID") if isinstance(e, dict) else None)
        if eid:
            ids.add(eid)
    return ids, ""


_BX_EVENT_WINDOW_DAYS = 90


def _bx_event_window(first: str, last: str = "") -> tuple:
    """Окно поиска события в календаре Bitrix вокруг сохранённой даты: [дата−90д, дата+90д].

    Не точная дата и не неделя: `bitrix_event_from` — дата НА МОМЕНТ СОЗДАНИЯ, а встречу могли
    перенести уже в самом Bitrix. Событие вне окна в ответе не придёт, и перенос прочитался бы
    как удаление — то есть портал оборвал бы связку с живым событием. Запрос всё равно один на
    календарь, широкое окно ничего не стоит.

    Функция общая нарочно. Сверка при синхронизации брала ±90, а отвязка одного совещания
    спрашивала ОДНИМ днём — логика одна, константы разные, и второе место молча ошибалось.

    Возвращает (lo, hi) либо (None, None), если дата не разбирается.
    """
    try:
        lo = (date.fromisoformat(first) - timedelta(days=_BX_EVENT_WINDOW_DAYS)).isoformat()
        hi = (date.fromisoformat(last or first) + timedelta(days=_BX_EVENT_WINDOW_DAYS)).isoformat()
    except ValueError:
        return None, None
    return lo, hi


def _meeting_event_owner(mt: dict, m: dict, user: dict) -> Optional[int]:
    """В ЧЬЁМ календаре лежит событие совещания.

    Событие живёт у того, кто его создал, а удаление раньше шло от имени того, кто нажал: со-РП
    (или тот же РП после смены bitrix24_user_id) бил в чужой календарь и получал отказ. С этой
    правки владельца сохраняем при создании; для событий, созданных раньше, остаются прежние
    догадки — РП проекта, затем сам нажавший.
    """
    return (_coerce_bitrix_id(mt.get("bitrix_event_owner"))
            or _project_pm_bitrix_id(m)
            or _coerce_bitrix_id(user.get("bitrix24_user_id")))


async def _reconcile_meeting_events(pid: str, m: dict, user: dict) -> dict:
    """Какие события совещаний проекта удалены на стороне Bitrix.

    Один запрос НА ВЛАДЕЛЬЦА календаря (окно от самого раннего совещания до самого позднего,
    ±7 дней), а не на каждое совещание: их у проекта десятки, а календарь один.

    Отвязываем ТОЛЬКО когда календарь ИЗВЕСТЕН — то есть владелец сохранён при создании события.
    Успешного ответа Bitrix мало: у записей, созданных до появления `bitrix_event_owner`, владельца
    приходится угадывать (РП проекта, затем нажавший), а спросив ЧУЖОЙ календарь, мы получим
    честный пустой ответ — и приняли бы его за удаление живого события. Догадка лечится
    попаданием: нашли событие — запомнили владельца, и следующая сверка уже вправе судить.
    Промах по угаданному календарю не значит ничего.

    Таймаут, отказ в правах, обрезанный ответ — тоже оставляем связку как есть: пропущенное
    удаление человек переживёт, а стёртая связка на живом событии врёт и плодит дубли.
    """
    out: dict = {"checked": 0, "gone": [], "backfill_owner": {}}
    if not _bitrix_url():
        return out
    by_owner: dict = {}
    for mt in _coll(m, "_meetings"):
        if not isinstance(mt, dict):
            continue
        eid = _coerce_bitrix_id(mt.get("bitrix_event_id"))
        if not eid:
            continue
        owner = _meeting_event_owner(mt, m, user)
        start = str(mt.get("bitrix_event_from") or _meeting_start_iso(mt))[:10]
        if not owner or len(start) != 10:
            continue          # не у кого или не про что спрашивать — гадать не будем
        by_owner.setdefault(int(owner), []).append((str(mt.get("id")), eid, start, mt))
    for owner, rows in by_owner.items():
        days = sorted(r[2] for r in rows)
        lo, hi = _bx_event_window(days[0], days[-1])
        if lo is None or hi is None:
            continue
        ids, err = await bx_calendar_event_ids(owner, lo, hi)
        if ids is None:
            await _bx_log("calendar.reconcile", "error", err)
            continue
        for mid, eid, _s, mt in rows:
            known = bool(_coerce_bitrix_id(mt.get("bitrix_event_owner")))
            out["checked"] += 1
            if eid in ids:
                if not known:
                    out["backfill_owner"][mid] = owner   # догадка подтвердилась — запоминаем
            elif known:
                out["gone"].append(mid)
            # else: календарь всего лишь угадан, промах ничего не доказывает — связку не трогаем
    return out


async def _meeting_on_delete(pid: str, item: dict, user: dict) -> None:
    """Совещание удалили в портале — убрать и событие в календаре Bitrix.

    Best-effort: провал Bitrix не отменяет удаление протокола, оно уже произошло. Раньше хука не
    было вовсе, и событие оставалось в календаре навсегда — причём без единой ссылки на него:
    id уезжал вместе с удалённым документом.
    """
    it = item or {}
    eid = _coerce_bitrix_id(it.get("bitrix_event_id"))
    if not eid or not _bitrix_url():
        return
    # Владельца ищем той же лестницей, что и везде: сохранённый → РП проекта → удаливший.
    # Отдельная лестница здесь однажды разъехалась бы с основной — а тут удаляют по-настоящему.
    try:
        _, m = await load_meta(pid)
    except Exception:  # noqa: BLE001 — проект мог исчезнуть; тогда судим по тому, что есть
        m = {}
    owner = _meeting_event_owner(it, m, user)
    if not owner:
        return
    ok, err = await bx_delete_calendar_event(owner, eid)
    await _append_action_log(pid, user, "meetings.bitrix_delete",
                             f"{it.get('title') or ''}: событие {eid} "
                             + ("удалено в Bitrix" if ok else f"НЕ удалено — {err}")[:100])


async def bx_delete_calendar_event(owner_id: int, event_id: int) -> tuple[bool, str]:
    """Удалить событие календаря Bitrix (calendar.event.delete). (успех, ошибка).

    «События уже нет» считаем успехом: цель вызова — чтобы события не было, и она достигнута.
    Пока это была ошибка, повторная попытка отвязать удалённое в Bitrix совещание возвращала 502
    вечно, и снять отметку «✓ Bitrix» в портале было нечем.
    """
    _, err = await bx_call("calendar.event.delete", {"type": "user", "ownerId": int(owner_id), "id": int(event_id)})
    if err and _bx_event_gone(err):
        await _bx_log("calendar.event.delete", "ok", "события уже нет в Bitrix")
        return True, ""
    if err:
        await _bx_log("calendar.event.delete", "error", err)
        return False, err
    await _bx_log("calendar.event.delete", "ok")
    return True, ""


# Коды статусов Bitrix — сверено по живому порталу (tasks.task.getFields):
#   2 «Ждёт выполнения» · 3 «Выполняется» · 4 «Ожидает контроля» · 5 «Завершена» · 6 «Отложена».
# Статуса «отменена» у Bitrix НЕТ; ближайшее по смыслу — «Отложена» (задача точно не в работе).
# Отображение лоссовое (on_hold и cancelled оба → 6), поэтому обратный путь опирается НЕ на
# маппинг, а на tasks.bx_status — код, который мы сами туда положили (см. вебхук).
OURS_TO_BX_STATUS = {"not_started": "2", "in_progress": "3", "on_hold": "6",
                     "completed": "5", "cancelled": "6"}

# Поля задачи, изменение которых имеет смысл донести до Bitrix.
BX_PUSH_FIELDS = ("title", "description", "planned_end", "status", "assignee_email")


def _bx_date(raw) -> Optional[str]:
    """Дата задачи из Bitrix → наш TEXT-формат «ГГГГ-ММ-ДД».

    tasks.task.* отдаёт ISO 8601 со смещением портала («2026-08-17T00:30:00+03:00»). Берём
    КАЛЕНДАРНЫЙ день как прислали, без перевода в UTC: задача, начатая в 00:30 по Риге, иначе
    приехала бы вчерашним числом. Запасной разбор «17.08.2026 10:30» — у разных методов Bitrix
    формат дат разный (ср. календарь, bitrix_calendar_routes._to_iso, там свой). Пусто и
    непонятное → None: в TEXT-колонке даты сравниваются строками, мусор в ней хуже пустоты.
    """
    s = str(raw or "").strip()
    if not s:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    m = re.match(r"^(\d{2})[.](\d{2})[.](\d{4})", s)
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None

_BG_TASKS: set = set()   # сильные ссылки на фоновые задачи: без них GC вправе убить их на середине


def _bx_bg(coro) -> None:
    """Отправка в Bitrix в фоне: сохранение задачи не должно ждать чужой сервер (до 15 с)
    и не должно падать из-за его икоты. Вне event-loop (юнит-тесты) просто не шлём."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        return
    t = loop.create_task(coro)
    _BG_TASKS.add(t)
    t.add_done_callback(_BG_TASKS.discard)


async def bx_push_task(tid: str, bx_id: int, code: str, tk: dict, changed) -> None:
    """Наши правки задачи → в Bitrix (tasks.task.update). Шлём ТОЛЬКО изменившиеся поля.

    Вызывать строго из роута правки задачи. Внутрь db.update_task это вешать нельзя:
    входящий вебхук пишет статус именно туда, напрямую — получилось бы кольцо
    Bitrix → PMO → Bitrix → ONTASKUPDATE → …
    """
    changed = set(changed or ())
    fields: dict = {}
    if "title" in changed:
        fields["TITLE"] = f"[{code}] {tk.get('title') or ''}"   # префикс кода — как при создании
    if "description" in changed:
        fields["DESCRIPTION"] = _plain_text(tk.get("description"))
    if "planned_end" in changed:
        fields["DEADLINE"] = tk.get("planned_end") or ""
    bx_code = OURS_TO_BX_STATUS.get(str(tk.get("status") or ""))
    if "status" in changed and bx_code:
        fields["STATUS"] = bx_code
    assignee_unresolved = False
    if "assignee_email" in changed and tk.get("assignee_email"):
        rid = await bx_find_user(tk.get("assignee_email"))
        if rid:
            fields["RESPONSIBLE_ID"] = rid
        else:
            assignee_unresolved = True   # исполнителя в Bitrix не нашли — смена НЕ уедет
    if not fields:
        return
    if "STATUS" in fields:
        # Метку пишем ДО отправки, а не после. Bitrix на наш update мгновенно шлёт ONTASKUPDATE,
        # и это эхо может прийти в вебхук РАНЬШЕ, чем мы успели записать метку — тогда «Отменена»
        # (наш код 6) вебхук принял бы за правку человека и перезаписал бы на «Отложена» (тот же
        # код 6, маппинг лоссовый). Пишем заранее: код в Bitrix станет ровно этим.
        await db.set_task_bx_status(tid, fields["STATUS"])
    _, err = await bx_call("tasks.task.update", {"taskId": int(bx_id), "fields": fields})
    if err:
        await _bx_log("task.update", "error", err, task_id=tid, bx_task_id=bx_id)
        return
    # Журнал не должен говорить «ok», если часть правки потерялась: смену исполнителя не
    # донесли, потому что его не нашли в Bitrix по email — это видно только здесь.
    if assignee_unresolved:
        await _bx_log("task.update", "error",
                      f"исполнитель {tk.get('assignee_email')} не найден в Bitrix — RESPONSIBLE_ID не обновлён",
                      task_id=tid, bx_task_id=bx_id)
    else:
        await _bx_log("task.update", "ok", task_id=tid, bx_task_id=bx_id)


def _email_bg(*args, **kwargs):
    """Отправить письмо НЕ блокируя ответ: в фоновом потоке (медленный SMTP не вешает запрос).
    Вне event-loop (напр. в тесте) — синхронно."""
    try:
        asyncio.get_running_loop().create_task(asyncio.to_thread(mailer.send_email, *args, **kwargs))
    except RuntimeError:
        mailer.send_email(*args, **kwargs)


def _meta(el: dict) -> dict:
    return project_meta_ops.parse(el)


def to_project(el: dict) -> dict:
    m = _meta(el)
    return {
        "id": str(el.get("id")),
        "code": m.get("code") or el.get("identifier"),
        "name": el.get("name"),
        "status": m.get("status") or "planning",
        "priority": m.get("priority") or "medium",
        "project_kind": m.get("project_kind"),
        "pm_id": m.get("pm_id"),
        "pm": m.get("pm"),
        "archived": bool(m.get("_archived")),
        "is_template": bool(m.get("_is_template")),
        "editors": [str(x) for x in (m.get("_editors") or [])],
        "observers": [str(x) for x in (m.get("_observers") or [])],
        "client": m.get("client"),
        "program": m.get("program"),
        "pm_name": m.get("pm_name"),
        "version": m.get("version"),
        "version_date": m.get("version_date"),
        "goal": m.get("goal"),
        "scope": m.get("scope"),
        "project_result": m.get("project_result"),
        "success_criteria": m.get("success_criteria"),
        "key_milestones": m.get("key_milestones"),
        "description": m.get("description"),
        "budget": m.get("budget"),
        "budget_currency": m.get("budget_currency") or "EUR",
        "planned_start": m.get("planned_start"),
        "planned_end": m.get("planned_end"),
        "actual_start": m.get("actual_start"),
        "actual_end": m.get("actual_end"),
        "bitrix_last_sync": m.get("bitrix_last_sync"),   # PULL-синк задач: дата последней синхронизации
        "created_at": el.get("createdAt"),
        "updated_at": el.get("updatedAt"),
        # ── дерево проектов (зонтик/подпроекты) ──────────────────────────────────────────
        # Строго В КОНЦЕ и в этом порядке: байты паспорта — контракт, а дописанный хвост
        # ломает меньше всего. Значения вычисляются в SQL (db._TREE_CTE), в мете их нет.
        **_tree_fields(m),
    }


def _tree_fields(m: dict) -> dict:
    """Поля дерева для ответов API. Одна функция на три вида ответа, чтобы состав не разъехался."""
    t = _tree_of(m)
    pid = t.get("parent_id")
    return {
        "parent_id": str(pid) if pid not in (None, "") else None,   # id наружу — строкой, как везде
        "parent_code": t.get("parent_code"),
        "parent_name": t.get("parent_name"),
        "subprojects_count": int(t.get("subprojects_count") or 0),
        "inherited_editors": [str(x) for x in (t.get("inherited_editors") or [])],
        "inherited_observers": [str(x) for x in (t.get("inherited_observers") or [])],
    }


def to_list_item(el: dict) -> dict:
    p = to_project(el)
    out = {k: p[k] for k in ("id", "code", "name", "status", "priority", "project_kind", "pm_id", "pm_name",
                             "planned_start", "planned_end", "created_at", "archived", "is_template", "editors",
                             "observers",
                             # дерево: список проектов рисует детей под зонтиком и подписывает роль
                             "parent_id", "parent_code", "parent_name", "subprojects_count",
                             "inherited_editors", "inherited_observers")}
    # Живые task-счётчики подставляет /projects одним bulk-запросом после фильтрации страницы.
    out["progress"] = 0
    out["tasks_total"] = 0
    out["tasks_completed"] = 0
    return out


async def fetch_projects(with_docs: bool = True, user: Optional[dict] = None) -> list:
    # RBAC-предфильтр в SQL (задел на рост портфеля). user=None и owner/viewer (READ_ALL_ROLES) →
    # scope=None → ДОСЛОВНО прежний запрос → байт-идентично по построению. pm → SQL отдаёт только его
    # проекты (pm_id/editors); Python-фильтр _owns_item у вызывающих остаётся как страховка поверх SQL.
    scope = None if (user is None or user.get("role") in READ_ALL_ROLES) else str(user.get("id"))
    els = await db.fetch_project_rows(owner_scope=scope)  # уже id DESC
    # Нормализованные коллекции (_action_log/_meetings/_backlog/_notes) нужны только тем, кто их
    # читает. Списки (to_project/to_list_item берут лишь поля паспорта) их не касаются → with_docs=False
    # пропускает bulk-загрузку project_docs. Байт-идентично: to_project не читает эти коллекции.
    if with_docs:
        # scoped-ветка грузит доки только по видимым pid; unscoped — прежний полный bulk (дословно).
        all_docs = (await db.load_project_docs_for([e.get("id") for e in els])
                    if scope is not None else await db.load_all_project_docs())
        for e in els:
            e["_docs"] = all_docs.get(str(e.get("id")), {})  # _meta(e) вольёт их в мету
    # Только проекты PM Tool (с нашим паспортом-JSON); прочие проекты не показываем.
    return [e for e in els if _meta(e)]


# ---------- auth ----------
_auth_router, login, logout, me = auth_routes.build_router(_API)
app.include_router(_auth_router)


# ---------- admin: управление пользователями (хранятся в таблице users) ----------
# owner — руководитель портфеля (видит и правит всё + админка), pm — руководитель проекта,
# exec — руководство компании (видит все проекты, правит только свои, админки нет).
_VALID_ROLES = {"owner", "pm", "exec"}


async def _save_users() -> None:
    """Сохранить USERS в таблицу users (ключ — email; служебное поле email в значении не дублируем)."""
    out = {email: {k: v for k, v in u.items() if k != "email"} for email, u in USERS.items()}
    await db.save_users(out)


# ---------- справочник людей (исполнители для PersonPicker; НЕ пользователи портала) ----------
# Фронт зовёт /persons (пикер исполнителя/владельца риска и т.п.) — в адаптере эндпоинтов
# не было вовсе (мёртвый UI: пустой список, «добавить» падал 404). Хранится в таблице persons.
_PEOPLE_IDX: dict = {"at": 0.0, "idx": None}  # кэш индекса людей ~60с (как _OWNS_TTL): резолв зовётся часто
_PEOPLE_TTL = 60.0


def _invalidate_people() -> None:
    """Сбросить кэш индекса людей — после любой записи persons/users (зеркалит _invalidate_project_ownership)."""
    _PEOPLE_IDX["idx"] = None
    _PEOPLE_IDX["at"] = 0.0


async def _save_persons(persons: list) -> None:
    await db.save_persons(persons)
    _invalidate_people()


async def _load_persons() -> list:
    persons = await db.load_persons()
    if persons:
        return persons
    # первичный сид: пользователи портала (РП) — чтобы пикер не встречал пустым списком
    seed = []
    for u in USERS.values():
        fn = (u.get("full_name") or "").strip()
        if not fn:
            continue
        first, _, last = fn.partition(" ")
        seed.append({"id": str(uuid.uuid4()), "first_name": first, "last_name": last, "full_name": fn,
                     "bitrix24_id": u.get("bitrix24_user_id"), "email": u.get("email"),
                     "created_at": _now_iso(), "updated_at": _now_iso()})
    if seed:
        await _save_persons(seed)
    return seed


# ---------- идентичность людей (WP1) ----------
# `persons` — канонический реестр людей (в нём И email, И bitrix24_id); `USERS` — только логины портала.
# Раньше исполнитель задачи был свободным текстом, а рядом жил НЕ связанный с ним assignee_email —
# из-за этого не работали «Мои задачи», доставка писем и подстановка ответственного в Bitrix.
# Теперь у задачи есть assignee_person_id, а name/email сервер сам держит в согласованном виде.
async def _people_index() -> dict:
    """Индексы реестра людей: по id / email / имени / bitrix24_id."""
    now = time.time()
    cached = _PEOPLE_IDX.get("idx")
    if cached is not None and (now - float(_PEOPLE_IDX.get("at") or 0.0)) < _PEOPLE_TTL:
        return cached
    by_id: dict = {}
    by_email: dict = {}
    by_name: dict = {}
    by_bx: dict = {}
    for p in await _load_persons():
        rec = {
            "person_id": str(p.get("id") or ""),
            "full_name": (p.get("full_name") or "").strip(),
            "email": ((p.get("email") or "").strip() or None),
            "phone": ((p.get("phone") or "").strip() or None),
            "bitrix24_id": p.get("bitrix24_id"),
            "user_id": p.get("user_id"),
            "is_active": p.get("is_active", True),
        }
        if not rec["person_id"]:
            continue
        by_id[rec["person_id"]] = rec
        if rec["email"]:
            by_email.setdefault(rec["email"].casefold(), rec)
        if rec["full_name"]:
            by_name.setdefault(rec["full_name"].casefold(), []).append(rec)  # список: ловим тёзок
        if rec["bitrix24_id"] is not None:
            by_bx.setdefault(str(rec["bitrix24_id"]), rec)
    idx = {"by_id": by_id, "by_email": by_email, "by_name": by_name, "by_bx": by_bx}
    _PEOPLE_IDX["idx"], _PEOPLE_IDX["at"] = idx, now
    return idx


async def _sync_bitrix_people() -> dict:
    """Синхронизация справочника людей с Bitrix24. Общая для кнопки в настройках и ночной джобы.

    Правила, каждое из которых оплачено кровью:

    1. **Деактивируем только после ПОЛНОГО обхода.** `user.search` отдаёт по 50 человек на
       страницу. Если хоть одна страница не пришла, `complete=False` и мы
       НИКОГО не трогаем: иначе один таймаут превратился бы в массовое увольнение.
    2. **Не найден в Bitrix ≠ уволен.** Деактивируем только тех, у кого ЕСТЬ `bitrix24_id`.
       Люди, заведённые руками или приехавшие из Excel, в Bitrix отсутствуют по построению.
    3. **`users` (логины) не трогаем вообще.** Автодеактивация логина — это лок-аут портала,
       да ещё в обход админского гарда «нельзя снять последнего владельца».
    4. **Идемпотентность побайтово.** Пишем, только если поле реально изменилось: прежний
       импорт безусловно ставил `updated_at`, и ночная джоба каждую ночь двигала бы байты
       `/persons` — голден-гейт краснел бы навсегда.
    """
    rep = {"fetched": 0, "imported": 0, "updated": 0, "deactivated": 0, "reactivated": 0,
           "linked": 0, "person_linked": 0, "bx_filled": 0, "complete": False, "error": ""}
    if not _bitrix_url():
        rep["error"] = "Bitrix24 не настроен"
        return rep

    fetched: list = []
    start = 0
    for _ in range(60):                      # 60 × 50 = 3000 человек — с большим запасом
        d, err = await bx_call("user.search", {"ACTIVE": True, "start": start})
        if err:
            rep["error"] = err               # обход НЕ завершён → деактивации не будет
            break
        batch = (d or {}).get("result") or []
        fetched.extend(batch)
        nxt = (d or {}).get("next")
        if not batch or nxt is None:
            rep["complete"] = True
            break
        start = nxt
    rep["fetched"] = len(fetched)

    persons = await _load_persons()
    by_bx = {str(p["bitrix24_id"]): p for p in persons if p.get("bitrix24_id") is not None}
    seen: set = set()
    dirty = False

    for u in fetched:
        bid = _coerce_bitrix_id(u.get("ID"))
        if bid is None:
            continue
        first = (u.get("NAME") or "").strip()
        last = (u.get("LAST_NAME") or "").strip()
        full = f"{first} {last}".strip()
        if not full:
            continue                          # без имени человек бесполезен пикеру
        seen.add(str(bid))
        # Телефон из Bitrix: мобильный приоритетнее рабочего. Нужен для подстановки в «Команду».
        phone = (u.get("PERSONAL_MOBILE") or u.get("WORK_PHONE") or "").strip() or None
        # Должность из Bitrix (WORK_POSITION) — тоже для автоподстановки в «Команду».
        position = (u.get("WORK_POSITION") or "").strip() or None
        p = by_bx.get(str(bid))
        if p is None:
            persons.append({"id": str(uuid.uuid4()), "first_name": first, "last_name": last,
                            "full_name": full, "bitrix24_id": bid, "email": u.get("EMAIL") or None,
                            "created_at": _now_iso(), "updated_at": _now_iso(),
                            "user_id": None, "is_active": True, "phone": phone,
                            "position": position})
            rep["imported"] += 1
            dirty = True
            continue
        # Обновляем ТОЛЬКО при реальной разнице — иначе каждую ночь двигали бы updated_at.
        # position/phone — с фолбэком на уже сохранённое: пустое значение из Bitrix не стирает
        # заполненное (иначе ночная джоба двигала бы байты /persons каждую ночь → голден-гейт красный).
        want = {"first_name": first, "last_name": last, "full_name": full,
                "email": u.get("EMAIL") or p.get("email"), "is_active": True,
                "phone": phone or p.get("phone"),
                "position": position or p.get("position")}
        delta = {k: v for k, v in want.items() if p.get(k) != v}
        if delta:
            if p.get("is_active") is False:
                rep["reactivated"] += 1
            p.update(delta)                   # update, не пересборка: порядок ключей = контракт
            p["updated_at"] = _now_iso()
            rep["updated"] += 1
            dirty = True

    # Деактивируем только если обход завершён БЕЗ ошибки И мы реально увидели живых людей.
    # Пустой ответ Bitrix (слетели права, сменился фильтр) — не повод считать, что вся
    # компания уволилась поголовно. `fetched` пуст → трогать никого нельзя.
    if rep["complete"] and fetched:
        for p in persons:
            if p.get("bitrix24_id") is None or str(p["bitrix24_id"]) in seen:
                continue
            if p.get("is_active") is False:
                continue
            p["is_active"] = False            # мягко: историю исполнителей резать нельзя
            p["updated_at"] = _now_iso()
            rep["deactivated"] += 1
            dirty = True

    # bitrix24_user_id логина заполняем из ДОВЕРЕННОЙ выгрузки Bitrix (email и id — одна запись
    # user.search), а НЕ из persons: person можно создать через POST /persons с чужим bitrix24_id
    # и своим email, и тогда РП присвоил бы себе чужой bitrix-id и прочитал чужой календарь.
    bx_by_email = {}
    for u in fetched:
        em = (u.get("EMAIL") or "").strip().casefold()
        bid = _coerce_bitrix_id(u.get("ID"))
        if em and bid is not None:
            bx_by_email.setdefault(em, bid)

    # persons ↔ users по email: связь для рассылки протокола и резолва (доступа НЕ даёт).
    for email, u in USERS.items():
        em = str(email).strip().casefold()
        p = next((x for x in persons if (x.get("email") or "").strip().casefold() == em), None)
        if p and p.get("user_id") != u.get("id"):
            p["user_id"] = u.get("id")
            rep["linked"] += 1
            dirty = True
        # Обратная сторона той же связи. Без неё логин цел, роль верна, проекты видны — а
        # «Мои задачи» и ICS молча пусты: _my_task_match сравнивает assignee_person_id задачи
        # именно с person_id и выходит сразу, не доходя до фолбэка на email/имя. Ставил только
        # разовый migrate_identity, поэтому каждый логин из POST /admin/users приезжал сломанным.
        if p and p.get("id") and u.get("person_id") != p.get("id"):
            u["person_id"] = p.get("id")
            rep["person_linked"] += 1
            await _save_users()
        if not u.get("bitrix24_user_id") and em in bx_by_email:
            u["bitrix24_user_id"] = bx_by_email[em]   # заданное вручную не перетираем
            rep["bx_filled"] += 1
            await _save_users()

    if dirty:
        # upsert, а НЕ save_persons: последний удалил бы человека, созданного через POST /persons
        # между нашим чтением и записью. Синк никого не удаляет (уволенных лишь гасит is_active).
        await db.upsert_persons(persons)
        _invalidate_people()
    await _bx_log("people.sync", "error" if rep["error"] else "ok", rep["error"])
    return rep


async def sync_bitrix_people() -> dict:
    """Под advisory-локом: синк читает весь справочник и переписывает его целиком
    (`db.save_persons` удаляет всех, кого нет в списке). Параллельный второй синк или
    ручной импорт стёр бы человека, созданного между чтением и записью."""
    res = await db.run_with_job_lock(_JOB_BX_PEOPLE, _sync_bitrix_people)
    if res is None:                          # лок у другого воркера — не дублируем работу
        return {"skipped": "синхронизация уже идёт"}
    return res


async def resolve_person(person_id=None, email=None, name=None) -> Optional[dict]:
    """Разрешить человека в порядке убывания точности: id → email → имя.

    По ИМЕНИ — только УНИКАЛЬНОЕ совпадение. Никогда не гадаем: роли-исполнители из импорта
    («IT lead», «Отдел контента», «РП») и тёзки остаются неразрешёнными, задача просто хранит
    текст как раньше. Это осознанное решение — лучше пусто, чем назначить не тому.
    """
    idx = await _people_index()
    if person_id:
        rec = idx["by_id"].get(str(person_id))
        if rec:
            return rec
    if email:
        rec = idx["by_email"].get(str(email).strip().casefold())
        if rec:
            return rec
    if name:
        hits = idx["by_name"].get(str(name).strip().casefold()) or []
        if len(hits) == 1:
            return hits[0]
    return None


async def _task_identity_fields(payload: dict) -> dict:
    """Три поля исполнителя задачи всегда приводит к согласованному виду СЕРВЕР.

    Если запись не трогает исполнителя — возвращаем {} (ничего не перетираем). Если трогает —
    пересчитываем все три вместе: иначе останется старый email от прежнего исполнителя.
    Не разрешился (свободный текст) → person_id=None, текст сохраняем как есть (мягкая деградация).
    """
    if "assignee_person_id" in payload:
        p = await resolve_person(person_id=payload.get("assignee_person_id"))
    elif "assignee_email" in payload:
        p = await resolve_person(email=payload.get("assignee_email"))
    elif "assignee_name" in payload:
        p = await resolve_person(name=payload.get("assignee_name"))
    else:
        return {}
    if p:
        # Email person'а канонический — НО у части сотрудников Bitrix (и у людей, заведённых
        # руками) он пустой. В этом случае НЕ затираем адрес, уже стоявший на задаче: иначе
        # правка любого поля мигрированной задачи молча уничтожала бы assignee_email, и
        # переставали работать письма исполнителю и подстановка RESPONSIBLE_ID в Bitrix.
        return {"assignee_person_id": p["person_id"],
                "assignee_name": p["full_name"],
                "assignee_email": p["email"] or payload.get("assignee_email") or None}
    return {"assignee_person_id": None,
            "assignee_name": payload.get("assignee_name"),
            "assignee_email": payload.get("assignee_email")}


def _fold_name(s) -> str:
    """Имя без регистра, лишних пробелов и диакритики: «Pēteris Piemērs» → «peteris piemers».

    Латышские файлы РП пишут одного и того же человека то с макронами/седилями, то без
    (задачи на «Pēteris Piemērs», а пользователь заведён как «Peteris Piemers»). Снятие диакритики
    — нормализация написания, а не догадка о том, кто имелся в виду.
    """
    base = unicodedata.normalize("NFKD", " ".join(str(s or "").split()).casefold())
    return "".join(ch for ch in base if not unicodedata.combining(ch))


async def _co_assignee_field(payload: dict) -> dict:
    """Соисполнители задачи: список людей, опознанный СЕРВЕРОМ.

    Ответственный за задачу по-прежнему ОДИН (`assignee_person_id`) — «несколько исполнителей»
    означает, что не отвечает никто. Соисполнители — те, кто в работе участвует: задача видна
    им в «Моих задачах», но загрузку портфеля они не получают, иначе одни и те же часы
    посчитались бы на всех разом.

    Каждого прогоняем через `resolve_person` тем же путём, что и исполнителя: id → email → имя,
    по имени только УНИКАЛЬНОЕ совпадение. Не разрешился — оставляем текстом (мягкая
    деградация: лучше запись «Отдел контента», чем не тот человек). Дубликаты и сам
    ответственный отсеиваются: держать человека в обеих ролях незачем.
    """
    if "co_assignees" not in payload:
        return {}
    raw = payload.get("co_assignees") or []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="co_assignees: ожидается список")
    if len(raw) > 20:
        raise HTTPException(status_code=422, detail="co_assignees: не больше 20 человек")
    main_pid = str(payload.get("assignee_person_id") or "").strip()
    out, seen = [], set()
    for item in raw:
        if isinstance(item, dict):
            p = await resolve_person(person_id=item.get("person_id")) if item.get("person_id") else None
            if not p and item.get("email"):
                p = await resolve_person(email=item.get("email"))
            if not p and item.get("name"):
                p = await resolve_person(name=item.get("name"))
            name = (item.get("name") or "").strip()
        else:
            p = await resolve_person(name=str(item))
            name = str(item).strip()
        rec = ({"person_id": p["person_id"], "name": p["full_name"], "email": p["email"] or None}
               if p else {"person_id": None, "name": name, "email": None})
        if not rec["name"]:
            continue
        key = rec["person_id"] or rec["name"].casefold()
        if key in seen or (rec["person_id"] and rec["person_id"] == main_pid):
            continue
        seen.add(key)
        out.append(rec)
    return {"co_assignees": json.dumps(out, ensure_ascii=False) if out else None}


def _my_task_match(user: dict, tk: dict) -> bool:
    """«Моя задача» = назначенная НА МЕНЯ (а не «любая задача моего проекта» — это WBS).
    Точность: person_id → email → имя (легаси-строки до миграции идентичности).

    Имя — последний рубеж и только на ЧТЕНИЕ (кому показать его же задачи), поэтому здесь
    сравнение мягче, чем в `resolve_person`/`_task_identity_fields`: те решают, кого ЗАПИСАТЬ
    исполнителем, и остаются строгими.

    Но если у задачи УЖЕ проставлен assignee_person_id — это однозначная идентичность, и
    сопоставляем ТОЛЬКО по ней. Иначе откат на имя показал бы задачу тёзке (два «Ивана
    Петрова» в реестре — обычное дело), хотя person_id прямо говорит, что она не его.
    """
    # Соисполнитель — тоже «моя задача»: он в ней участвует, и не показать её ему значит
    # спрятать работу, которую он делает. Проверяем ДО ответственного: у задачи с чужим
    # assignee_person_id опознание иначе оборвалось бы на строгом сравнении ниже.
    mine_pid = str(user.get("person_id") or "").strip()
    mine_email = (user.get("email") or "").strip().casefold()
    for co in (tk.get("co_assignees") or []):
        if not isinstance(co, dict):
            continue
        if mine_pid and str(co.get("person_id") or "").strip() == mine_pid:
            return True
        if mine_email and (co.get("email") or "").strip().casefold() == mine_email:
            return True

    task_pid = str(tk.get("assignee_person_id") or "").strip()
    if task_pid:
        return task_pid == mine_pid
    em = (user.get("email") or "").strip().casefold()
    if em and (tk.get("assignee_email") or "").strip().casefold() == em:
        return True
    fn = _fold_name(user.get("full_name"))
    if fn and _fold_name(tk.get("assignee_name")) == fn:
        return True
    return False


def _mine_name(user: dict, name) -> bool:
    """Совпадение по ИМЕНИ (со снятием диакритики) — для полей владельца/ответственного коллекций,
    где person_id не хранится (свободный текст). Мягко, как _my_task_match, только на ЧТЕНИЕ."""
    fn = _fold_name(user.get("full_name"))
    return bool(fn and name and _fold_name(name) == fn)


def _mine_email(user: dict, email) -> bool:
    em = (user.get("email") or "").strip().casefold()
    return bool(em and email and str(email).strip().casefold() == em)


def _my_backlog_match(user: dict, b: dict) -> bool:
    """Элемент бэклога, назначенный на меня: по assignee_person_id (стабильно), иначе по имени."""
    pid = str(b.get("assignee_person_id") or "").strip()
    if pid:
        return pid == str(user.get("person_id") or "").strip()
    return _mine_name(user, b.get("assignee_name"))


def _my_attendee_match(user: dict, meeting: dict) -> bool:
    """Я — участник совещания: по person_id (точно) → email → имени (fold) в списке attendees."""
    pid = str(user.get("person_id") or "").strip()
    em = (user.get("email") or "").strip().casefold()
    fn = _fold_name(user.get("full_name"))
    for a in (meeting.get("attendees") or []):
        if pid and str(a.get("person_id") or "").strip() == pid:
            return True
        if em and str(a.get("email") or "").strip().casefold() == em:
            return True
        if fn and _fold_name(a.get("name")) == fn:
            return True
    return False


def _require_write_role(user: dict):
    """Право писать вообще (вне привязки к конкретному проекту): РПП или РП.
    Общий справочник людей, импорт из Bitrix и т.п. Скоуп по проекту проверяет rbac."""
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail=f"Роль «{user.get('role')}» — только чтение")


_require_pm_role = _require_write_role  # legacy-алиас: имя ещё зовут route-модули и тесты


def _find_user_by_id(uid: str):
    for email, u in USERS.items():
        if str(u.get("id")) == str(uid):
            return email, u
    return None, None


# Алфавит БЕЗ пар, которые путают при чтении вслух и переписывании с экрана: 0/O/o, 1/l/I.
# Пароль показывается один раз и человек переносит его руками — «l» вместо «1» стоит письма
# «у меня не работает вход».
_PW_ALPHABET = ("ABCDEFGHJKLMNPQRSTUVWXYZ"
                "abcdefghijkmnopqrstuvwxyz"
                "23456789"
                "!@#%*+-=?")


def _gen_password(n: int = 14) -> str:
    """Пароль для нового логина. 14 символов из 83-символьного алфавита ≈ 89 бит энтропии."""
    return "".join(secrets.choice(_PW_ALPHABET) for _ in range(n))


async def _find_linkable_person(person_id: str) -> dict:
    """Человек, которому заводим логин. 409, если учётка у него уже есть.

    «Уже есть» проверяем через _find_user_by_id, а не по самому факту person['user_id']:
    удаление пользователя не чистит эту ссылку, поэтому висячий id иначе заблокировал бы
    кнопку навсегда."""
    persons = await _load_persons()
    p = next((x for x in persons if str(x.get("id")) == str(person_id)), None)
    if not p:
        raise HTTPException(status_code=404, detail="Человек не найден")
    linked = p.get("user_id")
    if linked and _find_user_by_id(linked)[1] is not None:
        raise HTTPException(status_code=409, detail="У этого человека уже есть учётная запись")
    return p


async def _link_person_to_user(person_id: str, user_id: str) -> None:
    """Обратная сторона связки: person.user_id. Прямую (user.person_id) ставит вызывающий.

    upsert_persons, а НЕ _save_persons: последний переписывает справочник целиком и удалил бы
    человека, заведённого между нашим чтением и записью."""
    persons = await _load_persons()
    p = next((x for x in persons if str(x.get("id")) == str(person_id)), None)
    if not p or p.get("user_id") == user_id:
        return
    p["user_id"] = user_id
    p["updated_at"] = _now_iso()
    await db.upsert_persons([p])
    _invalidate_people()


def _admin_view(email: str, u: dict) -> dict:
    # twofa_grace_until: до какого момента человек может пользоваться порталом БЕЗ 2FA.
    # null = ограничения нет (2FA уже включена либо человек ещё ни разу не входил).
    # Дата в прошлом = доступ к данным уже закрыт, пока он не подключит 2FA. Без этого поля
    # владелец не видел в списке, кто заблокирован: было только «есть 2FA / нет».
    return {"id": u.get("id"), "email": email, "full_name": u.get("full_name"),
            "role": u.get("role"), "bitrix24_user_id": u.get("bitrix24_user_id"),
            "is_active": u.get("is_active", True), "created_at": u.get("created_at"),
            "twofa_enabled": bool(u.get("twofa_enabled")),
            "twofa_grace_until": _twofa_grace_until_iso(u)}


def _hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def _stamp_pw_change(u: dict) -> None:
    """Отметить момент смены пароля (epoch). current_user отвергает токены, выданные ДО него,
    т.е. смена пароля отзывает все прежние сессии. Хранится в users.doc → переживает рестарт."""
    u["pw_changed_at"] = int(time.time())


def _count_owners(active_only: bool = False) -> int:
    return sum(1 for u in USERS.values()
               if u.get("role") == "owner" and (not active_only or u.get("is_active", True)))


def _coerce_bitrix_id(v):
    return int(v) if v not in (None, "", False) else None


def _project_pm_bitrix_id(m: dict) -> Optional[int]:
    """Bitrix-id руководителя проекта из pm_id (это id USERS, НЕ persons). Надёжнее матча по имени
    в persons, которым пользовался фронт: users.bitrix24_user_id заполняется из ДОВЕРЕННОЙ выгрузки
    Bitrix при синке людей. Нужен как постановщик (CREATED_BY) задачи — «поставил» её РП."""
    pm_id = m.get("pm_id")
    if not pm_id:
        return None
    _, u = _find_user_by_id(pm_id)
    return _coerce_bitrix_id(u.get("bitrix24_user_id")) if u else None


def _validate_user_payload(p: dict, *, require_email: bool, require_password: bool):
    if require_email or p.get("email") is not None:
        email = (p.get("email") or "").strip().lower()
        if not email or "@" not in email or len(email) > 200:
            raise HTTPException(status_code=422, detail="Некорректный email")
    if p.get("role") is not None and p["role"] not in _VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"role ∈ {sorted(_VALID_ROLES)}")
    if p.get("full_name") is not None and len(str(p.get('full_name') or '')) > 200:
        raise HTTPException(status_code=422, detail="full_name слишком длинный (≤200)")
    if require_password and (not p.get("password") or len(str(p["password"])) < 8):
        raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")


_system_router, health, metrics, ready = system_routes.build_router(_API)
app.include_router(_system_router)


# Белый список полей паспорта: что портал принимает при правке проекта. Вынесен из тела роута
# на уровень модуля, потому что это ИСТОЧНИК для словаря помощника — расхождение между ними
# оборачивается либо ложным «такого поля нет», либо тихо непринятым значением.
# Сверку держит tests/test_mcp_instructions.py::test_passport_dict_covers_what_portal_accepts.
_PASSPORT_FIELDS = ("code", "status", "priority", "project_kind", "pm_id", "pm", "client", "program", "pm_name",
                    "version", "version_date",
                    "goal", "scope", "project_result", "success_criteria", "key_milestones", "description",
                    "budget", "budget_currency", "planned_start", "planned_end", "actual_start", "actual_end")


# Паспорт-поля, изменения которых журналируются в version-log (old→new).
_VLOG_FIELDS = ("name", "status", "priority", "project_kind", "client", "pm_name", "goal", "scope", "project_result",
                "success_criteria", "key_milestones", "description", "budget", "budget_currency",
                "planned_start", "planned_end", "actual_start", "actual_end", "version")


# Окно «сеанса правки»: подряд идущие правки одного человека в его пределах склеиваются
# в ОДНУ запись журнала версий. Без склейки автосохранение паспорта писало бы запись на каждое
# нажатие клавиши: журнал обрезан 50 записями и вместо истории за месяцы показывал бы последние
# минуты, а номер версии рос бы сотнями за один присест.
_VLOG_SESSION_MINUTES = 15


def _format_version(major: int, seq: int) -> str:
    """Номер версии паспорта: «мажор.минор», минор — четырьмя знаками (1.0003).

    Минор — счётчик сеансов правки, растёт сам. Мажор пока всегда 1: он заведён под будущие
    «редакции» (согласована/утверждена) и меняется только осознанным действием, которого
    сегодня нет. Формат выбран владельцем: паспорт печатают и на него ссылаются, а «5»
    выглядит как черновик, тогда как «1.0005» читается как версия документа."""
    return f"{major}.{seq:04d}"


def _version_major(raw: object) -> int:
    """Мажор из сохранённого номера. Старые проекты хранят просто «5» — для них мажор 1."""
    m = re.match(r"^(\d+)\.", str(raw or ""))
    return int(m.group(1)) if m else 1


def _vlog_session_open(entry: Optional[dict], author: Optional[str], now_iso: str) -> bool:
    """Продолжается ли сеанс правки ТОГО ЖЕ человека. Разные авторы не склеиваем никогда —
    иначе в одной записи смешались бы правки РП и со-РП, и «кто менял» перестало бы отвечать."""
    if not entry or entry.get("author_name") != author:
        return False
    # Версию зафиксировали кнопкой: этот номер напечатан и больше не меняется, следующая
    # правка обязана уйти в новый. Без этого напечатанный 1.0003 и завтрашний 1.0003
    # оказались бы разными документами под одним номером.
    if entry.get("closed"):
        return False
    try:
        prev = datetime.fromisoformat(str(entry.get("created_at")))
        now = datetime.fromisoformat(now_iso)
    except (TypeError, ValueError):
        return False
    return timedelta(0) <= (now - prev) <= timedelta(minutes=_VLOG_SESSION_MINUTES)


def _vlog_merge(old_changes: list, new_changes: list) -> list:
    """Склеить правки сеанса по полю: old_value — из САМОЙ РАННЕЙ правки поля, new_value — из
    последней. Поле, которое в итоге вернули к исходному значению, из записи исчезает: сеанс
    описывает результат, а не путь к нему. Порядок ключей стабильный (dict сохраняет вставку)."""
    merged: dict = {}
    for c in list(old_changes or []) + list(new_changes or []):
        f = c.get("field")
        if f in merged:
            merged[f]["new_value"] = c.get("new_value")
        else:
            merged[f] = dict(c)
    return [c for c in merged.values() if _vlog_changed(c.get("old_value"), c.get("new_value"))]


def _vlog_changed(old, new) -> bool:
    """True, если паспорт-поле реально изменилось. Числа сравниваем ПО ЗНАЧЕНИЮ
    (budget «1000» == 1000 == 1000.0 → нет изменения), остальное — по строке;
    None/'' эквивалентны. Иначе int↔str давали бы ложную запись в журнал версий."""
    if old is None and new is None:
        return False
    so = str(old).strip() if old is not None else ""
    sn = str(new).strip() if new is not None else ""
    if so and sn:
        try:
            return abs(float(so) - float(sn)) > 1e-9  # so/sn — очищенные строки (float(old) байт-идентичен)
        except (TypeError, ValueError):
            pass
    return so != sn


def _user_by_full_name(name) -> Optional[dict]:
    """Учётка портала по отображаемому имени. Владение не может опираться на строку, которую
    человек правит себе сам, — поэтому имя обязано резолвиться в конкретного пользователя."""
    n = str(name or "").strip().casefold()
    if not n:
        return None
    return next((u for u in USERS.values()
                 if (u.get("full_name") or "").strip().casefold() == n), None)


def _apply_pm_change(pid: str, m: dict, payload: dict, user: Optional[dict]) -> None:
    """Держит pm_id (владение) и pm_name (подпись в паспорте) в одном шаге.

    Пока это были два независимых поля, паспорт мог показывать одного руководителя, а проект
    лежать в папке другого: названный РП открывал «Мои проекты» и видел пусто. Журнал при этом
    читался абсурдно, «project.transfer: Имя → то же Имя», потому что менялся невидимый pm_id,
    а подпись стояла на месте с самого начала.

    Право то же, что у /admin/projects/{pid}/transfer: руководитель портфеля ИЛИ основной РП
    этого проекта. Со-РП сюда не пускаем: у него полная запись через _owns_item, и он назначил бы
    основным РП себя, заперев прежнего, — управление со-РП есть только у основного.
    """
    wants_id = "pm_id" in payload and str(payload.get("pm_id") or "") != str(m.get("pm_id") or "")
    name_new = str(payload.get("pm_name") or "").strip()
    wants_name = "pm_name" in payload and name_new.casefold() != str(m.get("pm_name") or "").strip().casefold()
    if not wants_id and not wants_name:
        return                                    # автосохранение шлёт паспорт целиком — тишина
    uid = str((user or {}).get("id") or "")
    if (user or {}).get("role") != "owner" and str(m.get("pm_id") or "") != uid:
        raise HTTPException(status_code=403,
                            detail="Сменить руководителя может руководитель портфеля или основной РП проекта")
    target = None
    if wants_id:
        target_id = str(payload.get("pm_id") or "")
        target = next((u for u in USERS.values() if str(u.get("id")) == target_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь с таким pm_id не найден")
    elif wants_name:
        target = _user_by_full_name(name_new)
        if not target:
            raise HTTPException(
                status_code=422,
                detail="У этого человека нет учётной записи в портале — проект не на кого записать. "
                       "Заведите учётную запись или выберите другого руководителя.")
    if target is None:      # сюда не дойти: выше мы вышли, если менять нечего, — но пусть падает явно
        raise HTTPException(status_code=422, detail="Не удалось определить нового руководителя проекта")
    # Та же валидация дееспособности, что у передачи: проект не должен остаться без хозяина,
    # который может войти и писать.
    if not target.get("is_active", True):
        raise HTTPException(status_code=422, detail="Нельзя передать проект неактивному пользователю")
    if target.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=422, detail="Наблюдатель (viewer) не может быть ведущим РП")
    old_name = m.get("pm_name")
    old_id = str(m.get("pm_id") or "")
    payload["pm_id"] = str(target.get("id"))
    payload["pm_name"] = target.get("full_name")
    # Отдал проект сам — остаёшься со-РП (то же, что в маршруте передачи): иначе паспорт
    # сохраняется, и человек тут же лишается доступа к собственному проекту без пути назад.
    if old_id and old_id == uid and old_id != payload["pm_id"]:
        eds = [str(x) for x in (m.get("_editors") or [])]
        if old_id not in eds:
            m["_editors"] = eds + [old_id]
    _log_action(m, user or {}, "project.transfer",
                f"{old_name or '—'} → {payload['pm_name'] or '—'}")
    # Через дерево смена РП зонтика меняет права на всех подпроектах, а смена РП подпроекта —
    # на зонтике и соседях; точечная чистка их ключи не достаёт.
    _invalidate_after_membership_change(pid, m)


async def _save_meta(pid: str, payload: dict, author: Optional[str] = None, user: Optional[dict] = None):
    _validate_project_payload(payload)
    d = await db.get_project_row(pid)
    if not d:
        raise HTTPException(status_code=404, detail="Project not found")
    d["_docs"] = await db.load_project_docs(pid)  # нормализованные коллекции: _log_action дописывает в полный _action_log
    m = _meta(d)
    _colls_before = project_meta_ops.colls_snapshot(_extract_colls, m)  # снимок ДО правок (deep-copy)
    PASSPORT = _PASSPORT_FIELDS
    # Смена РП в паспорте — это ПЕРЕДАЧА ПРОЕКТА, а не правка подписи. На create (author is None)
    # владелец выставляется штатно, поэтому гейт только на редактировании.
    if author is not None:
        _apply_pm_change(pid, m, payload, user)
    # version-log: дифф изменяемых паспорт-полей (пишем только при правке — author задан, не на create)
    changes = []
    if author is not None:
        for k in _VLOG_FIELDS:
            if k not in payload:
                continue
            old = d.get("name") if k == "name" else m.get(k)
            new = payload.get(k)
            if _vlog_changed(old, new):
                changes.append({"field": k, "old_value": old, "new_value": new})
    for k in PASSPORT:
        if k in payload:
            m[k] = payload[k]
    if changes:
        vlog = m.get("_version_log")
        vlog = vlog if isinstance(vlog, list) else []
        now = _now_iso()
        last = vlog[-1] if vlog else None
        ver: Optional[int]
        if last is not None and _vlog_session_open(last, author, now):
            # Продолжение сеанса: дополняем ТУ ЖЕ запись, номер версии НЕ растёт.
            new_session = False
            merged = _vlog_merge(last.get("changed_fields") or [], changes)
            if merged:
                last["changed_fields"] = merged
                last["created_at"] = now
                ver = last.get("version", 1)
            else:
                # Человек вернул всё как было — записи о сеансе быть не должно.
                vlog.pop()
                ver = None
        else:
            new_session = True
            ver = (last.get("version", 0) + 1) if last else 1
            vlog.append({"id": str(uuid.uuid4()), "version": ver, "created_at": now,
                         "author_name": author, "changed_fields": changes})
        m["_version_log"] = vlog[-50:]  # ограничиваем рост описания проекта
        # Авто-версия паспорта: раньше фронт слал bump_version, а адаптер игнорировал —
        # поля «Версия»/«Дата версии» вечно пустели. Номер = номер записи журнала.
        # Если пользователь сам правил поле version — уважаем его значение.
        if not any(c["field"] == "version" for c in changes):
            major = _version_major(m.get("version"))
            if ver is None:  # сеанс схлопнулся — откатываемся на предыдущую запись
                tail = vlog[-1] if vlog else None
                m["version"] = _format_version(major, int(tail.get("version") or 0)) if tail else ""
                m["version_date"] = str(tail.get("created_at"))[:10] if tail else ""
            else:
                m["version"] = _format_version(major, ver)
                m["version_date"] = now[:10]
        # Зеркалим правку паспорта и в журнал действий (панель на странице паспорта
        # фильтрует по project.* — раньше правки полей туда не попадали вовсе).
        # ТОЛЬКО на старте сеанса: журнал действий append-only (db.append_action_log) и
        # обрезан 50 записями — с автосохранением запись на каждую правку вытеснила бы из него
        # всё остальное за считанные минуты. Полный список полей сеанса живёт в журнале версий.
        if user is not None and new_session:
            old_map = {c["field"]: c["old_value"] for c in changes}
            new_map = {c["field"]: c["new_value"] for c in changes}
            diff = _diff_detail(old_map, new_map, old_map.keys())
            if diff:
                _log_action(m, user, "project.update", diff)
    name = payload["name"] if ("name" in payload and payload["name"]) else None
    colls = project_meta_ops.dirty_colls(_colls_before, _extract_colls(m))  # только изменённые коллекции
    pending_log = list(m.get("_pending_action_log") or [])  # захват ДО сериализации (raw_for_save стрипит ключ)
    ok = await db.update_project_meta(pid, await _meta_raw_for_save(pid, m),
                                      expected_version=d["lockVersion"], name=name, colls=colls)
    if not ok:
        raise project_meta_ops.version_conflict()
    await _flush_pending_log(pid, pending_log)  # журнал append-only после успешной записи меты (A2)
    d2 = await db.get_project_row(pid)
    if d2 is None:  # только что успешно обновили — строка есть; гард для типизации
        raise HTTPException(status_code=404, detail="Project not found")
    return to_project(d2)


# ---------- коллекции модулей (хранятся JSON-ом в description проекта) ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_RLV = {"low": 1, "medium": 2, "high": 3}


def _risk_score(prob, impact) -> int:
    return _RLV.get((prob or "").lower(), 2) * _RLV.get((impact or "").lower(), 2)


async def load_meta(pid: str):
    return await project_meta_ops.load(pid, get_project_row=db.get_project_row, parse_meta=_meta,
                                       load_docs=db.load_project_docs)


_DESC_WARN = 40000
_DESC_MAX = 60000  # лимит поля description OpenProject ~64КБ; жёсткий стоп с запасом
_ACTION_LOG_CAP = 50  # журнал действий с диффами полей жирный — держим только последние N записей
# Нормализованные коллекции: живут в таблице project_docs, а не в 60КБ-блобе projects.meta —
# ни одна секция не упирается в лимит поля (→ 413). Сюда включены ВСЕ списочные коллекции модулей
# (не только тяжёлые): миграция ленивая (при первой записи extract_colls выносит в project_docs,
# strip_colls убирает из блоба; чтение до миграции берёт значение из блоба → байт-идентично). Запись
# селективна (dirty_colls) — правка одной секции переписывает только её строки, не все коллекции.
_DOC_COLLS = ("_action_log", "_meetings", "_backlog", "_notes", "_budget", "_reports",
              "_team", "_stakeholders", "_assumptions", "_comms", "_kpis", "_decisions")


def _extract_colls(meta: dict) -> dict:
    """Снимок нормализованных коллекций из меты для записи в project_docs (ДО вырезания из меты).
    _action_log режем до _ACTION_LOG_CAP здесь (раньше это делал _serialize_meta)."""
    out: dict = {}
    for key in _DOC_COLLS:
        items = meta.get(key)
        items = items if isinstance(items, list) else []
        if key == "_action_log" and len(items) > _ACTION_LOG_CAP:
            items = items[-_ACTION_LOG_CAP:]
        out[key] = items
    return out


async def _flush_pending_log(pid: str, entries: list) -> None:
    """Слить отложенные _log_action-записи в project_docs append-only (db.append_action_log —
    advisory-lock alog:<pid>) ПОСЛЕ успешной записи меты. Так журнал не переписывается version-checked
    путём и не затирает параллельный append задачи/риска (A2). Вызывается save-обёртками."""
    for entry in entries or []:
        await db.append_action_log(pid, entry, _ACTION_LOG_CAP)


def _serialize_meta(pid: str, meta: dict) -> str:
    """Синхронная финальная сериализация; async legacy-migration выполняет _meta_raw_for_save()."""
    return project_meta_ops.serialize(
        pid,
        meta,
        desc_warn=_DESC_WARN,
        desc_max=_DESC_MAX,
        action_log_cap=_ACTION_LOG_CAP,
        logger=logger,
    )


async def _meta_raw_for_save(pid: str, meta: dict) -> str:
    """Lazy-перенос legacy _baselines в таблицу перед удалением тяжёлой копии из meta.

    Раньше sync _serialize_meta вызывал async-функции без await, что ломало сохранение проекта,
    если в старой meta ещё присутствовал _baselines.
    """
    return await project_meta_ops.raw_for_save(
        pid,
        meta,
        ensure_baselines=db.ensure_baselines,
        serialize_meta=_serialize_meta,
        strip_colls=_DOC_COLLS,
    )


async def save_meta_full(pid: str, el: dict, meta: dict):
    return await project_meta_ops.save_full(
        pid,
        el,
        meta,
        update_project_meta=db.update_project_meta,
        get_project_row=db.get_project_row,
        meta_raw_for_save=_meta_raw_for_save,
        extract_colls=_extract_colls,
        flush_log=_flush_pending_log,
    )


async def with_meta_retry(pid: str, mutate, attempts: int = 4):
    """Optimistic-lock цикл: load_meta → mutate(m) → UPDATE; при конфликте version (False)
    перечитывает свежую мету и повторяет. Устраняет потерю обновлений при конкурентных правках.
    `mutate(m)` мутирует m на месте и возвращает результат эндпоинта (создавать id/created_at —
    ДО вызова, чтобы они были стабильны между попытками)."""
    return await project_meta_ops.with_retry(
        pid,
        mutate,
        attempts=attempts,
        load_meta=load_meta,
        update_project_meta=db.update_project_meta,
        meta_raw_for_save=_meta_raw_for_save,
        extract_colls=_extract_colls,
        flush_log=_flush_pending_log,
    )


def _collection_counts(m: dict) -> dict:
    """Derived counters for collections that still live in project metadata."""
    return project_meta_ops.collection_counts(m)


def _recount(m: dict):
    """Compatibility helper: derive collection counters without mutating project metadata."""
    return _collection_counts(m)


def _coll(m: dict, key: str) -> list:
    return project_meta_ops.collection(m, key)


# ---------- tasks (WBS) — источник истины: work packages OpenProject ----------
TYPE_ID = {"phase": 3, "task": 1, "milestone": 2}            # Summary task / Task / Milestone
ID_TYPE = {"Summary task": "phase", "Task": "task", "Milestone": "milestone"}
STATUS_ID = {"not_started": 1, "in_progress": 7, "completed": 12, "cancelled": 14, "on_hold": 13}
ID_STATUS = {1: "not_started", 7: "in_progress", 12: "completed", 14: "cancelled", 13: "on_hold"}
# Титулы статусов OpenProject (для журнала task.update: old_value был _links.status.title WP).
_STATUS_TITLE = {1: "New", 7: "In progress", 12: "Closed", 14: "Rejected", 13: "On hold"}
_EXTRA_KEYS = ("priority", "assignee_name", "assignee_email", "assignee_person_id", "bar_color",
               "bitrix24_task_id", "actual_start", "actual_end", "wbs_code", "sort_order",
               "estimated_hours", "actual_hours")
# Что из этого списка сервер НЕ принимает от клиента. Номер задачи Bitrix24 ставит и снимает
# только он сам (bitrix_routes/task_ops_routes пишут его своими маршрутами): «Удалить задачу из
# Bitrix24» идёт вебхуком интеграции ПО ЭТОМУ номеру, и подставленный обычным PUT чужой id снёс бы
# чужую задачу. У совещаний и у бэклога дыра закрыта списком _COLLECTION_PROTECTED,
# у задач оставалась открытой — а с переносом пункта в план работ такие номера стали обычным делом.
_CLIENT_EXTRA_KEYS = tuple(k for k in _EXTRA_KEYS if k != "bitrix24_task_id")
# co_assignees НЕ здесь: его не пропускают «как прислали». Список людей сервер опознаёт сам
# (`_co_assignee_field`) — ровно как исполнителя, иначе в задаче осели бы имена, которых нет
# в справочнике, и «Мои задачи» их не нашли бы.


def _href_id(links: dict, key: str):
    h = (links.get(key) or {}).get("href")
    return h.split("/")[-1] if h else None


TASK_TYPE_IDS = [1, 2, 3]   # Task, Milestone, Summary task
RISK_TYPE_ID = 8            # Risk


def _shims_with_extra(rows, shim, extra_fn) -> list:
    """Строки БД → шимы OpenProject; extra из колонок кладём в шим под ключом '_extra'."""
    extra = extra_fn(rows)
    out = []
    for r in rows:
        w = shim(r)
        w["_extra"] = extra.get(str(w["id"]), {})
        out.append(w)
    return out


async def _fetch_wps(pid: str, type_ids=None) -> list:
    # По type_ids выбираем источник: риски (тип 8) — из risks, иначе — из tasks.
    if type_ids and (type_ids == [RISK_TYPE_ID] or RISK_TYPE_ID in type_ids):
        return _shims_with_extra(await db.fetch_risks(pid), db.risk_shim, db.risk_extra)
    only = "milestone" if type_ids == [TYPE_ID["milestone"]] else None
    return _shims_with_extra(await db.fetch_tasks(pid, only_type=only), db.task_shim, db.task_extra)


def _status_name(wp: dict) -> str:
    sid = _href_id(wp.get("_links", {}), "status")
    return ID_STATUS.get(int(sid) if sid and str(sid).isdigit() else 0, "in_progress")


def _levels(wps: list) -> dict:
    byid = {str(w["id"]): w for w in wps}
    out = {}
    for w in wps:
        lvl, cur, seen = 0, w, set()
        while True:
            p = _href_id(cur.get("_links", {}), "parent")
            if not p or p not in byid or p in seen:
                break
            seen.add(p); lvl += 1; cur = byid[p]
        out[str(w["id"])] = lvl
    return out


async def _task_level(wp: dict, pid: str) -> int:
    """Уровень WBS одной задачи по цепочке родителей — без чтения всех задач проекта.
    Побайтно эквивалентно _levels(...)[tid]: считаем предков-задач ТОГО ЖЕ проекта
    (p in byid ⇔ get_task(p) существует и project_id == pid) с той же защитой от цикла."""
    lvl, cur, seen = 0, wp, set()
    while True:
        p = _href_id(cur.get("_links", {}), "parent")
        if not p or p in seen:
            break
        prow = await db.get_task(p)
        if not prow or str(prow["project_id"]) != str(pid):
            break
        seen.add(p); lvl += 1; cur = db.task_shim(prow)
    return lvl


def _wp_to_task(wp: dict, extra: dict, pid: str, level: int, sort_order: int) -> dict:
    links = wp.get("_links", {})
    wpid = str(wp.get("id"))
    ext = (extra or {}).get(wpid, {}) or {}
    ttype = ID_TYPE.get((links.get("type") or {}).get("title") or "Task", "task")
    ps, pe = wp.get("startDate"), wp.get("dueDate")
    dur = None
    if ps and pe:
        try:
            dur = (date.fromisoformat(pe) - date.fromisoformat(ps)).days + 1
        except Exception:  # noqa: BLE001
            dur = None
    return {
        "id": wpid, "project_id": str(pid),
        "parent_id": _href_id(links, "parent"),
        "wbs_code": ext.get("wbs_code"),
        "title": wp.get("subject"),
        "description": (wp.get("description") or {}).get("raw") or None,
        "task_type": ttype,
        "status": _status_name(wp),
        "priority": ext.get("priority") or "medium",
        "planned_start": ps, "planned_end": pe,
        "actual_start": ext.get("actual_start"), "actual_end": ext.get("actual_end"),
        "duration_days": dur,
        "progress": wp.get("percentageDone") or 0,
        "assignee_name": ext.get("assignee_name"), "assignee_email": ext.get("assignee_email"),
        "assignee_person_id": ext.get("assignee_person_id"),
        "bar_color": ext.get("bar_color"), "bitrix24_task_id": ext.get("bitrix24_task_id"),
        "sort_order": ext.get("sort_order") if ext.get("sort_order") is not None else sort_order,
        "estimated_hours": ext.get("estimated_hours"), "actual_hours": ext.get("actual_hours"),
        "level": level, "created_at": wp.get("createdAt"),
        # Соисполнители — в КОНЦЕ: байты этого ответа читают фронт, эталон и помощник, и
        # порядок ключей здесь часть контракта.
        "co_assignees": ext.get("co_assignees") or [],
    }


def _rollup_phase_progress(tasks: list) -> list:
    """Прогресс фазы = среднее прямых не-фазовых детей (display-only, в БД не пишем)."""
    kids: dict = {}
    for t in tasks:
        if t.get("task_type") != "phase" and t.get("parent_id"):
            kids.setdefault(str(t["parent_id"]), []).append(t.get("progress") or 0)
    for t in tasks:
        if t.get("task_type") == "phase":
            ch = kids.get(str(t["id"]))
            if ch:
                t["progress"] = round(sum(ch) / len(ch))
    return tasks


async def _wp_tasks(pid: str, m: dict) -> list:
    return _tasks_from_wps(await _fetch_wps(pid, TASK_TYPE_IDS), m, pid)


def _iso_delta(a: Optional[str], b: Optional[str]) -> int:
    """Разница в днях между двумя ISO-датами (a − b); 0, если что-то пусто/не парсится."""
    if not a or not b:
        return 0
    try:
        return (date.fromisoformat(str(a)[:10]) - date.fromisoformat(str(b)[:10])).days
    except ValueError:
        return 0


def _shift_date_days(iso, days: int):
    """Сдвинуть дату (ISO-строка или date) на days дней → объект date для DATE-колонки
    (asyncpg не принимает строку). None/непарсибельное — как есть."""
    if not iso:
        return iso
    try:
        return date.fromisoformat(str(iso)[:10]) + timedelta(days=days)
    except ValueError:
        return iso


# ── Даты во время приёма черновика ───────────────────────────────────────────────────
# Даты задачи умеют писать двое: явная правка и каскад, двигающий последователей на ту же
# дельту. Поодиночке каждый прав. В черновике, где даты выставлены сразу у полусотни задач,
# они пишут в одно и то же поле: каскад от первой задачи уезжает по всей цепочке и ложится
# ПОВЕРХ значений, которые тот же черновик задаёт явно дальше по списку. На реальном проекте
# так около половины задач получили даты, которых не было ни в одном элементе черновика,
# некоторые — даже за концом проекта, и появилась пара «предшественник позже последователя».
#
# Правило: ЯВНОЕ ЗНАЧЕНИЕ ЧЕРНОВИКА СИЛЬНЕЕ КАСКАДА. На время приёма сюда кладётся список
# задач, чьи даты черновик задаёт сам. Каскад их не двигает и не идёт сквозь них дальше:
# у такой задачи есть собственная правка, и это её каскад сдвинет то, что ниже. Всё, чего
# в черновике нет, каскад двигает как прежде — и попадает в отчёт поимённо, потому что
# «где-то что-то поехало» человек заметить не может.
_DRAFT_DATES: ContextVar[Optional[dict]] = ContextVar("_DRAFT_DATES", default=None)


@contextmanager
def draft_date_scope(owned: set):
    """Приём черновика: `owned` — задачи с явными датами (множество живое, приём его пополняет
    созданными). Отдаёт словарь сдвинутых каскадом: id → новые даты."""
    scope: dict = {"owned": owned, "shifted": {}}
    token = _DRAFT_DATES.set(scope)
    try:
        yield scope["shifted"]
    finally:
        _DRAFT_DATES.reset(token)


def draft_owns_task(tid) -> None:
    """Задача получила даты прямо сейчас (создана приёмом) — каскаду её больше не трогать."""
    scope = _DRAFT_DATES.get()
    if scope is not None:
        scope["owned"].add(str(tid))


async def _cascade_shift_successors(pid: str, moved_tid: str, delta_days: int) -> int:
    """Сдвинуть последователей перемещённой задачи на ту же дельту дней. Авто-планирования в
    бесплатной сборке dhtmlx нет, поэтому каскад считаем сами. Сдвиг на ОДНУ дельту сохраняет
    и зазор, и lag, и тип связи автоматически. Обход по зависимостям с защитой от циклов.
    Даты пишем НАПРЯМУЮ через db.update_task (не через роут задачи — иначе кольцо исходящего
    пуша в Bitrix и рекурсия по самому роуту)."""
    if not delta_days:
        return 0
    scope = _DRAFT_DATES.get()
    owned = scope["owned"] if scope else frozenset()
    deps = await db.fetch_deps(pid)
    succ: dict = {}
    for d in deps:
        succ.setdefault(str(d.get("depends_on_id")), []).append(str(d.get("task_id")))
    _, m = await load_meta(pid)
    by_id = {str(t["id"]): t for t in await _wp_tasks(pid, m)}
    shifted, visited, queue = 0, set(), list(succ.get(str(moved_tid), []))
    while queue:
        sid = queue.pop(0)
        if sid in visited:
            continue
        visited.add(sid)
        if sid in owned:
            # Дальше по этой ветке не идём: у задачи своя правка в этом же черновике, и её
            # собственный каскад сдвинет то, что за ней, — уже от верных дат.
            continue
        t = by_id.get(sid)
        if t and t.get("planned_start") and t.get("planned_end"):
            moved = {"planned_start": _shift_date_days(t["planned_start"], delta_days),
                     "planned_end": _shift_date_days(t["planned_end"], delta_days)}
            await db.update_task(sid, moved)
            shifted += 1
            if scope is not None:
                scope["shifted"][sid] = {"title": t.get("title") or sid,
                                         "planned_start": str(moved["planned_start"]),
                                         "planned_end": str(moved["planned_end"])}
        queue.extend(succ.get(sid, []))
    return shifted


async def _fetch_wps_bulk(pids, type_ids=None) -> dict:
    """Строки задач/рисков сразу для нескольких проектов → {pid: [шим, ...]}.
    Устраняет N+1 в /attention, /me/tasks, /search."""
    pids = [str(p) for p in pids]
    out: dict = {p: [] for p in pids}
    if not pids:
        return out
    if type_ids and (type_ids == [RISK_TYPE_ID] or RISK_TYPE_ID in type_ids):
        rows_by = await db.fetch_risks_bulk(pids)
        for p, rows in rows_by.items():
            out[p] = _shims_with_extra(rows, db.risk_shim, db.risk_extra)
    else:
        only = "milestone" if type_ids == [TYPE_ID["milestone"]] else None
        rows_by = await db.fetch_tasks_bulk(pids, only_type=only)
        for p, rows in rows_by.items():
            out[p] = _shims_with_extra(rows, db.task_shim, db.task_extra)
    return out


def _tasks_from_wps(wps: list, m: dict, pid: str) -> list:
    """Маппинг уже выбранных WP в задачи (без обращения к сети) — для bulk-пути.
    extra живёт в самом шиме (ключ '_extra'), т.к. сайдкар-колонки влиты в строку."""
    lv = _levels(wps)
    extra = {str(w["id"]): w.get("_extra", {}) for w in wps}
    return _rollup_phase_progress([_wp_to_task(w, extra, pid, lv.get(str(w["id"]), 0), i) for i, w in enumerate(wps)])


def _risks_from_wps(wps: list, m: dict, pid: str) -> list:
    re = {str(w["id"]): w.get("_extra", {}) for w in wps}
    return [_wp_to_risk(w, re, pid) for w in wps]


def _task_counts(wps: list) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    total = len(wps)
    completed = sum(1 for w in wps if _status_name(w) == "completed")
    overdue = sum(1 for w in wps if w.get("dueDate") and str(w["dueDate"]) < today and _status_name(w) != "completed")
    return {
        "tasks_total": total,
        "tasks_completed": completed,
        "progress": round(100 * completed / total) if total else 0,
        "overdue_tasks": overdue,
    }


def _to_date(v):
    """'YYYY-MM-DD'/ISO → datetime.date (DATE-колонка); пусто → None."""
    return date.fromisoformat(str(v)[:10]) if v else None


def _task_fields(payload: dict, for_create: bool, current_type: str = "") -> dict:
    """Колонки таблицы tasks из payload (замена _wp_body).

    ПРОГРЕСС фазы не пишем: он считается из детей (`_rollup_phase_progress`). А вот ДАТЫ
    пишем как у обычной задачи — раньше они тоже выбрасывались «потому что срок фазы
    деривируется из детей», но такой деривации в коде нет: чтение отдаёт `planned_start`/
    `planned_end` прямо из строки, и Гант берёт их же. Получалось, что PUT отвечает 200, а
    поле у фазы остаётся пустым навсегда — ровно об этом и написал РП. Обходной путь уже
    существовал в приёме черновика помощника (`draft_apply`: создать задачей с датами, потом
    сменить тип) — то есть через помощника даты фазе проставить было можно, а руками нет.

    Тип payload при обычном PUT не содержит — поэтому берём его из существующей строки."""
    ttype = (payload.get("task_type") or current_type or "task").lower()
    f: dict = {}
    if "title" in payload or for_create:
        f["title"] = (payload.get("title") or "Новая задача")[:255]
    if "task_type" in payload or for_create:
        f["task_type"] = ttype if ttype in TYPE_ID else "task"
    if "status" in payload or for_create:
        f["status"] = payload.get("status") or "not_started"
    if "description" in payload:
        f["description"] = payload.get("description") or ""
    if "planned_start" in payload:
        f["planned_start"] = _to_date(payload.get("planned_start"))
    if "planned_end" in payload:
        f["planned_end"] = _to_date(payload.get("planned_end"))
    if ttype != "phase" and "progress" in payload:
        f["progress"] = int(payload.get("progress") or 0)
    if "parent_id" in payload:
        f["parent_id"] = int(payload["parent_id"]) if payload.get("parent_id") else None
    return f


def _extra_fields(payload: dict, keys) -> dict:
    """Extra-колонки (сайдкар) из payload — только присутствующие ключи."""
    return {k: payload[k] for k in keys if k in payload}


# ---------- валидация входных данных (422 на недопустимые enum/длину) ----------
_VALID_TASK_STATUS = set(STATUS_ID)
_VALID_PRIORITY = {"critical", "high", "medium", "low"}
_VALID_LEVEL3 = {"low", "medium", "high"}


def _validate_enum(payload: dict, field: str, allowed: set, label: str):
    v = payload.get(field)
    if v not in (None, "") and v not in allowed:
        raise HTTPException(status_code=422, detail=f"Недопустимое значение «{v}» для {label}")


def _validate_number(payload: dict, field: str, label: str):
    """Числовое поле: не-число → 422 (иначе int()/asyncpg падают 500)."""
    v = payload.get(field)
    if v in (None, ""):
        return
    try:
        float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Поле «{label}» должно быть числом")


def _validate_task_payload(payload: dict):
    _validate_enum(payload, "status", _VALID_TASK_STATUS, "статуса")
    _validate_enum(payload, "priority", _VALID_PRIORITY, "приоритета")
    _validate_enum(payload, "task_type", set(TYPE_ID), "типа задачи")
    for _fld, _lbl in (("progress", "прогресса"), ("estimated_hours", "оценки часов"),
                       ("actual_hours", "фактических часов")):
        _validate_number(payload, _fld, _lbl)
    if payload.get("title") is not None and len(str(payload["title"])) > 255:
        raise HTTPException(status_code=422, detail="Название задачи длиннее 255 символов")


def _validate_risk_payload(payload: dict):
    _validate_enum(payload, "probability", _VALID_LEVEL3, "вероятности")
    _validate_enum(payload, "impact", _VALID_LEVEL3, "влияния")
    if payload.get("title") is not None and len(str(payload["title"])) > 255:
        raise HTTPException(status_code=422, detail="Название риска длиннее 255 символов")


_VALID_PROJECT_STATUS = {"planning", "active", "on_hold", "completed", "cancelled"}


def _validate_project_payload(payload: dict):
    _validate_enum(payload, "status", _VALID_PROJECT_STATUS, "статуса проекта")
    _validate_enum(payload, "priority", _VALID_PRIORITY, "приоритета")
    _validate_enum(payload, "project_kind", {"strategic", "operational", "pilot"}, "вида проекта")
    if payload.get("name") is not None and len(str(payload["name"])) > 255:
        raise HTTPException(status_code=422, detail="Название проекта длиннее 255 символов")
    if payload.get("code") is not None and len(str(payload["code"])) > 50:
        raise HTTPException(status_code=422, detail="Код проекта длиннее 50 символов")
    # Даты: начало не позже завершения (ISO YYYY-MM-DD сравнивается лексикографически). Проверяем,
    # только когда обе даты пришли в payload (визард шлёт обе; частичный PATCH одной — пропускаем).
    ps, pe = payload.get("planned_start"), payload.get("planned_end")
    if ps and pe and str(ps) > str(pe):
        raise HTTPException(status_code=422, detail="Плановое начало позже планового завершения")
    as_, ae = payload.get("actual_start"), payload.get("actual_end")
    if as_ and ae and str(as_) > str(ae):
        raise HTTPException(status_code=422, detail="Фактическое начало позже фактического завершения")


def _validate_generic_item(payload: Any):
    """Структурная валидация элемента модульной коллекции (team/stakeholders/…):
    плоский объект (скаляры/списки), БЕЗ вложенных объектов на верхнем уровне; строки ≤ 20000;
    элементы списков — скаляры или ПЛОСКИЕ объекты (напр. action_items встреч), не глубже.
    Ловит мусор/неверные типы без жёсткой per-collection-схемы (enum/required не навязываем —
    `status` и т.п. означают разное в разных коллекциях)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Ожидался объект")

    def _scalar(x) -> bool:
        return x is None or isinstance(x, (str, int, float, bool))

    for k, v in payload.items():
        if isinstance(v, str) and len(v) > 20000:
            raise HTTPException(status_code=422, detail=f"Поле «{k}» слишком длинное (≤20000)")
        if isinstance(v, dict):
            raise HTTPException(status_code=422, detail=f"Поле «{k}»: вложенные объекты не поддерживаются")
        if isinstance(v, list):
            if len(v) > 5000:  # cap длины списка: без него один элемент с миллионом записей раздувает project_docs
                raise HTTPException(status_code=422, detail=f"Поле «{k}»: слишком много элементов (≤5000)")
            for it in v:
                if _scalar(it):
                    continue
                if isinstance(it, dict):  # плоский объект: значения — скаляры или списки скаляров
                    for iv in it.values():
                        if not (_scalar(iv) or (isinstance(iv, list) and all(_scalar(z) for z in iv))):
                            raise HTTPException(status_code=422, detail=f"Поле «{k}»: слишком глубокая структура")
                else:
                    raise HTTPException(status_code=422, detail=f"Поле «{k}»: недопустимый элемент списка")


# CRUD задач (WBS, нативные work packages) вынесен в tasks_routes (build_router на main-фасаде).
# Хелперы (_task_fields/_wp_to_task/_log_action/_diff_detail/…) остаются в main.
(_tasks_router, tasks_list, tasks_create, tasks_update, tasks_delete) = \
    tasks_routes.build_router(_API)
app.include_router(_tasks_router)


def _log_action(m: dict, user: dict, action: str, detail: str = ""):
    """Сквозной журнал действий проекта (кто-что-когда) — RBAC-6 продуктового аудита.
    version_log покрывал только правки паспорта; здесь — удаления/создание/передача РП.

    A2 (гонка потери записи): НЕ мутируем m['_action_log']. Иначе version-checked запись меты
    (update_project_meta с colls) делает DELETE+re-INSERT всей коллекции _action_log из снимка в
    памяти БЕЗ advisory-lock — и затирает параллельный append журнала задачи/риска
    (db.append_action_log, который version не бампает и потому невидим version-проверке).
    Складываем запись в транзиентный m['_pending_action_log']; save-обёртки (with_meta_retry/
    save_meta_full/_save_meta) сливают её append-only ПОСЛЕ успешной записи меты (см. _flush_pending_log)."""
    pending = m.get("_pending_action_log")
    pending = pending if isinstance(pending, list) else []
    pending.append({"at": _now_iso(), "user_id": str(user.get("id") or ""),
                    "user_name": user.get("full_name") or "", "action": action, "detail": str(detail)[:160]})
    m["_pending_action_log"] = pending


async def _append_action_log(pid: str, user: dict, action: str, detail: str = "") -> None:
    """Append-only запись в журнал (не бампает projects.version → нет ложного 409 против правки
    паспорта). Зеркалит форму записи _log_action. Для операций, чья ЕДИНСТВЕННАЯ правка меты —
    журналирование (создание/правка/удаление задач и рисков: сами строки уже в таблицах tasks/risks)."""
    entry = {"at": _now_iso(), "user_id": str(user.get("id") or ""),
             "user_name": user.get("full_name") or "", "action": action, "detail": str(detail)[:160]}
    await db.append_action_log(pid, entry, _ACTION_LOG_CAP)


def _diff_parts(old: dict, new: dict, keys) -> list:
    """Дифф «поле: было→стало» ОТДЕЛЬНЫМИ строками (пустые значения — «—»).

    Имена полей остаются техническими сознательно: сервер не знает языка читателя,
    а любой перевод здесь навсегда осел бы в базе. Человеческие подписи подставляет
    интерфейс (ActionDetail во фронте) — и делает это на языке пользователя."""
    parts = []
    for k in keys:
        if k not in new:
            continue
        ov, nv = old.get(k), new.get(k)
        if _vlog_changed(ov, nv):
            o = str(ov)[:40] if ov not in (None, "") else "—"
            n = str(nv)[:40] if nv not in (None, "") else "—"
            parts.append(f"{k}: {o}→{n}")
    return parts


def _diff_detail(old: dict, new: dict, keys) -> str:
    """Компактный дифф «поле: было→стало» для журнала действий (пустые значения — «—»)."""
    return "; ".join(_diff_parts(old, new, keys))[:160]


def _editor_view(uid: str) -> dict:
    u = next((x for x in USERS.values() if str(x.get("id")) == str(uid)), None)
    return {"id": str(uid), "full_name": (u or {}).get("full_name") or str(uid), "email": (u or {}).get("email")}


# Операции задач (reorder / Bitrix24-задача / gantt-data / зависимости) вынесены
# в task_ops_routes (build_router на main-фасаде). Хелперы остаются в main.
(_task_ops_router, tasks_reorder, task_bitrix_create, task_bitrix_delete,
 gantt_data, dep_create, dep_delete) = task_ops_routes.build_router(_API)
app.include_router(_task_ops_router)


# ---------- risks — источник истины: work packages OpenProject (тип Risk) ----------
_RISK_EXTRA_KEYS = ("code", "category", "probability", "impact", "status", "owner",
                    "mitigation_plan", "contingency_plan", "related_task_id")


def _wp_to_risk(wp: dict, rextra: dict, pid: str) -> dict:
    wpid = str(wp.get("id"))
    ext = (rextra or {}).get(wpid, {}) or {}
    prob = ext.get("probability") or "medium"
    imp = ext.get("impact") or "medium"
    ups = ext.get("updates")
    return {
        "id": wpid, "project_id": str(pid),
        "code": ext.get("code"),
        "title": wp.get("subject"),
        "description": (wp.get("description") or {}).get("raw") or None,
        "category": ext.get("category"),
        "probability": prob, "impact": imp, "score": _risk_score(prob, imp),
        "status": ext.get("status") or "open",
        "owner": ext.get("owner"),
        "mitigation_plan": ext.get("mitigation_plan"),
        "contingency_plan": ext.get("contingency_plan"),
        "related_task_id": ext.get("related_task_id"),
        "created_at": wp.get("createdAt"),
        "updates": ups if isinstance(ups, list) else [],
    }


def _risk_counts(risks: list) -> dict:
    open_r = [r for r in risks if (r.get("status") or "open") not in ("closed", "mitigated")]
    def bucket(r):
        s = _risk_score(r.get("probability"), r.get("impact"))
        return "high" if s >= 6 else ("medium" if s >= 3 else "low")
    b = [bucket(r) for r in open_r]
    return {
        "risks_open": len(open_r),
        "risks_high": b.count("high"),
        "risks_medium": b.count("medium"),
        # Высокий риск, под который никто не написал, что будем делать, — единственный риск,
        # который красит проект. Честно заведённый риск С планом — это управление, а не тревога.
        "risks_high_unmitigated": sum(1 for r, k in zip(open_r, b)
                                      if k == "high" and not str(r.get("mitigation_plan") or "").strip()),
    }


async def _wp_risks(pid: str, m: dict) -> list:
    return _risks_from_wps(await _fetch_wps(pid, [RISK_TYPE_ID]), m, pid)


# Риски (нативные WP типа Risk) вынесены в risks_routes (build_router на main-фасаде).
# _wp_risks остаётся в main (используется портфелем/аналитикой).
(_risks_router, risks_list, risks_create, risks_update, risks_delete,
 risk_update_add, risk_update_del) = risks_routes.build_router(_API)
app.include_router(_risks_router)


# ---------- генерик-коллекции модулей ----------
def _item_label(item: dict) -> str:
    """Человекочитаемая метка записи для журнала действий."""
    for k in ("title", "name", "full_name", "goal", "description", "period"):
        v = item.get(k)
        if v:
            return str(v)[:80]
    return str(item.get("id") or "")[:36]


def _next_code(items: list, prefix: str) -> str:
    """Следующий свободный код вида PREFIX-NN по уже присвоенным (как R-NN у рисков)."""
    used = set()
    for it in items:
        c = (it or {}).get("code")
        if isinstance(c, str) and c.upper().startswith(prefix.upper() + "-"):
            try:
                used.add(int(c.split("-", 1)[1]))
            except ValueError:
                pass
    n = 1
    while n in used:
        n += 1
    return f"{prefix}-{n:02d}"


def _unique_code(base: str, existing) -> str:
    """Уникальный код проекта: base, затем base-2, base-3 … (без учёта регистра/пробелов)."""
    taken = {str(c or "").strip().lower() for c in (existing or [])}
    code = base[:60]
    n = 2
    while code.strip().lower() in taken:
        code = f"{base}-{n}"[:60]
        n += 1
    return code


# Генерик-CRUD модульных коллекций вынесен в collections_routes (build_router на main-фасаде).
# Регистрация и порядок сохранены здесь, чтобы позиция маршрутов в таблице не менялась.
_collections_router = APIRouter()


# Поля, которые ставит СЕРВЕР и не вправе прислать клиент, — по коллекции.
#
# ОДНА таблица, а не аргумент на месте регистрации, потому что путей записи в коллекцию ДВА:
# фабрика (обычный CRUD раздела) и приём черновика помощника (draft_apply._apply_coll). Второй
# всегда шёл своим mut и знал только про id/project_id/created_at — то есть помощник мог
# проставить `bitrix_event_owner` и через «убрать из Bitrix» удалить событие из чужого
# календаря, а с фазой C — отнести чужие расходы к любому блоку любого зонтика.
# Список должен быть один: два списка разъедутся на первом же новом поле.
_COLLECTION_PROTECTED: dict = {
    # fireflies_meeting_id/transcript_url/fireflies_minutes_sha ставит только связка Fireflies
    # (fireflies_sync): по id она находит «своё» совещание, по хешу отличает свой протокол от
    # правки человека. Подставь их клиент — чужой протокол Fireflies лёг бы поверх живого текста.
    "_meetings": ("bitrix_event_id", "bitrix_event_owner", "bitrix_event_from",
                  "fireflies_meeting_id", "transcript_url", "fireflies_minutes_sha"),
    # Номер задачи Bitrix ставит и снимает ТОЛЬКО сервер (bitrix_routes: create/delete пишут его
    # через with_meta_retry). Обычным PUT его принимать нельзя: удаление задачи идёт вебхуком
    # интеграции ПО ЭТОМУ номеру, и подставленный руками чужой id снёс бы чужую задачу. Ровно эта
    # дыра уже закрыта у совещаний — здесь она оставалась открытой.
    "_backlog": ("bitrix24_task_id",),
    "_budget": ("parent_item_id",),
}


def _protected_fields(key: str) -> tuple:
    """Серверные поля коллекции. Зовётся и фабрикой, и приёмом черновика."""
    return _COLLECTION_PROTECTED.get(key, ())


def _register_collection(url: str, key: str, reorder: bool = False, sort: bool = True,
                         recount: bool = False, code_prefix: str = "", on_delete: str = "",
                         before_write: str = ""):
    collections_routes.register(_API, _collections_router, url, key,
                                reorder=reorder, sort=sort, recount=recount, code_prefix=code_prefix,
                                on_delete=on_delete, protected=_protected_fields(key),
                                before_write=before_write)


_register_collection("team", "_team", reorder=True)
_register_collection("stakeholders", "_stakeholders", reorder=True)
_register_collection("assumptions", "_assumptions", reorder=True)
_register_collection("communication-plan", "_comms", reorder=True)
_register_collection("kpis", "_kpis", reorder=True)
_register_collection("decisions", "_decisions", recount=True, code_prefix="D")
# bitrix_event_* ставит ТОЛЬКО сервер. Иначе обычная правка совещания подсовывает чужой id
# события и чужой календарь, а «убрать из Bitrix» руками вебхука интеграции удаляет чужое
# событие. Раньше эти поля тоже писались клиентом, но удаление шло в календарь нажавшего —
# теперь адресом служит сохранённый владелец, и без этого списка это была бы дыра шире прежней.
_register_collection("meetings", "_meetings", sort=False, recount=True,
                     on_delete="_meeting_on_delete",
)
# parent_item_id — привязка статьи к статье ЗОНТИКА, то есть ссылка в ЧУЖОЙ проект. Обычным
# PUT её принимать нельзя: проверить, что цель существует и что зонтик тот самый, можно
# только асинхронно, а mutate синхронный. Ставит её отдельный маршрут (…/budget-items/{bid}/link),
# как `bitrix_event_owner` в совещаниях. before_write считает деньги из часов по ставке проекта.
_register_collection("budget-items", "_budget", sort=False,
                     before_write="_budget_before_write")
_register_collection("status-reports", "_reports", sort=False)
_register_collection("backlog", "_backlog", code_prefix="B")
app.include_router(_collections_router)

# Остальные группы роутов вынесены в модули (build_router на main-фасаде): справочник людей,
# админка/профиль/настройки, CRUD+жизненный цикл проектов, проектные операции. Все хелперы
# остаются в main и резолвятся через api.* на вызове — байты ответов не меняются.
(_directory_router, users, persons_list, persons_create, persons_update,
 persons_delete, persons_delete_all, persons_import_bitrix) = directory_routes.build_router(_API)
app.include_router(_directory_router)

(_admin_router, admin_users_list, admin_users_create, admin_users_update, admin_users_password,
 admin_users_delete, update_me, update_my_password, get_rag_settings, put_rag_settings,
 get_my_prefs, put_my_prefs, get_workload_settings, put_workload_settings,
 get_smtp_settings, put_smtp_settings, get_mcp_settings, put_mcp_settings) = admin_routes.build_router(_API)
app.include_router(_admin_router)

(_projects_router, projects, project_get, project_put, project_create, project_delete,
 project_summary, version_log, close_version, project_action_log, project_archive, project_unarchive,
 project_set_template, list_templates, project_transfer, transfer_candidates,
 project_editors_list, project_editor_add,
 project_editor_remove,
 project_observers_list, project_observer_add, project_observer_remove,
 subprojects_list, subproject_add, subproject_remove,
 project_clone) = projects_routes.build_router(_API)
app.include_router(_projects_router)

(_project_ops_router, backlog_promote, meeting_finalize, meeting_distribute, meeting_recur,
 status_report_get, risks_summary, budget_monthly, budget_summary, budget_settings,
 baselines_list, baseline_create, baseline_delete, tasks_bulk) = project_ops_routes.build_router(_API)
app.include_router(_project_ops_router)


# ---------- meetings: рассылка протокола участникам + событие в календарь ----------
def _meeting_protocol_body(mt: dict) -> str:
    lines = [f"Протокол встречи: {mt.get('title') or ''}",
             f"Дата: {mt.get('meeting_date') or ''} {mt.get('meeting_time') or ''}".strip()]
    ag = mt.get("agenda_items") or []
    if ag:
        lines.append("\nПовестка:")
        lines += [f"  • {a.get('item') or ''}" for a in ag if isinstance(a, dict)]
    if mt.get("minutes_content"):
        lines.append("\nПротокол:\n" + str(mt.get("minutes_content")))
    dec = mt.get("decisions") or []
    if dec:
        lines.append("\nРешения:")
        lines += [f"  • {d.get('decision_text') or d.get('title') or ''}" for d in dec if isinstance(d, dict)]
    acts = mt.get("actions") or []
    if acts:
        lines.append("\nПоручения:")
        lines += [f"  • {a.get('action_text') or ''} — {a.get('assignee_name') or ''} ({a.get('due_date') or 'без срока'})"
                  for a in acts if isinstance(a, dict)]
    if mt.get("next_meeting_date"):
        lines.append(f"\nСледующая встреча: {mt.get('next_meeting_date')}")
    return "\n".join(lines)


# Интеграция Bitrix24 (backlog-задача / тест / вебхук / настройки) вынесена в
# bitrix_routes (build_router на main-фасаде). bx-клиент и BITRIX_* остаются в main
# (монкейпатч-совместимость: вебхук читает api.BITRIX_INBOUND_TOKEN на вызове).
(_bitrix_router, backlog_bitrix_create, backlog_bitrix_delete, bitrix_test,
 bitrix_webhook, get_bitrix_settings, put_bitrix_settings) = bitrix_routes.build_router(_API)
app.include_router(_bitrix_router)

# Календарь Bitrix24 (WP6): недельная сетка, занятость, создание события и подбор общего слота.
# Готовый UI звал эти ручки и получал 404 — теперь они есть.
(_bx_cal_router, calendar_events, calendar_accessibility, calendar_event_create,
 suggest_slots) = bitrix_calendar_routes.build_router(_API)
app.include_router(_bx_cal_router)

# Связка Fireflies: приём вебхука V2 (только очередь, работа — в воркере fireflies_sync)
# и ручки владельца портала для очереди «не сопоставлено»/повторов.
(_fireflies_router, fireflies_webhook, fireflies_sync_list,
 fireflies_sync_retry) = fireflies_routes.build_router(_API)
app.include_router(_fireflies_router)


# _num, _budget_aggregates — вынесены в domain.py (импортированы выше)


# ───────────────────── ставка часа и производные деньги (фаза C) ─────────────────────

def parse_money(v, field: str = "значение"):
    """Число из того, что реально приходит из формы и из внешних систем.

    `_num` (domain.py) МОЛЧА даёт 0 на «50,5», «12 000» и «50 EUR» — проверено. Для сумм это
    старое поведение, и трогать его нельзя: на нём стоит байтовый контракт. Но ставка часа
    множит собой ВЕСЬ бюджет дерева, и её тихий ноль обнулил бы программу целиком, а
    `_budget_rollup` подставил бы вместо неё утверждённый лимит — в портфеле появились бы
    деньги, которых нет ни в одной статье. Поэтому у ставки своя дверь: разбираем запятую и
    пробелы-разделители, а на мусор отвечаем 422, а не нулём.

    None и пустая строка — это «не задано», а не ноль: ноль ставки означает «часы не
    тарифицируем», и путать эти два состояния нельзя.
    """
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, bool):
        raise HTTPException(status_code=422, detail=f"{field}: ожидается число")
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        t = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".")
        try:
            n = float(t)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{field}: ожидается число, получено «{str(v)[:40]}»")
    if n != n or n in (float("inf"), float("-inf")):
        raise HTTPException(status_code=422, detail=f"{field}: ожидается число")
    if n < 0:
        raise HTTPException(status_code=422, detail=f"{field}: не может быть отрицательным")
    return n


def _effective_rate(m: dict) -> float:
    """Ставка часа проекта: своя, иначе унаследованная от зонтика, иначе 0.

    Отсутствие и ноль различаем по НАЛИЧИЮ ключа, а не по истинности значения. Через `or`
    ставка 0 («внутренние работы, часы не тарифицируем») молча превращалась бы в ставку
    зонтика — и один и тот же проект считался бы по-разному в зависимости от того, пришёл
    ноль строкой из формы (истинна) или числом из импорта (ложен).

    Ставка родителя приезжает в транзиентном `_tree` (db._TREE_CTE, фаза B) СТРОКОЙ — meta
    в Postgres читается как json, а `meta->>'budget_rate'` даёт текст.
    """
    own = m.get("budget_rate")
    if own is not None and str(own).strip() != "":
        return _num(own)
    inh = (m.get("_tree") or {}).get("parent_budget_rate")
    if inh is not None and str(inh).strip() != "":
        return _num(inh)
    return 0.0


def _money_from_hours(hours, rate: float):
    """Деньги из часов — ОДИН раз, в момент записи, а не при каждом чтении.

    Так ставка не переписывает прошлое: часы за январь по старой ставке останутся стоить
    столько же, когда в июле ставка вырастет. Считать при чтении означало бы, что смена ставки задним
    числом молча меняет бюджет всей программы за полгода — и объяснить расхождение со
    статус-отчётами, где сумма заморожена, было бы нечем.

    Второе следствие важнее: `_budget_planned`/`_budget_actual` (domain.py) остаются без
    аргумента ставки и без единой правки, поэтому все, кто их зовёт — портфель, снимки,
    by_category, burn-down, MCP — считают ровно как раньше, а не «как раньше, если ставка 0».
    """
    if hours is None or str(hours).strip() == "" or rate <= 0:
        return None
    h = _num(hours)
    if h <= 0:
        return None
    return round(h * rate, 2)


# Числовые поля статьи бюджета. Нормализуются при ЗАПИСИ, а не при чтении.
_BUDGET_NUMERIC = ("amount", "forecast_total", "actual_total", "planned_amount",
                   "equipment_units", "equipment_amount", "labour_hours", "labour_amount",
                   "materials_units", "materials_amount", "contractors_units",
                   "contractors_amount", "planned_hours")


def _normalize_budget_numbers(item: dict, payload: dict) -> None:
    """Числа в статье бюджета — числами, а не тем, что пришло из формы или из импорта.

    Пока значение хранится как есть, «12 000» читается двумя сторонами ПО-РАЗНОМУ: бэкенд
    (`_num`) молча даёт 0, фронт (`numOf`) даёт NaN и проваливается в сумму по месяцам. Одна и
    та же статья показывает два разных числа на одном экране — в шапке раздела одно, в строке
    таблицы другое. Портал такое не печатает сам, но это приходит импортом из xlsx, от
    помощника и прямым вызовом API.

    Поэтому разбираем на границе записи: «12 000» → 12000.0, «50,5» → 50.5, мусор → 422.
    Пустое остаётся пустым — это «не задано», а не ноль. Дальше по системе идёт уже число, и
    расходиться нечему.
    """
    for k in _BUDGET_NUMERIC:
        if k not in payload:
            continue
        v = payload[k]
        if v is None or (isinstance(v, str) and not v.strip()):
            continue                      # «не задано» не трогаем: пустое — не ноль
        item[k] = parse_money(v, k)


def _budget_before_write(m: dict, item: dict, payload: dict, before: dict) -> None:
    """Хук фабрики коллекций для статьи бюджета: числа — числами, часы → деньги.

    Вызывается ВНУТРИ mutate, где есть мета проекта (а значит и ставка, и `_tree`), но нет
    похода в базу — этого достаточно: ставка живёт в том же документе.

    ПРАВИЛО: что правили последним, то и главное. То же самое действует в помесячной сетке,
    и разойтись эти два места не должны.

    Почему не «считаем, когда сумма пуста»: форма статьи присылает ВСЕ свои поля целиком при
    каждом сохранении, поэтому сумма никогда не бывает пустой после первого расчёта. Правка
    часов с 800 на 900 не двигала бы деньги вовсе — на экране стояло бы «900 ч» по цене 800.
    Поэтому смотрим, что именно ИЗМЕНИЛОСЬ: поменяли часы — пересчитываем; поменяли сумму
    руками — она главнее и остаётся как есть.

    `before` — значения полей ДО правки (у создания пусто).
    """
    _normalize_budget_numbers(item, payload)
    if "planned_hours" not in payload:
        return
    raw = payload.get("planned_hours")
    hours = None if (raw is None or str(raw).strip() == "") else _num(raw)
    item["planned_hours"] = hours

    def _same(a, b) -> bool:
        if a is None or str(a).strip() == "":
            return b is None or str(b).strip() == ""
        return b is not None and str(b).strip() != "" and _num(a) == _num(b)

    hours_changed = not _same(hours, before.get("planned_hours"))
    amount_changed = "amount" in payload and not _same(payload.get("amount"), before.get("amount"))
    if not hours_changed or amount_changed:
        return              # часы не трогали, либо в этой же правке вписали сумму руками
    derived = _money_from_hours(hours, _effective_rate(m))
    if derived is not None:
        item["amount"] = derived


async def _child_rows(pid: str) -> list:
    """ВСЕ подпроекты зонтика: [(row, project, meta)], отсортированные как таблица «Подпроекты».

    Без фильтра по правам — потому что есть один случай, где он даёт НЕВЕРНОЕ число, а не
    меньше данных: остаток по блоку зонтика. Остаток = план − всё, что откусили ВСЕ
    подпроекты; посчитанный по тем детям, которых видит смотрящий, он завышен, и человек
    планирует по нему следующие расходы. Поэтому решение «пускать ли вообще»
    принимается один раз и выше (правами на сам зонтик), а сюда фильтр не спускается.
    """
    ids = await db.child_project_ids(pid)
    if not ids:
        return []
    els = await db.fetch_project_rows_by_ids(ids)
    docs = await db.load_project_docs_for([e.get("id") for e in els])
    out = []
    for el in els:
        el["_docs"] = docs.get(str(el.get("id")), {})
        out.append((el, to_project(el), _meta(el)))
    out.sort(key=lambda t: (str(t[1].get("code") or ""), int(t[1]["id"])))
    return out


async def _readable_children(pid: str, user: dict) -> list:
    """Подпроекты зонтика, которые ЭТОТ человек вправе читать: [(row, project, meta)].

    Один загрузчик на два экрана — таблицу «Подпроекты» и сводный бюджет. Иначе это были бы
    две цепочки из четырёх запросов каждая, которые обязаны согласоваться в трёх вещах разом:
    что считать ребёнком, кого отсекать по правам и в каком порядке выдавать. Ровно на таких
    парах в этом проекте уже расходились фильтры доступа.

    Фильтр берём по УЖЕ загруженным строкам: спрашивать кэш прав по каждому ребёнку значило бы
    лишний запрос на каждый подпроект при каждом показе программы. По правилу
    дерева не отсечётся никто, но страховка переживёт смену правила.
    """
    return [t for t in await _child_rows(pid)
            if user.get("role") in READ_ALL_ROLES or _can_read_item(user, t[1])]


def _apply_budget_consumption(rows: list, projs: list) -> None:
    """Дописать строкам зонтиков, сколько их блоков израсходовали подпроекты. На месте.

    ВТОРОЙ ПРОХОД, а не поле в `_portfolio_row`. Та же строка обслуживает ещё дневной снимок и
    таблицу «Подпроекты»; число «взято детьми» осмысленно только там, где рядом лежат сами
    дети, и в снимке оно стало бы историей, которую никто не спрашивал.

    Считается по уже загруженным проектам — ни одного лишнего запроса. Суммы строк не меняются:
    `budget_consumed` только ПОКАЗЫВАЕТ, что за бюджетом программы стоят модули, и ни в один
    итог портфеля не входит — иначе деньги ребёнка посчитались бы и у него, и у родителя.
    """
    by_parent: dict = {}
    for p, m in projs:
        parent = (m.get("_tree") or {}).get("parent_id")
        if not parent:
            continue
        cur = m.get("budget_currency") or "EUR"
        taken = sum(_budget_actual(i) for i in _coll(m, "_budget")
                    if _budget_kind(i) == "expense" and i.get("parent_item_id"))
        if taken:
            a = by_parent.setdefault(str(parent), {"sum": 0.0, "kids": 0, "cur": cur})
            a["sum"] += taken
            a["kids"] += 1
    for r in rows:
        a = by_parent.get(str(r.get("id")))
        if a and a["cur"] == (r.get("budget_currency") or "EUR"):
            r["budget_consumed"] = round(a["sum"], 2)
            r["budget_consumed_projects"] = a["kids"]


def _consolidate_budget(um: dict, children: list) -> dict:
    """Сводный бюджет зонтика: план по блокам, сколько откусили подпроекты, что осталось.

    ЧИСТАЯ функция. `children` — уже загруженные и уже отфильтрованные по правам строки детей
    вида (pid, code, name, meta). Права здесь не проверяются намеренно: решать, чьи деньги
    человеку показывать, должен маршрут, у которого есть пользователь, — иначе правило
    разъедется с остальными (см. `_can_read_item`).

    Привязка статьи ребёнка (`parent_item_id`) — ОТНЕСЕНИЕ, а не обнуление. Свои числа
    подпроекта не меняются ни на копейку: он по-прежнему видит собственные план и факт, а
    портфель, снимки и by_category считают ровно как раньше. Это главное отличие от первого
    замысла, где привязанная статья должна была отдавать план 0: тогда `_budget_rollup` видел
    бы сумму 0, подставлял утверждённый лимит — и в портфеле появлялись бы деньги, которых нет
    ни в одной статье, а на своём экране подпроект показывал бы «0 из N» при утверждённом лимите N.

    Ничего не теряем молча: факт ребёнка, привязанный к несуществующей статье, попадает в
    `orphans`, а непривязанные расходы ребёнка — в `unattributed`. И то и другое видно на
    экране: деньги, которые никуда не отнесли, — это вопрос к людям, а не повод их скрыть.
    """
    exp = [i for i in _coll(um, "_budget") if _budget_kind(i) == "expense"]
    blocks = []
    by_id = {}
    for i in exp:
        b = {"item_id": str(i.get("id") or ""), "name": i.get("name") or i.get("title") or "—",
             "category": i.get("category") or "—",
             "planned": _budget_planned(i), "planned_hours": _num(i.get("planned_hours")) or None,
             "own_actual": _budget_actual(i), "by_child": [], "consumed_by_children": 0.0,
             "consumed": 0.0, "remaining": 0.0}
        blocks.append(b)
        by_id[b["item_id"]] = b

    cur = um.get("budget_currency") or "EUR"
    orphans, unattributed, foreign = [], [], []
    for pid, code, name, cm in children:
        own = {"project_id": str(pid), "project_code": code, "project_name": name,
               "currency": cm.get("budget_currency") or "EUR"}
        # Валюта проверяется при ПРИВЯЗКЕ, но проект может сменить её потом — а конвертации в
        # портале нет. Складывать KZT с EUR молча значит показать сумму, завышенную
        # в сотни раз, без единого признака ошибки. Такие подпроекты считаем отдельно и называем.
        if own["currency"] != cur:
            foreign.append({**own,
                            "actual": round(sum(_budget_actual(i) for i in _coll(cm, "_budget")
                                                if _budget_kind(i) == "expense"), 2)})
            continue
        loose_plan = loose_actual = 0.0
        for i in _coll(cm, "_budget"):
            if _budget_kind(i) != "expense":
                continue
            link = str(i.get("parent_item_id") or "")
            planned, actual = _budget_planned(i), _budget_actual(i)
            if link and link in by_id:
                blk = by_id[link]
                blk["by_child"].append({**own, "item_name": i.get("name") or "—",
                                        "planned": planned, "actual": actual})
                blk["consumed_by_children"] += actual
            elif link:
                # Ссылка есть, а статьи нет: её удалили в зонтике. Деньги реальны — показываем.
                orphans.append({**own, "item_name": i.get("name") or "—",
                                "parent_item_id": link, "planned": planned, "actual": actual})
            else:
                loose_plan += planned
                loose_actual += actual
        if loose_plan or loose_actual:
            unattributed.append({**own, "planned": loose_plan, "actual": loose_actual})

    for b in blocks:
        b["consumed"] = round(b["own_actual"] + b["consumed_by_children"], 2)
        b["remaining"] = round(b["planned"] - b["consumed"], 2)
        b["consumed_by_children"] = round(b["consumed_by_children"], 2)

    totals = {"planned": round(sum(b["planned"] for b in blocks), 2),
              "own_actual": round(sum(b["own_actual"] for b in blocks), 2),
              "consumed_by_children": round(sum(b["consumed_by_children"] for b in blocks), 2),
              "consumed": round(sum(b["consumed"] for b in blocks), 2),
              "remaining": round(sum(b["remaining"] for b in blocks), 2),
              "orphan_actual": round(sum(o["actual"] for o in orphans), 2),
              "unattributed_actual": round(sum(u["actual"] for u in unattributed), 2)}
    currencies = sorted({cur} | {c.get("budget_currency") or "EUR" for _, _, _, c in children})
    return {"currency": cur, "currencies": currencies,
            "rate": _effective_rate(um),
            "blocks": blocks, "orphans": orphans, "unattributed": unattributed,
            "foreign_currency": foreign, "totals": totals}


def _budget_kind(i: dict) -> str:
    # Доход, если явно kind=income ИЛИ (легаси) категория revenue; иначе расход.
    if i.get("kind") == "income":
        return "income"
    if not i.get("kind") and i.get("category") == "revenue":
        return "income"
    return "expense"


# ---------- публичный доступ (share по ссылке без входа) ----------
_SHARE_KEY = "_share"


def _share_cfg(m: dict) -> dict:
    s = m.get(_SHARE_KEY) or {}
    return {"enabled": bool(s.get("enabled")), "token": s.get("token") or "",
            "sections": [str(x) for x in (s.get("sections") or [])]}


# Публичная ссылка анонимна: контактный PII (email/phone команды и стейкхолдеров), адреса рассылки
# протокола (_distribution.recipients[].email) и исполнителей (assignee_email) наружу НЕ отдаём.
# _redact_public применяется в РЕАЛЬНЫХ share-хендлерах (collections._list / tasks_list / gantt-data),
# когда запрос авторизован как role="public" (share-токен, см. rbac/_resolve_public). На
# аутентифицированные ответы (owner/pm — голдены) НЕ влияет: там role != "public".
_PUBLIC_STRIP_KEYS = frozenset({"_distribution", "assignee_email", "email", "phone", "author_id"})


def _redact_public(data: Any) -> Any:
    """Рекурсивно убрать чувствительные ключи (_PUBLIC_STRIP_KEYS) из публичной share-выдачи.
    Возвращает НОВЫЕ структуры (dict/list пересобираются) — исходная мета/кэш не мутируются;
    скаляры неизменяемы. Имена/роли/статусы (не в strip-set) публичному зрителю остаются видны."""
    if isinstance(data, dict):
        return {k: _redact_public(v) for k, v in data.items() if k not in _PUBLIC_STRIP_KEYS}
    if isinstance(data, list):
        return [_redact_public(v) for v in data]
    return data


# ─────────────────────── доступ помощника (MCP): замок проекта ───────────────────────
# Разрежённый ключ: пишем ТОЛЬКО когда доступ открыт, при закрытии — pop, а не False. Приём тот же,
# что у persons.hidden_from_pickers: у нетронутых проектов документ остаётся байт-в-байт прежним.
# Наружу через to_project НЕ отдаём (иначе двинулись бы байты ВСЕХ проектов и пришлось бы пересобирать
# сотню эталонов) — состояние читается отдельным эндпоинтом /projects/{pid}/agent-access.
#
# Публичной ссылки этот флаг НЕ касается: она и так по умолчанию выключена (_share.enabled), и
# завязывать её на «закрыто по умолчанию» значило бы молча погасить уже розданные ссылки.
_AGENT_KEY = "_agent_access"


def _agent_access(m: dict) -> dict:
    """Что открыто помощнику. Нет ключа — закрыто всё (осознанное умолчание).

    Одна галочка открывает ВЕСЬ проект, включая бюджет, решения и оценки стейкхолдеров.
    Раздельное согласие было лишним вопросом: человек, пускающий помощника в проект, пускает
    его в проект. Поэтому `sensitive` выводится из `enabled`, а не читается из данных — иначе
    проекты, открытые старой формой без второй галочки, молча остались бы с урезанным доступом,
    хотя форма показывает «открыт». Ключ в документе сохраняем: если раздельность вернётся,
    читать снова будет откуда.
    """
    a = m.get(_AGENT_KEY) or {}
    enabled = bool(a.get("enabled"))
    return {"enabled": enabled, "sensitive": enabled}


def _set_agent_access(m: dict, enabled: bool, sensitive: bool = True) -> dict:
    if enabled:
        m[_AGENT_KEY] = {"enabled": True, "sensitive": True}
    else:
        m.pop(_AGENT_KEY, None)          # именно pop: False сделал бы документ отличным от нетронутых
    return _agent_access(m)


# ─────────────────────── токены помощника: выпуск и проверка ───────────────────────

def _api_token_new() -> str:
    return security_ops.api_token_new()


def _api_token_hash(token: str) -> str:
    return security_ops.api_token_hash(token)


async def issue_api_token(user: dict, name: str, scopes: str = "read+draft",
                          oauth_client_id: Optional[str] = None) -> dict:
    """Выпустить личный токен. Значение возвращается ОДИН раз и больше нигде не хранится."""
    raw = _api_token_new()
    now = datetime.now(timezone.utc)
    tid = await db.insert_api_token(
        user_email=str(user.get("email") or ""), name=(name or "").strip()[:80] or "Помощник",
        token_hash=_api_token_hash(raw), token_hint=security_ops.api_token_hint(raw),
        scopes=scopes, created_at=now.isoformat(),
        expires_at=(now + timedelta(days=security_ops.API_TOKEN_TTL_DAYS)).isoformat(),
        oauth_client_id=oauth_client_id)
    return {"id": str(tid), "token": raw, "name": name, "scopes": scopes,
            "expires_at": (now + timedelta(days=security_ops.API_TOKEN_TTL_DAYS)).isoformat()}


async def verify_api_token(token: str) -> Optional[dict]:
    """Кто пришёл с этим токеном, или None.

    Отказываем при: неизвестном токене, отзыве, истёкшем сроке, выключенной учётной записи
    и — так же, как обычным запросам, — при истёкшем грейсе 2FA. Последнее важно: иначе токен
    стал бы обходом требования, которое для интерфейса обязательно.
    """
    if not token:
        return None
    rec = await db.find_api_token(_api_token_hash(token))
    if not rec or rec.get("revoked_at"):
        return None
    try:
        if datetime.fromisoformat(str(rec["expires_at"])) < datetime.now(timezone.utc):
            return None
    except (TypeError, ValueError):
        return None
    email = rec.get("user_email")
    u = USERS.get(email)
    if not u or not u.get("is_active", True) or _twofa_must_enroll(u):
        return None
    await db.touch_api_token(rec["id"], _now_iso())
    return {"token_id": rec["id"], "scopes": rec.get("scopes") or "read",
            "oauth_client_id": rec.get("oauth_client_id"),
            "user": {"id": u["id"], "email": email, "full_name": u.get("full_name"),
                     "role": u.get("role"), "is_active": True,
                     "bitrix24_user_id": u.get("bitrix24_user_id"), "person_id": u.get("person_id")}}


async def refresh_pm_name(user_id: str, full_name: str) -> int:
    """Обновить подпись РП в проектах человека после того, как он поправил своё имя.

    `pm_name` — копия имени, снятая в момент записи проекта. Владение считается по `pm_id`
    и от неё не зависит (иначе переименованием можно было бы присвоить чужой проект), но
    в колонке «РП» человек продолжает видеть того, кого уже нет: свой прежний ник. Типичный
    случай — проект, заведённый под служебным именем учётки, которой потом дали настоящее имя.
    """
    changed = 0
    for el in await fetch_projects(with_docs=False):
        m = _meta(el)
        if str(m.get("pm_id") or "") != str(user_id or "") or m.get("pm_name") == full_name:
            continue

        def _mut(mm, name=full_name):
            mm["pm_name"] = name
            return name

        await with_meta_retry(str(el.get("id")), _mut)
        changed += 1
    return changed


def user_by_email(email: str) -> Optional[dict]:
    """Учётная запись по адресу — нужна там, где на руках только email (обмен кода OAuth
    на токен). Отдельный хелпер, а не обращение к USERS напрямую: точку монкейпатча в тестах
    держим одну."""
    return USERS.get((email or "").strip().lower()) or USERS.get(email)


def oauth_resource_ok(resource: str) -> bool:
    """RFC 8707: токен просят для конкретного ресурса. Наш ровно один — точка помощника.
    Сравниваем без хвостового слэша: клиенты присылают и так, и так."""
    want = str(resource or "").rstrip("/")
    mine = f"{PORTAL_PUBLIC_URL.rstrip('/')}/mcp"
    return want in (mine, mine + "/")


async def _find_share(token: str):
    """Ищем проект по публичному токену (только среди включённых)."""
    if not token:
        return None, None
    for el in await fetch_projects(with_docs=False):  # нужен только _share из блоба, не коллекции-доки
        m = _meta(el)
        s = m.get(_SHARE_KEY) or {}
        if s.get("enabled") and s.get("token") == token:
            return el, m
    return None, None


#: Списки доступа наружу по публичной ссылке не отдаются НИКОГДА: это внутренние
#: идентификаторы сотрудников, и анонимному читателю паспорта они не нужны ни для чего.
#: Раньше `editors` утекал вместе с полным паспортом — нашли при сверке эталонов,
#: когда к нему чуть не добавились `observers`.
# Списки доступа наружу не отдаём — это внутренние id сотрудников. Унаследованные тоже:
# у зонтика со многими подпроектами это был бы список всех их руководителей разом.
#
# Навигация по дереву — туда же, и это НЕ перестраховка: ссылка публикует ОДИН проект, а
# `parent_name`/`parent_code` назвали бы анониму зонтик, которого владелец ссылки не публиковал,
# а `subprojects_count` выдал бы размер программы. Поймано сверкой эталонов: публичная выдача
# выросла на 77 байт ровно этими четырьмя полями.
_PUBLIC_HIDDEN_FIELDS = ("editors", "observers", "inherited_editors", "inherited_observers",
                         "parent_id", "parent_code", "parent_name", "subprojects_count")


def _public_project_view(el: dict, m: dict) -> dict:
    """Минимальный публичный заголовок; полный паспорт только если он явно опубликован."""
    project = to_project(el)
    sections = _share_cfg(m)["sections"]
    if "passport" in sections:
        return {k: v for k, v in project.items() if k not in _PUBLIC_HIDDEN_FIELDS}
    return {k: project.get(k) for k in ("id", "code", "name", "status", "priority")}


# ---------- share / notes ----------
# Публичный share и заметки к сущностям вынесены в share_notes_routes (build_router на main-фасаде).
# Хелперы _find_share/_public_project_view/_share_cfg остаются в main (тестируются / общие).
(_share_notes_router, share_get, share_set, public_project,
 notes_list, note_add, note_delete) = share_notes_routes.build_router(_API)
app.include_router(_share_notes_router)


# ---------- portfolio ----------
# ---- настройки (RAG-пороги) в таблице settings; кэш грузится в _lifespan ----
# Прежние ключи red_high / red_overdue больше не читаются: там, где они сохранены явно (=1),
# новое правило, унаследовав их, красило бы проект в красный от ОДНОЙ просрочки.
_DEFAULT_RAG = {"red_overdue_pct": 25, "red_overdue_min": 3, "red_unmitigated_high": 1, "amber_medium": 1}
# Пороги перегрузки. Значения по умолчанию берутся из domain (там же env для развёртывания),
# а руководитель портфеля переопределяет их в «Настройках».
_DEFAULT_WORKLOAD = {"tasks": domain._OVERLOAD_TASKS,
                     "hours": int(domain._OVERLOAD_HOURS),
                     "pm_projects": domain._OVERLOAD_PM_PROJECTS}
_settings_cache = None


def _settings() -> dict:
    # Только кэш (грузится в _lifespan через db.load_settings) — _bitrix_url()/_rag читают синхронно.
    global _settings_cache
    if _settings_cache is None:
        _settings_cache = {}
    return _settings_cache


async def _save_settings(s: dict):
    global _settings_cache
    _settings_cache = s
    await db.save_settings(s)


def _rag_thresholds() -> dict:
    """Пороги RAG: сохранённые значения поверх умолчаний — только ИЗВЕСТНЫЕ ключи и только целые ≥ 1.

    Ноль или мусор в настройках не должны перекрашивать портфель: при red_unmitigated_high = 0
    красным стал бы каждый проект. Процент зажат в 1..100.
    """
    saved = _settings().get("rag") or {}
    out = dict(_DEFAULT_RAG)
    for k in out:
        v = saved.get(k) if isinstance(saved, dict) else None
        if v in (None, ""):
            continue
        try:
            out[k] = max(1, int(v))
        except (TypeError, ValueError):
            pass
    out["red_overdue_pct"] = min(100, out["red_overdue_pct"])
    return out


def _workload_thresholds() -> dict:
    """Пороги «перегружен»: сколько открытых задач, сколько часов, сколько проектов у РП."""
    saved = _settings().get("workload") or {}
    out = dict(_DEFAULT_WORKLOAD)
    for k in out:
        v = saved.get(k)
        if v not in (None, ""):
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                pass  # мусор в настройках не должен ронять портфель — остаётся значение по умолчанию
    return out


def _mcp_auto_apply() -> bool:
    """Применять ли черновики владельца портала сразу, без подтверждения в интерфейсе.

    Тумблер снимает предохранитель со ВСЕХ проектов портала — под учётной записью владельца
    помощник видит их все. Поэтому любое неожиданное значение читается как «выключено»:
    испорченная настройка не имеет права оказаться разрешением.
    """
    mcp = _settings().get("mcp")
    return isinstance(mcp, dict) and mcp.get("auto_apply") is True


def _health_score(rag: str, overdue: int, progress: int, risks_high: int) -> int:
    """Индекс здоровья проекта 0–100 — единый KPI для портфельного ранжирования
    (вместо разрозненных RAG/просрочки/рисков; чего нет в аналогах из коробки)."""
    h = 100
    h -= {"red": 45, "amber": 20}.get(rag, 0)
    h -= min(30, int(overdue or 0) * 3)
    h -= min(15, int(risks_high or 0) * 5)
    if int(progress or 0) < 10:
        h -= 5
    return max(0, min(100, h))


def _rag_task_counts(tasks: list, today_s: str) -> dict:
    """Работы для RAG — ОДНО определение на все пути (как в строке портфеля).

    Работа — листовая задача, фазы не считаются. Просрочена — не завершена и не отменена,
    а плановое окончание раньше сегодняшнего дня. Раньше сводка проекта и дайджест брали
    задачи вместе с фазами и считали отменённые просроченными — и цвет одного проекта
    в портфеле и в его сводке мог различаться.
    """
    leaf = [t for t in tasks if t.get("task_type") != "phase"]
    overdue = sum(1 for t in leaf if t.get("status") not in ("completed", "cancelled")
                  and t.get("planned_end") and str(t.get("planned_end")) < today_s)
    return {"rag_total": len(leaf), "rag_overdue": overdue}


def _rag(m: dict) -> str:
    """Цвет RAG по текущему правилу — проверки сверху вниз, первая подошедшая даёт цвет.

    Красный: просрочено не менее red_overdue_pct % работ И не менее red_overdue_min работ
    (при 0 работ не срабатывает), либо открытых высоких рисков БЕЗ плана снижения не меньше
    red_unmitigated_high. Жёлтый: хоть одна просрочка, хоть один открытый высокий риск или
    открытых средних рисков не меньше amber_medium. Иначе зелёный.
    """
    c = m.get("_counts", {})
    th = _rag_thresholds()
    total = int(c.get("rag_total", 0) or 0)
    overdue = int(c.get("rag_overdue", 0) or 0)
    if total and overdue >= th["red_overdue_min"] and overdue * 100 >= th["red_overdue_pct"] * total:
        return "red"
    if int(c.get("risks_high_unmitigated", 0) or 0) >= th["red_unmitigated_high"]:
        return "red"
    if overdue > 0 or int(c.get("risks_high", 0) or 0) > 0 \
            or int(c.get("risks_medium", 0) or 0) >= th["amber_medium"]:
        return "amber"
    return "green"


def _project_rag(m: dict, tasks: list, risks: list, today_s: str, done: bool) -> str:
    """Цвет проекта — ЕДИНСТВЕННАЯ точка, через которую его считают портфель, сводка проекта
    и дайджест. Закрытый проект — зелёный; ручной rag_status в мете главнее расчёта."""
    if done:
        return "green"
    if m.get("rag_status"):
        return m["rag_status"]
    return _rag({**m, "_counts": {**_risk_counts(risks), **_rag_task_counts(tasks, today_s)}})


def _bitrix_settings_view() -> dict:
    """Безопасное представление настроек Bitrix для UI: БЕЗ токена — только хост и источник."""
    url = _bitrix_url()
    return {"configured": bool(url), "host": url.split("/rest/")[0] if url else "",
            "source": "settings" if _settings().get("bitrix_webhook") else ("env" if BITRIX_URL else "none")}


def _apply_smtp():
    """Применить SMTP из настроек портала к mailer (пароль расшифровываем перед передачей)."""
    s = _settings().get("smtp") or {}
    cfg = dict(s)
    if s.get("password"):
        cfg["password"] = _decrypt_secret(s["password"])
    mailer.configure(cfg)


def _smtp_settings_view() -> dict:
    """Безопасное представление SMTP для UI — БЕЗ пароля."""
    s = _settings().get("smtp") or {}
    return {"configured": mailer.is_configured(),
            "host": s.get("host") or mailer.SMTP_HOST,
            "port": s.get("port") or mailer.SMTP_PORT,
            "user": s.get("user") or mailer.SMTP_USER,
            "from": s.get("from") or mailer.SMTP_FROM,
            "starttls": s.get("starttls", True) if s else mailer.SMTP_STARTTLS,
            "password_set": bool(s.get("password") or mailer.SMTP_PASSWORD),
            "source": "settings" if s else ("env" if mailer.SMTP_HOST else "none")}


def _budget_rollup(m: dict):
    """Бюджет проекта для портфеля: план = сумма плановых РАСХОДНЫХ статей — ровно то,
    что модуль «Бюджет» показывает как «Общий бюджет (расходы)». Фолбэки для проектов
    без статей: утверждённый лимит (budget_target), затем легаси-паспортное поле budget."""
    exp = [i for i in _coll(m, "_budget") if _budget_kind(i) == "expense"]
    plan = sum(_budget_planned(i) for i in exp)
    actual = sum(_budget_actual(i) for i in exp)
    if not plan:
        plan = _num(m.get("budget_target")) or _num(m.get("budget"))
    return (plan or None), actual, (m.get("budget_currency") or "EUR")


def _portfolio_row(p: dict, m: dict, tasks: list, risks: list, bl_store: dict, today_s: str) -> dict:
    """Строка портфеля. Задачи считаются ЖИВЬЁМ (bulk-WP): просрочка растёт со временем
    без правок проекта, поэтому кэш _counts для неё протухал между мутациями."""
    leaf = [t for t in tasks if t.get("task_type") != "phase"]
    total = len(leaf)
    completed_n = sum(1 for t in leaf if t.get("status") == "completed")
    # Просрочку показываем ровно ту, по которой считается цвет, — одно определение на оба места.
    overdue_n = _rag_task_counts(tasks, today_s)["rag_overdue"]
    progress = round(100 * completed_n / total) if total else 0
    max_due = max((str(t.get("planned_end")) for t in leaf
                   if t.get("planned_end") and t.get("status") != "cancelled"), default=None)
    c = {**_collection_counts(m), **_risk_counts(risks)}
    done = p["status"] in ("completed", "cancelled")
    # Закрытый проект — зелёный и без «просрочки»: его незакрытые хвосты не тревога портфеля.
    # RAG считаем по живым задачам и рискам; persisted `_counts` больше не используется.
    rag = _project_rag(m, tasks, risks, today_s, done)
    plan, actual, currency = _budget_rollup(m)
    # Отклонение от базового плана: сдвиг финиша проекта против последнего снимка, в днях.
    deviation = None
    bls = bl_store.get(str(p["id"])) or (m.get("_baselines") if isinstance(m.get("_baselines"), list) else [])
    if bls and max_due:
        base_max = max((str(bt.get("planned_end")) for bt in (bls[-1].get("tasks") or [])
                        if bt.get("planned_end")), default=None)
        if base_max:
            try:
                deviation = (date.fromisoformat(max_due[:10]) - date.fromisoformat(base_max[:10])).days
            except ValueError:
                deviation = None
    return {
        "id": p["id"], "code": p["code"], "name": p["name"], "status": p["status"], "priority": p["priority"],
        "client": p.get("client"), "program": p.get("program"), "project_kind": p.get("project_kind"),
        "pm_name": p["pm_name"], "planned_end": p["planned_end"], "progress": progress,
        "total_tasks": total, "tasks_completed": completed_n,
        "overdue_tasks_count": 0 if done else overdue_n,
        "open_risks_high_count": c.get("risks_high", 0), "open_risks_medium_count": c.get("risks_medium", 0),
        "baseline_deviation_days": deviation,
        "budget_plan": plan, "budget_actual": actual, "budget_currency": currency,
        "archived": bool(m.get("_archived")),
        # дерево: портфель группирует детей под зонтиком, не пересчитывая их отдельно
        "parent_id": _tree_fields(m)["parent_id"], "parent_code": _tree_fields(m)["parent_code"],
        "subprojects_count": _tree_fields(m)["subprojects_count"],
        "rag_status": rag, "attention_required": (rag == "red") and not done,
        "health": 100 if done else _health_score(rag, overdue_n, progress, c.get("risks_high", 0)),
    }


# Портфель / аналитика / капасити / поиск / внимание / календарь / дайджесты
# вынесены в portfolio_routes (build_router на main-фасаде). Хелперы-агрегаторы
# (_accessible_projects, _take_portfolio_snapshot, _run_leadership_digest,
# _run_digests, _load_snapshots и т.п.) остаются в main.
(_portfolio_router, portfolio, attention, my_tasks, search, admin_portfolio_snapshot,
 portfolio_trends, portfolio_workload, project_workload, portfolio_thresholds, portfolio_risk_heatmap,
 portfolio_milestones, portfolio_risks, my_calendar, admin_leadership_digest,
 admin_digest_run, admin_outbox) = portfolio_routes.build_router(_API)
app.include_router(_portfolio_router)


# ======================== P3: аналитика портфеля + капасити ========================
async def _accessible_projects(user: dict, include_archived: bool = False, include_templates: bool = False,
                               with_docs: bool = False):
    """Список (project, meta) доступных пользователю проектов (РПП — все, РП — свои).
    По умолчанию БЕЗ шаблонов и архива — как витрина портфеля, чтобы аналитика
    (workload/heatmap/вехи/тренды/календарь) не расходилась с ней по охвату.

    `with_docs=True` подтягивает нормализованные коллекции (_meetings и пр.). По умолчанию
    выключено: почти всем нужны только задачи, а доки — лишний запрос на каждый проект."""
    out = []
    for el in await fetch_projects(with_docs=with_docs, user=user):  # SQL-предфильтр по user; Python-фильтр ниже — страховка
        p = to_project(el)
        if p["code"].startswith("__"):
            continue
        if user.get("role") not in READ_ALL_ROLES and not _can_read_item(user, p):
            continue
        m = _meta(el)
        if not include_templates and m.get("_is_template"):
            continue
        if not include_archived and m.get("_archived"):
            continue
        out.append((p, m))
    return out


async def _load_snapshots(since: Optional[str] = None) -> dict:
    return await db.load_snapshots(since) if since else await db.load_snapshots()


async def _save_snapshots(store: dict):
    await db.save_snapshots(store)


async def _project_baselines(pid: str, m: dict) -> list:
    """Базовые планы проекта из БД."""
    return await db.load_baselines_for(pid)


async def _take_portfolio_snapshot(date_str: Optional[str] = None) -> int:
    """Дневной снимок метрик проектов в snapshots.json: {date: {pid: metrics}}.
    Считает те же живые строки и с теми же фильтрами (без шаблонов/архива),
    что и /portfolio/dashboard — тренды не расходятся с витриной."""
    today = date_str or datetime.now(timezone.utc).date().isoformat()
    projs = []
    for el in await fetch_projects():
        p = to_project(el)
        if p["code"].startswith("__"):
            continue
        m = _meta(el)
        if m.get("_is_template") or m.get("_archived"):
            continue
        projs.append((p, m))
    pids = [p["id"] for p, _ in projs]
    wps_by_pid, rwps_by_pid, bl_store = await asyncio.gather(
        _fetch_wps_bulk(pids, TASK_TYPE_IDS),
        _fetch_wps_bulk(pids, [RISK_TYPE_ID]),
        db.load_latest_baselines(),
    )
    snaps: dict = {}
    for p, m in projs:
        r = _portfolio_row(
            p, m,
            _tasks_from_wps(wps_by_pid.get(p["id"], []), m, p["id"]),
            _risks_from_wps(rwps_by_pid.get(p["id"], []), m, p["id"]),
            bl_store, today,
        )
        snaps[str(p["id"])] = {"rag": r["rag_status"],
                               "risks_high": r["open_risks_high_count"], "risks_medium": r["open_risks_medium_count"],
                               "overdue_tasks": r["overdue_tasks_count"], "tasks_total": r["total_tasks"],
                               # Число выполненных пишем явно: раньше его приходилось выводить из
                               # прогресса (round(total * progress/100)), а это врёт на округлении.
                               "tasks_completed": r["tasks_completed"],
                               "progress": r["progress"], "budget_plan": r["budget_plan"] or 0,
                               "deviation_days": r["baseline_deviation_days"]}
    await db.upsert_snapshot(today, snaps)
    await db.prune_snapshots(400)  # храним ~400 последних дат без full-table rewrite
    logger.info("Снимок портфеля за %s: %d проект(ов) → snapshots", today, len(snaps))
    return len(snaps)


# _workload_from_tasks (+пороги) — вынесены в domain.py (импортированы выше)


# _ics_esc — вынесён в domain.py (импортирован выше)


async def _run_leadership_digest():
    """Портфельный дайджест руководству (owner) — email (dry-run в outbox без SMTP)."""
    projs = []
    for el in await fetch_projects():
        p = to_project(el)
        if p["code"].startswith("__"):
            continue
        m = _meta(el)
        projs.append((p, m))
    pids = [p["id"] for p, _ in projs]
    twps, rwps = await asyncio.gather(
        _fetch_wps_bulk(pids, TASK_TYPE_IDS),
        _fetch_wps_bulk(pids, [RISK_TYPE_ID]),
    )
    rows = []
    today_s = datetime.now(timezone.utc).date().isoformat()
    for p, m in projs:
        risks = _risks_from_wps(rwps.get(p["id"], []), m, p["id"])
        c = {
            **_collection_counts(m),
            **_task_counts(twps.get(p["id"], [])),
            **_risk_counts(risks),
        }
        rag = _project_rag(m, _tasks_from_wps(twps.get(p["id"], []), m, p["id"]), risks, today_s,
                           p.get("status") in ("completed", "cancelled"))
        rows.append((p, c, rag))
    red = sum(1 for _, _, rag in rows if rag == "red")
    overdue = sum(c.get("overdue_tasks", 0) for _, c, _ in rows)
    high = sum(c.get("risks_high", 0) for _, c, _ in rows)
    lines = [f"Портфель: проектов {len(rows)} | красных {red} | просрочено задач {overdue} | высоких рисков {high}", ""]
    for p, c, rag in sorted(rows, key=lambda x: {"red": 0, "amber": 1, "green": 2}.get(x[2], 3)):
        lines.append(f"[{rag.upper()}] {p['code']} {p['name']} — задач {c.get('tasks_total', 0)}, "
                     f"просрочено {c.get('overdue_tasks', 0)}, риски H{c.get('risks_high', 0)}/M{c.get('risks_medium', 0)}")
    body = "\n".join(lines)
    sent = []
    for email, u in USERS.items():
        if u.get("role") == "owner" and u.get("is_active", True):
            await asyncio.to_thread(mailer.send_email, email, "PM Tool: портфельный дайджест руководству", body)
            sent.append(email)
    logger.info("Лидер-дайджест: проектов %d, получателей %d", len(rows), len(sent))
    return {"sent": sent, "projects": len(rows)}


# ======================== P2: коллаборация (лента активности + комментарии) ========================
# Задачи и риски — нативные work packages → используем journals OpenProject (history + comments).
# ======================== P2: вложения (файлы на work packages) ========================
_ALLOWED_ATT_EXT = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "txt", "csv", "md",
                    "log", "json", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "zip"}
_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
_UPLOAD_CHUNK_BYTES = 1024 * 1024


def _safe_filename(name: Optional[str]) -> str:
    name = (name or "file").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\- ]", "_", name).strip() or "file"
    return name[:200]


async def _read_upload_limited(file: UploadFile, max_bytes: int = _MAX_ATTACHMENT_BYTES) -> bytes:
    """Читает UploadFile чанками и прекращает при превышении лимита, не аллоцируя весь запрос."""
    content = bytearray()
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        if len(content) + len(chunk) > max_bytes:
            raise HTTPException(status_code=413, detail="Файл больше 25 МБ")
        content.extend(chunk)
    return bytes(content)


async def _wp_in_project(wpid: str, pid: str) -> bool:
    """Проверка, что задача/риск принадлежит проекту pid (анти-IDOR)."""
    try:
        return await db.wp_project_id(wpid) == int(pid)
    except (TypeError, ValueError):
        return False


async def _task_in_project(tid: str, pid: str) -> bool:
    """Anti-IDOR без коллизий с risks.id: проверяет именно таблицу tasks."""
    try:
        return await db.task_in_project(tid, pid)
    except (TypeError, ValueError):
        return False


async def _risk_in_project(rid: str, pid: str) -> bool:
    """Anti-IDOR без коллизий с tasks.id: проверяет именно таблицу risks."""
    try:
        return await db.risk_in_project(rid, pid)
    except (TypeError, ValueError):
        return False


async def _attachment_in_project(aid: str, pid: str) -> bool:
    """Проверка scope по лёгким метаданным, без чтения BYTEA."""
    a = await db.get_attachment_meta(aid)
    if not a:
        return False
    try:
        return int(a["project_id"]) == int(pid)
    except (TypeError, ValueError):
        return False


# Активность/комментарии и вложения вынесены в attachments_routes (build_router на main-фасаде).
(_attachments_router, wp_activity, wp_comment, wp_attachments,
 wp_attachment_upload, wp_attachment_download, wp_attachment_delete) = \
    attachments_routes.build_router(_API)
app.include_router(_attachments_router)

# Черновики от помощника (MCP): единственный путь, которым он меняет существующий проект.
(_drafts_router, drafts_list, draft_get, draft_patch, draft_accept, draft_reject) = \
    drafts_routes.build_router(_API)
app.include_router(_drafts_router)

# «Сообщить о проблеме» (F6): баг-репорты пользователей (build_router на main-фасаде).
(_problems_router, problem_create, problems_list, problem_screenshot, problem_delete) = \
    problems_routes.build_router(_API)
app.include_router(_problems_router)

# Запрос доступа наблюдателем (F-D): просит участник, решает РП проекта. Маршруты НЕ проектные —
# автор запроса по определению не имеет доступа к проекту, и rbac отказал бы ему раньше просьбы.
(_access_router, access_requests_list, access_request_create,
 access_request_approve, access_request_reject) = access_routes.build_router(_API)
app.include_router(_access_router)

# Реестр проектов переходного периода (только руководитель портфеля, вне MCP).
(_registry_router, registry_list, registry_create, registry_update, registry_delete) = \
    registry_routes.build_router(_API)
app.include_router(_registry_router)


# ======================== P5: шаблоны / эффективность ========================
# Структурные коллекции, которые копирует клон (паспорт-поля копируются отдельно).
# _baselines НЕ здесь: базовые планы живут в таблице baselines (не в мете), клон копирует их явно
# (projects_routes.project_clone), иначе src.get("_baselines") == None и история терялась молча.
_CLONE_COLLECTIONS = ["_team", "_stakeholders", "_assumptions", "_comms", "_kpis",
                      "_decisions", "_meetings", "_budget", "_backlog", "_reports"]


# ======================== P2: уведомления (email-дайджест) ========================
async def _digest_for_pm(u: dict, days: int = 7):
    """Собирает просрочку и ближайшие дедлайны по проектам PM → (subject, body, n_items)."""
    today_s = datetime.now(timezone.utc).date().isoformat()
    soon_s = (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()
    projs = await _accessible_projects(u)
    wps = await _fetch_wps_bulk([p["id"] for p, _ in projs], TASK_TYPE_IDS)
    overdue, due = [], []
    for p, m in projs:
        for tk in _tasks_from_wps(wps.get(p["id"], []), m, p["id"]):
            if tk.get("task_type") == "phase" or tk.get("status") in ("completed", "cancelled"):
                continue
            pe = tk.get("planned_end")
            if pe and str(pe) < today_s:
                overdue.append((p["code"], tk))
            elif pe and today_s <= str(pe) <= soon_s:
                due.append((p["code"], tk))
    n = len(overdue) + len(due)
    lines = [f"Дайджест PM Tool — {u.get('full_name') or u.get('email')}", ""]
    if overdue:
        lines.append(f"Просрочено ({len(overdue)}):")
        lines += [f"  • [{c}] {tk.get('title')} — план {tk.get('planned_end')}" for c, tk in overdue[:25]]
        lines.append("")
    if due:
        lines.append(f"Скоро дедлайн ({len(due)}):")
        lines += [f"  • [{c}] {tk.get('title')} — до {tk.get('planned_end')}" for c, tk in due[:25]]
    if not n:
        lines.append("Просроченных и срочных задач нет — отличная работа!")
    return ("PM Tool: дайджест задач", "\n".join(lines), n)


async def _run_digests(days: int = 7) -> list:
    pms = [(email, u) for email, u in USERS.items() if u.get("role") == "pm" and u.get("is_active", True)]
    sem = asyncio.Semaphore(8)

    async def _build(email, u):
        async with sem:  # сборка дайджестов PM параллельно (каждая = bulk-fetch)
            return email, await _digest_for_pm({**u, "email": email}, days)
    built = await asyncio.gather(*[_build(e, u) for e, u in pms], return_exceptions=True)
    sent = []
    for r in built:
        if isinstance(r, BaseException):  # gather(return_exceptions=True) → элемент может быть исключением
            logger.warning("digest: ошибка сборки: %s", r)
            continue
        email, (subj, body, n) = r
        if n:
            rec = await asyncio.to_thread(mailer.send_email, email, subj, body)
            sent.append({"to": email, "items": n, "sent": rec.get("sent", False), "dry_run": rec.get("dry_run", False)})
    return sent


# (Планировщик запускается в _lifespan выше — ежедневный снимок 23:00 + еженедельный дайджест пн 08:00.)


# Точка входа помощника. transport_security ОБЯЗАТЕЛЕН: по умолчанию SDK отвечает только
# localhost (защита от DNS-rebinding), и за реальным доменом всё вернуло бы 421 — молча.
# В умолчание входит и дев-фронт (:3000): там запросы к помощнику идут через vite-прокси,
# и Host остаётся его. Без этого разработка и e2e упирались бы в 421 — молчаливый отказ,
# который выглядит как «просто не работает». В продакшене список задают явно
# (MCP_ALLOWED_HOSTS в deploy/docker-compose.prod.yml).
_MCP_HOSTS = [h.strip() for h in os.environ.get(
    "MCP_ALLOWED_HOSTS",
    "127.0.0.1:8002,localhost:8002,127.0.0.1:3000,localhost:3000").split(",") if h.strip()]
_MCP_ORIGINS = [o.strip() for o in os.environ.get(
    "MCP_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.mount("/mcp", mcp_server.mount_app(_MCP, _MCP_HOSTS, _MCP_ORIGINS))
app.add_middleware(mcp_server.NormalizeMcpPath)

# Точки OAuth. Протокольные обслуживает SDK, страницу согласия — наш роутер.
app.router.routes.extend(oauth_routes.build_protocol_routes(_OAUTH, PORTAL_PUBLIC_URL))
(_oauth_router, oauth_consent_get, oauth_consent_approve, oauth_consent_deny) =     oauth_routes.build_router(_API, _OAUTH)
app.include_router(_oauth_router)
