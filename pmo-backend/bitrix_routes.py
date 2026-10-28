"""Bitrix24 integration routes on the stable ``main`` facade.

Backlog->Bitrix task link, connection test, inbound webhook (public), and
admin Bitrix-webhook settings. The bx-client helpers (bx, bx_create_task,
_bitrix_url) and monkeypatched config (BITRIX_INBOUND_TOKEN — read via ``api``
so test patches on main.* are honored) stay in ``main``. Response bytes unchanged.
"""

import hmac
import re
import urllib.parse
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException, Request

# ---------- Bitrix24: обратный синк (Bitrix -> наш статус) ----------
# Bitrix шлёт исходящий вебхук (form-urlencoded) при ONTASKUPDATE/ONTASKADD.
# Коды сверены по живому порталу (tasks.task.getFields):
#   2 «Ждёт выполнения» · 3 «Выполняется» · 4 «Ожидает контроля» · 5 «Завершена» · 6 «Отложена».
# Было: 6 → cancelled. Это ошибка — «Отложена» это НЕ «отменена», а наш on_hold. Из-за неё
# отложенная в Bitrix задача приезжала в портал отменённой.
BX_STATUS_TO_OURS = {"2": "not_started", "3": "in_progress", "4": "completed", "5": "completed", "6": "on_hold"}
_BL_STATUS = {"not_started": "new", "in_progress": "in_progress", "completed": "done", "cancelled": "cancelled"}

