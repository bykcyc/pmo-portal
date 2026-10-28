# -*- coding: utf-8 -*-
"""Обновление доступа помощника: ротация, одноразовость, отзыв цепочки.

Здесь проверяется не «работает ли обновление», а три катастрофы:
  1) «Отозвать» перестал отзывать — клиент через минуту выписывает себе новый доступ;
  2) украденное значение живёт вечно, потому что повтор никто не заметил;
  3) refresh принимается как обычный токен доступа к /mcp.
"""
import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any, cast

import main
import oauth_provider


def _now():
    return datetime.now(timezone.utc)


class _Db:
    """Двойник слоя БД: только то, что трогает провайдер."""

    def __init__(self):
        self.refresh: dict = {}
        self.tokens: dict = {}
        self.revoked_tokens: list = []
        self.seq = 0

    # ── refresh ─────────────────────────────────────────────────────────────
    async def insert_oauth_refresh(self, token_hash, chain_id, client_id, user_email, scopes,
                                   access_token_id, resource, created_at, chain_expires_at, expires_at):
        self.refresh[token_hash] = {
            "token_hash": token_hash, "chain_id": chain_id, "client_id": client_id,
            "user_email": user_email, "scopes": scopes, "access_token_id": access_token_id,
            "resource": resource, "created_at": created_at, "chain_expires_at": chain_expires_at,
            "expires_at": expires_at, "used_at": None, "revoked_at": None,
        }

    async def get_oauth_refresh(self, token_hash):
        return dict(self.refresh[token_hash]) if token_hash in self.refresh else None

    async def spend_oauth_refresh(self, token_hash, at):
        row = self.refresh.get(token_hash)
        if not row or row["used_at"] or row["revoked_at"]:
            return None
        row["used_at"] = at
        return row["chain_id"]

    async def revoke_oauth_chain(self, chain_id, at):
        n = 0
        for row in self.refresh.values():
            if row["chain_id"] == chain_id and not row["revoked_at"]:
                row["revoked_at"] = at
                n += 1
                if row["access_token_id"]:
                    self.revoked_tokens.append(str(row["access_token_id"]))
        return n

    async def chain_id_by_access_token(self, tid):
        for row in self.refresh.values():
            if str(row["access_token_id"]) == str(tid):
                return row["chain_id"]
        return None

    # ── доступы ─────────────────────────────────────────────────────────────
    async def revoke_api_token(self, tid, email, at):
        self.revoked_tokens.append(str(tid))
        return True

    async def revoke_api_token_by_hash(self, token_hash, at):
        self.revoked_tokens.append(f"hash:{token_hash}")
        return True

    async def find_api_token(self, token_hash):
        return self.tokens.get(token_hash)

    async def touch_oauth_client(self, cid, at):
        return None


class _Api:
    """Двойник фасада main."""

    def __init__(self, db, user=None, must_enroll=False):
        self.db = db
        self._user = user or {"email": "pm@example.com", "id": "u1", "is_active": True}
        self._must = must_enroll
        self.issued = 0

    def _now_iso(self):
        return _now().isoformat()

    def user_by_email(self, email):
        return self._user if str(email).lower() == str(self._user["email"]).lower() else None

    def _twofa_must_enroll(self, user):
        return self._must

    def _api_token_hash(self, raw):
        return f"h:{raw}"

    async def issue_api_token(self, user, name, scopes, client_id=None):
        self.issued += 1
        return {"id": str(self.issued), "token": f"pmo_tok{self.issued}", "scopes": scopes,
                "expires_at": (_now() + timedelta(days=90)).isoformat()}


class _Client:
    def __init__(self, cid="c1"):
        self.client_id = cid
        self.client_name = "Claude"


def _provider(db=None, **kw):
    db = db or _Db()
    api = _Api(db, **kw)
    prov = oauth_provider.PortalOAuthProvider(cast(Any, api), "https://pm.example.com/consent")
    return prov, api, db


def _seed_chain(prov, db, api, scopes=("read", "draft")):
    """Выдать первую пару, как после согласия человека."""
    raw = asyncio.run(prov._issue_refresh(
        chain_id="chain1", client_id="c1", user_email="pm@example.com", scopes=list(scopes),
        access_token_id="1", resource=None,
        chain_expires_at=(_now() + timedelta(days=365)).isoformat()))
    return raw


