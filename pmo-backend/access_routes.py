"""Запрос доступа наблюдателем: человек просит, руководитель проекта решает.

Зачем это есть. «Мои задачи» намеренно показывают элементы из ВСЕХ проектов — как участник
я вижу свои задачи даже там, где проект мне не открыт. До сих пор человек упирался в замочек
и шёл искать руководителя в чате. Теперь он просит прямо оттуда.

Кто решает — `_can_decide_access`: РП проекта, его со-РП и (запасным путём) владелец портфеля.
Кого УВЕДОМЛЯЕМ — уже, только `_leads_project`: владельцу портфеля незачем получать запросы по
всем чужим проектам, среди которых потеряются свои.

Со-РП решает, хотя ручная выдача наблюдателей (`POST /projects/{pid}/observers`) ему по-прежнему
закрыта. Разница осмысленная: здесь он отвечает на КОНКРЕТНУЮ просьбу конкретного человека, а
там раздаёт доступ по своему усмотрению.

Маршруты НЕ проектные (`/access-requests`, а не `/projects/{pid}/…`): автор запроса по
определению не имеет доступа к проекту, и `rbac` отказал бы ему раньше, чем он успел бы
попросить. Та же причина, по которой отдельно живут problem_reports и project_drafts.
"""

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException

# Пауза после ОТКАЗА. Сам запрос не истекает — он ждёт решения сколько угодно.
#
# Без паузы «отклонить» ничего не значит: человек нажимает снова через минуту, и руководитель
# получает тот же запрос, пока не сдастся. Сутки — слишком мало с другой стороны: отказ
# превращается в ежедневную просьбу. Отказ должен что-то значить, поэтому пауза — два месяца.
REJECT_COOLDOWN_HOURS = 24 * 60   # часов = 60 суток
NOTE_MAX = 500


