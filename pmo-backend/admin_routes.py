"""Admin user management, self-profile, and RAG/SMTP settings.

Every helper/state (require_owner, current_user, USERS, _admin_view,
_validate_user_payload, _hash_pw, _coerce_bitrix_id, _save_users, _find_user_by_id,
_count_owners, _verify_password, _settings, _save_settings, _rag_thresholds,
_DEFAULT_RAG, _smtp_settings_view, _apply_smtp, _encrypt_secret, logger) resolves
through ``api`` at call time, so shared/tested helpers stay in ``main`` and response
bytes are unchanged.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/admin/users")
    async def admin_users_list(user: dict = Depends(api.require_owner)):
        return {"data": [api._admin_view(e, u) for e, u in api.USERS.items()]}

    @router.post("/admin/users")
    async def admin_users_create(payload: dict, user: dict = Depends(api.require_owner)):
        # Два необязательных поля поверх прежнего контракта (тела POST в голденах не снимаются,
        # так что расширение бесплатно): person_id — заводим логин человеку ИЗ справочника,
        # generate_password — сервер сам придумает пароль и вернёт его РОВНО ОДИН РАЗ.
        plain = None
        if payload.get("generate_password"):
            plain = api._gen_password()
            payload = {**payload, "password": plain}   # проходит ту же валидацию, что и ручной
        api._validate_user_payload(payload, require_email=True, require_password=True)
        email = payload["email"].strip().lower()
        if email in api.USERS:
            raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")
        # Человека проверяем ДО любой записи: иначе 404/409 оставили бы половину пользователя.
        pid = str(payload.get("person_id") or "").strip()
        person = await api._find_linkable_person(pid) if pid else None
        password_hash = await asyncio.to_thread(api._hash_pw, str(payload["password"]))
        rec = {
            "id": str(uuid.uuid4()),
            "email": email,
            "full_name": (payload.get("full_name") or "").strip() or email,
            "role": payload.get("role") or "pm",
            "bitrix24_user_id": api._coerce_bitrix_id(payload.get("bitrix24_user_id")),
            "is_active": True,
            "password_hash": password_hash,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        # Прямая связь логин→человек. Без неё «Мои задачи» и ICS у нового РП будут ПУСТЫ без
        # единой ошибки: _my_task_match сравнивает assignee_person_id задачи именно с person_id
        # и выходит сразу, не доходя до фолбэка по email/имени. Раньше это поле ставил только
        # синк людей — то есть новый человек ждал ночи (или не дожидался вовсе).
        if person:
            rec["person_id"] = person["id"]
        api.USERS[email] = rec
        await api._save_users()                     # пользователь первым: висячая ссылка у
        if person:                                  # человека хуже, чем непроставленная —
            await api._link_person_to_user(person["id"], rec["id"])   # вторую починит синк
        # В журнал — только факт и роль. Пароль не логируем НИКОГДА.
        api.logger.info("admin: создан пользователь %s (role=%s, generated=%s)",
                        email, rec["role"], bool(plain))
        out = {"data": api._admin_view(email, rec)}
        if plain:
            # Рядом с data, а не внутри: _admin_view обслуживает и GET /admin/users, туда
            # пароль не должен попасть ни при каких обстоятельствах.
            out["generated_password"] = plain
        return out

    @router.put("/admin/users/{uid}")
    async def admin_users_update(uid: str, payload: dict, user: dict = Depends(api.require_owner)):
        email, u = api._find_user_by_id(uid)
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        api._validate_user_payload(payload, require_email=False, require_password=False)
        new_email = (payload.get("email") or email).strip().lower()
        if new_email != email and new_email in api.USERS:
            raise HTTPException(status_code=409, detail="Email уже занят")
        renamed_by_admin = False
        if "full_name" in payload:
            new_name = (payload.get("full_name") or "").strip() or u.get("full_name")
            renamed_by_admin = new_name != u.get("full_name")
            u["full_name"] = new_name
        if payload.get("role"):
            # Не разжаловать последнего АКТИВНОГО владельца (иначе 0 рабочих owner → лок-аут).
            if (u.get("role") == "owner" and payload["role"] != "owner"
                    and u.get("is_active", True) and api._count_owners(active_only=True) <= 1):
                raise HTTPException(status_code=409, detail="Нельзя снять роль у последнего владельца")
            u["role"] = payload["role"]
        if "bitrix24_user_id" in payload:
            u["bitrix24_user_id"] = api._coerce_bitrix_id(payload.get("bitrix24_user_id"))
        if "is_active" in payload:
            if not payload["is_active"] and u.get("role") == "owner" and api._count_owners(active_only=True) <= 1:
                raise HTTPException(status_code=409, detail="Нельзя деактивировать последнего владельца")
            u["is_active"] = bool(payload["is_active"])
            if not u["is_active"]:
                # Деактивация обязана гасить и подключения помощника: доступ уже отсекается
                # проверкой при каждом запросе, но живая цепочка воскресила бы его молча
                # в тот же миг, когда учётку вернут.
                await api.db.revoke_refresh_chains_by_user(email, api._now_iso())
        if new_email != email:
            u["email"] = new_email
            api.USERS[new_email] = u
            del api.USERS[email]
            email = new_email
        await api._save_users()
        if renamed_by_admin:
            await api.refresh_pm_name(u.get("id"), u.get("full_name"))
        return {"data": api._admin_view(email, u)}

    @router.put("/admin/users/{uid}/password")
    async def admin_users_password(uid: str, payload: dict, user: dict = Depends(api.require_owner)):
        email, u = api._find_user_by_id(uid)
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        npw = str(payload.get("new_password") or "")
        if len(npw) < 8:
            raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")
        u["password_hash"] = await asyncio.to_thread(api._hash_pw, npw)
        u.pop("password", None)  # убрать плейнтекст-фолбэк, если был
        api._stamp_pw_change(u)  # отозвать прежние токены пользователя
        await api._save_users()
        return {"ok": True}

    @router.delete("/admin/users/{uid}")
    async def admin_users_delete(uid: str, user: dict = Depends(api.require_owner)):
        email, u = api._find_user_by_id(uid)
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        if email == user.get("email"):
            raise HTTPException(status_code=409, detail="Нельзя удалить самого себя")
        # Нельзя оставить систему без АКТИВНОГО владельца: блокируем удаление последнего активного
        # (удаление неактивного владельца, пока есть активный, разрешено).
        if u.get("role") == "owner" and u.get("is_active", True) and api._count_owners(active_only=True) <= 1:
            raise HTTPException(status_code=409, detail="Нельзя удалить последнего владельца")
        del api.USERS[email]
        await api._save_users()
        api.logger.info("admin: удалён пользователь %s", email)
        return {"ok": True}

    @router.delete("/admin/users/{uid}/2fa")
    async def admin_users_reset_2fa(uid: str, user: dict = Depends(api.require_owner)):
        """Сброс 2FA у пользователя (потерял телефон). «Снять на время»: чистим 2FA И даём свежий
        грейс от текущего момента (first_login_at=now), чтобы он успел настроить заново, а не был
        заблокирован сразу же по истёкшему прежнему грейсу."""
        email, u = api._find_user_by_id(uid)
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        for k in ("twofa_secret", "twofa_pending_secret", "twofa_enabled", "twofa_enrolled_at"):
            u.pop(k, None)
        u["first_login_at"] = api._now_iso()
        await api._save_users()
        api.logger.info("admin: сброшена 2FA у %s", email)
        return {"data": api._admin_view(email, u)}

    # ---------- self-service: свой профиль ----------
    @router.put("/me")
    async def update_me(payload: dict, user: dict = Depends(api.current_user)):
        email = user["email"]
        u = api.USERS.get(email)
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        renamed = False
        if "full_name" in payload:
            fn = (payload.get("full_name") or "").strip()
            if len(fn) > 200:
                raise HTTPException(status_code=422, detail="full_name слишком длинный (≤200)")
            if fn and fn != u.get("full_name"):
                u["full_name"] = fn
                renamed = True
        await api._save_users()
        # Подпись РП в проектах — копия имени; без обновления человек остаётся в колонке «РП»
        # под прежним ником, и это читается как «проект не мой».
        if renamed:
            await api.refresh_pm_name(u.get("id"), u.get("full_name"))
        return {"data": {"id": u["id"], "email": email, "full_name": u.get("full_name"), "role": u.get("role")}}

    @router.put("/me/password")
    async def update_my_password(payload: dict, user: dict = Depends(api.current_user)):
        u = api.USERS.get(user["email"])
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        # Rate-limit проверки текущего пароля — иначе украденный токен перебирает реальный пароль в
        # обход лимита /auth/login (отдельный ключ pw:<email>, чтобы не мешать логину).
        _rk = f"pw:{user['email']}"
        if not await api._rate_ok(_rk):
            raise HTTPException(status_code=429, detail="Слишком много попыток, подождите минуту")
        if not await asyncio.to_thread(api._verify_password, u, str(payload.get("current_password") or "")):
            raise HTTPException(status_code=403, detail="Текущий пароль неверный")
        api._LOGIN_ATTEMPTS.pop(_rk, None)  # верный текущий пароль — сброс счётчика
        npw = str(payload.get("new_password") or "")
        if len(npw) < 8:
            raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")
        u["password_hash"] = await asyncio.to_thread(api._hash_pw, npw)
        u.pop("password", None)
        api._stamp_pw_change(u)  # смена своего пароля отзывает прежние сессии (в т.ч. текущую)
        await api._save_users()
        return {"ok": True}

    # ---------- self-service: двухфакторная аутентификация (TOTP) ----------
    @router.post("/me/2fa/setup")
    async def twofa_setup(user: dict = Depends(api.current_user)):
        """Начать привязку: генерим ПРОВИЗОРНЫЙ секрет (в twofa_pending_secret, не трогая боевой,
        чтобы прерванная перенастройка не отключила уже работающую 2FA). Отдаём otpauth-URI + QR
        и сам секрет (для ручного ввода) РОВНО ОДИН раз — потом только verify по коду."""
        u = api.USERS.get(user["email"])
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        # Лимит: генерация секрета шифрует + рисует QR + переписывает users целиком — не давать
        # аутентифицированному юзеру гонять это в цикле (write-amplification).
        if not await api._rate_ok(f"2fa:{user['email']}"):
            raise HTTPException(status_code=429, detail="Слишком много попыток, подождите минуту")
        secret = api._totp_new_secret()
        u["twofa_pending_secret"] = api._encrypt_secret(secret)
        await api._save_users()
        uri = api._totp_provisioning_uri(secret, user["email"])
        return {"data": {"secret": secret, "otpauth_uri": uri,
                         "qr_data_uri": api._totp_qr_data_uri(uri)}}

    @router.post("/me/2fa/enable")
    async def twofa_enable(payload: dict, user: dict = Depends(api.current_user)):
        """Подтвердить привязку кодом из приложения → включить 2FA (промотать провизорный секрет в боевой).
        Требуем текущий пароль (re-auth) — симметрично disable: украденная сессия не должна навязать
        свой аутентификатор и запереть владельца."""
        u = api.USERS.get(user["email"])
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        rk = f"2fa:{user['email']}"  # лимит на перебор 6-значного кода
        if api._twofa_locked(user["email"]):
            raise HTTPException(status_code=429, detail="Слишком много неверных кодов, попробуйте позже")
        if not await api._rate_ok(rk):
            raise HTTPException(status_code=429, detail="Слишком много попыток, подождите минуту")
        if not await asyncio.to_thread(api._verify_password, u, str(payload.get("password") or "")):
            raise HTTPException(status_code=403, detail="Пароль неверный")
        pending = api._decrypt_secret(u.get("twofa_pending_secret") or "")
        if not pending:
            raise HTTPException(status_code=400, detail="Сначала запросите настройку 2FA")
        if not api._totp_verify(pending, str(payload.get("code") or "")):
            api._twofa_fail(user["email"])
            raise HTTPException(status_code=400, detail="Неверный код")
        api._twofa_pass(user["email"])
        api._LOGIN_ATTEMPTS.pop(rk, None)
        u["twofa_secret"] = u.pop("twofa_pending_secret")  # провизорный → боевой
        u["twofa_enabled"] = True
        u["twofa_enrolled_at"] = api._now_iso()
        await api._save_users()
        return {"data": {"twofa_enabled": True}}

    @router.post("/me/2fa/disable")
    async def twofa_disable(payload: dict, user: dict = Depends(api.current_user)):
        """Отключить 2FA — требуем текущий пароль (re-auth), чтобы украденная сессия её не сняла."""
        u = api.USERS.get(user["email"])
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        rk = f"pw:{user['email']}"  # переиспользуем пароль-лимит (проверяем именно пароль)
        if not await api._rate_ok(rk):
            raise HTTPException(status_code=429, detail="Слишком много попыток, подождите минуту")
        if not await asyncio.to_thread(api._verify_password, u, str(payload.get("password") or "")):
            raise HTTPException(status_code=403, detail="Пароль неверный")
        api._LOGIN_ATTEMPTS.pop(rk, None)
        for k in ("twofa_secret", "twofa_pending_secret", "twofa_enabled", "twofa_enrolled_at"):
            u.pop(k, None)
        await api._save_users()
        return {"data": {"twofa_enabled": False}}

    # ── токены внешнего помощника (MCP) ───────────────────────────────────────────
    # Выпуск требует ЖИВОЙ сессии портала (Bearer), то есть человек уже прошёл вход и,
    # если у него включена, двухфакторку. Сам токен работает только на MCP-точке.

    @router.get("/me/agent-tokens")
    async def my_agent_tokens(user: dict = Depends(api.current_user)):
        rows = await api.db.fetch_api_tokens(user["email"])
        return {"data": [{**r, "id": str(r["id"])} for r in rows]}

    @router.post("/me/agent-tokens")
    async def create_agent_token(payload: dict, user: dict = Depends(api.current_user)):
        """Выпустить токен. Значение отдаётся ОДИН раз — второго шанса показать его не будет."""
        name = str(payload.get("name") or "").strip()
        scopes = "read" if str(payload.get("scopes") or "") == "read" else "read+draft"
        live = [r for r in await api.db.fetch_api_tokens(user["email"]) if not r.get("revoked_at")]
        if len(live) >= 5:
            raise HTTPException(status_code=409, detail="Уже пять действующих токенов — отзовите лишние")
        return {"data": await api.issue_api_token(user, name, scopes)}

    @router.delete("/me/agent-tokens/{tid}")
    async def revoke_agent_token(tid: str, user: dict = Depends(api.current_user)):
        # Гасим и ЦЕПОЧКУ обновления: без этого подключение через минуту выпишет себе новый
        # доступ, а человек уверен, что закрыл. Сначала цепочка, потом сама строка.
        chain = await api.db.chain_id_by_access_token(tid)
        if chain:
            await api.db.revoke_oauth_chain(chain, api._now_iso())
        ok = await api.db.revoke_api_token(tid, user["email"], api._now_iso())
        if not ok and not chain:
            raise HTTPException(status_code=404, detail="Токен не найден или уже отозван")
        return {"data": {"id": str(tid), "revoked": True}}

    @router.get("/admin/agent-tokens")
    async def all_agent_tokens(user: dict = Depends(api.require_owner)):
        """Все выпущенные токены — чтобы владелец видел, кто и когда подключал помощника."""
        rows = await api.db.fetch_api_tokens(None)
        return {"data": [{**r, "id": str(r["id"])} for r in rows]}

    @router.delete("/admin/agent-tokens/{tid}")
    async def admin_revoke_agent_token(tid: str, user: dict = Depends(api.require_owner)):
        chain = await api.db.chain_id_by_access_token(tid)   # см. комментарий выше: гасим цепочку
        if chain:
            await api.db.revoke_oauth_chain(chain, api._now_iso())
        ok = await api.db.revoke_api_token(tid, None, api._now_iso())
        if not ok and not chain:
            raise HTTPException(status_code=404, detail="Токен не найден или уже отозван")
        return {"data": {"id": str(tid), "revoked": True}}

    @router.get("/admin/mcp-log")
    async def mcp_access_log(user: dict = Depends(api.require_owner)):
        """Журнал обращений помощника: кто, каким инструментом, к какому проекту."""
        rows = await api.db.fetch_mcp_log(200)
        return {"data": [{**r, "id": str(r["id"]),
                          "token_id": (str(r["token_id"]) if r.get("token_id") else None),
                          "project_id": (str(r["project_id"]) if r.get("project_id") else None)}
                         for r in rows]}

    @router.get("/admin/settings/rag")
    async def get_rag_settings(user: dict = Depends(api.require_owner)):
        return {"data": api._rag_thresholds()}

    @router.put("/admin/settings/rag")
    async def put_rag_settings(payload: dict, user: dict = Depends(api.require_owner)):
        s = api._settings()
        # Только известные ключи. Старая форма настроек присылает red_high / red_overdue —
        # их молча пропускаем (правило их больше не читает), недостающие берём из умолчаний.
        # Мусор и ноль не роняют запрос и не пишутся: остаётся умолчание (см. _rag_thresholds).
        clean = {}
        for k, default in api._DEFAULT_RAG.items():
            try:
                clean[k] = max(1, int(payload.get(k, default)))
            except (TypeError, ValueError):
                clean[k] = default
        clean["red_overdue_pct"] = min(100, clean["red_overdue_pct"])
        s["rag"] = clean
        await api._save_settings(s)
        return {"data": api._rag_thresholds()}

    @router.get("/me/prefs")
    async def get_my_prefs(user: dict = Depends(api.current_user)):
        """Личные настройки интерфейса (что показывать в портфеле и т.п.).

        Хранятся В УЧЁТКЕ, а не в localStorage: человек открывает портал и с ноутбука,
        и с рабочей машины, и настройка должна ехать за ним. Наружу в /auth/me и
        /admin/users они не попадают — те собирают поля списком."""
        u = api.USERS.get(user["email"]) or {}
        return {"data": u.get("prefs") or {}}

    @router.put("/me/prefs")
    async def put_my_prefs(payload: dict, user: dict = Depends(api.current_user)):
        u = api.USERS.get(user["email"])
        if not u:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        prefs = {**(u.get("prefs") or {}), **{str(k)[:40]: v for k, v in (payload or {}).items()}}
        # Учётка — не свалка настроек: маленький потолок бережёт и файл, и время старта,
        # когда USERS читается целиком.
        if len(json.dumps(prefs, ensure_ascii=False)) > 4000:
            raise HTTPException(status_code=413, detail="Слишком много настроек")
        u["prefs"] = prefs
        await api._save_users()
        return {"data": prefs}

    @router.get("/admin/settings/workload")
    async def get_workload_settings(user: dict = Depends(api.require_owner)):
        return {"data": api._workload_thresholds()}

    @router.put("/admin/settings/workload")
    async def put_workload_settings(payload: dict, user: dict = Depends(api.require_owner)):
        s = api._settings()
        # Ноль и отрицательные не имеем смысла: порог «перегружен при 0 задач» красил бы всех.
        clean = {}
        for k, default in api._DEFAULT_WORKLOAD.items():
            try:
                v = int(payload.get(k, default) or default)
            except (TypeError, ValueError):
                v = default
            clean[k] = max(1, v)
        s["workload"] = clean
        await api._save_settings(s)
        return {"data": api._workload_thresholds()}

    @router.get("/admin/settings/mcp")
    async def get_mcp_settings(user: dict = Depends(api.require_owner)):
        return {"data": {"auto_apply": api._mcp_auto_apply()}}

    @router.put("/admin/settings/mcp")
    async def put_mcp_settings(payload: dict, user: dict = Depends(api.require_owner)):
        """Автоприём черновиков помощника для владельца портала.

        Разрешением считается ТОЛЬКО настоящее true: строка «да» или единица включить его
        не могут. Тумблер убирает человека из цепочки применения — цена ошибки разбора здесь
        выше цены строгости.
        """
        s = api._settings()
        s["mcp"] = {"auto_apply": payload.get("auto_apply") is True}
        await api._save_settings(s)
        # Тумблер снимает подтверждение со всех проектов портала сразу — след обязан остаться.
        # Пишем в журнал обращений помощника: он уже выведен в интерфейсе в той же секции,
        # где живёт сам выключатель, и человек увидит запись рядом с ним.
        await api.db.append_mcp_log(api._now_iso(), str(user.get("email") or ""), None,
                                    "settings.auto_apply", None, True,
                                    "включён" if s["mcp"]["auto_apply"] else "выключен")
        return {"data": {"auto_apply": api._mcp_auto_apply()}}

    @router.get("/admin/settings/smtp")
    async def get_smtp_settings(user: dict = Depends(api.require_owner)):
        return {"data": api._smtp_settings_view()}

    @router.put("/admin/settings/smtp")
    async def put_smtp_settings(payload: dict, user: dict = Depends(api.require_owner)):
        """SMTP из UI (пароль шифруется, наружу не отдаётся). Пустой host → вернуться к env."""
        s = api._settings()
        host = str(payload.get("host") or "").strip()
        if not host:
            s.pop("smtp", None)
            await api._save_settings(s)
            api._apply_smtp()
            return {"data": api._smtp_settings_view()}
        smtp = {"host": host, "port": int(payload.get("port") or 587),
                "user": str(payload.get("user") or "").strip(),
                "from": str(payload.get("from") or "").strip(),
                "starttls": bool(payload.get("starttls", True))}
        pw = payload.get("password")
        prev = (s.get("smtp") or {}).get("password")
        if pw:
            smtp["password"] = api._encrypt_secret(str(pw))
        elif prev:
            smtp["password"] = prev  # пароль не прислали — сохраняем прежний
        s["smtp"] = smtp
        await api._save_settings(s)
        api._apply_smtp()
        return {"data": api._smtp_settings_view()}

    @router.post("/admin/test-email")
    async def admin_test_email(payload: dict, user: dict = Depends(api.require_owner)):
        """Проверка почты. Кнопка в настройках была, ручки — не было: единственный способ
        убедиться, что SMTP настроен верно, отвечал 404.

        Отправляем СИНХРОННО (не через _email_bg): смысл проверки в том, чтобы увидеть
        результат, а не «отправлено куда-то в фон». Ошибку SMTP отдаём как есть — админу
        нужно знать, что именно не так (неверный пароль, недоступный хост, запрет STARTTLS).
        """
        to = str(payload.get("to_email") or "").strip()
        if not to or "@" not in to:
            raise HTTPException(status_code=422, detail="Укажите корректный адрес")
        rec = await asyncio.to_thread(
            api.mailer.send_email, to, "PM Tool: проверка почты",
            "Это тестовое письмо из PM Tool.\nЕсли вы его получили — SMTP настроен верно.")
        return {"data": {"sent": bool(rec.get("sent")), "to": to,
                         "dry_run": bool(rec.get("dry_run")),
                         "error": rec.get("error") or ""}}

    return (router, admin_users_list, admin_users_create, admin_users_update,
            admin_users_password, admin_users_delete, update_me, update_my_password,
            get_rag_settings, put_rag_settings, get_my_prefs, put_my_prefs,
            get_workload_settings, put_workload_settings,
            get_smtp_settings, put_smtp_settings, get_mcp_settings, put_mcp_settings)
