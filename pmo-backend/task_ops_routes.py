"""Task operations beyond basic CRUD: reorder, Bitrix24 task link, gantt-data,
task dependencies — on the stable ``main`` facade.

Every helper/state (rbac, load_meta, db, _task_in_project, _wp_in_project,
_wp_tasks, _compute_critical, _project_baselines, _bitrix_url, bx, bx_find_user,
bx_create_task, BITRIX_DEFAULT_RESP) resolves through ``api`` at call time, so
shared/tested helpers stay in ``main`` and response bytes are unchanged.
"""

import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Body, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.post("/projects/{pid}/tasks/reorder")
    async def tasks_reorder(pid: str, payload: list = Body(...), user: dict = Depends(api.rbac)):
        # Порядок/иерархия — колонки таблицы tasks: sort_order/wbs_code пишем всегда, parent_id — если прислан.
        # Сначала валидируем ВЕСЬ payload, затем пишем: чужой/битый id не должен оставлять частичный reorder.
        valid = await api.db.project_task_ids(pid)  # один запрос вместо N-2N (валидируем id в памяти)
        prepared = []
        for o in (payload or []):
            if not isinstance(o, dict) or o.get("id") in (None, ""):
                raise HTTPException(status_code=422, detail="Для reorder обязателен id задачи")
            tid = str(o["id"])
            if tid not in valid:
                raise HTTPException(status_code=404, detail="Task not found")
            fields = {"sort_order": o.get("sort_order"), "wbs_code": o.get("wbs_code")}
            if "parent_id" in o:
                parent_id = str(o["parent_id"]) if o.get("parent_id") else None
                if parent_id and parent_id not in valid:
                    raise HTTPException(status_code=404, detail="Parent task not found")
                fields["parent_id"] = int(parent_id) if parent_id else None
            prepared.append((tid, fields))

        # Петля: задача не может стать потомком самой себя. Перетаскивание на фронте такое
        # не предлагает, но проверять надо здесь: маршрут открыт напрямую и помощнику, а
        # зациклённая ветка выпала бы из дерева целиком — задачи есть в базе, а на экране их нет.
        moves = {tid: f["parent_id"] for tid, f in prepared if "parent_id" in f}
        if moves:
            parents = await api.db.project_task_parents(pid)
            parents.update({k: (str(v) if v is not None else None) for k, v in moves.items()})
            for tid in moves:
                seen, cur = {tid}, parents.get(tid)
                while cur:
                    if cur in seen:
                        raise HTTPException(status_code=422,
                                            detail="Задачу нельзя вложить в саму себя или в свою подзадачу")
                    seen.add(cur)
                    cur = parents.get(cur)

        await api.db.reorder_tasks(prepared)  # атомарно одной транзакцией (нет частичного reorder)
        return {"data": {"ok": True}}

    # ---------- Bitrix24: задача -> задача в Bitrix ----------
    @router.post("/projects/{pid}/tasks/{tid}/bitrix24-task")
    async def task_bitrix_create(pid: str, tid: str, payload: dict, user: dict = Depends(api.rbac)):
        if not await api._task_in_project(tid, pid):
            raise HTTPException(status_code=404, detail="Task not found")
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")
        _, m0 = await api.load_meta(pid)
        code = m0.get("code") or "PRJ"
        resp = payload.get("responsible_id") or await api.bx_find_user(payload.get("assignee_email")) or api.BITRIX_DEFAULT_RESP
        # Постановщик = РП (см. _bitrix_creator_id); присланный клиентом created_by_id не берём.
        # Ответственный (resp) остаётся исполнителем задачи.
        created_by = api._bitrix_creator_id(m0, user)
        bid = await api.bx_create_task(code, payload.get("title") or "Задача", payload.get("description"),
                                       resp, payload.get("deadline"), created_by)
        if not bid:
            raise HTTPException(status_code=502, detail="Bitrix24: создание задачи не удалось")

        await api.db.update_task(tid, {"bitrix24_task_id": bid})
        return {"data": {"bitrix24_task_id": bid}}

    @router.delete("/projects/{pid}/tasks/{tid}/bitrix24-task")
    async def task_bitrix_delete(pid: str, tid: str, user: dict = Depends(api.rbac)):
        if not await api._task_in_project(tid, pid):
            raise HTTPException(status_code=404, detail="Task not found")
        row = await api.db.get_task(tid)
        bid = api.db.task_extra([row]).get(tid, {}).get("bitrix24_task_id") if row else None
        if bid:
            await api.bx("tasks.task.delete", {"taskId": bid})
        await api.db.update_task(tid, {"bitrix24_task_id": None})
        return {"data": {"id": tid}}

    # ---------- gantt ----------
    @router.get("/projects/{pid}/gantt-data")
    async def gantt_data(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        wp_tasks = await api._wp_tasks(pid, m)
        deps = await api.db.fetch_deps(pid)  # формат элементов идентичен прежнему _coll(m,"_deps")
        critical = api._compute_critical(wp_tasks, deps)
        # baseline-overlay: последний снимок плана (id -> плановые даты), из БД
        bls = await api._project_baselines(pid, m)
        base_map = {str(b.get("id")): b for b in (bls[-1].get("tasks") or [])} if bls else {}
        tasks = []
        for t in wp_tasks:
            tid = str(t["id"])
            b = base_map.get(tid) or {}
            tasks.append({
                "id": t["id"], "text": t["title"], "wbs": t["wbs_code"] or "",
                "start_date": t["planned_start"], "end_date": t["planned_end"],
                "duration": t["duration_days"] or 0, "progress": round((t["progress"] or 0) / 100, 2),
                "parent": t["parent_id"] or 0, "type": t["task_type"], "open": True,
                "assignee_name": t["assignee_name"], "status": t["status"], "priority": t["priority"],
                "bar_color": t["bar_color"], "actual_start": t["actual_start"], "actual_end": t["actual_end"],
                "critical": tid in critical,
                "baseline_start": b.get("planned_start"), "baseline_end": b.get("planned_end"),
            })
        _TY = {"finish_to_start": "0", "start_to_start": "1", "finish_to_finish": "2", "start_to_finish": "3"}
        links = [{"id": str(d.get("id") or i), "source": str(d.get("depends_on_id")),
                  "target": str(d.get("task_id")), "type": _TY.get(d.get("dependency_type"), "0"),
                  "lag": d.get("lag_days") or 0} for i, d in enumerate(deps)]
        data = {"tasks": tasks, "links": links}
        if user.get("role") == "public":  # gantt-data достижим по ?share= (раздел wbs) — единая редакция PII
            data = api._redact_public(data)
        return {"data": data}

    @router.post("/projects/{pid}/task-dependencies")
    async def dep_create(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        tid, did = str(payload.get("task_id") or ""), str(payload.get("depends_on_id") or "")
        if not tid or not did:
            raise HTTPException(status_code=422, detail="task_id и depends_on_id обязательны")
        if tid == did:
            raise HTTPException(status_code=422, detail="Задача не может зависеть от самой себя")
        if not await api._task_in_project(tid, pid) or not await api._task_in_project(did, pid):
            raise HTTPException(status_code=404, detail="Обе задачи должны принадлежать проекту")
        # Связь с собственной фазой, цикл и дубль портал раньше принимал молча: стрелка на Ганте
        # рисовалась, а критический путь такую связь игнорировал — план выглядел посчитанным,
        # не будучи им. Проверка здесь, в единственном месте создания связи: сюда же приходят
        # и черновики помощника, и план нового проекта.
        _, m = await api.load_meta(pid)
        conflict = api.dep_conflict(await api._wp_tasks(pid, m), await api.db.fetch_deps(pid), tid, did)
        if conflict:
            raise HTTPException(status_code=422, detail=conflict)
        dep = {"id": str(uuid.uuid4()), "task_id": payload.get("task_id"),
               "depends_on_id": payload.get("depends_on_id"),
               "dependency_type": payload.get("dependency_type") or "finish_to_start",
               "lag_days": payload.get("lag_days") or 0}
        await api.db.insert_dep(pid, dep["id"], dep["task_id"], dep["depends_on_id"],
                                dep["dependency_type"], dep["lag_days"])
        return {"data": dep}

    @router.delete("/projects/{pid}/task-dependencies/{did}")
    async def dep_delete(pid: str, did: str, user: dict = Depends(api.rbac)):
        await api.db.delete_dep(pid, did)
        return {"data": {"id": did}}

    return (router, tasks_reorder, task_bitrix_create, task_bitrix_delete,
            gantt_data, dep_create, dep_delete)
