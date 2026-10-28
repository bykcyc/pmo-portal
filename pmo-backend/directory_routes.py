"""People directory: users list + persons CRUD + Bitrix import.

On the stable ``main`` facade. Every helper/state (rbac, current_user,
require_owner, USERS, _load_persons, _save_persons, _require_pm_role, _bitrix_url,
bx, _now_iso) resolves through ``api`` at call time, so shared/tested helpers stay
in ``main`` and response bytes are unchanged.
"""

import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/users")
    async def users(user: dict = Depends(api.rbac)):
        return [{"id": u["id"], "full_name": u["full_name"], "email": u.get("email")} for u in api.USERS.values()]

    @router.get("/persons")
    async def persons_list(q: str = "", user: dict = Depends(api.current_user)):
        persons = await api._load_persons()
        if q:
            ql = q.lower()
            persons = [p for p in persons if ql in (p.get("full_name") or "").lower()]
        return {"data": sorted(persons, key=lambda p: (p.get("full_name") or "").lower())}

    @router.post("/persons")
    async def persons_create(payload: dict, user: dict = Depends(api.current_user)):
        api._require_pm_role(user)
        first = str(payload.get("first_name") or "").strip()
        last = str(payload.get("last_name") or "").strip()
        if not first or not last:
            raise HTTPException(status_code=422, detail="Нужны first_name и last_name")
        full = f"{first} {last}"
        persons = await api._load_persons()
        if any((p.get("full_name") or "").casefold() == full.casefold() for p in persons):
            raise HTTPException(status_code=409, detail="Такой человек уже есть в справочнике")
        person = {"id": str(uuid.uuid4()), "first_name": first, "last_name": last, "full_name": full,
                  "bitrix24_id": payload.get("bitrix24_id"), "email": payload.get("email"),
                  "phone": payload.get("phone"), "position": payload.get("position"),
                  "created_at": api._now_iso(), "updated_at": api._now_iso()}
        persons.append(person)
        await api._save_persons(persons)
        return {"data": person}

    @router.put("/persons/{person_id}")
    async def persons_update(person_id: str, payload: dict, user: dict = Depends(api.current_user)):
        api._require_pm_role(user)
        persons = await api._load_persons()
        p = next((x for x in persons if str(x.get("id")) == person_id), None)
        if not p:
            raise HTTPException(status_code=404, detail="Человек не найден")
        for k in ("first_name", "last_name", "email", "phone", "position", "bitrix24_id"):
            if k in payload:
                p[k] = payload[k]
        # «Скрыть из пикеров» — РАЗРЕЖЁННОЕ поле: пишем только True, при снятии галочки удаляем
        # ключ. Не через общий цикл выше: тот записал бы и False, и тогда у каждого человека,
        # которого хоть раз тронули, документ отличался бы от нетронутых — а байты /persons
        # это голден-контракт. Ключ всегда дописывается в конец, порядок остальных не меняется.
        if "hidden_from_pickers" in payload:
            if payload["hidden_from_pickers"]:
                p["hidden_from_pickers"] = True
            else:
                p.pop("hidden_from_pickers", None)
        p["full_name"] = f"{(p.get('first_name') or '').strip()} {(p.get('last_name') or '').strip()}".strip()
        p["updated_at"] = api._now_iso()
        await api._save_persons(persons)
        return {"data": p}

    @router.delete("/persons/{person_id}")
    async def persons_delete(person_id: str, user: dict = Depends(api.current_user)):
        api._require_pm_role(user)
        persons = [x for x in await api._load_persons() if str(x.get("id")) != person_id]
        await api._save_persons(persons)
        return {"data": {"id": person_id}}

    @router.delete("/persons")
    async def persons_delete_all(user: dict = Depends(api.require_owner)):
        await api._save_persons([])
        return {"data": {"deleted": True}}

    @router.post("/persons/import-bitrix24")
    async def persons_import_bitrix(user: dict = Depends(api.current_user)):
        """Импорт сотрудников из Bitrix24. Тело переехало в `main.sync_bitrix_people()` — оно
        общее с ночной джобой, чтобы кнопка и расписание не разъезжались в поведении. Там же
        живут мягкая деактивация уволенных и связывание persons↔users."""
        api._require_write_role(user)
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")
        rep = await api.sync_bitrix_people()
        return {"data": {"imported": rep.get("imported", 0), "updated": rep.get("updated", 0),
                         "deactivated": rep.get("deactivated", 0), "reactivated": rep.get("reactivated", 0),
                         "linked": rep.get("linked", 0), "total_fetched": rep.get("fetched", 0),
                         "complete": rep.get("complete", False), "error": rep.get("error", ""),
                         # Синк гасит и входы уволенных — сообщение кнопки должно это назвать.
                         "logins_deactivated": rep.get("logins_deactivated", 0),
                         "logins_held": rep.get("logins_held", 0)}}

    return (router, users, persons_list, persons_create, persons_update,
            persons_delete, persons_delete_all, persons_import_bitrix)
