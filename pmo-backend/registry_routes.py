"""Реестр проектов переходного периода — только для руководителя портфеля.

Зачем он есть. Портал живёт рядом с Excel: часть проектов уже заведена, а часть существует
только в голове и в таблице владельца. Пока идёт перенос, портфель показывает половину картины,
и по нему нельзя ни спросить, ни отчитаться. Реестр закрывает эту дыру: строка заводится руками
как «болванка», а когда РП действительно создаст проект в портале, владелец привязывает строку
к нему — и дальше данные берутся живые, из проекта, а не из памяти.

Почему отдельной таблицей, а не «пустыми проектами». Пустой проект без РП засоряет портфель всем,
включая самих РП, ломает счётчики и требует прав на удаление. Реестр видит один человек, он
не участвует в расчётах портфеля и исчезает целиком, когда таблица пустеет.

Помощнику (MCP) реестр НЕ отдаётся: это личный рабочий список владельца на время перехода.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException

_TEXT_LIMIT = 400


def _clean(data: dict) -> dict:
    """Обрезаем строки: поля заполняются вручную, а хранить сюда роман незачем."""
    out = {}
    for k, v in (data or {}).items():
        if k in ("pm_name", "name", "kind", "rag", "customer", "phase", "note"):
            out[k] = (str(v).strip()[:_TEXT_LIMIT] if v is not None else None)
        elif k in ("project_id", "sort_order"):
            out[k] = v
    return out


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/portfolio/registry")
    async def registry_list(user: dict = Depends(api.require_owner)):
        """Реестр + живые данные привязанных проектов.

        Живое берём из той же сборки, что и дашборд портфеля (`_portfolio_row`), — иначе цифры
        в реестре разойдутся с цифрами на соседнем экране, и верить будет нечему.
        """
        rows = await api.db.fetch_registry()
        linked = {r["project_id"] for r in rows if r["project_id"]}
        live: dict = {}
        if linked:
            for p in (await api.portfolio(user=user))["data"]:
                if str(p.get("id")) in linked:
                    live[str(p["id"])] = {
                        "id": str(p["id"]), "code": p.get("code"), "name": p.get("name"),
                        # Ключ в строке портфеля — rag_status; наружу отдаём как rag, чтобы
                        # реестр и портфель говорили об одном и том же одним словом.
                        "status": p.get("status"), "rag": p.get("rag_status"), "progress": p.get("progress"),
                        "pm_name": p.get("pm_name"), "planned_end": p.get("planned_end"),
                        "overdue_tasks_count": p.get("overdue_tasks_count"),
                    }
        out = []
        for r in rows:
            # Ссылка есть, а проекта нет (удалили) — говорим об этом прямо, а не показываем
            # болванку молча: иначе владелец будет считать проект заведённым.
            r["live"] = live.get(r["project_id"] or "")
            r["link_broken"] = bool(r["project_id"] and not r["live"])
            out.append(r)
        return {"data": out}

    @router.post("/portfolio/registry")
    async def registry_create(payload: dict, user: dict = Depends(api.require_owner)):
        data = _clean(payload)
        if not (data.get("name") or "").strip():
            raise HTTPException(status_code=422, detail="Название проекта обязательно")
        return {"data": await api.db.insert_registry(data, api._now_iso())}

    @router.put("/portfolio/registry/{rid}")
    async def registry_update(rid: str, payload: dict, user: dict = Depends(api.require_owner)):
        data = _clean(payload)
        if "name" in data and not (data["name"] or "").strip():
            raise HTTPException(status_code=422, detail="Название проекта обязательно")
        if data.get("project_id"):
            # Привязываем только к существующему проекту: опечатка в id иначе даст вечную
            # «болванку со ссылкой», которую не отличить от незаведённого проекта.
            el = await api.db.get_project_row(str(data["project_id"]))
            if not el:
                raise HTTPException(status_code=404, detail="Такого проекта в портале нет")
        row = await api.db.update_registry(rid, data, api._now_iso())
        if not row:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        return {"data": row}

    @router.delete("/portfolio/registry/{rid}")
    async def registry_delete(rid: str, user: dict = Depends(api.require_owner)):
        if not await api.db.delete_registry(rid):
            raise HTTPException(status_code=404, detail="Строка не найдена")
        return {"data": {"id": str(rid)}}

    return router, registry_list, registry_create, registry_update, registry_delete
