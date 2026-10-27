"""Pure-ish security helpers used by the PMO API compatibility layer.

All mutable stores, environment values and optional Redis clients are supplied
by callers.  The module therefore performs no network or filesystem I/O during
import and ``main.py`` remains the stable compatibility/monkeypatch surface.
"""

import base64
import hashlib
import hmac
import io
import json
import logging
import secrets
import time
import uuid
from collections.abc import Callable, Mapping, MutableMapping
from typing import Any, Optional

import bcrypt


DEFAULT_SECRET = b"pmo-adapter-secret"


def build_fernet(secret: bytes) -> Any | None:
    """Build the optional at-rest secret cipher from the adapter secret."""
    try:
        from cryptography.fernet import Fernet

        key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
        return Fernet(key)
    except Exception:  # noqa: BLE001 - cryptography is optional in dev compatibility mode
        return None


def encrypt_secret(value: str, fernet: Any | None) -> str:
    if not value or fernet is None:
        return value
    return "enc:" + fernet.encrypt(value.encode()).decode()


def decrypt_secret(value: str, fernet: Any | None) -> str:
    if not value or not value.startswith("enc:"):
        return value
    if fernet is None:
        return value
    try:
        return fernet.decrypt(value[4:].encode()).decode()
    except Exception:  # noqa: BLE001 - preserve unreadable legacy values verbatim
        return value


def verify_password(user: Mapping[str, Any], password: str) -> bool:
    password_hash = user.get("password_hash")
    if password_hash:
        try:
            return bcrypt.checkpw(password.encode(), str(password_hash).encode())
        except Exception:  # noqa: BLE001 - malformed hashes are authentication failures
            return False
    return user.get("password") == password


# Precomputed bcrypt hash (cost 12) of an arbitrary string. Used only to spend a
# comparable amount of time on the unknown/inactive-user login path so that response
# latency does not reveal whether an email exists or is active (timing side-channel).
_DUMMY_HASH = b"$2b$12$kBnrJkOz/T8V1AJKSM6xMuhL0rcvGsGckZ/mBiPRbV2t1VerEsGt2"


def dummy_verify(password: str) -> bool:
    """Always-False password check that still runs one bcrypt verify, so the failure
    path costs the same as a real check. Call for missing/inactive accounts."""
    try:
        bcrypt.checkpw(password.encode(), _DUMMY_HASH)
    except Exception:  # noqa: BLE001 - timing burn only; result is always a failure
        pass
    return False


def token_signature(token: str) -> str:
    return token.rsplit(".", 1)[-1] if "." in token else ""


def prune_revoked(revoked: MutableMapping[str, float], *, now: float | None = None) -> None:
    current = time.time() if now is None else now
    for signature in [sig for sig, exp in revoked.items() if exp < current]:
        revoked.pop(signature, None)


def login_rate_ok(
    email: str,
    attempts: MutableMapping[str, list[float]],
    *,
    window: float,
    max_attempts: int,
    now: float | None = None,
) -> bool:
    current = time.time() if now is None else now
    # Bound memory: a password-spray over many distinct emails would otherwise grow
    # this dict without limit. When it gets large, drop emails whose attempts have all
    # aged out of the window (Redis path expires keys automatically; this is the
    # in-memory single-worker fallback).
    if len(attempts) > 4096:
        for stale in [e for e, stamps in attempts.items()
                      if all(current - s >= window for s in stamps)]:
            attempts.pop(stale, None)
    recent = [stamp for stamp in attempts.get(email, []) if current - stamp < window]
    recent.append(current)
    attempts[email] = recent
    return len(recent) <= max_attempts


async def revoke_token(
    signature: str,
    expires_at: float,
    *,
    redis_client: Any | None,
    revoked: MutableMapping[str, float],
    logger: logging.Logger,
    db_revoke: Callable[[str, float], Any] | None = None,
) -> None:
    if redis_client is not None:
        try:
            await redis_client.setex(
                f"revoked:{signature}",
                max(1, int(expires_at - time.time())),
                "1",
            )
            return
        except Exception as exc:  # noqa: BLE001 - Redis failure falls back to the local store
            logger.warning("Redis revoke failed (%s) — in-memory", exc)
    prune_revoked(revoked)
    revoked[signature] = expires_at
    # Durable-стор (Postgres): logout переживает рестарт. is_revoked остаётся в памяти
    # (прогревается на старте из load_revoked_tokens), поэтому горячий путь без I/O.
    if db_revoke is not None:
        try:
            await db_revoke(signature, expires_at)
        except Exception as exc:  # noqa: BLE001 - durable store is best-effort, memory already set
            logger.warning("revoked_tokens persist failed (%s) — только in-memory", exc)