def build_router(api: "PmoApi"):
    router = APIRouter()

    async def _decidable_project_ids(user: dict) -> list:
        """Проекты, по которым ЭТОТ человек вправе решать — РП и со-РП.

        Владелец портфеля сюда НЕ попадает по роли, хотя решить может (`_can_decide_access`):
        иначе список входящих у него состоял бы из чужих проектов, и свои в нём терялись.
        """
        ids = []
        for el in await api.fetch_projects(with_docs=False):
            if api._leads_project(user, api._meta(el)):
                ids.append(str(el.get("id")))
        return ids

    def _view(req: dict, projects: dict) -> dict:
        """Запрос + человекочитаемый проект. Имя проекта нужно и просителю, и решающему:
        по одному коду ни тот ни другой не поймёт, о чём речь."""
        p = projects.get(str(req["project_id"])) or {}
        return {**req, "project_code": p.get("code"), "project_name": p.get("name"),
                "pm_name": p.get("pm_name")}

    @router.get("/access-requests")
    async def access_requests_list(user: dict = Depends(api.current_user)):
        """Что мне решать и что я сам отправил — одним запросом.

        Два списка вместо двух маршрутов: они всегда нужны вместе (страница «Мои задачи»
        показывает состояние моих просьб, а колокольчик — входящие), а проекты для подписей
        читаются одной выборкой на оба.
        """
        mine = await api.db.fetch_access_requests(requester_id=str(user.get("id")), only_open=False, limit=50)
        decidable = await _decidable_project_ids(user)
        incoming = await api.db.fetch_access_requests(project_ids=decidable, only_open=True)
        wanted = {str(r["project_id"]) for r in mine} | {str(r["project_id"]) for r in incoming}
        projects = {}
        if wanted:
            for el in await api.db.fetch_project_rows_by_ids(list(wanted)):
                p = api.to_project(el)
                projects[str(p["id"])] = p
        return {"data": {"incoming": [_view(r, projects) for r in incoming],
                         "outgoing": [_view(r, projects) for r in mine]}}

    @router.post("/access-requests")
    async def access_request_create(payload: dict, user: dict = Depends(api.current_user)):
        """Попросить доступ наблюдателем к проекту, который сейчас закрыт."""
        pid = str(payload.get("project_id") or "").strip()
        if not pid:
            raise HTTPException(status_code=422, detail="Нужен project_id проекта")
        note = str(payload.get("note") or "").strip()[:NOTE_MAX]
        el = await api.db.get_project_row(pid)
        if not el:
            raise HTTPException(status_code=404, detail="Проект не найден")
        p = api.to_project(el)
        m = api._meta(el)
        # Просить то, что уже открыто, бессмысленно — и запрос повис бы у РП навсегда.
        if user.get("role") in api.READ_ALL_ROLES or api._can_read_item(user, p):
            raise HTTPException(status_code=422, detail="Проект уже доступен вам")
        if m.get("_is_template") or m.get("_archived"):
            raise HTTPException(status_code=422, detail="Проект недоступен для запросов")
        last = await api.db.last_access_decision(pid, str(user.get("id")))
        if last and last.get("status") == "rejected" and last.get("decided_at"):
            try:
                since = datetime.now(timezone.utc) - datetime.fromisoformat(str(last["decided_at"]))
                if since < timedelta(hours=REJECT_COOLDOWN_HOURS):
                    left = timedelta(hours=REJECT_COOLDOWN_HOURS) - since
                    days = max(1, int(left.total_seconds() // 86400))
                    raise HTTPException(
                        status_code=429,
                        detail=f"Запрос по этому проекту отклонён. Повторить можно через {days} дн.")
            except ValueError:
                pass    # кривая дата в старой записи не должна запирать человека навсегда
        created = await api.db.insert_access_request(
            pid, str(user.get("id")), user.get("full_name"), user.get("email"),
            note or None, api._now_iso())
        if created is None:
            raise HTTPException(status_code=409, detail="Запрос уже отправлен и ждёт решения")
        # В журнал проекта: РП должен видеть в истории, откуда взялся наблюдатель.
        await api._append_action_log(pid, user, "access.request",
                                     f"{user.get('full_name') or user.get('email')}: запрос доступа")
        return {"data": _view(created, {str(p["id"]): p})}

    async def _load_for_decision(rid: str, user: dict):
        req = await api.db.get_access_request(rid)
        if not req:
            raise HTTPException(status_code=404, detail="Запрос не найден")
        el = await api.db.get_project_row(req["project_id"])
        if not el:
            raise HTTPException(status_code=404, detail="Проект не найден")
        if not api._can_decide_access(user, api._meta(el)):
            raise HTTPException(status_code=403,
                                detail="Решать запрос может руководитель проекта или его со-руководитель")
        return req, el

    @router.post("/access-requests/{rid}/approve")
    async def access_request_approve(rid: str, user: dict = Depends(api.current_user)):
        """Подтвердить: человек становится наблюдателем проекта — одним действием.

        Порядок важен. Сначала ЗАКРЫВАЕМ запрос условным апдейтом (он же и защита от двойного
        решения), и только потом выдаём доступ. Наоборот было бы хуже: доступ выдан, а закрыть
        запрос не удалось — и второй нажавший выдал бы его ещё раз.
        """
        req, el = await _load_for_decision(rid, user)
        who = user.get("full_name") or user.get("email") or ""
        if not await api.db.decide_access_request(rid, "approved", who, api._now_iso()):
            raise HTTPException(status_code=409, detail="Запрос уже решён")
        pid = str(req["project_id"])
        uid = str(req["requester_id"])

        def _mut(m):
            obs = [str(x) for x in (m.get("_observers") or [])]
            if uid not in obs and uid != str(m.get("pm_id") or "") \
                    and uid not in [str(x) for x in (m.get("_editors") or [])]:
                obs.append(uid)
                api._log_action(m, user, "project.observer_add",
                                f"{req.get('requester_name') or uid} (по запросу)")
            m["_observers"] = obs
            return {"observers": [api._editor_view(x) for x in obs]}
        await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after, uid)
        return {"data": {"id": str(rid), "status": "approved"}}

    @router.post("/access-requests/{rid}/reject")
    async def access_request_reject(rid: str, user: dict = Depends(api.current_user)):
        """Отклонить. Повторить просьбу можно будет через два месяца — см. REJECT_COOLDOWN_HOURS."""
        req, _el = await _load_for_decision(rid, user)
        who = user.get("full_name") or user.get("email") or ""
        if not await api.db.decide_access_request(rid, "rejected", who, api._now_iso()):
            raise HTTPException(status_code=409, detail="Запрос уже решён")
        await api._append_action_log(str(req["project_id"]), user, "access.reject",
                                     f"{req.get('requester_name') or req['requester_id']}: отказано")
        return {"data": {"id": str(rid), "status": "rejected"}}

    return (router, access_requests_list, access_request_create,
            access_request_approve, access_request_reject)
