"""Маршруты OAuth: протокольные точки (их обслуживает SDK) и страница согласия (наша).

Разделение здесь принципиальное. Всё, что описано стандартом, — регистрация клиента, проверка
redirect_uri, PKCE, обмен кода, отзыв — берём готовым из SDK. Своего кода ровно столько, сколько
нужно, чтобы РЕШЕНИЕ принимал человек в портале: показать, кто и о чём просит, и превратить его
«Разрешить» в код авторизации.

Точки протокола живут под `/oauth/*`, а не в корне (SDK по умолчанию кладёт их туда). Причина
простая: `/register` в корне портала читается как «регистрация пользователя», а это совсем
не то, что происходит. Метаданные при этом объявляют полные адреса, так что клиенту всё равно.
"""

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

import secrets

from fastapi import APIRouter, Depends, HTTPException
from mcp.server.auth.handlers.authorize import AuthorizationHandler
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.handlers.register import RegistrationHandler
from mcp.server.auth.handlers.revoke import RevocationHandler
from mcp.server.auth.handlers.token import TokenHandler
from mcp.server.auth.middleware.client_auth import ClientAuthenticator
from mcp.server.auth.routes import cors_middleware, create_protected_resource_routes
from mcp.server.auth.settings import ClientRegistrationOptions
from mcp.shared.auth import OAuthMetadata
from pydantic import AnyHttpUrl
from starlette.routing import Route

import oauth_provider


def build_protocol_routes(provider, base_url: str) -> list:
    """Точки, с которыми разговаривает не человек, а программа-клиент."""
    base = base_url.rstrip("/")
    meta = OAuthMetadata(
        # Строкой, не AnyHttpUrl: сравнение издателя по RFC 8414 — побайтовое,
        # а готовый AnyHttpUrl дописал бы хвостовой слэш и сломал бы его.
        issuer=base,  # type: ignore[arg-type]
        authorization_endpoint=AnyHttpUrl(f"{base}/oauth/authorize"),
        token_endpoint=AnyHttpUrl(f"{base}/oauth/token"),
        registration_endpoint=AnyHttpUrl(f"{base}/oauth/register"),
        revocation_endpoint=AnyHttpUrl(f"{base}/oauth/revoke"),
        scopes_supported=oauth_provider.VALID_SCOPES,
        response_types_supported=["code"],
        # Код с PKCE — единственный путь получить доступ; обновление продлевает уже выданный
        # (ротация с одноразовым значением и абсолютным потолком цепочки, см. провайдер).
        grant_types_supported=["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported=["client_secret_post", "client_secret_basic", "none"],
        revocation_endpoint_auth_methods_supported=["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported=["S256"],
    )
    registration = ClientRegistrationOptions(
        enabled=True,                       # без самостоятельной регистрации клиент не подключится вовсе
        valid_scopes=oauth_provider.VALID_SCOPES,
        default_scopes=oauth_provider.VALID_SCOPES,
    )
    authenticator = ClientAuthenticator(provider)
    return [
        Route("/.well-known/oauth-authorization-server",
              endpoint=cors_middleware(MetadataHandler(meta).handle, ["GET", "OPTIONS"]),
              methods=["GET", "OPTIONS"]),
        # На точку согласия браузер приходит редиректом, поэтому CORS ей не нужен.
        Route("/oauth/authorize", endpoint=AuthorizationHandler(provider).handle, methods=["GET", "POST"]),
        Route("/oauth/token",
              endpoint=cors_middleware(TokenHandler(provider, authenticator).handle, ["POST", "OPTIONS"]),
              methods=["POST", "OPTIONS"]),
        Route("/oauth/register",
              endpoint=cors_middleware(RegistrationHandler(provider, options=registration).handle,
                                       ["POST", "OPTIONS"]),
              methods=["POST", "OPTIONS"]),
        Route("/oauth/revoke",
              endpoint=cors_middleware(RevocationHandler(provider, authenticator).handle, ["POST", "OPTIONS"]),
              methods=["POST", "OPTIONS"]),
        # RFC 9728: по этому адресу клиент узнаёт, какой сервер авторизации спрашивать.
        # Адрес берётся из заголовка WWW-Authenticate нашего же 401 — цепочка замыкается.
        *create_protected_resource_routes(
            resource_url=AnyHttpUrl(f"{base}/mcp"),
            authorization_servers=[base],  # type: ignore[list-item]  — та же причина, что у issuer
            scopes_supported=oauth_provider.VALID_SCOPES,
            resource_name="PMO портал",
        ),
    ]


def build_router(api: "PmoApi", provider):
    """Страница согласия: её открывает ЧЕЛОВЕК, уже вошедший в портал."""
    router = APIRouter()

    async def _pending(rid: str) -> dict:
        row = await api.db.get_oauth_request(rid)
        if not row:
            raise HTTPException(status_code=404, detail="Запрос не найден")
        if row.get("decided_at"):
            raise HTTPException(status_code=409, detail="По этому запросу решение уже принято")
        try:
            if datetime.fromisoformat(str(row["expires_at"])) < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Запрос устарел — начните подключение заново")
        except (TypeError, ValueError):
            raise HTTPException(status_code=410, detail="Запрос устарел — начните подключение заново")
        return row

    @router.get("/oauth/consent/{rid}")
    async def consent_get(rid: str, user: dict = Depends(api.current_user)):
        """Кто и о чём просит. Хост возврата показываем наравне с именем: имя клиент придумывает
        сам, а вот адрес, куда уедет код, — то, что реально видно и проверяемо."""
        row = await _pending(rid)
        client = await provider.get_client(row["client_id"])
        return {"data": {
            "id": rid,
            "client_name": (getattr(client, "client_name", None) or "") if client else "",
            "redirect_host": oauth_provider.redirect_host(row["redirect_uri"]),
            "scopes": str(row["scopes"] or "").split(),
            "user_email": user.get("email"),
        }}

    @router.post("/oauth/consent/{rid}/approve")
    async def consent_approve(rid: str, user: dict = Depends(api.current_user)):
        """«Разрешить». Только здесь появляется код авторизации — и только от живого человека,
        прошедшего обычный вход портала со всеми его требованиями, включая двухфакторку."""
        row = await _pending(rid)
        if not await api.db.decide_oauth_request(rid, str(user.get("email") or ""), api._now_iso()):
            raise HTTPException(status_code=409, detail="По этому запросу решение уже принято")
        code = secrets.token_urlsafe(32)          # ≥160 бит энтропии, как требует RFC 6749 §10.10
        now = datetime.now(timezone.utc)
        await api.db.insert_oauth_code(
            code_hash=oauth_provider._hash(code),
            client_id=row["client_id"],
            user_email=str(user.get("email") or ""),
            redirect_uri=row["redirect_uri"],
            redirect_explicit=bool(row["redirect_explicit"]),
            code_challenge=row["code_challenge"],
            scopes=row["scopes"],
            resource=row.get("resource"),
            expires_at=(now + timedelta(seconds=oauth_provider.CODE_TTL_SECONDS)).isoformat(),
        )
        return {"data": {"redirect_to": oauth_provider.approval_redirect(row, code)}}

    @router.post("/oauth/consent/{rid}/deny")
    async def consent_deny(rid: str, user: dict = Depends(api.current_user)):
        row = await _pending(rid)
        await api.db.decide_oauth_request(rid, str(user.get("email") or ""), api._now_iso())
        return {"data": {"redirect_to": oauth_provider.approval_redirect(row, None)}}

    return router, consent_get, consent_approve, consent_deny