async def is_revoked(
    signature: str,
    *,
    redis_client: Any | None,
    revoked: Mapping[str, float],
    logger: logging.Logger,
) -> bool:
    if redis_client is not None:
        try:
            return bool(await redis_client.exists(f"revoked:{signature}"))
        except Exception as exc:  # noqa: BLE001 - Redis failure falls back to the local store
            logger.warning("Redis check failed (%s) — in-memory", exc)
    return signature in revoked and revoked[signature] >= time.time()


async def rate_ok(
    email: str,
    *,
    redis_client: Any | None,
    window: float,
    max_attempts: int,
    fallback: Callable[[str], bool],
    logger: logging.Logger,
) -> bool:
    if redis_client is not None:
        try:
            key = f"login:{email}"
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, int(window))
            return count <= max_attempts
        except Exception as exc:  # noqa: BLE001 - Redis failure falls back to the local limiter
            logger.warning("Redis rate-limit failed (%s) — in-memory", exc)
    return fallback(email)


def enforce_prod_secrets(
    *,
    environment: Mapping[str, str],
    secret: bytes,
    users_fallback: bool,
    bitrix_url: str,
    bitrix_inbound_token: str,
    logger: logging.Logger,
    demo_credentials_live: bool = False,
    fernet_ok: bool = True,
    fireflies_enabled: bool = False,
    fireflies_api_key: str = "",
    fireflies_webhook_secret: str = "",
) -> None:
    """Apply the existing production fail-fast contract without reading globals."""
    if environment.get("ADAPTER_ENV", "").lower() == "production":
        if secret == DEFAULT_SECRET:
            raise RuntimeError("ADAPTER_SECRET обязателен в production (сейчас дефолт)")
        if not fernet_ok:
            # Fernet не собрался (нет cryptography?) → SMTP-пароль/Bitrix-токен легли бы в БД открытым
            # текстом. Не даём стартовать проду с тихим отключением шифра.
            raise RuntimeError(
                "Шифр Fernet не инициализирован (нет пакета cryptography?) — секреты в покое "
                "хранились бы в открытую; установите cryptography перед запуском в production"
            )
        # Секрет короче 32 байт офлайн-брутфорсится (он же ключ HMAC-токенов И Fernet-шифра секретов
        # в покое). Прод-fail-fast ловил только дефолт — теперь и слабый по длине.
        if len(secret) < 32:
            raise RuntimeError(
                "ADAPTER_SECRET слишком короткий для production (нужно ≥32 байта; "
                "сгенерируйте `openssl rand -base64 32`)"
            )
        if users_fallback:
            raise RuntimeError(
                "В таблице users нет ни одного пользователя — активны дефолтные сид-аккаунты "
                "(owner@company.com/admin123, pm1@company.com/pm123) с паролями по умолчанию. "
                "Восстановите дамп БД или заведите пользователей до запуска в production"
            )
        if demo_credentials_live:
            raise RuntimeError(
                "Стартовый аккаунт всё ещё принимает пароль по умолчанию "
                "(например owner@company.com/admin123). Смените пароли сид-аккаунтов "
                "или удалите их до запуска в production"
            )
        if bitrix_url and not bitrix_inbound_token:
            raise RuntimeError(
                "BITRIX24_INBOUND_TOKEN обязателен в production при включённом BITRIX24_WEBHOOK_URL"
            )
        # Связка Fireflies: без секрета вебхук принимал бы чужие тела без подписи, без ключа
        # воркер копил бы очередь, которую никогда не разберёт. Включили — значит задали оба.
        if fireflies_enabled and not fireflies_webhook_secret:
            raise RuntimeError(
                "FIREFLIES_WEBHOOK_SECRET обязателен в production при FIREFLIES_ENABLED=1"
            )
        if fireflies_enabled and not fireflies_api_key:
            raise RuntimeError(
                "FIREFLIES_API_KEY обязателен в production при FIREFLIES_ENABLED=1"
            )
        logger.info("prod-режим: секреты заданы")
    elif secret == DEFAULT_SECRET:
        logger.warning(
            "ADAPTER_SECRET использует дефолт — задайте свой перед продом "
            "(ADAPTER_ENV=production = fail-fast)"
        )