def test_refresh_rotates_and_kills_previous_access():
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    assert loaded is not None and loaded.client_id == "c1"
    out = asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read", "draft"]))
    assert out.access_token and out.refresh_token and out.refresh_token != raw
    assert "1" in db.revoked_tokens, "прежний доступ цепочки обязан погаснуть"
    # Старое значение мертво.
    assert asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw)) is None


def test_replay_kills_whole_chain():
    """Повтор потраченного значения — признак кражи: гасим цепочку целиком."""
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read"]))
    try:
        asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read"]))
        raise AssertionError("повтор обязан быть отвергнут")
    except oauth_provider.TokenError as exc:
        assert exc.error == "invalid_grant"
    assert all(r["revoked_at"] for r in db.refresh.values()), "цепочка должна быть погашена"


def test_foreign_client_cannot_use_refresh():
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    assert asyncio.run(prov.load_refresh_token(cast(Any, _Client("другой")), raw)) is None


def test_scopes_can_narrow_but_not_widen():
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api, scopes=("read",))
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    out = asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read", "draft"]))
    assert out.scope == "read", "обновление не должно расширять права"


def test_disabled_account_kills_chain_but_2fa_grace_does_not():
    # Деактивированная учётка: доступ мёртв навсегда.
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    api._user["is_active"] = False
    try:
        asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read"]))
        raise AssertionError("деактивированная учётка не должна обновляться")
    except oauth_provider.TokenError:
        pass
    assert all(r["revoked_at"] for r in db.refresh.values())

    # Истёкший грейс 2FA — состояние временное: отказ есть, цепочка жива.
    prov2, api2, db2 = _provider(must_enroll=True)
    raw2 = _seed_chain(prov2, db2, api2)
    loaded2 = asyncio.run(prov2.load_refresh_token(cast(Any, _Client()), raw2))
    try:
        asyncio.run(prov2.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded2), ["read"]))
        raise AssertionError("без 2FA обновлять нельзя")
    except oauth_provider.TokenError:
        pass
    assert not any(r["revoked_at"] for r in db2.refresh.values()), "грейс 2FA не должен рушить подключение"


def test_password_change_kills_the_chain():
    """Пароль меняют, когда боятся утечки. Значение refresh, выданное ДО смены, доступ не
    продлевает, даже если цепочку почему-то не погасили (второй рубеж к _revoke_agent_access)."""
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    api._user["pw_changed_at"] = time.time() + 5
    try:
        asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read"]))
        raise AssertionError("значение, выданное до смены пароля, не должно обновляться")
    except oauth_provider.TokenError as exc:
        assert exc.error == "invalid_grant"
    assert all(r["revoked_at"] for r in db.refresh.values()), "цепочка должна быть погашена"
    assert api.issued == 0


def test_chain_started_after_password_change_still_renews():
    prov, api, db = _provider()
    api._user["pw_changed_at"] = time.time() - 60
    raw = _seed_chain(prov, db, api)
    loaded = asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw))
    out = asyncio.run(prov.exchange_refresh_token(cast(Any, _Client()), cast(Any, loaded), ["read"]))
    assert out.access_token


def test_chain_ceiling_stops_endless_renewal():
    """Потолок цепочки не двигается при ротации: одно согласие ≠ вечный доступ."""
    prov, api, db = _provider()
    raw = asyncio.run(prov._issue_refresh(
        chain_id="chain1", client_id="c1", user_email="pm@example.com", scopes=["read"],
        access_token_id="1", resource=None,
        chain_expires_at=(_now() - timedelta(days=1)).isoformat()))
    assert asyncio.run(prov.load_refresh_token(cast(Any, _Client()), raw)) is None


def test_revoke_from_either_side_kills_chain():
    """RFC 7009: клиент может прислать любое из двух значений — гаснуть должно всё."""
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)

    class _Tok:
        token = raw
    asyncio.run(prov.revoke_token(_Tok()))
    assert all(r["revoked_at"] for r in db.refresh.values())
    assert "1" in db.revoked_tokens


def test_refresh_value_is_not_an_access_token():
    """Разные пространства значений: refresh не должен работать как bearer на /mcp."""
    prov, api, db = _provider()
    raw = _seed_chain(prov, db, api)
    assert raw.startswith("pmor_")
    assert asyncio.run(db.find_api_token(api._api_token_hash(raw))) is None


def test_ttl_constants_are_sane():
    assert oauth_provider.REFRESH_TTL_DAYS <= oauth_provider.REFRESH_CHAIN_DAYS
    assert main.security_ops.API_TOKEN_TTL_DAYS <= oauth_provider.REFRESH_CHAIN_DAYS
