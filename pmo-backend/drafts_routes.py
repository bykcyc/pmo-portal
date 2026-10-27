"""Черновики от помощника: список, просмотр, правка выбора, приём и отклонение.

Черновик — единственный способ, которым внешний помощник может изменить или удалить что-либо
в СУЩЕСТВУЮЩЕМ проекте. Создание нового проекта идёт напрямую (ломать нечего), всё остальное —
только сюда, и применяется лишь после того, как человек нажал «Принять» в портале.

Как и остальные модули, резолвит хелперы через `api` на вызове — точки монкейпатча в `main`
остаются валидными.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException

import draft_apply

# Сколько живёт нерешённый черновик. Дальше — уборка: иначе они копятся и мешают увидеть свежий.
DRAFT_TTL_DAYS = 14


def build_router(api: "PmoApi"):
    router = APIRouter()

    async def _owns_project(user: dict, pid) -> bool:
        """Владение проектом по его id. `_owns_item` работает с МЕТОЙ проекта и синхронный —
        поэтому мету надо сначала прочитать; отдельной логики прав тут нет и быть не должно."""
        if not pid:
            return False
        try:
            _el, m = await api.load_meta(str(pid))
        except Exception:  # noqa: BLE001 — проекта нет: доступа тоже нет
            return False
        return bool(api._owns_item(user, m))

    async def _visible(user: dict, d: dict) -> bool:
        """Черновик виден автору и тем, кто имеет доступ к его проекту.

        Для черновика нового проекта (project_id пуст) — только автору и владельцу портала:
        проекта, по которому считать права, ещё не существует.
        """
        if str(d.get("author") or "") == str(user.get("email") or ""):
            return True
        if user.get("role") == "owner":
            return True
        return await _owns_project(user, d.get("project_id"))

    async def _mine(user: dict, d: dict) -> bool:
        """Черновик, который ждёт решения ИМЕННО ЭТОГО человека: он автор или ведёт проект.

        Отличается от `_visible` ровно ролью: владелец портфеля вправе открыть и принять любой
        черновик, но в СПИСКЕ у него должны быть свои. Иначе пункт меню показывает чужие
        просьбы по чужим проектам, и счётчик перестаёт что-либо значить.
        """
        if str(d.get("author") or "") == str(user.get("email") or ""):
            return True
        return await _owns_project(user, d.get("project_id"))

    @router.get("/drafts")
    async def drafts_list(user: dict = Depends(api.current_user)):
        """Черновики, которые ждут МЕНЯ: мои и по моим проектам. Отсюда же счётчик в меню."""
        rows = await api.db.fetch_drafts(status="open")
        out = []
        for d in rows:
            if not await _mine(user, d):
                continue
            out.append({"id": str(d["id"]),
                        "project_id": (str(d["project_id"]) if d.get("project_id") else None),
                        "author": d["author"], "source": d["source"], "title": d["title"],
                        "status": d["status"], "created_at": d["created_at"],
                        "counts": draft_apply.summary(d)})
        return {"data": out}

    async def _titles(pid) -> dict:
        """id элемента → его название в проекте. Нужно, чтобы строка «изменить» показывала имя,
        а не «#551»: помощник присылает только изменяемые поля, названия среди них может не быть."""
        out: dict = {}
        if not pid:
            return out
        try:
            _el, m = await api.load_meta(str(pid))
        except Exception:  # noqa: BLE001 — проект исчез: покажем то, что прислал помощник
            return out
        for row in (await api._wp_tasks(str(pid), m)) + (await api._wp_risks(str(pid), m)):
            if row.get("id") is not None and row.get("title"):
                out[str(row["id"])] = str(row["title"])
        for coll in draft_apply._COLL_BY_SECTION.values():
            for row in (m.get(coll) or []):
                if isinstance(row, dict) and row.get("id") is not None:
                    name = row.get("title") or row.get("name") or row.get("full_name") or row.get("article")
                    if name:
                        out[str(row["id"])] = str(name)
        return out

    @router.get("/drafts/{did}")
    async def draft_get(did: str, user: dict = Depends(api.current_user)):
        d = await api.db.get_draft(did)
        if not d or not await _visible(user, d):
            raise HTTPException(status_code=404, detail="Черновик не найден")
        titles = await _titles(d.get("project_id"))
        items = []
        for it in (d.get("items") or []):
            tid = it.get("target_id")
            # Кладём ОТДЕЛЬНЫМ полем, а не в data: data применяется к проекту, и подмешанное
            # туда название стало бы правкой, которой человек не просил.
            items.append({**it, "target_title": titles.get(str(tid))} if tid and titles.get(str(tid)) else it)
        return {"data": {**d, "items": items, "id": str(d["id"]),
                         "project_id": (str(d["project_id"]) if d.get("project_id") else None),
                         "counts": draft_apply.summary(d)}}

    @router.patch("/drafts/{did}")
    async def draft_patch(did: str, payload: dict, user: dict = Depends(api.current_user)):
        """Правка перед приёмом: снять галочку, поменять значение, дописать срок.

        Человек правит именно черновик, а не проект: до «Принять» в проекте не меняется ничего.
        """
        d = await api.db.get_draft(did)
        if not d or not await _visible(user, d):
            raise HTTPException(status_code=404, detail="Черновик не найден")
        if d.get("status") != "open":
            raise HTTPException(status_code=409, detail="Черновик уже закрыт")
        incoming = {str(x.get("id")): x for x in (payload.get("items") or []) if isinstance(x, dict)}
        items = []
        for it in d["items"]:
            patch = incoming.get(str(it.get("id")))
            if patch:
                if "selected" in patch:
                    it["selected"] = bool(patch["selected"])
                if isinstance(patch.get("data"), dict):
                    it["data"] = {**(it.get("data") or {}), **patch["data"]}
            items.append(it)
        await api.db.update_draft_items(did, items)
        return {"data": {"id": str(did), "counts": draft_apply.summary({"items": items})}}

    @router.post("/drafts/{did}/accept")
    async def draft_accept(did: str, user: dict = Depends(api.current_user)):
        """Принять отмеченное. Применяет сервер — он знает порядок и ловушки портала.

        В журнале действий проекта остаётся «принял такой-то», а не «изменено помощником»:
        ответственность за содержание несёт человек, нажавший кнопку.
        """
        d = await api.db.get_draft(did)
        if not d or not await _visible(user, d):
            raise HTTPException(status_code=404, detail="Черновик не найден")
        if d.get("status") != "open":
            raise HTTPException(status_code=409, detail="Черновик уже закрыт")
        pid = d.get("project_id")
        if not pid:
            raise HTTPException(status_code=409,
                                detail="Это черновик нового проекта — его создаёт помощник, принимать нечего")
        if user.get("role") != "owner" and not await _owns_project(user, pid):
            raise HTTPException(status_code=403, detail="Принять может только руководитель проекта")

        report = await draft_apply.apply_draft(api, str(pid), d, user)
        ok = await api.db.decide_draft(did, "accepted", user.get("email") or "", api._now_iso(), report)
        if not ok:                                  # кто-то принял его параллельно, пока мы применяли
            raise HTTPException(status_code=409, detail="Черновик уже закрыт")
        await api._append_action_log(str(pid), user, "draft.accept",
                                     f"принято {len(report['created']) + len(report['updated'])}, "
                                     f"не удалось {len(report['failed'])}")
        return {"data": {"id": str(did), "status": "accepted", "report": report}}

    @router.post("/drafts/{did}/reject")
    async def draft_reject(did: str, user: dict = Depends(api.current_user)):
        d = await api.db.get_draft(did)
        if not d or not await _visible(user, d):
            raise HTTPException(status_code=404, detail="Черновик не найден")
        ok = await api.db.decide_draft(did, "rejected", user.get("email") or "", api._now_iso(), None)
        if not ok:
            raise HTTPException(status_code=409, detail="Черновик уже закрыт")
        return {"data": {"id": str(did), "status": "rejected"}}

    return router, drafts_list, draft_get, draft_patch, draft_accept, draft_reject