def urlsafe_b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


TOKEN_TTL = 8 * 3600  # срок жизни bearer-токена (сек); issued-at = exp - TOKEN_TTL (см. current_user)

# ── токены внешнего помощника (MCP) ────────────────────────────────────────────────
# Отдельная сущность от bearer-токена входа: живёт 90 дней, хранится в БД и принимается ТОЛЬКО
# на MCP-точке. Значение видит один раз человек, у нас лежит SHA-256: bcrypt не нужен (32 случайных
# байта перебирать нечего), а на каждом запросе он стоил бы задержки.
API_TOKEN_TTL_DAYS = 90


def api_token_new() -> str:
    return "pmo_" + secrets.token_urlsafe(32)


def api_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def api_token_hint(token: str) -> str:
    """Хвост для узнавания в списке. Начало не берём: по нему токен искали бы в чужих логах."""
    return "…" + token[-4:]


def make_token(email: str, secret: bytes) -> str:
    payload = urlsafe_b64(
        json.dumps(
            {"sub": email, "jti": uuid.uuid4().hex, "exp": int(time.time()) + TOKEN_TTL}
        ).encode()
    )
    signature = urlsafe_b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def read_token(token: str, secret: bytes) -> Optional[dict]:
    try:
        payload, signature = token.split(".")
        expected = urlsafe_b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data.get("exp", 0) < time.time():
            return None
        # Промежуточный MFA-challenge подписан тем же секретом, но НЕ является полноценным
        # access-токеном: без этой проверки его можно было бы предъявить как Bearer в обход 2FA.
        if data.get("mfa"):
            return None
        return data
    except Exception:  # noqa: BLE001 - malformed input is an invalid token
        return None


# --- Двухфакторная аутентификация (TOTP, RFC 6238) --------------------------------
#
# Секрет TOTP хранится в users.doc зашифрованным тем же Fernet, что и SMTP-пароль
# (encrypt_secret/decrypt_secret). Проверку кода и генерацию QR делает pyotp/qrcode —
# импортируем лениво (как cryptography в build_fernet), чтобы модуль оставался
# импортируемым без побочных эффектов даже если пакет не установлен.

MFA_CHALLENGE_TTL = 300  # сек: сколько живёт промежуточный токен между «пароль верный» и вводом кода


def totp_new_secret() -> str:
    """Новый base32-секрет для привязки аутентификатора."""
    import pyotp

    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str, issuer: str = "PMO") -> str:
    """otpauth://-URI для QR: аутентификатор (Google Authenticator и пр.) его считывает."""
    import pyotp

    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def totp_verify(secret: str, code: str) -> bool:
    """Проверка 6-значного кода с допуском ±1 окно (±30с) на дрейф часов телефона."""
    if not secret or not code:
        return False
    code = str(code).strip().replace(" ", "")
    if not code.isdigit():
        return False
    try:
        import pyotp

        return bool(pyotp.TOTP(secret).verify(code, valid_window=1))
    except Exception:  # noqa: BLE001 - любая ошибка проверки = неуспех аутентификации
        return False


def totp_qr_data_uri(uri: str) -> str:
    """SVG-QR отдаём как data-URI: фронт вставляет в <img> без внешних запросов (CSP-safe)."""
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def make_mfa_challenge(email: str, secret: bytes) -> str:
    """Короткоживущий токен второго шага входа. Флаг mfa=True не даёт использовать его как access."""
    payload = urlsafe_b64(
        json.dumps(
            {"sub": email, "jti": uuid.uuid4().hex,
             "exp": int(time.time()) + MFA_CHALLENGE_TTL, "mfa": True}
        ).encode()
    )
    signature = urlsafe_b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def read_mfa_challenge(token: str, secret: bytes) -> Optional[dict]:
    try:
        payload, signature = token.split(".")
        expected = urlsafe_b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data.get("exp", 0) < time.time():
            return None
        if data.get("mfa") is not True:  # обычный access-токен нельзя предъявить как challenge
            return None
        return data
    except Exception:  # noqa: BLE001 - malformed input is an invalid challenge
        return None
