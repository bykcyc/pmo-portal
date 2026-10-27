"""Authentication routes built against the stable ``main`` compatibility facade."""

import asyncio
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, Header, HTTPException


def build_router(api: "PmoApi"):
    """Create auth routes while resolving mutable state through ``api`` at call time."""
    router = APIRouter()

    @router.post("/auth/login")
    async def login(payload: dict):
        email = str(payload.get("email") or "").lower().strip()  # str(): кривой email (число/объект) → 401, не 500
        if not await api._rate_ok(email):  # per-email лимит ДО bcrypt-verify (изолирует каждый email)
            raise HTTPException(
                status_code=429,
                detail="Слишком много попыток входа, подождите минуту",
            )
        password = payload.get("password") or ""
        user = api.USERS.get(email)
        if user and user.get("is_active", True):
            password_ok = await asyncio.to_thread(api._verify_password, user, password)
        else:
            # Unknown or deactivated account: still spend one bcrypt verify so the
            # response time does not reveal whether the email exists / is active.
            await asyncio.to_thread(api._dummy_verify, password)
            password_ok = False
        if not password_ok:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        api._LOGIN_ATTEMPTS.pop(email, None)
        # Первый вход застолбляет якорь 7-дневного грейса на настройку 2FA. Для существующих
        # пользователей отсчёт пойдёт от первого входа ПОСЛЕ деплоя — не залочить всех разом.
        # Персист — best-effort: запись метки не должна ронять валидный вход (напр. БД недоступна).
        if not user.get("first_login_at"):
            user["first_login_at"] = api._now_iso()
            try:
                await api._save_users()
            except Exception as exc:  # noqa: BLE001 - вход важнее сохранения bookkeeping-метки
                api.logger.warning("не удалось сохранить first_login_at для %s: %s", email, exc)
        # 2FA включена → второй шаг: вместо access_token отдаём короткоживущий challenge.
        if user.get("twofa_enabled") and user.get("twofa_secret"):
            return {"twofa_required": True, "challenge": api.make_mfa_challenge(email)}
        return {"access_token": api.make_token(email), "token_type": "bearer"}

    @router.post("/auth/login/totp")
    async def login_totp(payload: dict):
        """Второй шаг входа при включённой 2FA: challenge (из /auth/login) + 6-значный TOTP-код."""
        data = api.read_mfa_challenge(str(payload.get("challenge") or ""))
        if not data:
            raise HTTPException(status_code=401, detail="Сессия входа истекла, войдите заново")
        email = data.get("sub")
        # Локаут перебора: N подряд неверных кодов → короткая блокировка (окно rate-limit сбрасывалось
        # каждые 60с и давало ~10/мин бесконечно — обладатель пароля мог сбрутить 6 цифр за дни).
        if api._twofa_locked(email):
            raise HTTPException(status_code=429, detail="Слишком много неверных кодов, попробуйте позже")
        rk = f"2fa:{email}"  # отдельный лимит на перебор 6 цифр (украли challenge — не сбрутить код)
        if not await api._rate_ok(rk):
            raise HTTPException(status_code=429, detail="Слишком много попыток, подождите минуту")
        user = api.USERS.get(email)
        if not user or not user.get("is_active", True) or not user.get("twofa_enabled"):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        secret = api._decrypt_secret(user.get("twofa_secret") or "")
        if not api._totp_verify(secret, str(payload.get("code") or "")):
            api._twofa_fail(email)
            raise HTTPException(status_code=401, detail="Неверный код")
        api._twofa_pass(email)
        api._LOGIN_ATTEMPTS.pop(rk, None)
        return {"access_token": api.make_token(email), "token_type": "bearer"}

    @router.post("/auth/logout")
    async def logout(
        authorization: str = Header(default=""),
        user: dict = Depends(api.current_user),
    ):
        """Отзыв текущего токена (серверная инвалидация до его exp)."""
        token = authorization.replace("Bearer ", "").strip()
        data = api.read_token(token) or {}
        await api._revoke_token(
            api._token_sig(token),
            data.get("exp", time.time() + 8 * 3600),
        )
        return {"ok": True}

    @router.get("/auth/me")
    async def me(user: dict = Depends(api.rbac)):
        return user

    return router, login, logout, me
