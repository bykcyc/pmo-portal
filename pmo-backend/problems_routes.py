"""«Сообщить о проблеме» (F6): любой залогиненный пользователь шлёт баг-репорт со скриншотом
текущей страницы; владелец портфеля видит список и удаляет. Хранилище — таблица problem_reports
(schema.sql), доступ — db.* хелперы. Все helpers/state резолвятся через ``api`` (стабильный
main-фасад) на вызове, чтобы monkeypatch-точки тестов оставались валидны."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

_MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024   # 8 МБ на PNG — с запасом; html2canvas на scale:1 сильно меньше


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.post("/problems")
    async def problem_create(request: Request, description: str = Form(...),
                             page_url: str = Form(""), screenshot: UploadFile = File(None),
                             user: dict = Depends(api.current_user)):
        """Создать баг-репорт. Любой залогиненный (не только owner). Скриншот опционален."""
        desc = (description or "").strip()
        if not desc:
            raise HTTPException(status_code=422, detail="Опишите проблему")
        shot = shot_type = None
        if screenshot is not None:
            try:
                shot = await api._read_upload_limited(screenshot)
            finally:
                await screenshot.close()
            if len(shot) > _MAX_SCREENSHOT_BYTES:
                raise HTTPException(status_code=413, detail="Скриншот больше 8 МБ")
            shot_type = screenshot.content_type or "image/png"
        rid = await api.db.insert_problem(
            user.get("email") or "", user.get("full_name"), desc[:5000],
            (page_url or "")[:1000], (request.headers.get("user-agent") or "")[:500],
            shot, shot_type, api._now_iso())
        return {"data": {"id": str(rid)}}

    @router.get("/problems")
    async def problems_list(user: dict = Depends(api.require_owner)):
        """Список репортов — только владельцу портфеля. БЕЗ бинарника скрина (метаданные + флаг).

        Состояние (`status` и три поля ответа) отдаётся вместе со списком. Раньше ответ
        собирался руками из восьми полей, а база отдавала двенадцать: плашка «Решено» на
        экране владельца не появлялась НИКОГДА, а кнопка «Отметить решённой» висела и на уже
        закрытых — повторный клик получал 409. Тип на фронте эти поля объявлял с самого начала.
        """
        rows = await api.db.fetch_problems(200)
        return {"data": [{"id": str(r["id"]), "reporter_email": r["reporter_email"],
                          "reporter_name": r["reporter_name"], "description": r["description"],
                          "page_url": r["page_url"], "user_agent": r["user_agent"],
                          "has_screenshot": bool(r["has_screenshot"]),
                          "created_at": r["created_at"],
                          "status": r.get("status") or "open",
                          "resolution": r.get("resolution"),
                          "resolved_at": r.get("resolved_at"),
                          "resolved_by": r.get("resolved_by")} for r in rows]}

    @router.get("/problems/{rid}/screenshot")
    async def problem_screenshot(rid: str, user: dict = Depends(api.require_owner)):
        got = await api.db.get_problem_screenshot(rid)
        if not got:
            raise HTTPException(status_code=404, detail="Скриншот не найден")
        data, ctype = got

        async def _body():
            yield bytes(data)
        return StreamingResponse(_body(), media_type=ctype or "image/png")

    @router.post("/problems/{rid}/resolve")
    async def problem_resolve(rid: str, payload: dict, user: dict = Depends(api.require_owner)):
        """Отметить проблему решённой — и сказать об этом тому, кто её прислал.

        Удалять репорт вместо этого нельзя: удаление молча уносит и саму жалобу, и возможность
        ответить. Автор узнаёт о решении в колокольчике (см. portfolio_routes.attention).
        """
        note = str(payload.get("resolution") or "").strip()[:500]
        who = user.get("full_name") or user.get("email") or ""
        if not await api.db.resolve_problem(rid, note or None, who, api._now_iso()):
            raise HTTPException(status_code=409, detail="Сообщение уже отмечено решённым")
        return {"data": {"id": str(rid), "status": "resolved"}}

    @router.delete("/problems/{rid}")
    async def problem_delete(rid: str, user: dict = Depends(api.require_owner)):
        await api.db.delete_problem(rid)
        return {"data": {"id": str(rid)}}

    return router, problem_create, problems_list, problem_screenshot, problem_delete
