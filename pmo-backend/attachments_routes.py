"""Work-package activity, comments and attachment routes on the stable ``main`` facade.

Handlers resolve all mutable state and helpers through ``api`` at call time, so the
single ``main.*`` monkeypatch point (rbac internals, db layer, IDOR guards, upload
helpers) stays valid and response bytes are unchanged.
"""

import re
import urllib.parse
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/projects/{pid}/work-packages/{wpid}/activity")
    async def wp_activity(pid: str, wpid: str, user: dict = Depends(api.rbac)):
        if not await api._wp_in_project(wpid, pid):
            raise HTTPException(status_code=404, detail="Задача не найдена в проекте")  # анти-IDOR
        out = []
        for a in await api.db.fetch_activities(wpid):
            # user = user_title (у мигрированных = null); автор реально в префиксе '**Имя:** ' comment
            out.append({"id": a["id"],
                        "user": a["user"],
                        "comment": a["comment"],
                        "details": [x for x in (a["details"] or []) if x],
                        "created_at": a["created_at"], "version": a["version"]})
        return {"data": out}

    @router.post("/projects/{pid}/work-packages/{wpid}/activity")
    async def wp_comment(pid: str, wpid: str, payload: dict, user: dict = Depends(api.rbac)):
        if not await api._wp_in_project(wpid, pid):
            raise HTTPException(status_code=404, detail="Задача не найдена в проекте")  # анти-IDOR
        text = (payload.get("comment") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Пустой комментарий")
        # Автор в тексте комментария префиксом (формат записи не меняем — совместимость истории).
        author = user.get("full_name") or user.get("email")
        d = await api.db.insert_activity(pid, wpid, f"**{author}:** {text}", author_name=author)
        # @mentions: уведомляем упомянутых (@логин = local-part email). Dry-run, если SMTP не настроен.
        mentioned = set()
        for handle in re.findall(r"@([\w.\-]+)", text):
            for em in api.USERS:
                if em.split("@")[0].lower() == handle.lower():
                    mentioned.add(em)
        for em in mentioned:
            if em != user.get("email"):
                api._email_bg(em, "PM Tool: вас упомянули в комментарии",
                              f"{user.get('full_name') or user.get('email')} упомянул(а) вас:\n\n{text}")
        return {"data": {"id": d["id"], "created_at": d["created_at"], "mentioned": sorted(mentioned)}}

    @router.get("/projects/{pid}/work-packages/{wpid}/attachments")
    async def wp_attachments(pid: str, wpid: str, user: dict = Depends(api.rbac)):
        if not await api._wp_in_project(wpid, pid):
            raise HTTPException(status_code=404, detail="Задача не найдена в проекте")
        return {"data": [{"id": a["id"], "file_name": a["file_name"],
                          "size": a["file_size"], "content_type": a["content_type"] or "",
                          "author": a["author"],
                          "created_at": a["created_at"]} for a in await api.db.fetch_attachments(wpid)]}

    @router.post("/projects/{pid}/work-packages/{wpid}/attachments")
    async def wp_attachment_upload(pid: str, wpid: str, request: Request,
                                   file: UploadFile = File(...), user: dict = Depends(api.rbac)):
        if not await api._wp_in_project(wpid, pid):
            raise HTTPException(status_code=404, detail="Задача не найдена в проекте")
        fname = api._safe_filename(file.filename)
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        if ext not in api._ALLOWED_ATT_EXT:
            raise HTTPException(status_code=415, detail=f"Тип файла .{ext or '?'} не разрешён")
        # Ранний отказ по Content-Length (с запасом на multipart framing), затем обязательная потоковая отсечка.
        try:
            if int(request.headers.get("content-length") or 0) > api._MAX_ATTACHMENT_BYTES + api._UPLOAD_CHUNK_BYTES:
                raise HTTPException(status_code=413, detail="Файл больше 25 МБ")
        except ValueError:
            pass
        try:
            content = await api._read_upload_limited(file)
        finally:
            await file.close()
        if len(content) > api._MAX_ATTACHMENT_BYTES:  # защитный инвариант на случай замены reader
            raise HTTPException(status_code=413, detail="Файл больше 25 МБ")
        content_type = "application/octet-stream" if ext == "svg" else (file.content_type or "application/octet-stream")
        a = await api.db.insert_attachment(pid, wpid, fname, content_type,
                                           content, user.get("full_name") or user.get("email"))
        return {"data": {"id": a["id"], "file_name": a["file_name"], "size": a["file_size"]}}

    @router.get("/projects/{pid}/attachments/{aid}/content")
    async def wp_attachment_download(pid: str, aid: str, user: dict = Depends(api.rbac)):
        if not await api._attachment_in_project(aid, pid):
            raise HTTPException(status_code=404, detail="Вложение не найдено")
        a = await api.db.get_attachment(aid)
        if not a:
            raise HTTPException(status_code=404, detail="Вложение не найдено")
        fn = a["file_name"]
        data = bytes(a["data"])

        async def _body():
            yield data
        cd = f"attachment; filename=\"{fn}\"; filename*=UTF-8''{urllib.parse.quote(fn)}"
        return StreamingResponse(_body(), media_type=a["content_type"] or "application/octet-stream",
                                 headers={"Content-Disposition": cd})

    @router.delete("/projects/{pid}/attachments/{aid}")
    async def wp_attachment_delete(pid: str, aid: str, user: dict = Depends(api.rbac)):
        if not await api._attachment_in_project(aid, pid):
            raise HTTPException(status_code=404, detail="Вложение не найдено")
        await api.db.delete_attachment(aid)
        return {"data": {"id": aid}}

    return (router, wp_activity, wp_comment, wp_attachments,
            wp_attachment_upload, wp_attachment_download, wp_attachment_delete)
