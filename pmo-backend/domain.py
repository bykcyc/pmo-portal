"""Чистые доменные вычисления адаптера — без FastAPI, сети и глобального состояния.
Вынесены из main.py для уменьшения мега-модуля; реэкспортируются в main, поэтому
все ссылки `main.*` и тесты (которые их вызывают) остаются валидными.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

# Пороги перегрузки по умолчанию. Через env их задаёт админ при развёртывании, а руководитель
# портфеля меняет их в «Настройках» — тогда сюда приходит готовый словарь thresholds.
_OVERLOAD_TASKS = int(os.environ.get("WORKLOAD_OVERLOAD_TASKS", "8") or 8)
_OVERLOAD_HOURS = float(os.environ.get("WORKLOAD_OVERLOAD_HOURS", "80") or 80)
# Сколько проектов на одного руководителя считается перегрузкой (проверяется во фронте,
# здесь — источник значения по умолчанию, чтобы порог жил в одном месте).
_OVERLOAD_PM_PROJECTS = int(os.environ.get("WORKLOAD_OVERLOAD_PM_PROJECTS", "4") or 4)


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def dep_conflict(tasks: list, deps: list, task_id, depends_on_id):
    """Почему такую связь заводить нельзя. None — можно.

    Портал раньше разрешал все три случая, и все три одинаково обманчивы: стрелка на Ганте
    рисуется, человек считает, что план посчитан, а критический путь такую связь либо
    игнорирует (он строится только по листьям — фазы в него не входят вовсе), либо не
    строится совсем.

      • **связь с собственной фазой** (предком или потомком): «задача зависит от фазы, внутри
        которой лежит» — утверждение без смысла, зато при первой же перестановке оно
        превращается в цикл;
      • **цикл** A→B→A: топологической сортировки нет → критпуть по этим задачам не считается;
      • **дубль** той же пары: вторая стрелка ничего не добавляет, а каскад обходит её лишний раз.
    """
    tid, did = str(task_id or ""), str(depends_on_id or "")
    if not tid or not did:
        return "task_id и depends_on_id обязательны"
    if tid == did:
        return "Задача не может зависеть от самой себя"

    parent = {str(t.get("id")): (str(t.get("parent_id")) if t.get("parent_id") else None) for t in tasks}
    title = {str(t.get("id")): (t.get("title") or "") for t in tasks}

    def _chain(start):
        """Цепочка предков — с защитой от испорченных данных (родитель сам себе предок)."""
        out, cur, seen = [], parent.get(start), set()
        while cur and cur not in seen:
            seen.add(cur)
            out.append(cur)
            cur = parent.get(cur)
        return out

    if did in _chain(tid):
        return (f"«{title.get(tid, tid)}» лежит внутри «{title.get(did, did)}» — задача не может "
                f"зависеть от собственной фазы. Свяжите её с задачей, которая должна завершиться раньше")
    if tid in _chain(did):
        return (f"«{title.get(did, did)}» лежит внутри «{title.get(tid, tid)}» — фаза не может "
                f"зависеть от собственной задачи")

    succ: dict = {}
    for d in deps or []:
        a, b = str(d.get("depends_on_id")), str(d.get("task_id"))
        if a == did and b == tid:
            return "Такая связь уже есть"
        succ.setdefault(a, []).append(b)

    # Цикл: новая связь did→tid замкнёт кольцо, если из tid уже достижим did.
    queue, seen = list(succ.get(tid, [])), set()
    while queue:
        n = queue.pop(0)
        if n in seen:
            continue
        seen.add(n)
        if n == did:
            return (f"Получится замкнутый круг: «{title.get(did, did)}» и так зависит от "
                    f"«{title.get(tid, tid)}» по цепочке связей")
        queue.extend(succ.get(n, []))
    return None


def _compute_critical(tasks: list, deps: list) -> set:
    """Критический путь по CPM (forward/backward pass, slack==0), вес = duration_days.
    Считаем ТОЛЬКО по подграфу зависимостей — задачи без связей в критпуть не входят
    (иначе самая длинная изолированная задача ложно становится «критической»)."""
    leaf = {str(t["id"]): (float(t.get("duration_days") or 0) or 1.0)
            for t in tasks if t.get("task_type") != "phase"}
    if not leaf:
        return set()
    succ: dict = {}
    pred: dict = {}
    nodes: set = set()
    for d in deps:
        a, b = str(d.get("depends_on_id")), str(d.get("task_id"))  # a предшествует b
        if a in leaf and b in leaf and b not in succ.get(a, []):
            succ.setdefault(a, []).append(b)
            pred.setdefault(b, []).append(a)
            nodes.add(a)
            nodes.add(b)
    if not nodes:
        return set()
    dur = {n: leaf[n] for n in nodes}
    succ = {n: succ.get(n, []) for n in nodes}
    pred = {n: pred.get(n, []) for n in nodes}
    indeg = {n: len(pred[n]) for n in nodes}
    queue = [n for n in nodes if indeg[n] == 0]
    topo = []
    while queue:
        n = queue.pop(0)
        topo.append(n)
        for s in succ[n]:
            indeg[s] -= 1
            if indeg[s] == 0:
                queue.append(s)
    if len(topo) != len(nodes):
        return set()  # цикл — не считаем
    es, ef = {}, {}
    for n in topo:
        es[n] = max([ef[p] for p in pred[n]], default=0.0)
        ef[n] = es[n] + dur[n]
    proj_end = max(ef.values(), default=0.0)
    ls, lf = {}, {}
    for n in reversed(topo):
        lf[n] = min([ls[s] for s in succ[n]], default=proj_end)
        ls[n] = lf[n] - dur[n]
    return {n for n in nodes if abs(ls[n] - es[n]) < 1e-6}


def _budget_planned(i: dict) -> float:
    """План статьи: поле «Сумма» (amount); для старых данных — прогноз, план_amount
    или сумма разбивки; если ничего нет — сумма помесячного плана (monthly)."""
    for k in ("amount", "forecast_total", "planned_amount"):
        v = i.get(k)
        if v is not None and str(v) != "":
            return _num(v)
    breakdown = sum(_num(i.get(k)) for k in
                    ("equipment_amount", "labour_amount", "materials_amount", "contractors_amount"))
    if breakdown:
        return breakdown
    return sum(_num(e.get("planned")) for e in (i.get("monthly") or []))


def _budget_actual(i: dict) -> float:
    """Факт статьи: ОСНОВНОЙ источник — сумма помесячного факта (вносится по месяцам).
    Легаси actual_total/actual_amount используем только если помесячного факта ещё нет."""
    ms = sum(_num(e.get("actual")) for e in (i.get("monthly") or []))
    if ms:
        return ms
    for k in ("actual_total", "actual_amount"):
        v = i.get(k)
        if v is not None and str(v) != "":
            return _num(v)
    return 0.0


def _month_key(e: dict) -> str:
    """Ключ точки помесячного ряда — «ГГГГ-ММ».

    Портал пишет запись как {year: 2026, month: 1}, а ключ раньше считался как str(month)[:7],
    то есть «1». Январь 2026 и январь 2027 схлопывались в одну точку и складывались, а сортировка
    шла лексикографически («1», «10», «11», «12», «2»). На двухлетней программе burn-down
    показывал 12 точек вместо 24 — и это были суммы разных лет. Год лежал в той же записи и не
    читался: соседнее поле `years` того же ответа читало его правильно.

    Легаси-форма (месяц уже строкой «2026-01» или датой) сохраняется как была — первые 7 символов.
    """
    y, mo = e.get("year"), e.get("month")
    if mo is None:
        mo = e.get("period") or e.get("date")
    if mo is None or str(mo).strip() == "":
        return ""
    ys, ms = str(y or "").strip(), str(mo).strip()
    if ys.isdigit() and ms.isdigit():
        return "%04d-%02d" % (int(ys), int(ms))
    return ms[:7]


def _budget_aggregates(items: list):
    """by_category и помесячный burn-down (с накоплением) из item['monthly'] записей."""
    cats: dict = {}
    for i in items:
        c = i.get("category") or "—"
        a = cats.setdefault(c, {"category": c, "planned": 0.0, "actual": 0.0})
        a["planned"] += _budget_planned(i)
        a["actual"] += _budget_actual(i)
    months: dict = {}
    for i in items:
        for e in (i.get("monthly") or []):
            mo = _month_key(e)
            if not mo:
                continue
            a = months.setdefault(mo, {"month": mo, "planned": 0.0, "actual": 0.0})
            a["planned"] += _num(e.get("planned") if e.get("planned") is not None else e.get("planned_amount"))
            a["actual"] += _num(e.get("actual") if e.get("actual") is not None else e.get("actual_amount"))
    monthly = sorted(months.values(), key=lambda x: x["month"])
    cp = ca = 0.0
    for mm in monthly:
        cp += mm["planned"]
        ca += mm["actual"]
        mm["cum_planned"] = round(cp, 2)
        mm["cum_actual"] = round(ca, 2)
    return list(cats.values()), monthly


def _workload_from_tasks(tasks: list, thresholds: Optional[dict] = None) -> list:
    today = datetime.now(timezone.utc).date().isoformat()
    by: dict = {}
    for tk in tasks:
        if tk.get("task_type") == "phase" or tk.get("status") in ("completed", "cancelled"):
            continue
        who = tk.get("assignee_name") or "—"
        a = by.setdefault(who, {"assignee": who, "open_tasks": 0, "overdue": 0, "duration_days": 0,
                                "estimated_hours": 0, "actual_hours": 0, "_projects": set()})
        a["open_tasks"] += 1
        if tk.get("planned_end") and str(tk["planned_end"]) < today:
            a["overdue"] += 1
        a["duration_days"] += tk.get("duration_days") or 0
        a["estimated_hours"] += float(tk.get("estimated_hours") or 0)
        a["actual_hours"] += float(tk.get("actual_hours") or 0)
        if tk.get("project_id"):
            a["_projects"].add(str(tk["project_id"]))
    rows = []
    for a in by.values():
        a["projects_count"] = len(a.pop("_projects"))
        # переаллокация (конфликт ресурсов): много открытых задач ИЛИ переоценка по часам
        lim_tasks = int((thresholds or {}).get("tasks") or _OVERLOAD_TASKS)
        lim_hours = float((thresholds or {}).get("hours") or _OVERLOAD_HOURS)
        a["overloaded"] = a["open_tasks"] >= lim_tasks or a["estimated_hours"] >= lim_hours
        rows.append(a)
    return sorted(rows, key=lambda x: (-x["open_tasks"], -x["overdue"]))


def _ics_esc(s: str) -> str:
    return str(s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", " ")


def _workdays(start_iso, end_iso) -> int:
    """Рабочие дни (пн–пт) между ISO-датами включительно; 0, если даты некорректны/пусты."""
    from datetime import date
    try:
        s = date.fromisoformat(str(start_iso)[:10])
        e = date.fromisoformat(str(end_iso)[:10])
    except (TypeError, ValueError):
        return 0
    if e < s:
        return 0
    days = (e - s).days + 1
    weeks, rem = divmod(days, 7)
    count = weeks * 5
    wd = s.weekday()
    for i in range(rem):
        if (wd + i) % 7 < 5:
            count += 1
    return count


# ─────────────────── подбор общего слота для совещания ───────────────────
# Чистая функция: занятость участников уже загружена (Bitrix), сеть здесь не трогаем —
# поэтому алгоритм тестируется как арифметика, а не как интеграция.

WORK_START_H = 9          # рабочее окно: 9:00–18:00, Пн–Пт.
WORK_END_H = 18           # Обед НАМЕРЕННО не блокируем — решение владельца: у всех он в разное время.
SLOT_STEP_MIN = 30        # сетка кандидатов


def _overlaps(a_from: datetime, a_to: datetime, b_from: datetime, b_to: datetime) -> bool:
    """Пересечение полуинтервалов [from, to). Встреча 10:00–11:00 и 11:00–12:00 НЕ конфликтуют."""
    return a_from < b_to and b_from < a_to


def find_free_slots(busy_by_user: dict, date_from: datetime, date_to: datetime,
                    duration_min: int = 60, limit: int = 8) -> dict:
    """Ранжированные слоты, когда участники свободны одновременно.

    busy_by_user: {bitrix_id: [(начало, конец), …]} — уже разобранные интервалы занятости.
    Возвращает {"slots": [...], "conflict_free": bool}.

    Если полностью свободного окна нет, отдаём НЕ пустоту, а лучшие компромиссы с числом
    конфликтов: календарь никогда не бывает пустым, и «слотов нет» — бесполезный ответ.
    UI честно скажет «свободны 3 из 4».

    Ранжирование: меньше конфликтов → раньше дата → бонус утреннему окну 10:00–12:00
    (в него охотнее соглашаются) → раньше время.
    """
    duration = max(15, int(duration_min or 60))
    users = list(busy_by_user.keys())
    step = timedelta(minutes=SLOT_STEP_MIN)
    slots: list = []

    # date_from — это «не раньше чем», обычно «сейчас». Дни перебираем с полуночи, но слот,
    # который уже начался, не предлагаем: «давайте сегодня в 16:00» в 17:47 — не предложение.
    day = date_from.replace(hour=0, minute=0, second=0, microsecond=0)
    last = date_to.replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= last:
        if day.weekday() < 5:                                   # Пн–Пт
            start = day.replace(hour=WORK_START_H)
            end_of_day = day.replace(hour=WORK_END_H)
            cur = start
            while cur + timedelta(minutes=duration) <= end_of_day:
                slot_end = cur + timedelta(minutes=duration)
                if cur < date_from:
                    cur += step
                    continue
                busy_users = [u for u in users
                              if any(_overlaps(cur, slot_end, b0, b1) for b0, b1 in busy_by_user[u])]
                slots.append({
                    "from": cur.isoformat(),
                    "to": slot_end.isoformat(),
                    "conflicts": len(busy_users),
                    "busy_user_ids": busy_users,
                    "free_count": len(users) - len(busy_users),
                    "total_count": len(users),
                })
                cur += step
        day += timedelta(days=1)

    def _rank(s: dict):
        dt = datetime.fromisoformat(s["from"])
        morning_bonus = 0 if 10 <= dt.hour < 12 else 1        # 0 сортируется раньше
        return (s["conflicts"], dt.date(), morning_bonus, dt.time())

    slots.sort(key=_rank)
    free = [s for s in slots if s["conflicts"] == 0]
    best = (free or slots)[:limit]
    return {"slots": best, "conflict_free": bool(free)}
