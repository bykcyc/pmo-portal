"""Risk-register routes on the stable ``main`` facade.

Risks are native work packages (type Risk); handlers resolve every helper/state
through ``api`` at call time (rbac, load_meta, _wp_risks, _validate_risk_payload,
_wp_to_risk, _risk_in_project, _extra_fields, _diff_detail, _log_action,
with_meta_retry, _now_iso, db, _RISK_EXTRA_KEYS), so the tested/shared helpers stay
in ``main`` and response bytes are unchanged.
"""

import json
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/projects/{pid}/risks")
    async def risks_list(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        data = await api._wp_risks(pid, m)
        if user.get("role") == "public":  # анонимный share: убрать author_id апдейтов и любой контактный PII
            data = api._redact_public(data)
        return {"data": data}

    @router.post("/projects/{pid}/risks")
    async def risks_create(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_risk_payload(payload)
        ext = {k: payload.get(k) for k in api._RISK_EXTRA_KEYS}
        ext["probability"] = ext.get("probability") or "medium"
        ext["impact"] = ext.get("impact") or "medium"
        ext["status"] = ext.get("status") or "open"
        if not ext.get("code"):
            # авто-код R-NN: раньше code никогда не присваивался (ни при импорте, ни руками) —
            # реестр и матрица показывали обрезки названий. Следующий свободный номер по рискам проекта.
            used = set()
            for r in await api.db.fetch_risks(pid):
                c = r["code"]
                if isinstance(c, str) and c.upper().startswith("R-"):
                    try:
                        used.add(int(c.split("-", 1)[1]))
                    except ValueError:
                        pass
            n = 1
            while n in used:
                n += 1
            ext["code"] = f"R-{n:02d}"
        fields = {"title": (payload.get("title") or "Новый риск")[:255], **ext,
                  "updates": json.dumps([], ensure_ascii=False)}
        if payload.get("description"):
            fields["description"] = payload["description"]
        row = await api.db.insert_risk(pid, fields)  # риск создаётся одним INSERT (база + сайдкар-колонки)
        wp = api.db.risk_shim(row)
        wp["_extra"] = api.db.risk_extra([row]).get(str(wp["id"]), {})

        # append-only журнал (без бампа version → нет ложного 409 против правки паспорта)
        await api._append_action_log(pid, user, "risk.create",
                                     f"{ext.get('code') or ''} {payload.get('title') or ''}".strip()[:80])
        return {"data": api._wp_to_risk(wp, {str(wp["id"]): wp["_extra"]}, pid)}

    @router.put("/projects/{pid}/risks/{rid}")
    async def risks_update(pid: str, rid: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_risk_payload(payload)
        if not await api._risk_in_project(rid, pid):
            raise HTTPException(status_code=404, detail="Risk not found")
        cur = await api.db.get_risk(rid)
        if not cur:
            raise HTTPException(status_code=404, detail="Risk not found")
        cur_wp = api.db.risk_shim(cur)
        cur_ext = api.db.risk_extra([cur]).get(rid, {})
        fields: dict = {}
        if "title" in payload:
            fields["title"] = (payload.get("title") or "")[:255]
        if "description" in payload:
            fields["description"] = payload.get("description") or ""
        fields.update(api._extra_fields(payload, api._RISK_EXTRA_KEYS))
        row = await api.db.update_risk(rid, fields)  # риск пропатчен одним UPDATE
        wp = api.db.risk_shim(row)
        wp["_extra"] = api.db.risk_extra([row]).get(rid, {})
        old = {k: cur_ext.get(k) for k in api._RISK_EXTRA_KEYS}
        old["title"] = cur_wp.get("subject")
        diff = api._diff_detail(old, payload, [k for k in payload if k in old])
        if diff:  # append-only журнал (без бампа version)
            await api._append_action_log(pid, user, "risk.update", f"{wp['_extra'].get('code') or rid}: {diff}")
        return {"data": api._wp_to_risk(wp, {rid: wp["_extra"]}, pid)}

    @router.delete("/projects/{pid}/risks/{rid}")
    async def risks_delete(pid: str, rid: str, user: dict = Depends(api.rbac)):
        if not await api._risk_in_project(rid, pid):
            raise HTTPException(status_code=404, detail="Risk not found")
        cur = await api.db.get_risk(rid)
        gone_code = api.db.risk_extra([cur]).get(rid, {}).get("code") if cur else None
        await api.db.delete_wp("risks", rid)  # каскадно чистит activities/attachments риска
        await api._append_action_log(pid, user, "risk.delete", str(gone_code or rid))  # append-only
        return {"data": {"id": rid}}

    @router.post("/projects/{pid}/risks/{rid}/updates")
    async def risk_update_add(pid: str, rid: str, payload: dict, user: dict = Depends(api.rbac)):
        if not await api._risk_in_project(rid, pid):
            raise HTTPException(status_code=404, detail="Risk not found")
        upd = {"id": str(uuid.uuid4()), "risk_id": rid, "update_text": payload.get("update_text") or "",
               "author_id": user.get("id"), "created_at": api._now_iso()}
        cur = await api.db.get_risk(rid)
        ups = (api.db.risk_extra([cur]).get(rid, {}).get("updates") or []) if cur else []
        ups.append(upd)
        await api.db.update_risk(rid, {"updates": json.dumps(ups, ensure_ascii=False)})
        return {"data": upd}

    @router.delete("/projects/{pid}/risks/{rid}/updates/{uid}")
    async def risk_update_del(pid: str, rid: str, uid: str, user: dict = Depends(api.rbac)):
        if not await api._risk_in_project(rid, pid):
            raise HTTPException(status_code=404, detail="Risk not found")
        cur = await api.db.get_risk(rid)
        ups = (api.db.risk_extra([cur]).get(rid, {}).get("updates") or []) if cur else []
        ups = [u for u in ups if str(u.get("id")) != uid]
        await api.db.update_risk(rid, {"updates": json.dumps(ups, ensure_ascii=False)})
        return {"data": {"id": uid}}

    return (router, risks_list, risks_create, risks_update, risks_delete,
            risk_update_add, risk_update_del)
