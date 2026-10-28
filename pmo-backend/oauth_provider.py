"""Портал как сервер авторизации для подключения помощника (OAuth 2.1 + PKCE).

Зачем это вообще. Личный токен, который человек копирует и вставляет в заголовок, умеют задать
Claude Desktop и Claude Code. А коннекторы claude.ai в браузере поля для токена не имеют вовсе:
они регистрируются сами (RFC 7591), ведут человека на страницу согласия и получают токен по коду.
Без этого «подключить портал к своему Claude» для большинства РП физически невозможно.

Три решения, на которых стоит модуль:

1. **Проверки протокола — не наши.** Точное совпадение redirect_uri, обязательный PKCE S256,
   одноразовость кода, аутентификация клиента на точке обмена — всё это уже написано в SDK
   (`mcp.server.auth.handlers`). Мы реализуем только хранилище и шаг согласия. Своя реализация
   этих проверок была бы вторым шансом ошибиться в самом опасном месте.

2. **Итог флоу — обычная строка в `api_tokens`.** Никакого второго вида токенов: тот же хеш,
   тот же срок, тот же `verify_api_token`, тот же список и та же кнопка «Отозвать» в Профиле.
   Иначе «Отозвать» отзывал бы не всё, а это ровно тот случай, когда человек считает, что доступ
   закрыт, а он открыт.

3. **Согласие даёт ЧЕЛОВЕК в портале, своей учётной записью.** Точка `/authorize` сама никого
   не пускает: она сохраняет запрос и уводит на страницу портала, где работает обычный вход
   с паролем и двухфакторкой. Так у подключения помощника нет собственного, более слабого входа.

4. **Обновление доступа (refresh) с ротацией и потолком.** Доступ живёт 90 дней, но клиент
   продлевает его сам, не дёргая человека. Три правила, без которых это было бы дырой:
   значение одноразовое (повтор = кража либо гонка → гасим ВСЮ цепочку); у цепочки есть
   АБСОЛЮТНЫЙ потолок, который не двигается при ротации, — одно согласие не превращается
   в вечный доступ; refresh живёт в своей таблице со своим префиксом и bearer-токеном на /mcp
   не является никогда.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

if TYPE_CHECKING:
    from pmo_api import PmoApi

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

import security

# Сколько человек может думать над страницей согласия. Меньше — и он не успеет войти в портал
# и пройти двухфакторку; больше — и забытая вкладка остаётся заряженной слишком долго.
REQUEST_TTL_MINUTES = 15

# Код авторизации живёт секунды: клиент обменивает его сразу. Запас — на медленную сеть.
CODE_TTL_SECONDS = 120

# Сколько живёт одно значение refresh и вся цепочка. Потолок цепочки — решение о том, как
# часто человек подтверждает доступ ЗАНОВО: ротация продлевает доступ, но не бесконечно.
REFRESH_TTL_DAYS = 90
REFRESH_CHAIN_DAYS = 365

# Сколько помнить клиента, который зарегистрировался и так и не подключился. Регистрация
# анонимна (RFC 7591): без срока каждая чужая попытка — строка навсегда. Честному клиенту
# хватает минут (регистрация → согласие → обмен кода); вернувшийся позже со старой регистрацией
# получит «Client ID not found», и регистрироваться ему придётся заново. Клиент с любым следом
# подключения не уходит никогда — правило в `db.delete_unused_oauth_clients`.
UNUSED_CLIENT_TTL_DAYS = 1

# Права, которые вообще бывают у помощника. `read` — читать открытые проекты,
# `draft` — предлагать изменения черновиком. Ничего, что меняет доступ, тут нет и быть не может.
VALID_SCOPES = ["read", "draft"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(value: str) -> str:
    """Хеш кода авторизации. В базе лежит только он: копия базы не даёт обменять код на токен."""
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def redirect_host(uri: str) -> str:
    """Хост, куда уедет код. Показываем его человеку на странице согласия: имя клиента
    произвольное («pmo», «Claude»), а вот хост подделать труднее — по нему и видно подмену."""
    try:
        return urlparse(str(uri)).netloc or str(uri)
    except ValueError:
        return str(uri)


class PortalOAuthProvider:
    """Реализация `OAuthAuthorizationServerProvider` поверх нашей базы.

    Методы вызывает SDK; ничего, кроме хранения и выдачи токена, тут не происходит.
    """

    def __init__(self, api: "PmoApi", consent_url: str):
        self._api = api
        # Куда уводить человека за согласием. Это страница ПОРТАЛА, а не сторонний провайдер:
        # мы сами и есть тот, кто знает пользователей.
        self._consent_url = consent_url.rstrip("/")

    # ── клиенты ────────────────────────────────────────────────────────────────────────────

    async def get_client(self, client_id: str) -> Optional[OAuthClientInformationFull]:
        row = await self._api.db.get_oauth_client(client_id)
        if not row:
            return None
        try:
            return OAuthClientInformationFull.model_validate(row["info"])
        except Exception:  # noqa: BLE001 — битая карточка равнозначна незарегистрированному клиенту
            return None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        info = client_info.model_dump(mode="json")
        await self._api.db.upsert_oauth_client(
            client_id=client_info.client_id,
            # Секрет храним как выдали: SDK сверяет его прямым сравнением на точке обмена.
            # Сам по себе он бесполезен — без кода авторизации и PKCE-проверки доступа не даёт.
            client_secret=client_info.client_secret,
            client_name=str(client_info.client_name or "")[:200],
            info=info,
            created_at=self._api._now_iso(),
        )

    # ── согласие ───────────────────────────────────────────────────────────────────────────

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """Не выдаём код, а уводим человека в портал. Код появится, когда он нажмёт «Разрешить»."""
        if params.resource and not self._api.oauth_resource_ok(params.resource):
            # RFC 8707: токен просят не для нашего ресурса — выдавать его нельзя.
            raise AuthorizeError(error="invalid_target", error_description="Неизвестный ресурс")
        rid = secrets.token_urlsafe(24)
        now = _now()
        await self._api.db.insert_oauth_request(
            rid=rid,
            client_id=client.client_id,
            redirect_uri=str(params.redirect_uri),
            redirect_explicit=params.redirect_uri_provided_explicitly,
            code_challenge=params.code_challenge,
            scopes=" ".join(params.scopes or VALID_SCOPES),
            state=params.state,
            resource=params.resource,
            created_at=now.isoformat(),
            expires_at=(now + timedelta(minutes=REQUEST_TTL_MINUTES)).isoformat(),
        )
        return f"{self._consent_url}?rid={rid}"

    # ── код авторизации ────────────────────────────────────────────────────────────────────

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> Optional[AuthorizationCode]:
        row = await self._api.db.get_oauth_code(_hash(authorization_code))
        if not row or row.get("used_at") or row["client_id"] != client.client_id:
            return None
        try:
            expires_at = datetime.fromisoformat(str(row["expires_at"]))
        except (TypeError, ValueError):
            return None
        if expires_at < _now():
            return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=str(row["scopes"] or "").split(),
            expires_at=expires_at.timestamp(),
            client_id=row["client_id"],
            code_challenge=row["code_challenge"],
            redirect_uri=AnyUrl(row["redirect_uri"]),
            redirect_uri_provided_explicitly=bool(row["redirect_explicit"]),
            resource=row.get("resource"),
            subject=row["user_email"],
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        # Гасим код ПЕРЕД выпуском токена: если два обмена придут одновременно, второй увидит
        # уже использованный код и уйдёт ни с чем, а не выпустит второй токен.
        if not await self._api.db.use_oauth_code(_hash(authorization_code.code),
                                                 self._api._now_iso()):
            raise TokenError(error="invalid_grant", error_description="Код уже использован")

        user = self._api.user_by_email(str(authorization_code.subject or ""))
        if not user or not user.get("is_active", True):
            raise TokenError(error="invalid_grant", error_description="Учётная запись недоступна")

        name = str(client.client_name or redirect_host(str(authorization_code.redirect_uri)))[:80]
        # Привязываем токен к клиенту: без этого точка отзыва не убедится, что клиент гасит
        # СВОЙ токен, и «отключить коннектор» молча ничего бы не делало.
        issued = await self._api.issue_api_token(
            user, name, "+".join(authorization_code.scopes or ["read"]), client.client_id)
        await self._api.db.touch_oauth_client(client.client_id, self._api._now_iso())
        try:
            ttl = int((datetime.fromisoformat(issued["expires_at"]) - _now()).total_seconds())
        except (TypeError, ValueError):
            ttl = 0
        scopes = authorization_code.scopes or ["read"]
        refresh = await self._issue_refresh(
            chain_id=secrets.token_urlsafe(24), client_id=client.client_id,
            user_email=str(user.get("email") or ""), scopes=scopes,
            access_token_id=issued.get("id"), resource=getattr(authorization_code, "resource", None),
            chain_expires_at=(_now() + timedelta(days=REFRESH_CHAIN_DAYS)).isoformat())
        return OAuthToken(
            access_token=issued["token"],
            token_type="Bearer",
            expires_in=max(ttl, 0),
            scope=" ".join(scopes),
            refresh_token=refresh,
        )

    async def _issue_refresh(self, chain_id: str, client_id: str, user_email: str, scopes: list,
                             access_token_id, resource, chain_expires_at: str) -> str:
        """Новое значение refresh в существующей (или только что начатой) цепочке.

        Префикс `pmor_` отличает его от токена доступа `pmo_`: значения живут в разных таблицах,
        и поиск никогда не идёт поперёк — иначе refresh стал бы рабочим доступом к /mcp."""
        raw = "pmor_" + secrets.token_urlsafe(32)
        await self._api.db.insert_oauth_refresh(
            _hash(raw), chain_id, client_id, user_email, " ".join(scopes),
            access_token_id, resource, self._api._now_iso(), chain_expires_at,
            (_now() + timedelta(days=REFRESH_TTL_DAYS)).isoformat())
        return raw

    # ── обновление доступа ─────────────────────────────────────────────────────────────────

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> Optional[RefreshToken]:
        row = await self._api.db.get_oauth_refresh(_hash(refresh_token or ""))
        if not row or row.get("used_at") or row.get("revoked_at"):
            return None
        # client_id берём ИЗ СТРОКИ, а не из аргумента: иначе проверка SDK «этот ли клиент
        # предъявляет значение» сравнивала бы аргумент сам с собой.
        if str(row.get("client_id") or "") != str(client.client_id):
            return None
        try:
            expires = datetime.fromisoformat(str(row["expires_at"]))
            chain_end = datetime.fromisoformat(str(row["chain_expires_at"]))
        except (TypeError, ValueError):
            return None
        if expires <= _now() or chain_end <= _now():
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=str(row["client_id"]),
            scopes=[s for s in str(row.get("scopes") or "read").split() if s],
            expires_at=int(expires.timestamp()),
        )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list
    ) -> OAuthToken:
        """Ротация: старое значение списывается, выдаётся новая пара, прежний доступ гасится.

        Повторное предъявление уже потраченного значения — признак кражи (RFC 9700): цепочка
        гасится целиком, человек подтверждает доступ заново. Честный клиент попадает сюда лишь
        при обрыве сети на ответе; это осознанная цена одноразовости.
        """
        now_iso = self._api._now_iso()
        chain_id = await self._api.db.spend_oauth_refresh(_hash(refresh_token.token), now_iso)
        if not chain_id:
            row = await self._api.db.get_oauth_refresh(_hash(refresh_token.token))
            if row and row.get("chain_id"):
                await self._api.db.revoke_oauth_chain(str(row["chain_id"]), now_iso)
            raise TokenError(error="invalid_grant",
                             error_description="Значение уже использовано — подтвердите доступ заново")

        row = await self._api.db.get_oauth_refresh(_hash(refresh_token.token)) or {}
        try:
            chain_end = datetime.fromisoformat(str(row.get("chain_expires_at") or ""))
        except (TypeError, ValueError):
            chain_end = _now()
        if chain_end <= _now():
            await self._api.db.revoke_oauth_chain(chain_id, now_iso)
            raise TokenError(error="invalid_grant",
                             error_description="Срок подключения истёк — подтвердите доступ заново")

        user = self._api.user_by_email(str(row.get("user_email") or ""))
        if not user or not user.get("is_active", True):
            # Деактивированная учётка — цепочку гасим: иначе доступ воскреснет при её возврате.
            await self._api.db.revoke_oauth_chain(chain_id, now_iso)
            raise TokenError(error="invalid_grant", error_description="Учётная запись недоступна")
        if user.get("pw_changed_at") and security.issued_before(row.get("created_at"), user["pw_changed_at"]):
            # Значение выдано ДО смены пароля. Смена пароля гасит цепочки сама
            # (_revoke_agent_access); это второй рубеж, если та запись не дошла до базы.
            await self._api.db.revoke_oauth_chain(chain_id, now_iso)
            raise TokenError(error="invalid_grant",
                             error_description="Пароль сменён — подтвердите доступ заново")
        if self._api._twofa_must_enroll(user):
            # Грейс 2FA — состояние ВРЕМЕННОЕ: цепочку не рушим, человек включит 2FA и клиент
            # восстановится сам, без повторного согласия.
            raise TokenError(error="invalid_grant",
                             error_description="Требуется настроить двухфакторную аутентификацию")

        # Сузить права можно, расширить — нет: иначе обновление стало бы способом получить
        # больше, чем человек согласовал.
        had = [s for s in str(row.get("scopes") or "read").split() if s]
        asked = [s for s in (scopes or had) if s in had] or had

        if row.get("access_token_id"):
            # Прежний доступ цепочки гаснет в тот же миг: две живые строки на одно подключение
            # человек в Профиле прочитал бы как «кто-то ещё подключился».
            await self._api.db.revoke_api_token(str(row["access_token_id"]), None, now_iso)
        name = str(client.client_name or "Помощник")[:80]
        issued = await self._api.issue_api_token(user, name, "+".join(asked), client.client_id)
        new_refresh = await self._issue_refresh(
            chain_id=chain_id, client_id=str(client.client_id),
            user_email=str(row.get("user_email") or ""), scopes=asked,
            access_token_id=issued.get("id"), resource=row.get("resource"),
            chain_expires_at=str(row.get("chain_expires_at")))
        try:
            ttl = int((datetime.fromisoformat(issued["expires_at"]) - _now()).total_seconds())
        except (TypeError, ValueError):
            ttl = 0
        return OAuthToken(access_token=issued["token"], token_type="Bearer",
                          expires_in=max(ttl, 0), scope=" ".join(asked),
                          refresh_token=new_refresh)

    # ── отзыв ──────────────────────────────────────────────────────────────────────────────

    async def load_access_token(self, token: str) -> Optional[AccessToken]:
        got = await self._api.verify_api_token(token)
        if not got:
            return None
        user = got["user"]
        return AccessToken(
            token=token,
            # Для токена из OAuth — его клиент; для выписанного руками в Профиле клиента нет,
            # и владельцем считается сам человек.
            client_id=str(got.get("oauth_client_id") or user.get("email") or ""),
            scopes=[s for s in str(got.get("scopes") or "read").split("+") if s],
            subject=str(user.get("id") or ""),
        )

    async def revoke_token(self, token: Any) -> None:
        """Отключение коннектора на стороне клиента должно гасить доступ и у нас — иначе
        в Профиле остаётся живая строка от подключения, которого уже нет.

        Гасим ЦЕПОЧКУ с любой стороны: пришёл ли токен доступа или refresh. Половинчатый отзыв
        (только предъявленное значение) означал бы, что клиент через минуту выпишет себе новый
        доступ, а человек уверен, что закрыл."""
        raw = getattr(token, "token", "") or ""
        now_iso = self._api._now_iso()
        row = await self._api.db.get_oauth_refresh(_hash(raw))
        if row and row.get("chain_id"):
            await self._api.db.revoke_oauth_chain(str(row["chain_id"]), now_iso)
            return
        token_hash = self._api._api_token_hash(raw)
        found = await self._api.db.find_api_token(token_hash)
        if found and found.get("id"):
            chain = await self._api.db.chain_id_by_access_token(found["id"])
            if chain:
                await self._api.db.revoke_oauth_chain(str(chain), now_iso)
                return
        await self._api.db.revoke_api_token_by_hash(token_hash, now_iso)


def approval_redirect(row: dict, code: Optional[str]) -> str:
    """Куда вернуть браузер после решения человека: с кодом — при согласии, с ошибкой — при отказе.

    `state` возвращаем ровно тем, что прислал клиент: по нему он узнаёт свой запрос и гасит CSRF.
    """
    if code:
        return construct_redirect_uri(row["redirect_uri"], code=code, state=row.get("state"))
    return construct_redirect_uri(row["redirect_uri"], error="access_denied",
                                  error_description="Человек отклонил запрос", state=row.get("state"))
