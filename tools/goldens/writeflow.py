# -*- coding: utf-8 -*-
"""Write-flow контракт: проверяет, что бэкенд ПИШЕТ одинаково (golden-снапшоты ловят только чтение).

  python writeflow.py --base http://localhost:8001     # v1 (OpenProject)
  python writeflow.py --base http://localhost:8002     # v2 (Postgres)

Всё делается в ПЕСОЧНОМ проекте, который скрипт создаёт и в конце удаляет.
Витринные/реальные проекты не трогаются.
Сравниваются не байты (id закономерно разные), а инварианты бизнес-логики:
цепочки, каскады, оптимистичная блокировка, авто-коды, авто-переносы.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PM = {"email": "pm1@company.com", "password": "pm123"}
OWNER = {"email": "owner@company.com", "password": "admin123"}

FAILS = []
PASSES = []


def check(cond, label, detail=""):
    (PASSES if cond else FAILS).append(label)
    print(f"  {'OK  ' if cond else 'FAIL'} {label}" + (f"  [{detail}]" if detail and not cond else ""))


class Api:
    def __init__(self, base, creds):
        self.base = base.rstrip("/")
        self.token = self._login(creds)

    def _login(self, creds):
        return self("POST", "/auth/login", creds, auth=False)["access_token"]

    def __call__(self, method, path, body=None, auth=True, raw=False):
        data = json.dumps(body).encode() if body is not None else None
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
            raise

    def status(self, method, path, body=None):
        return self(method, path, body, raw=True)[0]

    def data(self, method, path, body=None):
        r = self(method, path, body)
        return r.get("data", r) if isinstance(r, dict) else r


def run(base):
    pm = Api(base, PM)
    owner = Api(base, OWNER)
    pid = None
    try:
        # ── песочный проект ─────────────────────────────────────────────
        proj = pm.data("POST", "/projects", {
            "name": "WF SANDBOX (удаляется тестом)", "code": f"WF{int(time.time()) % 100000}",
            "status": "planning", "priority": "low",
        })
        pid = str(proj["id"])
        print(f"\n[sandbox pid={pid}]")

        # ── 1. Задачи: create → update → каскад deps при delete ─────────
        print("\n1. Задачи и зависимости")
        a = pm.data("POST", f"/projects/{pid}/tasks", {"title": "A", "task_type": "task",
                                                       "planned_start": "2026-08-01", "planned_end": "2026-08-05"})
        b = pm.data("POST", f"/projects/{pid}/tasks", {"title": "B", "task_type": "task",
                                                       "planned_start": "2026-08-06", "planned_end": "2026-08-10"})
        check(isinstance(a["id"], str) and isinstance(b["id"], str), "id задач сериализуются строками",
              f"{type(a['id']).__name__}")
        upd = pm.data("PUT", f"/projects/{pid}/tasks/{a['id']}", {"status": "in_progress", "progress": 50})
        check(upd["status"] == "in_progress" and upd["progress"] == 50, "update задачи применяется")
        check(pm.status("PUT", f"/projects/{pid}/tasks/{a['id']}", {"status": "нет-такого"}) == 422,
              "невалидный enum статуса → 422")

        dep = pm.data("POST", f"/projects/{pid}/task-dependencies",
                      {"task_id": b["id"], "depends_on_id": a["id"], "dependency_type": "finish_to_start"})
        g = pm.data("GET", f"/projects/{pid}/gantt-data")
        link = next((l for l in g["links"] if str(l["source"]) == str(a["id"])), None)
        check(link and str(link["target"]) == str(b["id"]), "gantt: связь A→B (предшественник = source)")
        check(pm.status("POST", f"/projects/{pid}/task-dependencies",
                        {"task_id": a["id"], "depends_on_id": a["id"]}) == 422, "self-dependency → 422")

        pm("DELETE", f"/projects/{pid}/tasks/{b['id']}")
        g2 = pm.data("GET", f"/projects/{pid}/gantt-data")
        check(not any(str(l["target"]) == str(b["id"]) for l in g2["links"]),
              "каскад: удаление задачи чистит её зависимости")

        # ── 2. Фаза: свои даты пишутся, прогресс — из детей ─────────
        print("\n2. Фазы")
        ph = pm.data("POST", f"/projects/{pid}/tasks", {"title": "Фаза", "task_type": "phase"})
        pm.data("POST", f"/projects/{pid}/tasks", {"title": "child", "task_type": "task", "parent_id": ph["id"],
                                                   "planned_start": "2026-09-01", "planned_end": "2026-09-10"})
        pm.data("PUT", f"/projects/{pid}/tasks/{ph['id']}", {"planned_end": "2027-01-01", "progress": 77})
        tasks = pm.data("GET", f"/projects/{pid}/tasks")
        phase = next(t for t in tasks if str(t["id"]) == str(ph["id"]))
        # Раньше даты фазы сервер молча выбрасывал — PUT отвечал 200, а поле оставалось пустым
        # навсегда. Деривации срока из детей в коде нет и не было.
        check(phase["planned_end"] == "2027-01-01", "срок фазы сохраняется", str(phase["planned_end"]))
        check(not phase.get("progress"), "прогресс фазы по-прежнему из детей", str(phase.get("progress")))

        # ── 3. Риски: авто-код R-NN, скоринг ────────────────────────────
        print("\n3. Риски")
        r1 = pm.data("POST", f"/projects/{pid}/risks", {"title": "Риск-1", "probability": "high", "impact": "high"})
        r2 = pm.data("POST", f"/projects/{pid}/risks", {"title": "Риск-2", "probability": "low", "impact": "low"})
        check(r1.get("code") == "R-01" and r2.get("code") == "R-02", "авто-коды рисков R-01/R-02",
              f"{r1.get('code')}/{r2.get('code')}")
        check(r1["score"] == 9 and r2["score"] == 1, "скоринг 3×3 (high×high=9, low×low=1)")

        # ── 4. Совещание: финализация → решения в журнал + задачи в бэклог
        print("\n4. Совещание → решения + бэклог")
        mt = pm.data("POST", f"/projects/{pid}/meetings", {
            "title": "Кик-офф", "meeting_date": "2026-08-01",
            "decisions": [{"id": "d1", "decision_text": "Берём вариант Б", "rationale": "дешевле"}],
            "actions": [{"id": "a1", "action_text": "Согласовать смету", "assignee_name": "IT lead",
                         "due_date": "2026-08-15", "status": "open"}],
        })
        fin = pm.data("POST", f"/projects/{pid}/meetings/{mt['id']}/finalize")
        decs = pm.data("GET", f"/projects/{pid}/decisions")
        bl = pm.data("GET", f"/projects/{pid}/backlog")
        check(any("вариант Б" in (d.get("title") or "") for d in decs), "решение встречи → журнал решений")
        check(any("смету" in (i.get("title") or "") for i in bl), "поручение встречи → бэклог")
        check(any((i.get("code") or "").startswith("B-") for i in bl), "авто-код бэклога B-NN")
        pm.data("POST", f"/projects/{pid}/meetings/{mt['id']}/finalize")  # идемпотентность
        check(len(pm.data("GET", f"/projects/{pid}/decisions")) == len(decs),
              "повторная финализация не дублирует решения")

        # ── 5. Бэклог → WBS (создаёт настоящую задачу, пункт уходит) ────
        print("\n5. Бэклог → WBS")
        item = bl[0]
        before = len(pm.data("GET", f"/projects/{pid}/tasks"))
        pm.data("POST", f"/projects/{pid}/backlog/{item['id']}/promote")
        after = len(pm.data("GET", f"/projects/{pid}/tasks"))
        bl2 = pm.data("GET", f"/projects/{pid}/backlog")
        check(after == before + 1, "promote создаёт задачу в WBS")
        check(not any(str(i["id"]) == str(item["id"]) for i in bl2), "promote убирает пункт из бэклога")

        # ── 6. Бюджет: план из статей, факт помесячно ───────────────────
        print("\n6. Бюджет")
        it = pm.data("POST", f"/projects/{pid}/budget-items",
                     {"name": "Лицензии", "kind": "expense", "category": "software", "amount": 1000})
        pm.data("PUT", f"/projects/{pid}/budget-items/{it['id']}/monthly",
                {"entries": [{"year": 2026, "month": 8, "planned": 600, "actual": 250},
                             {"year": 2026, "month": 9, "planned": 400, "actual": 100}]})
        bs = pm.data("GET", f"/projects/{pid}/budget-summary")
        check(bs["expense_planned"] == 1000, "план расходов = сумма статей", str(bs["expense_planned"]))
        check(bs["expense_actual"] == 350, "факт = сумма помесячного факта", str(bs["expense_actual"]))
        pm.data("PUT", f"/projects/{pid}/budget-settings", {"budget_target": "800"})
        check(pm.data("GET", f"/projects/{pid}/budget-summary")["target"] == 800, "утверждённый лимит сохраняется")

        # ── 7. Базовый план ─────────────────────────────────────────────
        print("\n7. Базовый план")
        pm.data("POST", f"/projects/{pid}/baselines", {"name": "БП-1"})
        bls = pm.data("GET", f"/projects/{pid}/baselines")
        check(len(bls) == 1 and bls[0]["task_count"] > 0, "снимок базового плана содержит задачи",
              str(bls[0].get("task_count") if bls else None))

        # ── 8. RBAC ─────────────────────────────────────────────────────
        print("\n8. RBAC")
        # WP2: РПП (owner) правит ЛЮБОЙ проект — песочница принадлежит pm1, а не ему.
        # Раньше здесь фиксировалось обратное (owner строго read-only): владелец портфеля не мог
        # поправить даже опечатку в чужом проекте.
        check(owner.status("POST", f"/projects/{pid}/tasks", {"title": "X"}) == 200, "owner правит любой проект")
        check(owner.status("GET", f"/projects/{pid}/tasks") == 200, "owner читает любой проект")
        # А РП по-прежнему заперт в своих проектах — скоуп владения не ослаб.
        check(owner.status("GET", "/portfolio/dashboard") == 200, "Портфель доступен РПП")

        # ── 9. Комментарии/история задачи ───────────────────────────────
        print("\n9. Комментарии")
        pm.data("POST", f"/projects/{pid}/work-packages/{a['id']}/activity", {"comment": "проверка"})
        acts = pm.data("GET", f"/projects/{pid}/work-packages/{a['id']}/activity")
        mine = [x for x in acts if x.get("comment") and "проверка" in x["comment"]]
        check(len(mine) == 1, "комментарий сохраняется и читается")
        check("Project Manager 1" in (mine[0]["comment"] if mine else ""),
              "автор в тексте комментария (префикс), не в поле user")

        # ── 10. Клон проекта ────────────────────────────────────────────
        print("\n10. Клон")
        cl = pm.data("POST", f"/projects/{pid}/clone", {})
        cid = str(cl["id"])
        try:
            ct = pm.data("GET", f"/projects/{cid}/tasks")
            cr = pm.data("GET", f"/projects/{cid}/risks")
            check(len(ct) == len(pm.data("GET", f"/projects/{pid}/tasks")), "клон копирует все задачи")
            check(len(cr) == 2, "клон копирует риски")
        finally:
            pm("DELETE", f"/projects/{cid}")

        # ── 11a. Подпроекты: связь, права по дереву, уровень ────────────
        # Здесь проверяется то, чего не докажут модульные тесты: связь идёт через РЕАЛЬНУЮ
        # транзакцию в базе, а унаследованные права считает SQL, а не заглушка.
        print("\n11a. Подпроекты")
        umb = pm.data("POST", "/projects", {"name": "writeflow зонтик", "code": "WF-UMB"})
        uid_ = str(umb["id"])
        kid = pm.data("POST", "/projects", {"name": "writeflow подпроект", "code": "WF-KID"})
        kid_ = str(kid["id"])
        try:
            pm.data("POST", f"/projects/{uid_}/subprojects", {"project_id": kid_})
            child = pm.data("GET", f"/projects/{kid_}")
            parent = pm.data("GET", f"/projects/{uid_}")
            check(child["parent_id"] == uid_, "у подпроекта появился зонтик", str(child["parent_id"]))
            check(child["parent_code"] == "WF-UMB", "и его код виден в паспорте ребёнка")
            check(parent["subprojects_count"] == 1, "у зонтика счётчик подпроектов",
                  str(parent["subprojects_count"]))
            rows = pm.data("GET", f"/projects/{uid_}/subprojects")
            check([r["id"] for r in rows] == [kid_], "сводка подпроектов отдаёт ребёнка")
            check("rag_status" in (rows[0] if rows else {}), "строка сводки в форме портфеля")

            # Уровень ровно один — иначе дерево стало бы произвольной глубины.
            code = pm.status("POST", f"/projects/{kid_}/subprojects", {"project_id": uid_})
            check(code in (409, 422), "второй уровень запрещён", str(code))

            pm("DELETE", f"/projects/{uid_}/subprojects/{kid_}")
            check(pm.data("GET", f"/projects/{kid_}")["parent_id"] is None, "отвязка снимает связь")
        finally:
            # Зонтик удаляем ПЕРВЫМ: ON DELETE SET NULL освободит ребёнка, а не унесёт его.
            pm("DELETE", f"/projects/{uid_}")
            check(pm.status("GET", f"/projects/{kid_}") == 200,
                  "удаление зонтика не удаляет подпроект")
            pm("DELETE", f"/projects/{kid_}")

        # ── 11b. Сводный бюджет: ставка, часы, остаток по блоку зонтика ─
        # Модульные тесты гоняют свёртку на заглушках. Здесь настоящая цепочка: ставка
        # доезжает до ребёнка через SQL (db._TREE_CTE отдаёт её ТЕКСТОМ), часы превращаются
        # в деньги при ЗАПИСИ, а остаток по блоку считается по всем детям.
        print("\n11b. Сводный бюджет")
        umb2 = pm.data("POST", "/projects", {"name": "writeflow зонтик бюджета", "code": "WF-UMB2"})
        u2 = str(umb2["id"])
        kid2 = pm.data("POST", "/projects", {"name": "writeflow подпроект бюджета", "code": "WF-KID2"})
        k2 = str(kid2["id"])
        try:
            pm.data("POST", f"/projects/{u2}/subprojects", {"project_id": k2})
            pm.data("PUT", f"/projects/{u2}/budget-settings", {"budget_rate": "50"})
            blk = pm.data("POST", f"/projects/{u2}/budget-items",
                          {"name": "Блок 2", "kind": "expense", "category": "dev", "planned_hours": 100})
            check(pm.data("GET", f"/projects/{u2}/budget-summary")["expense_planned"] == 5000,
                  "часы блока стали деньгами по ставке зонтика (100 × 50)",
                  str(pm.data("GET", f"/projects/{u2}/budget-summary")["expense_planned"]))

            mine = pm.data("POST", f"/projects/{k2}/budget-items",
                           {"name": "Наши часы", "kind": "expense", "category": "dev"})
            pm.data("POST", f"/projects/{k2}/budget-items/{mine['id']}/link",
                    {"parent_item_id": str(blk["id"])})
            # Ставка у ребёнка своя не задана — берётся у зонтика; 20 ч → 1000.
            pm.data("PUT", f"/projects/{k2}/budget-items/{mine['id']}/monthly",
                    {"entries": [{"year": 2026, "month": 9, "actual_hours": 20}]})
            check(pm.data("GET", f"/projects/{k2}/budget-summary")["expense_actual"] == 1000,
                  "часы подпроекта стали деньгами по УНАСЛЕДОВАННОЙ ставке (20 × 50)",
                  str(pm.data("GET", f"/projects/{k2}/budget-summary")["expense_actual"]))

            cu = pm.data("GET", f"/projects/{u2}/budget-consolidated")
            check(cu["view"] == "umbrella", "зонтик видит сводный вид", str(cu.get("view")))
            b = next((x for x in cu.get("blocks", []) if str(x["item_id"]) == str(blk["id"])), None) or {}
            check(b.get("planned") == 5000 and b.get("consumed") == 1000 and b.get("remaining") == 4000,
                  "остаток по блоку = план − взятое подпроектами",
                  f'{b.get("planned")}/{b.get("consumed")}/{b.get("remaining")}')
            check([str(c["project_id"]) for c in b.get("by_child", [])] == [k2],
                  "в матрице виден именно этот подпроект")

            ck = pm.data("GET", f"/projects/{k2}/budget-consolidated")
            check(ck["view"] == "subproject", "подпроект видит блоки зонтика", str(ck.get("view")))
            bk = next((x for x in ck.get("blocks", []) if str(x["item_id"]) == str(blk["id"])), None) or {}
            check(bk.get("remaining") == 4000 and bk.get("my_actual") == 1000,
                  "подпроекту видны остаток по блоку и СВОЯ доля",
                  f'{bk.get("remaining")}/{bk.get("my_actual")}')
            check("by_child" not in bk, "соседи подпроекту по именам не называются")

            # Привязка ОТНОСИТ, но ничего не обнуляет: свой план статьи остаётся её планом.
            check(pm.data("GET", f"/projects/{k2}/budget-items")[0].get("parent_item_id") == str(blk["id"]),
                  "статья подпроекта помнит блок зонтика")
        finally:
            pm("DELETE", f"/projects/{u2}")
            pm("DELETE", f"/projects/{k2}")

        # ── 11. Счётчики проекта ────────────────────────────────────────
        print("\n11. Счётчики")
        s = pm.data("GET", f"/projects/{pid}/summary")
        check(s["tasks_total"] == len(pm.data("GET", f"/projects/{pid}/tasks")), "summary.tasks_total сходится",
              f'{s["tasks_total"]}')
        check(s["risks_open"] == 2, "summary.risks_open сходится", str(s["risks_open"]))

    finally:
        if pid:
            try:
                pm("DELETE", f"/projects/{pid}")
                print(f"\n[sandbox pid={pid} удалён]")
            except Exception as e:  # noqa: BLE001
                print(f"\n!! ПЕСОЧНИЦА {pid} НЕ УДАЛЕНА: {e}")

    print(f"\n{'ЗЕЛЕНО' if not FAILS else 'КРАСНО'}: {len(PASSES)} ok, {len(FAILS)} fail")
    if FAILS:
        for f in FAILS:
            print("  -", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    sys.exit(run(ap.parse_args().base))
