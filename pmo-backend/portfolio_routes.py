"""Portfolio, analytics, capacity, cross-project search, attention digest,
calendar (iCal) and admin digests — on the stable ``main`` facade.

Read-mostly aggregators. Every helper/state (rbac, require_owner, fetch_projects,
to_project, _can_read_item, _meta, _accessible_projects, _fetch_wps_bulk,
_tasks_from_wps, _risks_from_wps, _portfolio_row, _coll, _load_snapshots,
_take_portfolio_snapshot, _workload_from_tasks, load_meta, _wp_tasks, _ics_esc,
_run_leadership_digest, _run_digests, mailer, TASK_TYPE_IDS, RISK_TYPE_ID, TYPE_ID,
READ_ALL_ROLES, db) resolves through ``api`` at call time, so shared/tested
helpers stay in ``main`` and response bytes are unchanged.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, Response


def build_router(api: "PmoApi"):
    router = APIRouter()

    # Портфель открыт всем, кто ведёт проекты (решение владельца): гард
    # `require_portfolio_view` пускает owner, exec и pm. Что человек увидит, решает НЕ гард,
    # а скоуп-фильтры внутри хендлеров — для owner они по-прежнему ничего не отсекают, а РП
    # оставляют его проекты, его со-РП-шные и те, где он наблюдатель.
    @router.get("/portfolio/dashboard")
    async def portfolio(status: str = "", priority: str = "", pm_id: str = "", kind: str = "",
                        include_archived: bool = False, user: dict = Depends(api.require_portfolio_view)):
        projs = []
        for el in await api.fetch_projects(user=user):
            p = api.to_project(el)
            if p["code"].startswith("__"):
                continue
            # ЧТЕНИЕ — значит `_can_read_item`, а не `_owns_item`: иначе портфель РП молча
            # терял бы проекты, где он наблюдатель, хотя в списке проектов они у него есть.
            if user.get("role") not in api.READ_ALL_ROLES and not api._can_read_item(user, p):
                continue
            if (status and p["status"] != status) or (priority and p["priority"] != priority):
                continue
            if pm_id and p["pm_id"] != pm_id and pm_id not in (p.get("editors") or []):
                continue  # фильтр «РП» находит и проекты, где пользователь — со-руководитель
            if kind and (p.get("project_kind") or "") != kind:
                continue
            m = api._meta(el)
            if m.get("_is_template") or (m.get("_archived") and not include_archived):
                continue  # шаблоны и (по умолчанию) архив не в портфеле
            projs.append((p, m))
        today_s = datetime.now(timezone.utc).date().isoformat()
        pids = [p["id"] for p, _ in projs]
        wps_by_pid, rwps_by_pid, bl_store = await asyncio.gather(
            api._fetch_wps_bulk(pids, api.TASK_TYPE_IDS),
            api._fetch_wps_bulk(pids, [api.RISK_TYPE_ID]),
            api.db.load_latest_baselines(),
        )
        rows = [api._portfolio_row(
            p, m,
            api._tasks_from_wps(wps_by_pid.get(p["id"], []), m, p["id"]),
            api._risks_from_wps(rwps_by_pid.get(p["id"], []), m, p["id"]),
            bl_store, today_s,
        )
                for p, m in projs]
        # Вторым проходом: у строки зонтика — сколько его блоков израсходовали подпроекты.
        # Только для показа, ни в один итог не входит (иначе деньги ребёнка посчитались бы
        # дважды — у него и у родителя).
        api._apply_budget_consumption(rows, projs)
        stats = {"total": 0, "planning": 0, "active": 0, "on_hold": 0, "completed": 0, "cancelled": 0,
                 "overdue": 0, "red": 0, "amber": 0, "green": 0}
        for r in rows:
            stats["total"] += 1
            if r["status"] in ("planning", "active", "on_hold", "completed", "cancelled"):
                stats[r["status"]] += 1
            if r["overdue_tasks_count"] > 0:
                stats["overdue"] += 1  # по той же логике, что строки: у закрытых просрочка уже обнулена
            stats[r["rag_status"]] = stats.get(r["rag_status"], 0) + 1
        return {"data": rows, "stats": stats}

    # ---------- attention digest (что требует внимания) ----------
    @router.get("/attention")
    async def attention(days: int = 7, user: dict = Depends(api.rbac)):
        today_s = datetime.now(timezone.utc).date().isoformat()
        soon_s = (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()
        # «Застой» — только если задача в работе с 0% БОЛЬШЕ НЕДЕЛИ. Свежая in_progress с 0% — норма
        # (только начали), поэтому порог: плановый старт был раньше, чем неделю назад.
        week_ago_s = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
        groups: dict = {"overdue": [], "due_soon": [], "no_dates": [], "stalled": [], "meetings": [],
                        "actions": [], "access": [], "access_decided": [], "problem_resolved": []}
        # Скоуп — общая витрина `_accessible_projects` (она же у портфеля и «Моих задач»).
        # Раньше колокол ходил своим путём и НЕ исключал архив и шаблоны: портфель их прятал,
        # а уведомления по ним продолжали капать. Один источник правды — один охват.
        # with_docs=True: группам «совещания» и «поручения» нужны нормализованные коллекции.
        projs = [(p, m) for p, m in await api._accessible_projects(user, with_docs=True)
                 if p["status"] not in ("completed", "cancelled")]
        wps_by_pid = await api._fetch_wps_bulk([p["id"] for p, _ in projs], api.TASK_TYPE_IDS)
        for p, m in projs:
            pid, code = p["id"], p["code"]
            # Веду проект — отвечаю за всё, что в нём происходит, и колокол по нему мой.
            # Не веду — уведомляю ТОЛЬКО о том, что назначено на меня.
            #
            # Раньше охват колокола был «всё, что я могу прочитать». Для руководителя проекта
            # это одно и то же, а вот владельцу портфеля и руководству компании (роли owner и
            # exec читают все проекты) падали уведомления по каждой задаче каждого проекта
            # компании — среди них своих было не найти. Наблюдателю точно так же капало по
            # чужому проекту, который он просто смотрит. Кросс-проектный срез называется
            # Портфель, и он никуда не делся; колокол — личный.
            leads = api._leads_project(user, m)
            for tk in api._tasks_from_wps(wps_by_pid.get(pid, []), m, pid):
                if tk.get("task_type") == "phase":
                    continue
                if not leads and not api._my_task_match(user, tk):
                    continue
                st = tk.get("status")
                pe = tk.get("planned_end")
                base = {"project_id": pid, "project_code": code, "section": "wbs", "id": tk["id"],
                        "title": tk.get("title"), "assignee": tk.get("assignee_name"),
                        "planned_end": pe, "status": st, "priority": tk.get("priority")}
                # Отменённая задача не «просрочена» и не «без дат»: её никто не будет делать.
                # Раньше здесь стояло только != "completed", и колокол требовал внимания
                # к отменённому — причём дайджест на ту же задачу отвечал иначе.
                open_task = st not in ("completed", "cancelled")
                if open_task and pe and str(pe) < today_s:
                    groups["overdue"].append(base)
                elif open_task and pe and today_s <= str(pe) <= soon_s:
                    groups["due_soon"].append(base)
                elif open_task and not tk.get("planned_start") and not pe:
                    groups["no_dates"].append(base)
                ps = tk.get("planned_start")
                if st == "in_progress" and (tk.get("progress") or 0) == 0 and ps and str(ps) < week_ago_s:
                    groups["stalled"].append(base)
            for mt in api._coll(m, "_meetings"):
                # Совещание — моё, если я его участник (тот же матч, что в «Моих задачах»).
                mine_meeting = leads or api._my_attendee_match(user, mt)
                md = mt.get("next_meeting_date") or mt.get("meeting_date")
                if mine_meeting and md and today_s <= str(md) <= soon_s:
                    groups["meetings"].append({"project_id": pid, "project_code": code, "section": "meetings",
                                               "id": mt.get("id"), "title": mt.get("title") or mt.get("subject") or "Meeting", "date": md})
                for ai_i, ai in enumerate(mt.get("action_items") or mt.get("actions") or []):
                    # Поручение — моё, если оно на меня и записано. Имя тут свободный текст,
                    # person_id у поручений нет, поэтому матч по имени и почте — как везде.
                    mine_action = leads or api._mine_name(user, ai.get("assignee_name"))                         or api._mine_email(user, ai.get("assignee_email"))
                    due = ai.get("due_date")
                    if mine_action and due and (ai.get("status") not in ("done", "completed")) and str(due) <= soon_s:
                        # Стабильный id: у вложенных поручений своего id нет. Без него на фронте
                        # ключ уведомления был «meetings:null» — общий на ВСЕ поручения, и клик
                        # по одному гасил разом все (и подсчёт уникальных их схлопывал в одно).
                        aid = ai.get("id") or f"{mt.get('id')}#act{ai_i}"
                        groups["actions"].append({"project_id": pid, "project_code": code, "section": "meetings",
                                                  "id": aid, "title": ai.get("text") or ai.get("title") or "Action",
                                                  "due_date": due, "overdue": str(due) < today_s})
        # Запросы доступа — единственная группа, которая берётся НЕ из проектов, а из своей
        # таблицы: её автор к проекту доступа не имеет, значит через `_accessible_projects` она
        # не прошла бы никогда. И единственная, по которой можно ДЕЙСТВОВАТЬ: `kind` говорит
        # фронту открыть форму решения вместо перехода в раздел проекта.
        # Уведомляем того, кто ВЕДЁТ проект (РП и со-РП). Владелец портфеля решить может, но
        # получать запросы по чужим проектам ему незачем: своих среди них не найти.
        decidable = {str(p["id"]): p for p, m in projs if api._leads_project(user, m)}
        if decidable:
            for r in await api.db.fetch_access_requests(project_ids=list(decidable), only_open=True):
                pr = decidable.get(str(r["project_id"])) or {}
                groups["access"].append({
                    "kind": "access_request", "request_id": r["id"],
                    "project_id": r["project_id"], "project_code": pr.get("code") or "",
                    "project_name": pr.get("name") or "",
                    "section": "access", "id": r["id"],
                    "title": r.get("requester_name") or r.get("requester_email") or r["requester_id"],
                    "note": r.get("note"), "created_at": r.get("created_at")})

        # Ответ просителю. Без него человек отправлял просьбу в тишину: подтверждение он ещё
        # замечал по появившемуся проекту, а отказ не узнавал никогда и спрашивал снова.
        # Отдаём решения за последние две недели — «прочитано» отмечает сам колокольчик.
        since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        mine = await api.db.fetch_access_requests(requester_id=str(user.get("id")), only_open=False, limit=50)
        fresh = [r for r in mine if r.get("status") != "open" and str(r.get("decided_at") or "") >= since]
        if fresh:
            names = {}
            for el in await api.db.fetch_project_rows_by_ids([r["project_id"] for r in fresh]):
                pp = api.to_project(el)
                names[str(pp["id"])] = pp
            for r in fresh:
                pp = names.get(str(r["project_id"])) or {}
                groups["access_decided"].append({
                    "kind": "access_decision", "request_id": r["id"], "status": r["status"],
                    "project_id": r["project_id"], "project_code": pp.get("code") or "",
                    "project_name": pp.get("name") or "",
                    "section": "access_decided", "id": r["id"],
                    "title": pp.get("name") or pp.get("code") or "",
                    "decided_by": r.get("decided_by"), "created_at": r.get("decided_at")})
        # «Ваша проблема решена» — ответ тому, кто нажал «Сообщить о проблеме». Поток был
        # односторонним: человек писал и больше ничего об этом не слышал, даже когда чинили в
        # тот же день. Две недели — столько же, сколько у ответа на запрос доступа.
        for pr in await api.db.fetch_problems_by_reporter(str(user.get("email") or "")):
            if pr.get("status") != "resolved" or str(pr.get("resolved_at") or "") < since:
                continue
            groups["problem_resolved"].append({
                "kind": "problem_resolved", "report_id": str(pr["id"]),
                "project_id": "", "project_code": "", "section": "problem_resolved",
                "id": str(pr["id"]), "title": str(pr.get("description") or "")[:120],
                "note": pr.get("resolution"), "decided_by": pr.get("resolved_by"),
                "page_url": pr.get("page_url"), "created_at": pr.get("resolved_at")})

        counts = {k: len(v) for k, v in groups.items()}
        # total — по УНИКАЛЬНЫМ сущностям. Просроченная задача, которая ещё и стоит на месте,
        # попадает и в overdue, и в stalled: сумма длин групп считала её дважды, и бейдж на
        # колокольчике врал. Ключ тот же, что у фронта (section:id) — счётчик и список сходятся.
        seen: set = set()
        for key in ("overdue", "due_soon", "stalled", "meetings", "actions", "access",
                    "access_decided", "problem_resolved"):
            for it in groups[key]:
                seen.add(f"{it.get('section')}:{it.get('id')}")
        counts["total"] = len(seen)
        for k in groups:
            groups[k] = groups[k][:50]
        return {"data": groups, "counts": counts}

    # ---------- мои задачи (кросс-проектно) ----------
    @router.get("/me/tasks")
    async def my_tasks(user: dict = Depends(api.rbac)):
        """Задачи, назначенные НА МЕНЯ. Раньше фильтра по исполнителю не было вовсе — раздел
        отдавал ВСЕ задачи всех доступных проектов, то есть был вторым списком WBS.
        Скоуп проектов — общая витрина `_accessible_projects` (без шаблонов и архива:
        архивные задачи сюда протекали). Закрытые проекты по-прежнему не засоряют раздел.
        Следствие для РПП: его «Мои задачи» пусты, пока задачи не назначены на него —
        это правильно, его кросс-проектный срез называется Портфель."""
        out = []
        projs = [(p, m) for p, m in await api._accessible_projects(user)
                 if p["status"] not in ("completed", "cancelled")]
        wps_by_pid = await api._fetch_wps_bulk([p["id"] for p, _ in projs], api.TASK_TYPE_IDS)
        for p, m in projs:
            for tk in api._tasks_from_wps(wps_by_pid.get(p["id"], []), m, p["id"]):
                # Фазу показываем, ТОЛЬКО если она назначена на меня (я отвечаю за этот блок работ) —
                # раньше фазы отсекались огулом, и назначенный ответственным за фазу не видел её.
                # Неназначенные фазы всё равно отсеются: _my_task_match требует совпадения исполнителя.
                if not api._my_task_match(user, tk):
                    continue
                out.append({**tk, "project_id": p["id"], "project_code": p["code"], "project_name": p["name"]})
        return {"data": out[:500]}  # cap роста: ниже потолка выдача байт-идентична, но рост ограничен

    @router.get("/me/items")
    async def my_items(user: dict = Depends(api.rbac)):
        """ВСЕ элементы, назначенные НА МЕНЯ, во ВСЕХ проектах (не только там, где я РП/со-РП),
        сгруппированные по проекту: задачи (WBS), бэклог, риски, решения, допущения, коммуникации,
        KPI, роль в команде, стейкхолдер, совещания (где я участник). Матч по person_id где он есть
        (WBS/бэклог/участник совещания), иначе по имени/email.

        Скан по ВСЕМ проектам осознанный: как участник я вижу свои элементы даже в чужом проекте.
        Утечки нет — возвращаются ТОЛЬКО мои элементы; сам проект при этом не открывается. Флаг
        `can_open` говорит фронту, можно ли зайти внутрь проекта (я владелец портфеля / РП / со-РП).
        `project_active` и `item.closed` — для фильтров «активные/все» и «актуальные/завершённые»."""
        today = datetime.now(timezone.utc).date().isoformat()
        projs = []
        for el in await api.fetch_projects(with_docs=True):  # unscoped: ВСЕ проекты (вкл. архив/завершённые)
            p = api.to_project(el)
            if p["code"].startswith("__"):
                continue
            m = api._meta(el)
            if m.get("_is_template"):
                continue
            projs.append((p, m))
        pids = [p["id"] for p, _ in projs]
        twps, rwps = await asyncio.gather(
            api._fetch_wps_bulk(pids, api.TASK_TYPE_IDS),
            api._fetch_wps_bulk(pids, [api.RISK_TYPE_ID]),
        )
        out = []
        for p, m in projs:
            items: list = []

            def add(kind, iid, title, section, subtitle=None, status=None, closed=False):
                items.append({"type": kind, "id": str(iid), "title": title, "subtitle": subtitle,
                              "status": status, "section": section, "closed": bool(closed)})

            for tk in api._tasks_from_wps(twps.get(p["id"], []), m, p["id"]):
                if api._my_task_match(user, tk):
                    st = tk.get("status")
                    add("task", tk["id"], tk.get("title"), "wbs", status=st,
                        closed=st in ("completed", "cancelled"))
            for r in api._risks_from_wps(rwps.get(p["id"], []), m, p["id"]):
                if api._mine_name(user, r.get("owner")):
                    st = r.get("status")
                    add("risk", r["id"], r.get("title"), "risks", r.get("code"), st,
                        closed=st in ("closed", "mitigated"))
            for b in api._coll(m, "_backlog"):
                if api._my_backlog_match(user, b):
                    st = b.get("status")
                    add("backlog", b.get("id"), b.get("title"), "backlog", b.get("code"), st,
                        closed=st in ("completed", "cancelled", "done"))
            for tm in api._coll(m, "_team"):
                if api._mine_name(user, tm.get("full_name")) or api._mine_email(user, tm.get("email")):
                    add("team", tm.get("id"), tm.get("full_name"), "team",
                        tm.get("project_role") or tm.get("position"))
            for s in api._coll(m, "_stakeholders"):
                if api._mine_name(user, s.get("name")):
                    add("stakeholder", s.get("id"), s.get("name"), "stakeholders", s.get("role"))
            for a in api._coll(m, "_assumptions"):
                if api._mine_name(user, a.get("owner")):
                    st = a.get("status")
                    add("assumption", a.get("id"), a.get("description"), "assumptions", status=st,
                        closed=st in ("confirmed", "invalid"))
            for c in api._coll(m, "_comms"):
                if api._mine_name(user, c.get("responsible")):
                    add("comm", c.get("id"), c.get("goal"), "comm-plan", c.get("frequency"))
            for k in api._coll(m, "_kpis"):
                if api._mine_name(user, k.get("responsible")):
                    add("kpi", k.get("id"), k.get("name"), "kpis", status=k.get("status"))
            for d in api._coll(m, "_decisions"):
                if api._mine_name(user, d.get("decided_by")):
                    st = d.get("status")
                    add("decision", d.get("id"), d.get("title"), "decisions", d.get("code"), st,
                        closed=st in ("superseded", "revoked", "rejected"))
            for mt in api._coll(m, "_meetings"):
                if api._my_attendee_match(user, mt):
                    st = mt.get("status")
                    md = mt.get("meeting_date")
                    past = bool(md and str(md) < today)
                    add("meeting", mt.get("id"), mt.get("title"), "meetings", subtitle=md, status=st,
                        closed=past or st in ("completed", "cancelled"))

            if items:
                status = p.get("status")
                out.append({
                    "project_id": p["id"], "project_code": p["code"], "project_name": p["name"],
                    "project_status": status,
                    "project_active": status not in ("completed", "cancelled") and not m.get("_archived"),
                    # «Открыть» — это переход на чтение, поэтому `_can_read_item`: наблюдатель
                    # проект открыть может, и ссылка у него должна быть живой.
                    "can_open": user.get("role") in api.READ_ALL_ROLES or api._can_read_item(user, p),
                    # Имя РП — ответ на вопрос «а у кого просить». Без него человек упирался в
                    # замочек и шёл искать руководителя в чате; теперь он видит, кого спрашивает.
                    "pm_name": p.get("pm_name") or "",
                    "items": items,
                })
        return {"data": out}

    @router.get("/me/calendar")
    async def my_calendar_feed(user: dict = Depends(api.rbac)):
        """Датированные элементы, назначенные НА МЕНЯ, для страницы «Календарь»: задачи WBS + бэклог
        (фазы исключены). Только с датой (planned_start/planned_end). project_code/name — для фильтра
        по проектам на фронте. События Bitrix фронт накладывает отдельно (та же логика, что в совещаниях)."""
        projs = [(p, m) for p, m in await api._accessible_projects(user, with_docs=True)
                 if p["status"] not in ("completed", "cancelled")]
        pids = [p["id"] for p, _ in projs]
        twps = await api._fetch_wps_bulk(pids, api.TASK_TYPE_IDS)
        out = []
        for p, m in projs:
            base = {"project_id": p["id"], "project_code": p["code"], "project_name": p["name"]}
            for tk in api._tasks_from_wps(twps.get(p["id"], []), m, p["id"]):
                # Фазы НЕ исключаем: как и «Мои задачи»/me/tasks, показываем назначенные на меня
                # элементы WBS, включая фазы с датами (бывает, что единственный WBS-элемент РП — фаза).
                if not api._my_task_match(user, tk):
                    continue
                ps, pe = tk.get("planned_start"), tk.get("planned_end")
                if not ps and not pe:
                    continue
                out.append({**base, "type": "task", "section": "wbs", "id": str(tk["id"]),
                            "title": tk.get("title"), "start": ps, "end": pe, "status": tk.get("status")})
            for b in api._coll(m, "_backlog"):
                if not api._my_backlog_match(user, b):
                    continue
                ps, pe = b.get("planned_start"), b.get("planned_end")
                if not ps and not pe:
                    continue
                out.append({**base, "type": "backlog", "section": "backlog", "id": str(b.get("id")),
                            "title": b.get("title"), "start": ps, "end": pe, "status": b.get("status")})
        return {"data": out}

    # ---------- глобальный поиск ----------
    @router.get("/search")
    async def search(q: str = "", user: dict = Depends(api.rbac)):
        ql = (q or "").strip().lower()
        res = {"projects": [], "tasks": [], "risks": [], "decisions": []}
        if len(ql) < 2:
            return {"data": res}
        projs = []
        for el in await api.fetch_projects(user=user):
            p = api.to_project(el)
            if p["code"].startswith("__"):
                continue
            # Поиск — чтение: наблюдателю ищем по тем же проектам, что он видит в списке.
            if user.get("role") not in api.READ_ALL_ROLES and not api._can_read_item(user, p):
                continue
            projs.append((p, api._meta(el)))
        pids = [p["id"] for p, _ in projs]
        # два независимых bulk-фетча — параллельно (как /portfolio/dashboard), не последовательно
        twps, rwps = await asyncio.gather(
            api._fetch_wps_bulk(pids, api.TASK_TYPE_IDS),
            api._fetch_wps_bulk(pids, [api.RISK_TYPE_ID]),
        )
        for p, m in projs:
            if ql in (p["name"] or "").lower() or ql in (p["code"] or "").lower():
                res["projects"].append({"project_id": p["id"], "project_code": p["code"], "id": p["id"], "title": p["name"], "section": "passport"})
            for tk in api._tasks_from_wps(twps.get(p["id"], []), m, p["id"]):
                if ql in (tk.get("title") or "").lower():
                    res["tasks"].append({"project_id": p["id"], "project_code": p["code"], "id": tk["id"], "title": tk["title"], "section": "wbs"})
            for r in api._risks_from_wps(rwps.get(p["id"], []), m, p["id"]):
                if ql in (r.get("title") or "").lower():
                    res["risks"].append({"project_id": p["id"], "project_code": p["code"], "id": r["id"], "title": r["title"], "section": "risks"})
            for d in api._coll(m, "_decisions"):
                if ql in (str(d.get("title") or "")).lower():
                    res["decisions"].append({"project_id": p["id"], "project_code": p["code"], "id": d.get("id"), "title": d.get("title"), "section": "decisions"})
        for k in res:
            res[k] = res[k][:20]
        return {"data": res}

    @router.post("/admin/portfolio/snapshot")
    async def admin_portfolio_snapshot(date: str = "", user: dict = Depends(api.require_owner)):
        n = await api._take_portfolio_snapshot(date or None)
        return {"data": {"projects": n, "date": date or datetime.now(timezone.utc).date().isoformat()}}

    @router.get("/portfolio/trends")
    async def portfolio_trends(days: int = 90, user: dict = Depends(api.require_portfolio_view)):
        since = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
        allowed = {str(p["id"]) for p, _ in await api._accessible_projects(user)}  # RBAC-скоуп
        store = await api._load_snapshots(since)
        series = []
        for d in sorted(store):
            if d < since:
                continue
            a = {"date": d, "red": 0, "amber": 0, "green": 0, "risks_high": 0, "risks_medium": 0,
                 "overdue_tasks": 0, "tasks_total": 0, "tasks_completed": 0, "budget_plan": 0, "projects": 0}
            psum = 0
            for pid, h in (store[d] or {}).items():
                if pid not in allowed:
                    continue
                rag = h.get("rag") or "green"
                a[rag] = a.get(rag, 0) + 1
                a["risks_high"] += h.get("risks_high", 0) or 0
                a["risks_medium"] += h.get("risks_medium", 0) or 0
                a["overdue_tasks"] += h.get("overdue_tasks", 0) or 0
                a["tasks_total"] += h.get("tasks_total", 0) or 0
                # Старые снимки числа выполненных не хранили — выводим его из прогресса, чтобы
                # график «сделано» работал и по накопленной истории, а не с сегодняшнего дня.
                a["tasks_completed"] += (h.get("tasks_completed")
                                         if h.get("tasks_completed") is not None
                                         else round((h.get("tasks_total", 0) or 0) * (h.get("progress", 0) or 0) / 100))
                a["budget_plan"] += h.get("budget_plan", 0) or 0
                psum += h.get("progress", 0) or 0
                a["projects"] += 1
            if a["projects"]:
                a["progress_avg"] = round(psum / a["projects"])
                series.append(a)
        return {"data": series}

    @router.get("/portfolio/workload")
    async def portfolio_workload(user: dict = Depends(api.require_portfolio_view)):
        projs = await api._accessible_projects(user)
        wps = await api._fetch_wps_bulk([p["id"] for p, _ in projs], api.TASK_TYPE_IDS)
        tasks = []
        for p, m in projs:
            for tk in api._tasks_from_wps(wps.get(p["id"], []), m, p["id"]):
                tk["project_id"] = p["id"]
                tasks.append(tk)
        return {"data": api._workload_from_tasks(tasks, api._workload_thresholds())}

    @router.get("/projects/{pid}/workload")
    async def project_workload(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        return {"data": api._workload_from_tasks(await api._wp_tasks(pid, m), api._workload_thresholds())}

    @router.get("/portfolio/thresholds")
    async def portfolio_thresholds(user: dict = Depends(api.require_portfolio_view)):
        """Пороги «перегружен» для графиков портфеля.

        Отдельный маршрут, а не поле в /portfolio/workload: пороги нужны и «Загрузке
        руководителей», которая строится на фронте из списка проектов, а лезть за ними
        в админские настройки нельзя — те доступны только владельцу портфеля, а портфель
        видит и руководство компании."""
        return {"data": api._workload_thresholds()}

    @router.get("/portfolio/risk-heatmap")
    async def portfolio_risk_heatmap(user: dict = Depends(api.require_portfolio_view)):
        projs = await api._accessible_projects(user)
        rwps = await api._fetch_wps_bulk([p["id"] for p, _ in projs], [api.RISK_TYPE_ID])
        levels = ["low", "medium", "high"]
        cells = {f"{pr}|{im}": 0 for pr in levels for im in levels}
        total = 0
        for p, m in projs:
            for r in api._risks_from_wps(rwps.get(p["id"], []), m, p["id"]):
                if r.get("status") in ("closed", "mitigated"):
                    continue
                key = f"{r.get('probability') or 'medium'}|{r.get('impact') or 'medium'}"
                if key in cells:
                    cells[key] += 1
                    total += 1
        return {"data": {"cells": cells, "total": total}}

    @router.get("/portfolio/milestones")
    async def portfolio_milestones(user: dict = Depends(api.require_portfolio_view)):
        projs = await api._accessible_projects(user)
        wps = await api._fetch_wps_bulk([p["id"] for p, _ in projs], [api.TYPE_ID["milestone"]])
        out = []
        for p, m in projs:
            for tk in api._tasks_from_wps(wps.get(p["id"], []), m, p["id"]):
                d = tk.get("planned_end") or tk.get("planned_start")
                if d:
                    out.append({"project_id": p["id"], "project_code": p["code"], "id": tk["id"],
                                "title": tk.get("title"), "date": d, "status": tk.get("status")})
        out.sort(key=lambda x: str(x["date"]))
        return {"data": out}

    @router.get("/portfolio/risks")
    async def portfolio_risks(probability: str = "", impact: str = "", user: dict = Depends(api.require_portfolio_view)):
        """Открытые риски по портфелю, опц. фильтр probability/impact — для drill-down тепловой карты."""
        projs = await api._accessible_projects(user)
        rwps = await api._fetch_wps_bulk([p["id"] for p, _ in projs], [api.RISK_TYPE_ID])
        out = []
        for p, m in projs:
            for r in api._risks_from_wps(rwps.get(p["id"], []), m, p["id"]):
                if r.get("status") in ("closed", "mitigated"):
                    continue
                if probability and (r.get("probability") or "medium") != probability:
                    continue
                if impact and (r.get("impact") or "medium") != impact:
                    continue
                out.append({"project_id": p["id"], "project_code": p["code"], "id": r["id"],
                            "title": r.get("title"), "probability": r.get("probability"),
                            "impact": r.get("impact"), "score": r.get("score"), "status": r.get("status")})
        out.sort(key=lambda x: -(x.get("score") or 0))
        return {"data": out}

    @router.get("/me/calendar.ics")
    async def my_calendar(user: dict = Depends(api.rbac)):
        """iCal с дедлайнами МОИХ задач. Это личный календарь пользователя, поэтому фильтр
        исполнителя тот же, что и в «Моих задачах» (`_my_task_match`) — иначе в чужой Outlook
        уезжали дедлайны всей команды."""
        projs = await api._accessible_projects(user)
        wps = await api._fetch_wps_bulk([p["id"] for p, _ in projs], api.TASK_TYPE_IDS)
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PM Tool//OpenProject//RU", "CALSCALE:GREGORIAN"]
        for p, m in projs:
            for tk in api._tasks_from_wps(wps.get(p["id"], []), m, p["id"]):
                if tk.get("task_type") == "phase" or not tk.get("planned_end"):
                    continue
                if not api._my_task_match(user, tk):
                    continue
                dt = str(tk["planned_end"]).replace("-", "")
                lines += ["BEGIN:VEVENT", f"UID:task-{tk['id']}@pmtool",
                          f"DTSTART;VALUE=DATE:{dt}", f"DTEND;VALUE=DATE:{dt}",
                          f"SUMMARY:[{p['code']}] {api._ics_esc(tk.get('title'))}",
                          f"DESCRIPTION:{api._ics_esc((tk.get('status') or '') + ' / ' + (tk.get('assignee_name') or ''))}",
                          "END:VEVENT"]
        lines.append("END:VCALENDAR")
        return Response("\r\n".join(lines), media_type="text/calendar",
                        headers={"Content-Disposition": "attachment; filename=pmtool.ics"})

    @router.post("/admin/digest/leadership")
    async def admin_leadership_digest(user: dict = Depends(api.require_owner)):
        return {"data": await api._run_leadership_digest(), "smtp_configured": api.mailer.is_configured()}

    @router.post("/admin/digest/run")
    async def admin_digest_run(days: int = 7, user: dict = Depends(api.require_owner)):
        return {"data": await api._run_digests(days), "smtp_configured": api.mailer.is_configured()}

    @router.get("/admin/outbox")
    async def admin_outbox(user: dict = Depends(api.require_owner)):
        return {"data": api.mailer.OUTBOX[-100:], "smtp_configured": api.mailer.is_configured()}

    return (router, portfolio, attention, my_tasks, search, admin_portfolio_snapshot,
            portfolio_trends, portfolio_workload, project_workload, portfolio_thresholds, portfolio_risk_heatmap,
            portfolio_milestones, portfolio_risks, my_calendar, admin_leadership_digest,
            admin_digest_run, admin_outbox)