# Настоящее тело исходящего вебхука Bitrix — десяток коротких полей формы (~1 КиБ).
# 64 КиБ — с запасом, но не склад: вебхук открыт анонимам. Caddy режет там же.
_MAX_WEBHOOK_BODY = 64 * 1024


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.post("/projects/{pid}/backlog/{bid}/bitrix24-task")
    async def backlog_bitrix_create(pid: str, bid: str, payload: dict, user: dict = Depends(api.rbac)):
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")
        _, m0 = await api.load_meta(pid)
        code = m0.get("code") or "PRJ"
        item = next((it for it in api._coll(m0, "_backlog") if str(it.get("id")) == bid), None)
        if not item:
            raise HTTPException(status_code=404, detail="Backlog item not found")
        resp = payload.get("responsible_id") or api.BITRIX_DEFAULT_RESP
        created_by = api._bitrix_creator_id(m0, user)  # постановщик = РП; из тела — никогда
        b = await api.bx_create_task(code, payload.get("title") or item.get("title") or "Бэклог",
                                     payload.get("description") or item.get("description"),
                                     resp, payload.get("deadline"), created_by)
        if not b:
            raise HTTPException(status_code=502, detail="Bitrix24: создание задачи не удалось")

        def _mut(m):
            it = next((x for x in api._coll(m, "_backlog") if str(x.get("id")) == bid), None)
            if it is not None:
                it["bitrix24_task_id"] = b
            return {"bitrix24_task_id": b}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.delete("/projects/{pid}/backlog/{bid}/bitrix24-task")
    async def backlog_bitrix_delete(pid: str, bid: str, user: dict = Depends(api.rbac)):
        _, m0 = await api.load_meta(pid)
        item = next((it for it in api._coll(m0, "_backlog") if str(it.get("id")) == bid), None)
        if item and item.get("bitrix24_task_id"):
            await api.bx("tasks.task.delete", {"taskId": item["bitrix24_task_id"]})

            def _mut(m):
                it = next((x for x in api._coll(m, "_backlog") if str(x.get("id")) == bid), None)
                if it is not None:
                    it["bitrix24_task_id"] = None
                return {"id": bid}
            await api.with_meta_retry(pid, _mut)
        return {"data": {"id": bid}}

    @router.post("/admin/bitrix24/test-connection")
    async def bitrix_test(user: dict = Depends(api.require_owner)):
        url = api._bitrix_url()
        if not url:
            return {"data": {"connected": False, "error": "Bitrix-вебхук не настроен"}}
        d = await api.bx("profile")
        ok = bool(d and isinstance(d, dict) and "result" in d)
        host = url.split("/rest/")[0]
        owner = (d or {}).get("result", {}) if ok else {}
        return {"data": {"connected": ok, "url": host,
                         "owner": f"{owner.get('NAME','')} {owner.get('LAST_NAME','')}".strip() or None}}

    @router.post("/projects/{pid}/bitrix24/sync")
    async def bitrix_sync_project(pid: str, force: bool = False, user: dict = Depends(api.rbac)):
        """PULL статусов и фактических дат задач проекта из Bitrix (кнопка «Синхронизировать» +
        авто при открытии).
        Надёжнее ИСХОДЯЩЕГО вебхука Bitrix: тот шлёт события лишь по задачам, где владелец вебхука —
        участник, а участвует он далеко не во всех. Здесь мы САМИ спрашиваем tasks.task.get по нашим
        bitrix24_task_id: пользователю вебхука нужен доступ к задаче (у администратора портала он есть ко всем). Троттлинг
        15 мин НА СЕРВЕРЕ — переживает перезагрузки и нескольких пользователей; кнопка шлёт
        force=true в обход троттла."""
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")
        _, m = await api.load_meta(pid)
        last = m.get("bitrix_last_sync")
        if not force and last:
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last))).total_seconds()
                if age < 15 * 60:
                    return {"data": {"skipped": "throttled", "checked": 0, "updated": 0, "last_sync": last,
                                     "meetings_checked": 0, "meetings_unlinked": 0}}
            except ValueError:
                pass
        checked = updated = 0
        for t in await api.db.tasks_with_bitrix(pid):
            bid = t.get("bitrix24_task_id")
            if not bid:
                continue
            checked += 1
            # select ОБЯЗАН быть в UPPER_SNAKE: camelCase-имена Bitrix молча игнорирует и отдаёт
            # пустоту. А вот в ОТВЕТЕ ключи приходят camelCase — отсюда пара имён ниже.
            data, err = await api.bx_call(
                "tasks.task.get",
                {"taskId": int(bid), "select": ["ID", "STATUS", "DATE_START", "CLOSED_DATE"]})
            if err or not isinstance(data, dict):
                continue
            tk = (((data.get("result") or {}).get("task")) or {})
            raw = str(tk.get("status") or "")
            ours = BX_STATUS_TO_OURS.get(raw)
            # dict[str, Any], а не выведенный из литерала dict[str, str]: ниже кладём число.
            fields: dict[str, Any] = {}
            mark_bx = False
            # Статус: тот же echo-guard, что во входящем вебхуке (статус уже наш ИЛИ код в Bitrix —
            # наш собственный push). Гард висит ТОЛЬКО на статусе и больше не выбрасывает задачу
            # целиком: иначе фактические даты не приезжали бы ровно в типичном случае — РП перевёл
            # задачу в работу в портале, а стартовали её потом в Bitrix.
            if ours and not (t.get("status") == ours or (t.get("bx_status") or "") == raw):
                fields["status"] = ours
                if ours == "completed":
                    fields["progress"] = 100
                mark_bx = True
            # Фактические даты: эха у них не бывает (мы их в Bitrix не пушим, см. BX_PUSH_FIELDS),
            # поэтому гард им не нужен. Пустое из Bitrix НИКОГДА не пишем: null значит «не начата /
            # не закрыта», а у нас на этом месте может стоять дата, вбитая РП руками.
            for col, key_lc, key_uc in (("actual_start", "dateStart", "DATE_START"),
                                        ("actual_end", "closedDate", "CLOSED_DATE")):
                v = api._bx_date(tk.get(key_lc) if tk.get(key_lc) is not None else tk.get(key_uc))
                if v and v != (t.get(col) or None):
                    fields[col] = v
            # Статус 4 «Ожидает контроля» мы считаем завершением, но closedDate Bitrix заполняет
            # только при 5 «Завершена» — без этого зеркала правила роута (tasks_routes) задача
            # приезжала бы завершённой с пустым «Факт. конец». Реальная дата всегда побеждает.
            today = api._now_iso()[:10]
            if fields.get("status") in ("in_progress", "completed") and not (fields.get("actual_start") or t.get("actual_start")):
                fields["actual_start"] = today
            if fields.get("status") == "completed" and not (fields.get("actual_end") or t.get("actual_end")):
                fields["actual_end"] = today
            if not fields:
                continue
            await api.db.update_task(str(t["id"]), fields)   # напрямую, НЕ через роут — иначе кольцо
            if mark_bx:
                await api.db.set_task_bx_status(str(t["id"]), raw)
            await api._bx_log("task.pull", "ok", task_id=str(t["id"]), bx_task_id=int(bid))
            updated += 1
        # Совещания: сверяем, живы ли их события в календаре Bitrix. Раньше синхронизация трогала
        # ТОЛЬКО задачи, и событие, удалённое в Bitrix, оставалось помеченным в портале навсегда —
        # «синхронизировать» его не убирало, потому что синхронизация про него и не знала.
        rep = await api._reconcile_meeting_events(pid, m, user)
        stamp = api._now_iso()

        def _mut(mm):
            mm["bitrix_last_sync"] = stamp
            for mt in api._coll(mm, "_meetings"):
                if not isinstance(mt, dict):
                    continue
                mid = str(mt.get("id"))
                if mid in rep["gone"]:
                    eid = mt.get("bitrix_event_id")
                    for k in ("bitrix_event_id", "bitrix_event_owner", "bitrix_event_from"):
                        mt.pop(k, None)
                    api._log_action(mm, user, "meetings.bitrix_event_gone",
                                    f"{mt.get('title') or mid}: событие {eid} удалено в Bitrix")
                elif mid in rep["backfill_owner"]:
                    mt["bitrix_event_owner"] = rep["backfill_owner"][mid]
        await api.with_meta_retry(pid, _mut)
        return {"data": {"checked": checked, "updated": updated, "last_sync": stamp,
                         "meetings_checked": rep["checked"], "meetings_unlinked": len(rep["gone"])}}

    @router.get("/admin/bitrix24/sync-log")
    async def bitrix_sync_log(user: dict = Depends(api.require_owner)):
        """Журнал обмена с Bitrix24. Фронт опрашивал эту ручку каждые 30 с и получал 404 —
        секция настроек молча показывала «операций нет». Список всегда массив: клиент читает
        `r.data.data` без страховки, и null уронил бы страницу настроек."""
        return {"data": await api.db.fetch_bitrix_log(50)}

    @router.post("/webhooks/bitrix24")
    async def bitrix_webhook(request: Request):
        # Токен лежит В ТЕЛЕ формы, поэтому тело приходится прочесть до проверки. Читаем потоком
        # с потолком: у chunked-запроса Content-Length нет, и request.body() проглотил бы в память
        # всё, что пришлёт аноним, — и только потом выяснилось бы, что токен чужой.
        declared = request.headers.get("content-length") or ""
        if declared.isdigit() and int(declared) > _MAX_WEBHOOK_BODY:
            raise HTTPException(status_code=413, detail="Payload too large")
        buf = bytearray()
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > _MAX_WEBHOOK_BODY:
                raise HTTPException(status_code=413, detail="Payload too large")
        raw = bytes(buf).decode("utf-8", "ignore")
        form = {k: (v[0] if v else "") for k, v in urllib.parse.parse_qs(raw).items()}
        # Опциональная проверка подписи: если задан BITRIX24_INBOUND_TOKEN, вебхук обязан его прислать
        # (Bitrix кладёт application_token в исходящий вебхук). Пусто = проверка выключена (как раньше).
        if api.BITRIX_INBOUND_TOKEN:
            tok = form.get("auth[application_token]") or form.get("application_token") or ""
            # Байты, не str: compare_digest на str с не-ASCII бросает TypeError (был 500 вместо 403).
            if not hmac.compare_digest(tok.encode(), str(api.BITRIX_INBOUND_TOKEN).encode()):
                raise HTTPException(status_code=403, detail="Invalid webhook token")
        try:
            if form.get("event", "") not in ("ONTASKUPDATE", "ONTASKADD"):
                return {"result": "ok"}
            bid_raw = form.get("data[FIELDS_AFTER][ID]") or form.get("data[FIELDS_BEFORE][ID]") or ""
            raw_status = form.get("data[FIELDS_AFTER][STATUS]", "")
            ours = BX_STATUS_TO_OURS.get(raw_status)
            if not bid_raw.isdigit() or not ours:
                return {"result": "ok"}
            bid = int(bid_raw)
            # Совпадение с задачей — прямой поиск по колонке bitrix24_task_id (был перебор проектов).
            found = await api.db.task_by_bitrix(bid)
            if found:
                tid, pid = str(found["id"]), str(found["project_id"])
                # ── Защита от эхо-петли ──────────────────────────────────────────────
                # Наш push вызывает в Bitrix ONTASKUPDATE, и это событие прилетает сюда же.
                # Без защиты получилось бы кольцо. Два независимых рубежа:
                #  1) статус и так уже наш — писать нечего (заодно снимает лишний bump версии);
                #  2) код в Bitrix ровно тот, который мы сами туда положили (tasks.bx_status).
                #     Второй рубеж обязателен: маппинг статусов НЕ биекция — «отменена» и
                #     on_hold оба уезжают в «Отложена» (6), и по одному коду их не различить.
                #     Метка живёт в БД, а не в памяти — иначе она не пережила бы второй воркер.
                if found.get("status") == ours or (found.get("bx_status") or "") == raw_status:
                    return {"result": "ok", "matched": "task", "wp": tid, "skipped": "эхо/без изменений"}
                fields: dict = {"status": ours}
                if ours == "completed":
                    fields["progress"] = 100
                await api.db.update_task(tid, fields)
                # Теперь мы точно знаем, какой код стоит в Bitrix — запоминаем.
                await api.db.set_task_bx_status(tid, raw_status)
                await api._bx_log("task.inbound", "ok", task_id=tid, bx_task_id=bid)
                return {"result": "ok", "matched": "task", "wp": tid, "status": ours}
            # Ветка бэклога (bitrix id живёт в мете _backlog) — по-прежнему перебором проектов.
            for e in await api.fetch_projects():
                pid = str(e["id"])
                m = api._meta(e)
                bl = m.get("_backlog", []) or []
                if any(it.get("bitrix24_task_id") == bid for it in bl):
                    def _mut(m):
                        for it in m.get("_backlog", []):
                            if it.get("bitrix24_task_id") == bid:
                                it["status"] = _BL_STATUS.get(ours, it.get("status"))
                        return True
                    await api.with_meta_retry(pid, _mut)
                    return {"result": "ok", "matched": "backlog", "status": ours}
        except Exception as ex:  # noqa: BLE001
            api.logger.warning("Bitrix webhook обработка не удалась: %s", ex)
        return {"result": "ok"}

    @router.get("/admin/settings/bitrix")
    async def get_bitrix_settings(user: dict = Depends(api.require_owner)):
        return {"data": api._bitrix_settings_view()}

    @router.put("/admin/settings/bitrix")
    async def put_bitrix_settings(payload: dict, user: dict = Depends(api.require_owner)):
        """Задать/очистить Bitrix-вебхук из UI. Пустое значение → вернуться к env. Хранится шифрованным."""
        raw = (payload.get("webhook_url") or "").strip().rstrip("/")
        s = api._settings()
        if not raw:
            s.pop("bitrix_webhook", None)
            await api._save_settings(s)
            return {"data": api._bitrix_settings_view()}
        if not re.match(r"^https://[^/\s]+/rest/\d+/[A-Za-z0-9]+$", raw):
            raise HTTPException(status_code=422, detail="Ожидается вебхук вида https://<домен>/rest/<id>/<токен>/")
        s["bitrix_webhook"] = api._encrypt_secret(raw)
        await api._save_settings(s)
        return {"data": api._bitrix_settings_view()}

    return (router, backlog_bitrix_create, backlog_bitrix_delete, bitrix_test,
            bitrix_webhook, get_bitrix_settings, put_bitrix_settings)
