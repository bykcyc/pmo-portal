# -*- coding: utf-8 -*-
"""Наполнение проекта PMO «под ключ» по контент-плану (JSON) через публичный REST API.

    python tools/seed_project.py --emit-example > plan.json     # эталонный план
    python tools/seed_project.py --plan plan.json --dry-run     # что будет вызвано (без записи)
    python tools/seed_project.py --plan plan.json               # боевой прогон + верификация
    python tools/seed_project.py --verify-only 57               # планка качества существующего проекта
    python tools/seed_project.py --delete 57                    # убрать за собой

РАЗДЕЛЕНИЕ ОТВЕТСТВЕННОСТИ. План — это СМЫСЛ (что написать по теме): его сочиняет человек или LLM.
Скрипт — МЕХАНИКА: порядок вызовов, реальные id, резолв людей из справочника, авто-коды, сдвиг дат.
Поля, которые выводит сервер (assignee_name/email, code, score, wbs_code, даты фазы), в плане не
появляются вообще — иначе они молча разойдутся с тем, что реально лежит в базе.

ТОЛЬКО ДЕВ. Скрипт отказывается работать с чем-либо, кроме 127.0.0.1/localhost: наполнить боевой
портал «демо-проектом» — значит показать его реальным РП и вручную вычищать потом.

СЛЕД В ЭТАЛОНАХ. Новый проект сдвигает golden-снапшоты (/projects, /portfolio/*, /attention, /search)
и визуальные снимки e2e (лишняя строка в списке проектов). Поэтому: заполнить → показать → --delete.
Пока сид-проект жив, golden- и visual-гейты не запускать.
"""
import argparse
import copy
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CODE_PREFIX = "SEED-"          # гард уборки: удаляем только свои проекты
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

FAILS: list = []
PASSES: list = []


def check(cond, label, detail=""):
    (PASSES if cond else FAILS).append(label)
    print(f"  {'OK  ' if cond else 'FAIL'} {label}" + (f"  [{detail}]" if detail and not cond else ""))


# ─────────────────────────────── API ───────────────────────────────

class Api:
    """Тот же клиент, что в tools/goldens/writeflow.py: stdlib, логин → Bearer.
    В dry-run пишущие вызовы не уходят на сервер, а печатаются и возвращают фиктивный id."""

    def __init__(self, base, creds, dry=False):
        self.base = base.rstrip("/")
        self.dry = dry
        self.calls = 0
        self.token = self._login(creds)

    def _login(self, creds):
        """Вход в один шаг, а при включённой 2FA — в два.

        Когда на портале включена 2FA, /auth/login отдаёт не токен, а короткоживущий challenge.
        Код спрашиваем у человека прямо в момент запуска: держать TOTP-секрет рядом со скриптом
        значило бы обессмыслить второй фактор.
        """
        r = self("POST", "/auth/login", creds, auth=False, force=True)
        if r.get("access_token"):
            return r["access_token"]
        if not r.get("twofa_required"):
            raise SystemExit("Вход не удался: портал не вернул ни токен, ни запрос второго шага.")
        code = os.environ.get("PMO_TOTP") or input("Код из приложения (6 цифр): ").strip()
        r2 = self("POST", "/auth/login/totp", {"challenge": r["challenge"], "code": code},
                  auth=False, force=True)
        if not r2.get("access_token"):
            raise SystemExit("Второй шаг не прошёл: код неверный или устарел, попробуйте заново.")
        return r2["access_token"]

    def __call__(self, method, path, body=None, auth=True, raw=False, force=False):
        if self.dry and not force and method != "GET":
            self.calls += 1
            keys = ",".join(sorted(body)) if isinstance(body, dict) else ""
            print(f"  [dry] {method:6} {path}" + (f"  {{{keys}}}" if keys else ""))
            return {"data": {"id": f"dry{self.calls}"}}
        if self.dry and method == "GET" and "/dry" in path:
            # В dry-run проект не создаётся, и его id — фикция («dry1»). Такой GET уходил на живой
            # сервер и валил прогон пятисоткой (реальные id — числа, поэтому пересечься не с чем).
            return {"data": []}
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                b = r.read()
                if raw:
                    return r.status, b
                return json.loads(b) if b else None
        except urllib.error.HTTPError as e:
            if raw:
                return e.code, e.read()
            detail = e.read().decode("utf-8", "ignore")[:300]
            raise SystemExit(f"\nAPI {method} {path} → {e.code}\n{detail}") from None

    def data(self, method, path, body=None):
        r = self(method, path, body)
        return r.get("data", r) if isinstance(r, dict) else r


# ────────────────────────── план: загрузка, сдвиг дат ──────────────────────────

