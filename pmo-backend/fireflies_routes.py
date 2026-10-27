"""Связка Fireflies: приём вебхука V2 и ручки владельца портала для очереди.

POST /webhooks/fireflies — публичный приёмник (Caddy пропускает /webhooks/* без среза). Только
проверяет подпись и ставит встречу в очередь fireflies_sync; вся работа (Fireflies, PMO, Битрикс)
— в воркере fireflies_sync.run_due. Ответ 2xx сразу: Fireflies ждёт его ≤30 с и повторяет при
5xx/429/сетевой ошибке до 5 раз — поэтому сбой БД отдаём как 5xx (пусть повторит), а прочие
4xx не повторяются.

Конфиг (FIREFLIES_*) и хелперы — через `api` (модуль main) во время вызова: монкейпатчи тестов
на main.* остаются в силе.
"""
import json
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import fireflies_sync as ffs

if TYPE_CHECKING:
    from pmo_api import PmoApi

# Настоящее тело V2 — пять коротких полей. 64 КиБ — с запасом на будущее, но не склад.
_MAX_BODY = 64 * 1024


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.post("/webhooks/fireflies")
    async def fireflies_webhook(request: Request):
        # Выключено или нет секрета — ручки «нет»: без подписи тело принимать нельзя вовсе.
        secret = api.FIREFLIES_WEBHOOK_SECRET
        if not (api.FIREFLIES_ENABLED and secret):
            raise HTTPException(status_code=404, detail="Not Found")
        declared = request.headers.get("content-length") or ""
        if declared.isdigit() and int(declared) > _MAX_BODY:
            raise HTTPException(status_code=413, detail="Payload too large")
        # СЫРЫЕ байты: подпись считается по ним, не по разобранному JSON. Читаем потоком с
        # потолком: у chunked-запроса Content-Length нет, и request.body() проглотил бы в память
        # всё, что пришлёт анонимный клиент, ещё до проверки подписи.
        buf = bytearray()
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > _MAX_BODY:
                raise HTTPException(status_code=413, detail="Payload too large")
        raw = bytes(buf)
        if not ffs.signature_ok(raw, request.headers.get("x-hub-signature"), secret):
            raise HTTPException(status_code=401, detail="Invalid signature")
        try:
            body = json.loads(raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid JSON") from None
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Invalid payload")
        event = body.get("event")
        if event != "meeting.summarized":
            return {"result": "ignored"}
        mid = body.get("meeting_id")
        if not isinstance(mid, str) or not ffs.MEETING_ID_RX.fullmatch(mid):
            raise HTTPException(status_code=400, detail="Invalid meeting_id")
        result = await api.db.fireflies_sync_receive(mid, event, body.get("reprocessed_at"), ffs.now_iso())
        api.logger.info("Fireflies webhook: встреча %s — %s", mid, result)
        return {"result": result}

    @router.get("/admin/fireflies/sync")
    async def fireflies_sync_list(status: Optional[str] = None, user: dict = Depends(api.require_owner)):
        """Очередь связки для владельца портала: id, статусы шагов, кандидаты. Текстов нет."""
        if status and status not in ffs.STATUSES:
            raise HTTPException(status_code=422, detail=f"status: одно из {', '.join(ffs.STATUSES)}")
        rows = await api.db.fireflies_sync_list(status or None, 200)
        return {"data": rows}

    @router.post("/admin/fireflies/sync/{meeting_id}/retry")
    async def fireflies_sync_retry(meeting_id: str, bitrix_reset: bool = False,
                                   user: dict = Depends(api.require_owner)):
        """Вернуть встречу в очередь со свежим счётчиком попыток (готовые шаги не повторяются).

        bitrix_reset=true — владелец проверил событие в Битриксе и комментария там НЕТ: шаг
        Битрикса, застрявший в 'posting' (исход вызова неизвестен), снова можно публиковать."""
        if not ffs.MEETING_ID_RX.fullmatch(meeting_id) or not await api.db.fireflies_sync_retry(
                meeting_id, ffs.now_iso(), reset_bitrix_posting=bool(bitrix_reset)):
            raise HTTPException(status_code=404, detail="Встреча не найдена в очереди")
        api.logger.info("Fireflies: ручной повтор встречи %s%s (%s)", meeting_id,
                        " со сбросом шага Битрикса" if bitrix_reset else "", user.get("email") or user.get("id"))
        row = await api.db.fireflies_sync_get(meeting_id)
        return {"data": row or {"meeting_id": meeting_id}}

    return router, fireflies_webhook, fireflies_sync_list, fireflies_sync_retry
