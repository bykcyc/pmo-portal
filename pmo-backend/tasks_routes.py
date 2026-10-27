"""Task CRUD (WBS) routes on the stable ``main`` facade.

Tasks are native work packages. Every helper/state (rbac, load_meta, db,
_validate_task_payload, _task_fields, _extra_fields, _EXTRA_KEYS, _wp_tasks,
_wp_to_task, _task_in_project, _log_action, with_meta_retry, _email_bg, _now_iso,
_workdays, _href_id, _STATUS_TITLE, _diff_detail, _fetch_wps, _levels,
TASK_TYPE_IDS) resolves through ``api`` at call time, so shared/tested helpers
(_log_action, _diff_detail, _validate_task_payload, _wp_to_task) stay in ``main``
and response bytes are unchanged.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/projects/{pid}/tasks")
    async def tasks_list(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        data = await api._wp_tasks(pid, m)
        if user.get("role") == "public":  # анонимный share: убрать assignee_email
            data = api._redact_public(data)
        return {"data": data}

    @router.post("/projects/{pid}/tasks")
    async def tasks_create(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_task_payload(payload)
        pp = payload.get("parent_id")  # родитель обязан быть задачей ЭТОГО проекта (как в reorder)
        if pp and not await api._task_in_project(str(pp), pid):
            raise HTTPException(status_code=404, detail="Parent task not found")
        # Исполнителя приводит к реестру людей СЕРВЕР (assignee_person_id/name/email — согласованы).
        fields = {**api._task_fields(payload, for_create=True), **api._extra_fields(payload, api._CLIENT_EXTRA_KEYS),
                  **await api._task_identity_fields(payload),
                  **await api._co_assignee_field(payload)}
        row = await api.db.insert_task(pid, fields)  # задача создаётся одним INSERT (база + сайдкар-колонки)
        wp = api.db.task_shim(row)
        wp["_extra"] = api.db.task_extra([row]).get(str(wp["id"]), {})
        wpid = str(wp["id"])

        # Журнал — append-only (не бампает version → нет ложного 409 против правки паспорта).
        await api._append_action_log(pid, user, "task.create", str(payload.get("title") or wpid)[:80])
        # Уведомление о назначении (best-effort; outbox, если SMTP не настроен).
        # Адрес берём из ЭФФЕКТИВНЫХ полей задачи, а не из payload: PersonPicker шлёт только
        # person_id, а email выводит сервер. Читая payload, письмо не уходило НИКОГДА.
        ae = (wp.get("_extra") or {}).get("assignee_email")
        if ae:
            _, m = await api.load_meta(pid)
            code = m.get("code") or "PRJ"
            api._email_bg(ae, f"PM Tool: вам назначена задача [{code}]",
                          f"Задача: {payload.get('title')}\nПроект: {code}\n"
                          f"Срок: {payload.get('planned_end') or '—'}")
        return {"data": api._wp_to_task(wp, {wpid: wp["_extra"]}, pid, 0, 0)}

    @router.put("/projects/{pid}/tasks/{tid}")
    async def tasks_update(pid: str, tid: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_task_payload(payload)
        if not await api._task_in_project(tid, pid):
            raise HTTPException(status_code=404, detail="Task not found")
        pp = payload.get("parent_id")  # нельзя перепривязать к задаче другого проекта
        if pp and not await api._task_in_project(str(pp), pid):
            raise HTTPException(status_code=404, detail="Parent task not found")
        cur = await api.db.get_task(tid)
        if not cur:
            raise HTTPException(status_code=404, detail="Task not found")
        cur_wp = api.db.task_shim(cur)
        cur_ext = api.db.task_extra([cur]).get(tid, {})
        ident = await api._task_identity_fields(payload)  # сервер приводит исполнителя к реестру людей
        # Соисполнители опознаются тем же реестром. Ответственного берём из ident, а если правка
        # его не трогает — из текущей строки: иначе человек, уже назначенный ответственным, мог
        # бы попасть ещё и в соисполнители и числиться в задаче дважды.
        co = await api._co_assignee_field({**payload,
                                           "assignee_person_id": ident.get("assignee_person_id")
                                           if ident else cur_ext.get("assignee_person_id")})
        fields = {**api._task_fields(payload, for_create=False, current_type=cur.get("task_type") or ""),
                  **api._extra_fields(payload, api._CLIENT_EXTRA_KEYS), **ident, **co}
        # Авто-даты факта по статусу: задача пошла в работу → actual_start, завершена → actual_end
        # (если пользователь не проставил их сам). Пишем в те же extra-колонки одним UPDATE.
        st = payload.get("status")
        today = api._now_iso()[:10]
        new_as = payload.get("actual_start", cur_ext.get("actual_start"))
        new_ae = payload.get("actual_end", cur_ext.get("actual_end"))
        if st in ("in_progress", "completed") and not new_as:
            fields["actual_start"] = new_as = today
        if st == "completed" and not new_ae:
            fields["actual_end"] = new_ae = today
        # Авто-часы факта: таймшитов нет, при завершении выводим из факт-дат (раб. дни × 8ч).
        if st == "completed" and not payload.get("actual_hours") and not cur_ext.get("actual_hours"):
            wd = api._workdays(new_as, new_ae)
            if wd:
                fields["actual_hours"] = wd * 8
        row = await api.db.update_task(tid, fields)  # задача пропатчена одним UPDATE
        wp = api.db.task_shim(row)
        wp["_extra"] = api.db.task_extra([row]).get(tid, {})
        # журнал: старые значения — из cur (extra-колонки + WP-поля до правки)
        # По КЛИЕНТСКОМУ списку: номер задачи Bitrix маршрут не пишет (api._CLIENT_EXTRA_KEYS),
        # и в журнале не должно появляться «bitrix24_task_id: 4821→99999» о записи, которой не было.
        old = {k: cur_ext.get(k) for k in api._CLIENT_EXTRA_KEYS}
        _sid = api._href_id(cur_wp.get("_links", {}), "status")
        old.update({
            "title": cur_wp.get("subject"),
            "planned_start": cur_wp.get("startDate"), "planned_end": cur_wp.get("dueDate"),
            "progress": cur_wp.get("percentageDone"),
            "status": api._STATUS_TITLE.get(int(_sid) if _sid and str(_sid).isdigit() else 0),
        })
        # Журнал сравниваем по ЭФФЕКТИВНЫМ полям: PersonPicker шлёт только person_id, а в журнале
        # человеку важно ИМЯ исполнителя. Сам UUID из человекочитаемого журнала исключаем.
        eff = {**payload, **ident}
        _keys = [k for k in eff if k in old and k != "assignee_person_id"]
        parts = api._diff_parts(old, eff, _keys)
        diff = "; ".join(parts)[:160]
        if diff:  # append-only журнал (без бампа version → нет ложного 409 против паспорта)
            await api._append_action_log(pid, user, "task.update",
                                         f"«{str(cur_wp.get('subject') or tid)[:40]}»: {diff}")
            # История САМОЙ задачи (вкладка «История» в карточке). До этого туда попадали
            # только комментарии, поэтому у задачи, которую двигали и переназначали месяц,
            # история была пустой. Пишем те же изменения, но построчно и с автором.
            try:
                await api.db.insert_activity(pid, tid, None, details=parts,
                                             user_title=user.get("full_name") or user.get("email"))
            except Exception:  # история — не причина завалить сохранение задачи
                pass
        ex = wp.get("_extra", {})
        # Письмо НОВОМУ исполнителю: раньше о назначении узнавали только при создании задачи,
        # а переназначение проходило молча — человек не знал, что работа теперь на нём.
        new_ae = ex.get("assignee_email")
        if new_ae and str(new_ae) != str(cur_ext.get("assignee_email") or ""):
            _, m = await api.load_meta(pid)
            code = m.get("code") or "PRJ"
            api._email_bg(new_ae, f"PM Tool: вам назначена задача [{code}]",
                          f"Задача: {wp.get('subject') or tid}\nПроект: {code}\n"
                          f"Срок: {ex.get('planned_end') or wp.get('dueDate') or '—'}")
        # письмо о смене дедлайна (best-effort, async): если planned_end изменился
        if "planned_end" in payload:
            old_due, new_due = cur_wp.get("dueDate"), payload.get("planned_end")
            ae = ex.get("assignee_email") or payload.get("assignee_email")
            if ae and str(new_due or "") != str(old_due or ""):
                _, m = await api.load_meta(pid)
                code = m.get("code") or "PRJ"
                api._email_bg(ae, f"PM Tool: изменён срок задачи [{code}]",
                              f"Задача: {wp.get('subject') or payload.get('title') or tid}\n"
                              f"Новый срок: {new_due or '—'} (был {old_due or '—'})")
        out = api._wp_to_task(wp, {tid: wp["_extra"]}, pid, await api._task_level(wp, pid), 0)
        # Правку — обратно в Bitrix (раньше связь была односторонней: задача уезжала туда при
        # создании и больше не обновлялась НИКОГДА). Только для связанных задач и только
        # изменившиеся поля. Строго fire-and-forget: чужой сервер думает до 15 с, а сохранение
        # задачи не имеет права на него ждать и тем более падать из-за его недоступности.
        #
        # `changed` считаем по КАНОНИЧЕСКИМ значениям: «до» приводим тем же _wp_to_task, что и
        # «после». Прежний код сравнивал наш ключ статуса с английским титулом OpenProject
        # (in_progress != "In progress") и не имел description в «до» вовсе — из-за этого push
        # срабатывал на КАЖДОМ сохранении задачи и продавливал статус в Bitrix даже без изменений.
        bx_id = (wp.get("_extra") or {}).get("bitrix24_task_id")
        cur_wp["_extra"] = cur_ext
        before = api._wp_to_task(cur_wp, {tid: cur_ext}, pid, 0, 0)
        changed = {k for k in api.BX_PUSH_FIELDS if str(before.get(k) or "") != str(out.get(k) or "")}
        if bx_id and changed and api._bitrix_url():
            _, m = await api.load_meta(pid)
            api._bx_bg(api.bx_push_task(tid, int(bx_id), m.get("code") or "PRJ", out, changed))
        # F4.2: свой каскад авто-планирования — сдвиг предшественника двигает последователей на ту
        # же дельту (в бесплатной сборке dhtmlx авто-планирования нет). `before`/`out` дают старые/
        # новые даты. Фронт после PUT инвалидирует ['gantt'] → сдвинутые задачи перерисуются.
        if "planned_start" in payload or "planned_end" in payload:
            delta = (api._iso_delta(out.get("planned_start"), before.get("planned_start"))
                     or api._iso_delta(out.get("planned_end"), before.get("planned_end")))
            if delta:
                await api._cascade_shift_successors(pid, tid, delta)
        return {"data": out}

    @router.delete("/projects/{pid}/tasks/{tid}")
    async def tasks_delete(pid: str, tid: str, user: dict = Depends(api.rbac)):
        if not await api._task_in_project(tid, pid):
            raise HTTPException(status_code=404, detail="Task not found")
        await api.db.delete_wp("tasks", tid)  # каскадно чистит deps/activities/attachments задачи
        await api._append_action_log(pid, user, "task.delete", tid)  # append-only, без бампа version
        return {"data": {"id": tid}}

    return router, tasks_list, tasks_create, tasks_update, tasks_delete