def load_plan(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _shift_str(s, delta):
    return (date.fromisoformat(s) + timedelta(days=delta)).isoformat() if isinstance(s, str) and ISO.match(s) else s


def shift_dates(plan, delta):
    """Сдвинуть ВСЕ даты плана на delta дней. Благодаря этому сохранённый план не протухает:
    демо всегда «в разгаре», а не «закончилось полгода назад»."""
    if not delta:
        return plan

    def walk(node):
        if isinstance(node, dict):
            # помесячный бюджет хранит year/month числами — двигаем их тем же смещением
            if "year" in node and "month" in node and isinstance(node.get("year"), int):
                d = date(int(node["year"]), int(node["month"]), 1) + timedelta(days=delta)
                node["year"], node["month"] = d.year, d.month
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return _shift_str(node, delta)

    return walk(copy.deepcopy(plan))


# ─────────────────────────────── валидация плана ───────────────────────────────

def validate_plan(plan, today, existing=None, patch=False):
    """Проверяем то, чего НЕ проверит сервер. Он молча стерпит фазу с датами, просроченную
    «в работе» задачу и бюджет, не сходящийся по месяцам, — а советник в UI потом покраснеет.

    `existing` — что уже лежит в проекте (режим --into). Пороги качества считаем по СУММЕ
    «уже есть + добавляем»: раздел, заполненный человеком руками, не нужно дублировать планом.
    `patch` — план дописывает существующий проект: он не обязан содержать все разделы."""
    have = existing or {}
    errs = []
    warns = []   # не блокируют заполнение, но скрипт молча правит план — надо сказать вслух
    # Пороги ДЕМО-качества (мало KPI, факт за будущий месяц, просрочка) ломают не заливку, а
    # «образцовость». При переносе РЕАЛЬНОГО проекта (patch) переносим то, что есть, — такие
    # претензии становятся предупреждениями. Структурные ошибки (даты фазы, битые ссылки,
    # сумма бюджета) остаются блокирующими в любом режиме: они реально портят данные.
    def soft_err(msg):
        (warns if patch else errs).append(msg)
    tasks = {}
    for ph in plan.get("wbs") or []:
        if ph.get("type") != "phase":
            errs.append(f"wbs: верхний уровень должен быть фазой, а не {ph.get('type')!r} ({ph.get('key')})")
        if any(k in ph for k in ("planned_start", "planned_end", "progress")):
            errs.append(f"wbs {ph.get('key')}: у ФАЗЫ не может быть дат/прогресса — сервер их игнорирует "
                        f"(деривирует из детей), значение молча потеряется")
        for t in ph.get("children") or []:
            tasks[t["key"]] = t
            ps, pe = t.get("planned_start"), t.get("planned_end")
            if not ps or not pe:
                errs.append(f"задача {t['key']}: нужны обе плановые даты (иначе советник: «задач без дат»)")
            elif ps > pe:
                errs.append(f"задача {t['key']}: начало позже завершения")
            elif pe < today and t.get("status") not in ("completed", "cancelled"):
                soft_err(f"задача {t['key']}: срок {pe} в прошлом, а статус {t.get('status')!r} — "
                         f"это «просрочка» в советнике; сделайте completed или сдвиньте срок")
            if not t.get("assignee"):
                errs.append(f"задача {t['key']}: нет исполнителя (советник: «задач без исполнителя»)")
            if t.get("type") == "milestone":
                # Портал вехи не поддерживает: в редакторе типа только «фаза» и «задача»
                # (TYPE_OPTIONS в TaskDrawer/WbsRows). Веха, заведённая через API, рисуется
                # ромбом, но при клике по колонке «Тип» селект открывается ПУСТЫМ и молча
                # превращает её в фазу. Ключевые точки заводим обычными задачами.
                warns.append(f"задача {t['key']}: type=\"milestone\" — портал вех не умеет, "
                             f"создаю обычной задачей")

    for d in plan.get("dependencies") or []:
        for side in ("task", "depends_on"):
            if d.get(side) not in tasks:
                errs.append(f"зависимость ссылается на несуществующую задачу {d.get(side)!r}")
        if d.get("task") == d.get("depends_on"):
            errs.append("зависимость задачи от самой себя → 422")

    for it in (plan.get("budget") or {}).get("items") or []:
        mon = it.get("monthly") or []
        planned = round(sum(float(m.get("planned") or 0) for m in mon), 2)
        if mon and abs(planned - float(it.get("amount") or 0)) > 0.5:
            errs.append(f"бюджет «{it.get('name')}»: сумма по месяцам {planned} != amount {it.get('amount')} "
                        f"(советник: «не расписаны по месяцам»)")
        for m in mon:
            if float(m.get("actual") or 0) and date(int(m["year"]), int(m["month"]), 1) > date.fromisoformat(today):
                soft_err(f"бюджет «{it.get('name')}»: факт за будущий месяц {m['year']}-{m['month']:02d}")

    aliases = set((plan.get("people") or {}).get("aliases") or {})
    for ref in re.findall(r'"@([a-z0-9_]+)"', json.dumps(plan, ensure_ascii=False)):
        if ref not in aliases:
            errs.append(f"неизвестный алиас человека @{ref}")

    # планка качества — те же пороги, что показывает советник живому РП
    def total(key):
        return len(plan.get(key) or []) + int(have.get(key) or 0)

    if total("kpis") < 3:
        soft_err("KPI меньше трёх (советник просит 3–5)")
    if not 3 <= total("risks") <= 5:
        soft_err("рисков должно быть 3–5")
    if total("comm_plan") < 2:
        soft_err("нужно ≥2 регулярные коммуникации")
    if total("stakeholders") < 2:
        soft_err("нужно ≥2 стейкхолдера (минимум спонсор и заказчик)")
    # Встречи проверяем ТОЛЬКО те, что заводит сам план. Патч (--into) не обязан их содержать:
    # раздел мог быть заполнен раньше или человек сознательно решил обойтись без него.
    # Правду о готовности проекта всё равно скажет verify() — уже по факту, а не по плану.
    mts = plan.get("meetings") or []
    if mts:
        if not any(m.get("finalize") for m in mts):
            errs.append("нужна хотя бы одна ПРОШЕДШАЯ встреча с finalize:true")
        if not any(not m.get("finalize") for m in mts):
            errs.append("нужна хотя бы одна БУДУЩАЯ встреча (finalize:false)")
    elif not patch:
        errs.append("нужна хотя бы одна ПРОШЕДШАЯ встреча с finalize:true")
        errs.append("нужна хотя бы одна БУДУЩАЯ встреча (finalize:false)")
    return errs, warns


# ─────────────────────────────── люди ───────────────────────────────

def resolve_people(api, plan):
    """Алиас (@analyst) → реальный человек из справочника. ЛЮДЕЙ НЕ ВЫДУМЫВАЕМ: задача, назначенная
    на несуществующего человека, не попадёт ни в «Мои задачи», ни в письма, ни в Bitrix."""
    persons = api.data("GET", "/persons")
    # Справочник начинается со служебных аккаунтов Bitrix («Admin», info@…) — если
    # брать подряд, демо-проект окажется укомплектован ими. Берём только похожих на живых людей:
    # имя+фамилия, без цифр и без служебных слов.
    junk = re.compile(r"(?i)\d|admin|test|info|support|bitrix|noreply")
    pool = [p for p in persons
            if p.get("is_active") is not False and (p.get("email") or "").strip()
            and len((p.get("full_name") or "").split()) >= 2
            and not junk.search(p.get("full_name") or "")]
    me = api.data("GET", "/auth/me")
    aliases = (plan.get("people") or {}).get("aliases") or {}
    explicit = (plan.get("people") or {}).get("explicit") or {}
    by_name = {(p.get("full_name") or "").casefold(): p for p in pool}

    out, used = {}, set()
    for alias, spec in aliases.items():
        if spec.get("self"):
            pid = me.get("person_id") or next(
                (p["id"] for p in pool if (p.get("email") or "").casefold() == (me.get("email") or "").casefold()), None)
            out[alias] = {"person_id": pid, "full_name": me.get("full_name"), "email": me.get("email"),
                          "project_role": spec.get("project_role"), "position": spec.get("position")}
            continue
        want = explicit.get(alias)
        p = by_name.get((want or "").casefold()) if want else None
        if want and not p:
            raise SystemExit(f"В справочнике нет человека «{want}» (алиас @{alias})")
        if not p:  # авто: берём следующего свободного — детерминированно, по порядку справочника
            p = next((x for x in pool if x["id"] not in used), None)
            if not p:
                raise SystemExit("В справочнике не хватает людей под алиасы")
        used.add(p["id"])
        out[alias] = {"person_id": p["id"], "full_name": p.get("full_name"), "email": p.get("email"),
                      "project_role": spec.get("project_role"), "position": spec.get("position")}
    return out


def _who(people, ref):
    # .get, не [] — алиас может отсутствовать (перенос реального проекта без служебного @lead),
    # и это не повод падать: неизвестный @алиас ловит валидатор, а хардкод «@lead» — нет.
    return people.get(ref.lstrip("@")) if isinstance(ref, str) and ref.startswith("@") else None


def _name(people, ref):
    p = _who(people, ref)
    return p["full_name"] if p else ref


# ─────────────────────────────── шаги наполнения ───────────────────────────────

def create_project(api, plan, allow_any_code=False):
    meta, pas = plan["meta"], plan.get("passport") or {}
    code = meta["code"]
    if not code.startswith(CODE_PREFIX) and not allow_any_code:
        raise SystemExit(f"meta.code обязан начинаться с {CODE_PREFIX} — это гард уборки. "
                         f"Для переноса реального проекта (не сида): --allow-any-code")
    existing = api.data("GET", "/projects")
    items = existing.get("items", existing) if isinstance(existing, dict) else existing
    if any((p.get("code") or "") == code for p in items or []):
        raise SystemExit(f"Проект с кодом {code} уже есть. Удалите его (--delete-code {code}) или смените код.")
    # Создатель автоматически становится РП. pm_id НЕ шлём: через PUT его менять нельзя (403),
    # а на создании он нужен только если РПП назначает чужого человека.
    proj = api.data("POST", "/projects", {"name": meta["name"], "code": code,
                                          "status": pas.get("status") or "planning",
                                          "priority": pas.get("priority") or "medium",
                                          "project_kind": pas.get("project_kind") or None})
    return str(proj["id"])


def seed_passport(api, pid, plan, people):
    pas = dict(plan.get("passport") or {})
    # pm_name из плана берём только если явно назван @lead (self=РП, как в сид-планах). При
    # переносе реального проекта @lead нет — тогда pm_name не навязываем: сервер оставит РП
    # создателя проекта (тот, под кем запускают перенос), а не случайного участника команды.
    lead = _who(people, "@lead")
    if lead:
        pas.setdefault("pm_name", lead["full_name"])
    pas.pop("pm_id", None)          # 403: владельца меняют только через transfer
    api.data("PUT", f"/projects/{pid}", pas)


def seed_foundation(api, pid, plan, people):
    for m in plan.get("team") or []:
        p = _who(people, m.get("alias")) or {}
        api.data("POST", f"/projects/{pid}/team", {
            "full_name": p.get("full_name") or m.get("name"), "email": p.get("email"),
            "position": m.get("position") or p.get("position"),
            "project_role": m.get("project_role") or p.get("project_role"), "phone": m.get("phone")})
    for s in plan.get("stakeholders") or []:
        api.data("POST", f"/projects/{pid}/stakeholders", s)
    for a in plan.get("assumptions") or []:
        api.data("POST", f"/projects/{pid}/assumptions",
                 {**a, "owner": _name(people, a.get("owner"))})
    for c in plan.get("comm_plan") or []:
        api.data("POST", f"/projects/{pid}/communication-plan",
                 {**c, "responsible": _name(people, c.get("responsible"))})
    for k in plan.get("kpis") or []:
        api.data("POST", f"/projects/{pid}/kpis", k)


def seed_wbs(api, pid, plan, people):
    """Фазы, затем листья. Исполнитель уходит ТОЛЬКО как assignee_person_id: имя и почту сервер
    подставит сам из реестра людей.

    ГРАБЛИ С ДАТАМИ ФАЗЫ. Сервер отказывается писать planned_start/planned_end строке с
    task_type="phase" (`_task_fields`: «срок деривируется из детей») — но НЕ деривирует их на
    самом деле: колонки остаются NULL, и на Ганте фаза выходит без срока, а в таблице UI
    подставляет сегодняшнее число. Обходится ровно так, как это сделано в настоящих проектах
    портала: пока строка ещё `task`, даты записываются, а превращение в `phase` их не стирает
    (обновление просто не трогает эти колонки). Отсюда два PUT в конце — иначе Гант врёт.
    """
    taskmap = {}
    for ph in plan.get("wbs") or []:
        row = api.data("POST", f"/projects/{pid}/tasks",
                       {"title": ph["title"], "task_type": "phase", "description": ph.get("description")})
        pid_ph = str(row["id"])
        taskmap[ph["key"]] = pid_ph
        for t in ph.get("children") or []:
            p = _who(people, t.get("assignee")) or {}
            # «milestone» в план ещё может прийти (тип есть в API и в старых планах), но в портал
            # он не уедет: редактор типа знает только фазу и задачу, и веха там нередактируема.
            ttype = t.get("type") or "task"
            if ttype == "milestone":
                ttype = "task"
            body = {"title": t["title"], "task_type": ttype,
                    "parent_id": pid_ph,
                    "planned_start": t.get("planned_start"), "planned_end": t.get("planned_end"),
                    "status": t.get("status") or "not_started", "progress": t.get("progress") or 0,
                    "priority": t.get("priority") or "medium",
                    "assignee_person_id": p.get("person_id"),
                    "estimated_hours": t.get("estimated_hours"), "description": t.get("description")}
            row = api.data("POST", f"/projects/{pid}/tasks", {k: v for k, v in body.items() if v is not None})
            taskmap[t["key"]] = str(row["id"])
    return taskmap


def set_phase_spans(api, pid):
    """Проставить фазам срок = охват их детей. Вызывать ПОСЛЕ всех вставок задач (включая
    перенос поручений из бэклога) — иначе охват устареет, как только в фазу добавится задача.
    Механика двух PUT — в докстринге seed_wbs."""
    tasks = api.data("GET", f"/projects/{pid}/tasks") or []
    kids: dict = {}
    for t in tasks:
        if t.get("task_type") != "phase" and t.get("parent_id"):
            kids.setdefault(str(t["parent_id"]), []).append(t)
    for ph in [t for t in tasks if t.get("task_type") == "phase"]:
        ch = kids.get(str(ph["id"])) or []
        starts = [c["planned_start"] for c in ch if c.get("planned_start")]
        ends = [c["planned_end"] for c in ch if c.get("planned_end")]
        if not (starts and ends):
            continue
        api.data("PUT", f"/projects/{pid}/tasks/{ph['id']}",
                 {"task_type": "task", "planned_start": min(starts), "planned_end": max(ends)})
        api.data("PUT", f"/projects/{pid}/tasks/{ph['id']}", {"task_type": "phase"})


def seed_dependencies(api, pid, plan, taskmap):
    for d in plan.get("dependencies") or []:
        api.data("POST", f"/projects/{pid}/task-dependencies", {
            "task_id": taskmap[d["task"]], "depends_on_id": taskmap[d["depends_on"]],
            "dependency_type": d.get("type") or "finish_to_start", "lag_days": d.get("lag_days") or 0})


def seed_risks(api, pid, plan, people, taskmap):
    for r in plan.get("risks") or []:
        body = {k: v for k, v in r.items() if k != "related_task"}
        body["owner"] = _name(people, r.get("owner"))
        if r.get("related_task"):
            body["related_task_id"] = taskmap.get(r["related_task"])
        api.data("POST", f"/projects/{pid}/risks", body)      # code R-NN и score считает сервер


def seed_decisions(api, pid, plan, people, taskmap):
    """ТОЛЬКО внемитинговые решения. Решения совещания пишет ФИНАЛИЗАЦИЯ — она дедуплицирует
    по своему маркеру _from_meeting и не видит записей, созданных напрямую: положишь дважды —
    получишь дубль в журнале."""
    for d in plan.get("decisions") or []:
        body = {k: v for k, v in d.items() if k != "related_task"}
        body["decided_by"] = _name(people, d.get("decided_by"))
        if d.get("related_task"):
            body["related_task_id"] = taskmap.get(d["related_task"])
        api.data("POST", f"/projects/{pid}/decisions", body)


def seed_budget(api, pid, plan, taskmap):
    b = plan.get("budget") or {}
    if not b:
        return
    api.data("PUT", f"/projects/{pid}/budget-settings", {
        "budget_target": b.get("target"), "income_target": b.get("income_target"),
        "currency": b.get("currency") or "EUR"})
    for it in b.get("items") or []:
        body = {k: v for k, v in it.items() if k not in ("monthly", "wbs_task")}
        if it.get("wbs_task"):
            body["wbs_task_id"] = taskmap.get(it["wbs_task"])
        row = api.data("POST", f"/projects/{pid}/budget-items", body)
        if it.get("monthly"):
            # ФАКТ вносится ТОЛЬКО помесячно — колонка «Сумма (факт)» суммируется из этих записей.
            api.data("PUT", f"/projects/{pid}/budget-items/{row['id']}/monthly", {"entries": it["monthly"]})


def seed_backlog(api, pid, plan, people):
    for it in plan.get("backlog") or []:      # только внемитинговые: поручения встреч придут из finalize
        api.data("POST", f"/projects/{pid}/backlog",
                 {**it, "requested_by": _name(people, it.get("requested_by"))})


def seed_meetings(api, pid, plan, people):
    """Совещание с повесткой, участниками, решениями и поручениями. Для прошедших — finalize:
    он и есть единственный писатель решений (→ журнал) и поручений (→ бэклог)."""
    out = []
    for mt in plan.get("meetings") or []:
        att = []
        for a in mt.get("attendees") or []:
            p = _who(people, a.get("alias")) or {}
            att.append({"name": p.get("full_name") or a.get("name"), "present": a.get("present", True),
                        "role_dept": a.get("role_dept"), "person_id": p.get("person_id"),
                        "email": p.get("email") or a.get("email")})
        body = {k: v for k, v in mt.items() if k not in ("key", "finalize", "attendees", "agenda_items",
                                                         "actions", "decisions")}
        body["attendees"] = att
        body["agenda_items"] = [{**a, "presenter": _name(people, a.get("presenter"))}
                                for a in (mt.get("agenda_items") or [])]
        body["actions"] = [{k: v for k, v in a.items() if k != "promote"} | {
            "assignee_name": _name(people, a.get("assignee")),
            "assignee_email": (_who(people, a.get("assignee")) or {}).get("email")}
            for a in (mt.get("actions") or [])]
        body["actions"] = [{k: v for k, v in a.items() if k != "assignee"} for a in body["actions"]]
        body["decisions"] = [{**d, "decided_by": _name(people, d.get("decided_by"))}
                             for d in (mt.get("decisions") or [])]
        body["status"] = "draft"
        row = api.data("POST", f"/projects/{pid}/meetings", body)
        mid = str(row["id"])
        if mt.get("finalize"):
            api.data("POST", f"/projects/{pid}/meetings/{mid}/finalize")
        out.append((mt, mid))
    return out


def promote_from_meetings(api, pid, plan, people, taskmap):
    """Поручение встречи → настоящая задача WBS. ВАЖНО: promote создаёт задачу БЕЗ дат, БЕЗ
    исполнителя и БЕЗ родителя — сразу после него обязателен PUT, иначе советник краснеет
    двумя строками («задач без дат», «без исполнителя»)."""
    wanted = {a["action_text"]: a["promote"] for mt in (plan.get("meetings") or [])
              for a in (mt.get("actions") or []) if a.get("promote")}
    if not wanted:
        return
    for it in api.data("GET", f"/projects/{pid}/backlog") or []:
        spec = wanted.get(it.get("title"))
        if not spec:
            continue
        res = api.data("POST", f"/projects/{pid}/backlog/{it['id']}/promote")
        tid = str(res["task_id"])
        p = _who(people, spec.get("assignee")) or {}
        api.data("PUT", f"/projects/{pid}/tasks/{tid}", {k: v for k, v in {
            "parent_id": taskmap.get(spec.get("parent")),
            "planned_start": spec.get("planned_start"), "planned_end": spec.get("planned_end"),
            "status": spec.get("status") or "not_started",
            "assignee_person_id": p.get("person_id")}.items() if v is not None})
        taskmap[f"promoted:{it['title'][:30]}"] = tid


def seed_baseline(api, pid, plan):
    """ПОСЛЕДНИМ из всего, что создаёт задачи: снимок берётся с текущей WBS, и задача, добавленная
    после него, повиснет в советнике как «новая после снимка»."""
    b = plan.get("baseline")
    if b:
        api.data("POST", f"/projects/{pid}/baselines", {"name": b.get("name") or "Базовый план v1",
                                                        "description": b.get("description")})


def seed_reports(api, pid, plan, taskmap):
    """Цифры бюджета берём из /budget-summary, а вехи — из реальных задач: так отчёт сходится
    с проектом бесплатно, а не «примерно»."""
    reports = plan.get("reports") or []
    if not reports:
        return
    summary = api.data("GET", f"/projects/{pid}/budget-summary") or {}
    tasks = {str(t["id"]): t for t in (api.data("GET", f"/projects/{pid}/tasks") or [])}
    for rep in reports:
        body = {k: v for k, v in rep.items() if k not in ("milestones", "budget_from_summary")}
        if rep.get("budget_from_summary"):
            body["budget_plan"] = summary.get("expense_planned")
            body["budget_actual"] = summary.get("expense_actual")
            body["budget_forecast"] = summary.get("expense_forecast") or summary.get("expense_planned")
        ms = []
        for m in rep.get("milestones") or []:
            t = tasks.get(taskmap.get(m.get("task"), ""))
            if not t:
                continue
            ms.append({"name": t.get("title"), "planned_date": t.get("planned_end"),
                       "actual_date": t.get("actual_end"), "status": m.get("status") or t.get("status")})
        body["milestones"] = ms
        api.data("POST", f"/projects/{pid}/status-reports", body)


# ─────────────────────────────── верификация ───────────────────────────────

def verify(api, pid):
    """Порт SectionAdvisor: те же критерии, что портал показывает живому РП в панели
    «На этой странице». Проект считается заполненным, когда ни одна вкладка не краснеет."""
    today = date.today().isoformat()
    g = lambda p: api.data("GET", f"/projects/{pid}/{p}") or []       # noqa: E731
    proj = api.data("GET", f"/projects/{pid}")
    team, stake, assum = g("team"), g("stakeholders"), g("assumptions")
    comms, kpis, tasks = g("communication-plan"), g("kpis"), g("tasks")
    risks, decisions, backlog = g("risks"), g("decisions"), g("backlog")
    meetings, reports, bases = g("meetings"), g("status-reports"), g("baselines")
    gantt = api.data("GET", f"/projects/{pid}/gantt-data") or {}
    budget, bsum = g("budget-items"), api.data("GET", f"/projects/{pid}/budget-summary") or {}
    leaves = [t for t in tasks if t.get("task_type") != "phase"]
    open_r = [r for r in risks if r.get("status") == "open"]

    print("\nПланка качества (панель «На этой странице»):")
    check(bool(proj.get("goal")) and bool(proj.get("planned_end")) and bool(proj.get("pm_name")),
          "паспорт: цель, РП и плановое завершение")
    check(bool(team) and all(m.get("project_role") for m in team), "команда: у всех роль в проекте")
    check(len(stake) >= 2 and all(s.get("influence") and s.get("interest") for s in stake),
          "стейкхолдеры: ≥2, у всех влияние и интерес (иначе не попадут в матрицу)")
    check(bool(assum) and all(a.get("type") and a.get("owner") for a in assum),
          "допущения: у всех тип и владелец")
    check(len(comms) >= 2 and all(c.get("responsible") and c.get("frequency") for c in comms),
          "коммуникации: ≥2, у всех ответственный и частота")
    check(len(kpis) >= 3, "KPI: не меньше трёх", str(len(kpis)))
    check(bool(leaves), "план работ: есть задачи")
    check(not [t for t in leaves if not t.get("planned_start") or not t.get("planned_end")],
          "план работ: нет задач без дат")
    check(not [t for t in leaves if not t.get("assignee_name")], "план работ: нет задач без исполнителя")
    check(not [t for t in leaves if t.get("planned_end") and t["planned_end"] < today
               and t.get("status") not in ("completed", "cancelled")],
          "план работ: нет просроченных открытых задач")
    check(not [t for t in tasks if t.get("task_type") == "phase"
               and not (t.get("planned_start") and t.get("planned_end"))],
          "Гант: у фаз проставлен срок (сервер их сам НЕ деривирует)")
    check(bool(gantt.get("links")), "Гант: между задачами есть связи", str(len(gantt.get("links") or [])))
    check(3 <= len(risks) <= 5, "риски: 3–5", str(len(risks)))
    check(all(r.get("owner") for r in open_r), "риски: у открытых есть владелец")
    check(all(r.get("mitigation_plan") for r in open_r if (r.get("score") or 0) >= 6),
          "риски: у высоких есть план митигации")
    check(bool(decisions) and all(d.get("rationale") and d.get("date")
                                  for d in decisions if d.get("status") == "active"),
          "решения: у активных есть обоснование и дата")
    check(bool(budget) and float(bsum.get("expense_actual") or 0) > 0,
          "бюджет: статьи есть и факт внесён (только помесячно)")
    check(bool(bases), "базовый план: снимок снят")
    check(not [m for m in meetings if m.get("meeting_date") and m["meeting_date"] < today
               and m.get("status") != "final"],
          "совещания: прошедшие завершены (finalize)")
    check(any(m.get("meeting_date", "") >= today for m in meetings), "совещания: есть будущая встреча")
    check(bool(reports), "статус-отчёт: есть")
    check(not [r for r in reports if r.get("status_overall") in ("amber", "red") and not r.get("next_steps")],
          "статус-отчёт: при жёлтом/красном заполнены «Следующие шаги»")
    check(bool(backlog), "бэклог: не пуст")
    return len(FAILS)


# ─────────────────────────────── уборка ───────────────────────────────

def delete_project(api, pid):
    proj = api.data("GET", f"/projects/{pid}")
    code = proj.get("code") or ""
    if not code.startswith(CODE_PREFIX):
        raise SystemExit(f"Отказ: проект {pid} имеет код «{code}», а не {CODE_PREFIX}*. "
                         f"Скрипт удаляет ТОЛЬКО свои сид-проекты.")
    api("DELETE", f"/projects/{pid}")
    print(f"Проект {pid} ({code}) удалён. Эталоны снова чистые.")


def existing_counts(api, pid):
    """Что в проекте УЖЕ заполнено руками. В режиме --into пороги качества считаются по сумме
    «есть + добавляем»: раздел, который человек заполнил сам, дублировать планом не надо."""
    keys = {"team": "team", "stakeholders": "stakeholders", "assumptions": "assumptions",
            "comm_plan": "communication-plan", "kpis": "kpis", "risks": "risks",
            "decisions": "decisions", "backlog": "backlog", "budget": "budget-items",
            "meetings": "meetings", "reports": "status-reports"}
    out = {}
    for plan_key, url in keys.items():
        got = api.data("GET", f"/projects/{pid}/{url}")
        out[plan_key] = len(got) if isinstance(got, list) else 0
    return out


def find_by_code(api, code):
    res = api.data("GET", "/projects")
    items = res.get("items", res) if isinstance(res, dict) else res
    return next((str(p["id"]) for p in items or [] if (p.get("code") or "") == code), None)


# ─────────────────────────────── эталонный план ───────────────────────────────

def example_plan():
    a = date.today()
    d = lambda n: (a + timedelta(days=n)).isoformat()      # noqa: E731
    return {
        "meta": {"theme": "Внедрение CRM", "anchor": a.isoformat(), "code": "SEED-CRM",
                 "name": "Внедрение CRM в отделе продаж"},
        "people": {"aliases": {
            "lead": {"project_role": "Руководитель проекта", "self": True},
            "analyst": {"project_role": "Бизнес-аналитик", "position": "Аналитик"},
            "dev": {"project_role": "Разработчик", "position": "Инженер"},
            "qa": {"project_role": "Тестировщик", "position": "QA-инженер"}}},
        "passport": {
            "status": "active", "priority": "high", "project_kind": "strategic",
            "client": "Коммерческий директор", "planned_start": d(-60), "planned_end": d(90),
            "actual_start": d(-58), "budget": 120000, "budget_currency": "EUR",
            "goal": ["Сократить цикл сделки с 21 до 12 дней к концу года"],
            "scope": ["Внедрение CRM для отдела продаж (28 человек)", "НЕ входит: маркетинг и поддержка"],
            "project_result": ["Работающая CRM с интеграцией в 1С", "Обученная команда продаж"],
            "key_milestones": ["ТЗ утверждено", "Пилот на одной команде", "Промышленный запуск"],
            "success_criteria": "Цикл сделки ≤12 дней, 90% сделок ведутся в CRM",
            "description": "Продажи ведутся в Excel: сделки теряются, прогноз недостоверен."},
        "team": [{"alias": "@lead"}, {"alias": "@analyst"}, {"alias": "@dev"}, {"alias": "@qa"}],
        "stakeholders": [
            {"name": "Коммерческий директор", "role": "Спонсор проекта", "type": "internal",
             "influence": "10", "interest": "9", "engagement_strategy": "Еженедельный статус лично"},
            {"name": "Руководители отделов продаж", "role": "Заказчик", "type": "internal",
             "influence": "7", "interest": "9", "engagement_strategy": "Демо каждые 2 недели"},
            {"name": "ИТ-департамент", "role": "Интеграция с 1С", "type": "internal",
             "influence": "6", "interest": "5", "engagement_strategy": "Согласование на этапе интеграции"}],
        "assumptions": [
            {"type": "assumption", "description": "Данные из Excel пригодны для миграции",
             "owner": "@analyst", "status": "active"},
            {"type": "constraint", "description": "Бюджет ограничен 120 000 EUR", "owner": "@lead",
             "status": "confirmed"},
            {"type": "dependency", "description": "Нужен API 1С от ИТ-департамента", "owner": "@dev",
             "status": "active"}],
        "comm_plan": [
            {"goal": "Держать спонсора в курсе рисков", "channel": "Встреча", "audience": "Спонсор",
             "frequency": "Еженедельно", "responsible": "@lead"},
            {"goal": "Синхронизация команды", "channel": "Teams", "audience": "Команда проекта",
             "frequency": "Ежедневно", "responsible": "@lead"},
            {"goal": "Демо результата", "channel": "Встреча", "audience": "Руководители продаж",
             "frequency": "Раз в 2 недели", "responsible": "@analyst"}],
        "kpis": [
            {"name": "Цикл сделки", "target": "12", "unit": "дней", "current_value": "18",
             "formula": "Среднее время от лида до оплаты", "status": "at_risk",
             "description": "Ключевая метрика проекта"},
            {"name": "Доля сделок в CRM", "target": "90", "unit": "%", "current_value": "45",
             "formula": "Сделки в CRM / все сделки", "status": "on_track"},
            {"name": "Активные пользователи", "target": "28", "unit": "чел", "current_value": "12",
             "formula": "Уникальные логины за неделю", "status": "on_track"}],
        "wbs": [
            {"key": "F1", "type": "phase", "title": "Анализ и требования", "children": [
                {"key": "F1.T1", "type": "task", "title": "Интервью с отделом продаж",
                 "planned_start": d(-58), "planned_end": d(-44), "assignee": "@analyst",
                 "status": "completed", "progress": 100, "estimated_hours": 40, "priority": "high"},
                {"key": "F1.T2", "type": "task", "title": "Написать ТЗ",
                 "planned_start": d(-43), "planned_end": d(-25), "assignee": "@analyst",
                 "status": "completed", "progress": 100, "estimated_hours": 60},
                {"key": "F1.K1", "title": "ТЗ утверждено",
                 "planned_start": d(-24), "planned_end": d(-24), "assignee": "@lead",
                 "status": "completed", "progress": 100}]},
            {"key": "F2", "type": "phase", "title": "Настройка и интеграция", "children": [
                {"key": "F2.T1", "type": "task", "title": "Настроить воронку и права",
                 "planned_start": d(-23), "planned_end": d(-5), "assignee": "@dev",
                 "status": "completed", "progress": 100, "estimated_hours": 80},
                {"key": "F2.T2", "type": "task", "title": "Интеграция с 1С",
                 "planned_start": d(-4), "planned_end": d(20), "assignee": "@dev",
                 "status": "in_progress", "progress": 40, "estimated_hours": 120, "priority": "critical"},
                {"key": "F2.T3", "type": "task", "title": "Миграция данных из Excel",
                 "planned_start": d(10), "planned_end": d(30), "assignee": "@analyst",
                 "status": "not_started", "estimated_hours": 50}]},
            {"key": "F3", "type": "phase", "title": "Пилот и запуск", "children": [
                {"key": "F3.T1", "type": "task", "title": "Пилот на одной команде",
                 "planned_start": d(31), "planned_end": d(55), "assignee": "@qa",
                 "status": "not_started", "estimated_hours": 60},
                {"key": "F3.T2", "type": "task", "title": "Обучение отдела продаж",
                 "planned_start": d(56), "planned_end": d(75), "assignee": "@lead",
                 "status": "not_started", "estimated_hours": 40},
                {"key": "F3.K1", "title": "Промышленный запуск",
                 "planned_start": d(90), "planned_end": d(90), "assignee": "@lead",
                 "status": "not_started"}]}],
        "dependencies": [
            {"task": "F2.T1", "depends_on": "F1.K1"},
            {"task": "F2.T2", "depends_on": "F2.T1"},
            {"task": "F2.T3", "depends_on": "F2.T2"},
            {"task": "F3.T1", "depends_on": "F2.T3"},
            {"task": "F3.T2", "depends_on": "F3.T1"},
            {"task": "F3.K1", "depends_on": "F3.T2"}],
        "risks": [
            {"title": "ИТ не даст API 1С в срок", "probability": "high", "impact": "high",
             "status": "open", "owner": "@dev", "category": "Технический",
             "description": "Интеграция — критический путь проекта",
             "mitigation_plan": "Эскалация спонсору; параллельно готовим импорт через файлы",
             "contingency_plan": "Запуск без онлайн-интеграции, обмен раз в сутки",
             "related_task": "F2.T2"},
            {"title": "Отдел продаж саботирует переход", "probability": "medium", "impact": "high",
             "status": "open", "owner": "@lead", "category": "Организационный",
             "mitigation_plan": "Чемпионы в каждой команде, обучение до запуска",
             "contingency_plan": "Поэтапный переход по командам"},
            {"title": "Данные в Excel грязные", "probability": "high", "impact": "medium",
             "status": "open", "owner": "@analyst", "category": "Данные",
             "mitigation_plan": "Профилирование данных до миграции",
             "related_task": "F2.T3"},
            {"title": "Превышение бюджета на доработках", "probability": "low", "impact": "medium",
             "status": "open", "owner": "@lead", "category": "Финансовый",
             "mitigation_plan": "Резерв 10%, изменения только через комитет"}],
        "decisions": [
            {"title": "Берём облачную CRM, а не коробку", "date": d(-30),
             "rationale": "Быстрее старт, нет затрат на инфраструктуру",
             "alternatives": "Коробочная версия на своих серверах",
             "impact": "Зависимость от вендора, зато запуск на 2 месяца раньше",
             "decided_by": "@lead", "status": "active"}],
        "budget": {"target": 120000, "currency": "EUR", "items": [
            {"name": "Лицензии CRM", "kind": "expense", "category": "operational", "amount": 36000,
             "comments": "28 пользователей × 12 мес",
             "monthly": [{"year": a.year, "month": a.month, "planned": 18000, "actual": 18000},
                         {"year": (a + timedelta(days=31)).year, "month": (a + timedelta(days=31)).month,
                          "planned": 18000, "actual": 0}]},
            {"name": "Внедрение и интеграция", "kind": "expense", "category": "implementation",
             "amount": 60000, "wbs_task": "F2.T2",
             "monthly": [{"year": a.year, "month": a.month, "planned": 30000, "actual": 27500},
                         {"year": (a + timedelta(days=31)).year, "month": (a + timedelta(days=31)).month,
                          "planned": 30000, "actual": 0}]},
            {"name": "Обучение", "kind": "expense", "category": "implementation", "amount": 14000,
             "monthly": [{"year": (a + timedelta(days=62)).year, "month": (a + timedelta(days=62)).month,
                          "planned": 14000, "actual": 0}]}]},
        "backlog": [
            {"title": "Мобильное приложение для торговых представителей", "priority": "medium",
             "status": "new", "estimated_days": 15, "requested_by": "@lead",
             "description": "Просили на демо; в текущий объём не входит"},
            {"title": "Дашборд для руководителя продаж", "priority": "high", "status": "new",
             "estimated_days": 5, "requested_by": "@analyst"}],
        "meetings": [
            {"key": "M1", "title": "Кик-офф проекта", "meeting_type": "kickoff",
             "meeting_date": d(-59), "meeting_time": "10:00", "duration_minutes": 60,
             "location": "Переговорная 3", "finalize": True,
             "minutes_content": "Согласовали объём, границы и график. Спонсор подтвердил бюджет.",
             "agenda_items": [{"item": "Цели и объём", "presenter": "@lead", "time_allocated": "20 мин"},
                              {"item": "План работ", "presenter": "@analyst", "time_allocated": "25 мин"}],
             "attendees": [{"alias": "@lead", "present": True}, {"alias": "@analyst", "present": True},
                           {"alias": "@dev", "present": True}, {"alias": "@qa", "present": False}],
             "decisions": [{"decision_text": "Пилот запускаем на одной команде, а не на всём отделе",
                            "rationale": "Снижает риск саботажа и позволяет собрать обратную связь",
                            "decided_by": "@lead"}],
             "actions": [{"action_text": "Собрать требования по интеграции с 1С",
                          "assignee": "@dev", "due_date": d(-40), "status": "open",
                          "promote": {"parent": "F2", "planned_start": d(-40), "planned_end": d(-20),
                                      "assignee": "@dev", "status": "completed"}}]},
            {"key": "M2", "title": "Статус-встреча", "meeting_type": "status",
             "meeting_date": d(7), "meeting_time": "11:00", "duration_minutes": 30,
             "location": "Teams", "finalize": False,
             "agenda_items": [{"item": "Ход интеграции с 1С", "presenter": "@dev", "time_allocated": "15 мин"}],
             "attendees": [{"alias": "@lead", "present": True}, {"alias": "@dev", "present": True}],
             "actions": [{"action_text": "Подготовить план миграции данных", "assignee": "@analyst",
                          "due_date": d(14), "status": "open"}]}],
        "baseline": {"name": "Базовый план v1", "description": "Утверждён на кик-оффе"},
        "reports": [
            {"report_date": d(-3), "period": "Текущая неделя", "status_overall": "amber",
             "status_budget": "green", "status_timeline": "amber", "budget_from_summary": True,
             "summary": "Настройка завершена. Интеграция с 1С идёт медленнее плана: ждём API от ИТ.",
             "next_steps": "Эскалировать вопрос API спонсору; параллельно готовить импорт через файлы.",
             "conclusions": "Нужно решение по API 1С до конца недели, иначе сдвинется пилот.",
             "milestones": [{"task": "F1.K1", "status": "done"}, {"task": "F3.K1", "status": "on_track"}]}]}


# ─────────────────────────────── main ───────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Наполнить проект PMO по контент-плану")
    ap.add_argument("--base", default="http://127.0.0.1:8002")
    # Пароль лучше не светить в истории команд (особенно на проде): по умолчанию берём из
    # окружения PMO_LOGIN/PMO_PASSWORD, дефолт — дев-учётка. На проде: `export PMO_PASSWORD=…`
    # (с ведущим пробелом строка не попадёт в history) и запуск без --password.
    ap.add_argument("--login", default=os.environ.get("PMO_LOGIN", "pm1@company.com"))
    # Пароль: из PMO_PASSWORD, иначе решаем ниже по хосту (дев → pm123; прод → скрытый ввод).
    ap.add_argument("--password", default=os.environ.get("PMO_PASSWORD"))
    ap.add_argument("--plan")
    ap.add_argument("--into", metavar="PID",
                    help="дописать СУЩЕСТВУЮЩИЙ проект: создаём только то, что есть в плане")
    ap.add_argument("--anchor", help="дата, на которую написан план (по умолчанию meta.anchor)")
    ap.add_argument("--no-shift", action="store_true", help="не сдвигать даты плана на сегодня")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--strict", action="store_true", help="любое предупреждение верификатора → exit 1")
    ap.add_argument("--replace", action="store_true", help="удалить проект с таким же кодом и создать заново")
    ap.add_argument("--allow-remote", metavar="HOST",
                    help="ОСОЗНАННО работать с не-дев хостом (перенос реального проекта на прод). "
                         "Значение обязано совпасть с хостом из --base — двойная защита от опечатки.")
    ap.add_argument("--allow-any-code", action="store_true",
                    help="разрешить код проекта БЕЗ префикса SEED- (перенос реального проекта, а не сида). "
                         "Удаление остаётся под защитой SEED- в любом случае.")
    ap.add_argument("--verify-only", metavar="PID")
    ap.add_argument("--delete", metavar="PID")
    ap.add_argument("--delete-code", metavar="CODE")
    ap.add_argument("--emit-example", action="store_true")
    args = ap.parse_args()

    if args.emit_example:
        print(json.dumps(example_plan(), ensure_ascii=False, indent=2))
        return 0

    # host из --base: срезаем схему, затем ПУТЬ (например, /api за обратным прокси) и порт — иначе
    # в хост попадёт «portal.example.com/api», и --allow-remote пришлось бы задавать с путём.
    host = args.base.split("//", 1)[-1].split("/")[0].split(":")[0]
    if host not in ("127.0.0.1", "localhost"):
        # По умолчанию — только дев: демо-проект на боевом увидят реальные РП. Осознанный перенос
        # реального проекта разрешаем, но требуем назвать хост дважды (--base и --allow-remote),
        # чтобы прод нельзя было задеть опечаткой.
        if args.allow_remote != host:
            raise SystemExit(f"Отказ: {args.base} — не дев-хост. Для ОСОЗНАННОГО переноса реального "
                             f"проекта повтори хост: --allow-remote {host}")
        if args.delete or args.delete_code:
            raise SystemExit(f"Отказ: удаление на не-дев хосте ({host}) запрещено. Удаляй только на деве.")
        print(f"⚠ НЕ-ДЕВ ХОСТ {host} — разрешено флагом --allow-remote. Пишем на реальный портал.")

    # Пароль без placeholder'ов: не задан явно → на деве берём pm123, на проде спрашиваем скрытым
    # вводом (getpass, /dev/tty — не в history/ps/env). Так в командной строке пароля нет вовсе.
    password = args.password
    if not password:
        if host in ("127.0.0.1", "localhost"):
            password = "pm123"
        else:
            import getpass
            password = getpass.getpass(f"Пароль для {args.login} на {host} (ввод скрыт): ")
    api = Api(args.base, {"email": args.login, "password": password}, dry=args.dry_run)

    if args.delete or args.delete_code:
        pid = args.delete or find_by_code(api, args.delete_code)
        if not pid:
            raise SystemExit(f"Проект с кодом {args.delete_code} не найден")
        delete_project(api, pid)
        return 0

    if args.verify_only:
        verify(api, args.verify_only)
        print(f"\n{'ЗЕЛЕНО' if not FAILS else 'КРАСНО'}: {len(PASSES)} ok, {len(FAILS)} fail")
        return 1 if FAILS and args.strict else 0

    if not args.plan:
        raise SystemExit("Нужен --plan file.json (эталон: --emit-example)")

    plan = load_plan(args.plan)
    today = date.today()
    if not args.no_shift:
        anchor = args.anchor or (plan.get("meta") or {}).get("anchor")
        if anchor:
            delta = (today - date.fromisoformat(anchor)).days
            if delta:
                plan = shift_dates(plan, delta)
                print(f"Даты плана сдвинуты на {delta:+d} дн. (якорь {anchor} → сегодня)")

    have = {}
    if args.into:
        proj = api.data("GET", f"/projects/{args.into}")
        have = existing_counts(api, args.into)
        print(f"Дописываем СУЩЕСТВУЮЩИЙ проект {args.into} — {proj.get('code')} «{proj.get('name')}».")
        filled = [f"{k}={v}" for k, v in have.items() if v]
        if filled:
            print(f"  Уже заполнено (НЕ трогаем): {', '.join(filled)}")

    # Перенос реального проекта (--allow-any-code) не обязан удовлетворять порогам ДЕМО-качества
    # (обязательные совещания и т.п.) — переносим то, что есть, а не то, что «должно быть у образцового».
    soft = bool(args.into) or args.allow_any_code
    errs, warns = validate_plan(plan, today.isoformat(), existing=have, patch=soft)
    if errs:
        print("План невалиден:")
        for e in errs:
            print("  -", e)
        return 2
    print(f"План валиден: {plan['meta']['name']}")
    for w in warns:
        print("  ! ", w)

    if args.replace and not args.dry_run and not args.into:
        old = find_by_code(api, plan["meta"]["code"])
        if old:
            delete_project(api, old)

    people = resolve_people(api, plan)
    print("Люди (из справочника, не выдуманы):")
    for alias, p in people.items():
        print(f"  @{alias:<9} → {p['full_name']} <{p['email']}>")

    print("\nНаполняем:" if not args.dry_run else "\nПоследовательность вызовов (dry-run):")
    if args.into:
        # Проект уже существует и заполнен человеком: создаём только то, что есть в плане.
        pid = str(args.into)
        if plan.get("passport"):
            seed_passport(api, pid, plan, people)
    else:
        pid = create_project(api, plan, allow_any_code=args.allow_any_code)
        seed_passport(api, pid, plan, people)
    seed_foundation(api, pid, plan, people)
    taskmap = seed_wbs(api, pid, plan, people)
    seed_dependencies(api, pid, plan, taskmap)
    seed_risks(api, pid, plan, people, taskmap)
    seed_decisions(api, pid, plan, people, taskmap)
    seed_budget(api, pid, plan, taskmap)
    seed_backlog(api, pid, plan, people)
    seed_meetings(api, pid, plan, people)
    promote_from_meetings(api, pid, plan, people, taskmap)
    set_phase_spans(api, pid)               # после ВСЕХ вставок задач: охват фазы = её дети
    seed_baseline(api, pid, plan)           # после ВСЕГО, что создаёт задачи
    seed_reports(api, pid, plan, taskmap)

    if args.dry_run:
        print(f"\nDry-run: {api.calls} пишущих вызовов, ни один не отправлен.")
        return 0

    verify(api, pid)
    ok = not FAILS
    print(f"\n{'ЗЕЛЕНО' if ok else 'КРАСНО'}: {len(PASSES)} ok, {len(FAILS)} fail")
    print(f"\nПроект готов: http://localhost:3000/projects/{pid}/passport")
    if args.into:
        # Проект чужой (наполняли по явной просьбе) — предлагать его удаление нельзя.
        print("Это ВАШ проект — скрипт его не удалит (гард: удаляются только SEED-*).")
    else:
        print(f"Убрать за собой: python tools/seed_project.py --delete {pid}")
    print("Заполненный проект сдвигает golden- и visual-эталоны — учитывайте при прогоне гейтов.")
    return 1 if FAILS and args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
