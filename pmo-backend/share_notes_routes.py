"""Public share and entity-notes routes on the stable ``main`` facade.

Handlers resolve state/helpers through ``api`` at call time (rbac, current_user,
load_meta, with_meta_retry, _share_cfg, _owns_item, _find_share,
_public_project_view, _log_action, _coll, _now_iso, _SHARE_KEY), so the shared
and tested helpers stay in ``main`` and response bytes are unchanged.
"""

import secrets
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/projects/{pid}/share")
    async def share_get(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        cfg = api._share_cfg(m)
        # Токен = анонимный доступ к опубликованным разделам. Отдаём его только тем, кто может
        # управлять шарингом (ведущий РП/со-РП/owner); обычному читателю/viewer — без токена.
        if cfg.get("token") and not api._is_primary_pm_or_owner(user, m):
            cfg = {**cfg, "token": ""}
        return {"data": cfg}

    @router.post("/projects/{pid}/share")
    async def share_set(pid: str, payload: dict, user: dict = Depends(api.current_user)):
        # Публиковать/править видимость может владелец проекта (pm-owner/со-РП) или owner-админ.
        # Не-owner обязан быть write-способным (pm): разжалованный в viewer с прежним pm_id/editors
        # не должен крутить публичную ссылку (зеркало _is_primary_pm_or_owner).
        _, m0 = await api.load_meta(pid)
        if user.get("role") != "owner" and not (user.get("role") in api.WRITE_ROLES and api._owns_item(user, m0)):
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        enabled = bool(payload.get("enabled"))
        sections = [str(s) for s in (payload.get("sections") or [])]

        def _mut(m):
            cur = m.get(api._SHARE_KEY) or {}
            token = cur.get("token") or secrets.token_urlsafe(16)
            # S6: при переходе выключено→включено выдаём НОВЫЙ токен, чтобы «отозванная» выключением
            # ссылка не воскресала при повторном включении.
            if enabled and not cur.get("enabled"):
                token = secrets.token_urlsafe(16)
            m[api._SHARE_KEY] = {"enabled": enabled, "token": token, "sections": sections}
            api._log_action(m, user, "share.update",
                            f"{'включён' if enabled else 'выключен'} · разделов: {len(sections)}")
            return m[api._SHARE_KEY]
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/public/{token}")
    async def public_project(token: str):
        """Резолв публичной ссылки → заголовок проекта + список опубликованных разделов.
        БЕЗ авторизации. Сами данные разделов публичная страница тянет обычными эндпоинтами
        с ?share=<token> (их авторизует rbac, скоуп — только опубликованные разделы)."""
        el, m = await api._find_share(token)
        if not el:
            raise HTTPException(status_code=404, detail="Ссылка недоступна")
        return {"data": {"project": api._public_project_view(el, m), "sections": api._share_cfg(m)["sections"]}}

    @router.get("/projects/{pid}/notes/{etype}/{eid}")
    async def notes_list(pid: str, etype: str, eid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        notes = [n for n in api._coll(m, "_notes") if n.get("entity_type") == etype and str(n.get("entity_id")) == eid]
        return {"data": notes}

    @router.post("/projects/{pid}/notes/{etype}/{eid}")
    async def note_add(pid: str, etype: str, eid: str, payload: dict, user: dict = Depends(api.rbac)):
        note = {"id": str(uuid.uuid4()), "project_id": pid, "entity_type": etype,
                "entity_id": eid, "content": payload.get("content") or "", "author_id": user.get("id"),
                "author_name": user.get("full_name"), "created_at": api._now_iso()}

        def _mut(m):
            note["project_id"] = m.get("_src_id") or pid
            notes = api._coll(m, "_notes")
            notes.append(note)
            m["_notes"] = notes
            return note
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.delete("/projects/{pid}/notes/{nid}")
    async def note_delete(pid: str, nid: str, user: dict = Depends(api.rbac)):
        def _mut(m):
            m["_notes"] = [n for n in api._coll(m, "_notes") if str(n.get("id")) != nid]
            return {"id": nid}
        return {"data": await api.with_meta_retry(pid, _mut)}

    return router, share_get, share_set, public_project, notes_list, note_add, note_delete
