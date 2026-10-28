# -*- coding: utf-8 -*-
"""Слой доступа к PostgreSQL для pmo-backend v2 (замена транспорта к OpenProject).

Ключевая идея миграции: наружу этот модуль отдаёт данные в ТОЙ ЖЕ форме, что раньше
приходила из OpenProject REST API («WP-шим», «project-шим»). Благодаря этому все
мапперы (_wp_to_task, _wp_to_risk, to_project, _levels, _status_name…), вся бизнес-логика
и большинство тестов остаются нетронутыми — меняется только источник строк.

Правила совместимости (нарушение любого = красный golden-дифф):
  * порядок: проекты id DESC (так отдавал OpenProject), задачи/риски id ASC;
  * json.loads вручную (не asyncpg-кодек) — иначе числа станут Decimal, а порядок ключей поедет;
  * created_at/updated_at — TEXT в формате OP ('…sss'Z'), генерируются _op_now();
  * даты задач из DATE-колонок отдаём строками 'YYYY-MM-DD' — весь даунстрим сравнивает строки;
  * часы: 40.0 → 40 (JS присылает целое, и golden ждёт целое).
"""
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Optional

import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://pmo:pmo@localhost:5433/pmo")

_pool: Optional[asyncpg.Pool] = None

# Обратные карты к TYPE_ID/STATUS_ID из main.py — шим воспроизводит _links OpenProject.
_TYPE_TITLE = {"phase": "Summary task", "task": "Task", "milestone": "Milestone"}
_STATUS_ID = {"not_started": 1, "in_progress": 7, "completed": 12, "cancelled": 14, "on_hold": 13}

_TASK_EXTRA_COLS = ("priority", "assignee_name", "assignee_email", "assignee_person_id", "bar_color",
                    "bitrix24_task_id", "actual_start", "actual_end", "wbs_code", "sort_order",
                    "estimated_hours", "actual_hours", "co_assignees")
# JSON-колонки задачи: выбираются как текст и разбираются в шиме (как `risks.updates`).
_TASK_JSON_COLS = ("co_assignees",)
_RISK_EXTRA_COLS = ("code", "category", "probability", "impact", "status", "owner",
                    "mitigation_plan", "contingency_plan", "related_task_id")


def _op_now() -> str:
    """Таймстемп в формате OpenProject: 2026-07-09T13:00:44.029Z (мс + Z)."""
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _num(v):
    """40.0 → 40 (целые часы приходят от JS целыми и такими же обязаны уйти)."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def _d(v) -> Optional[str]:
    """DATE → 'YYYY-MM-DD' (даунстрим-код сравнивает даты как строки)."""
    return v.isoformat() if isinstance(v, date) else v


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10, command_timeout=30)
    return _pool


async def close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("db pool не инициализирован")
    return _pool


@asynccontextmanager
async def transaction():
    """Единая атомарная область: `async with db.transaction() as con: ... con=con`.
    Функции insert_* принимают con → все записи внутри блока фиксируются одной транзакцией."""
    async with pool().acquire() as con:
        async with con.transaction():
            yield con


async def apply_schema(path: Optional[str] = None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    async with pool().acquire() as con:
        await con.execute(sql)


# ─────────────────────────── шимы: строка БД → форма OpenProject ───────────────────────────

def project_shim(r: asyncpg.Record) -> dict:
    """Строка projects → элемент, неотличимый от проекта OpenProject для to_project()/_meta()."""
    return {
        "id": r["id"],
        "identifier": r["identifier"],
        "name": r["name"],
        "description": {"raw": r["meta"]},     # meta хранится текстом → _meta() сделает json.loads
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "lockVersion": r["version"],           # наружу не уходит; нужен save_meta_full/with_meta_retry
        "active": True,
        "parent_id": _rec(r, "parent_id"),
        # Транзиентный блок дерева: попадает в мету через project_meta.parse и снимается
        # там же перед записью. В сам JSON проекта НЕ уходит никогда.
        "_tree": {
            "parent_id": _rec(r, "parent_id"),
            "parent_code": _rec(r, "parent_code") or _rec(r, "parent_identifier"),
            "parent_name": _rec(r, "parent_name"),
            "parent_budget_rate": _rec(r, "parent_budget_rate"),
            "subprojects_count": _rec(r, "subprojects_count") or 0,
            "inherited_editors": list(_rec(r, "inh_editors") or []),
            "inherited_observers": list(_rec(r, "inh_observers") or []),
        },
    }


def task_shim(r: asyncpg.Record) -> dict:
    """Строка tasks → work package в форме OpenProject (для _wp_to_task/_levels/_status_name)."""
    links: dict = {
        "type": {"title": _TYPE_TITLE.get(r["task_type"], "Task")},
        "status": {"href": f"/api/v3/statuses/{_STATUS_ID.get(r['status'], 1)}"},
    }
    if r["parent_id"] is not None:
        links["parent"] = {"href": f"/api/v3/work_packages/{r['parent_id']}"}
    return {
        "id": r["id"],
        "subject": r["title"],
        "description": {"raw": r["description"] or ""},
        "startDate": _d(r["planned_start"]),
        "dueDate": _d(r["planned_end"]),
        "percentageDone": r["progress"],
        "createdAt": r["created_at"],
        "lockVersion": r["version"],
        "_links": links,
    }


def risk_shim(r: asyncpg.Record) -> dict:
    return {
        "id": r["id"],
        "subject": r["title"],
        "description": {"raw": r["description"] or ""},
        "createdAt": r["created_at"],
        "lockVersion": r["version"],
        "_links": {"type": {"title": "Risk"}, "status": {"href": "/api/v3/statuses/1"}},
    }


def task_extra(rows) -> dict:
    """Колонки-сайдкары обратно в форму meta['_task_extra'] = {wpid: {...}}."""
    out = {}
    for r in rows:
        ext = {}
        for k in _TASK_EXTRA_COLS:
            v = r[k]
            if v is None:
                continue
            if k in _TASK_JSON_COLS:
                try:
                    parsed = json.loads(v) if isinstance(v, str) else v
                except ValueError:
                    parsed = []
                if parsed:
                    ext[k] = parsed
            else:
                ext[k] = _num(v) if k in ("estimated_hours", "actual_hours") else v
        if ext:
            out[str(r["id"])] = ext
    return out


def risk_extra(rows) -> dict:
    out = {}
    for r in rows:
        ext = {k: r[k] for k in _RISK_EXTRA_COLS if r[k] is not None}
        ups = json.loads(r["updates"]) if r["updates"] else []
        if ups:
            ext["updates"] = ups
        if ext:
            out[str(r["id"])] = ext
    return out


# ─────────────────────────── проекты ───────────────────────────

_PROJ_COLS = "id, name, identifier, meta::text AS meta, version, created_at, updated_at"

# ─────────────────────────── дерево проектов: зонтик → подпроекты ───────────────────────────
# Права по дереву ВЫЧИСЛЯЮТСЯ, а не хранятся. Это единственное место, где записано правило:
#   • РП и со-РП ЗОНТИКА правят подпроект     → inh_editors у подпроекта;
#   • РП и со-РП подпроекта читают зонтик и соседей, наблюдатели зонтика читают подпроекты
#                                             → inh_observers.
# Материализовать это в _editors/_observers нельзя: маршруты со-РП читают тот же список,
# мутируют и пишут обратно — первая же правка навсегда впечатала бы наследование в мету.
# Поэтому колонки транзиентные: project_shim кладёт их в `_tree`, project_meta.raw_for_save
# снимает перед записью, а _owns_item/_observes_item просто спрашивают.
_TREE_CTE = """
WITH mem AS (
  SELECT id, parent_id, meta->>'pm_id' AS pm_id,
    ARRAY(SELECT e FROM json_array_elements_text(
      CASE WHEN json_typeof(meta->'_editors')   = 'array' THEN meta->'_editors'   ELSE '[]'::json END) e) AS editors,
    ARRAY(SELECT o FROM json_array_elements_text(
      CASE WHEN json_typeof(meta->'_observers') = 'array' THEN meta->'_observers' ELSE '[]'::json END) o) AS observers
  FROM projects),
tree AS (
  SELECT p.id,
    par_p.identifier AS parent_identifier,
    par_p.meta->>'code' AS parent_code,
    par_p.name AS parent_name,
    par_p.meta->>'budget_rate' AS parent_budget_rate,
    (SELECT count(*) FROM projects c WHERE c.parent_id = p.id)::int AS subprojects_count,
    -- Себя из наследования вычитаем: кто указан в проекте напрямую, в списке «унаследованных»
    -- не нужен — иначе одно имя стояло бы в двух колонках и путало бы читателя.
    ARRAY(SELECT x FROM (
        SELECT unnest(array_prepend(par.pm_id, par.editors)) AS x FROM mem par WHERE par.id = p.parent_id
      ) t WHERE x IS NOT NULL AND x <> '' AND x <> COALESCE(own.pm_id, '')
          AND NOT (x = ANY(own.editors)) ORDER BY x) AS inh_editors,
    ARRAY(SELECT x FROM (
        SELECT unnest(array_prepend(c.pm_id, c.editors)) AS x FROM mem c WHERE c.parent_id = p.id
        UNION SELECT unnest(array_prepend(s.pm_id, s.editors)) FROM mem s
              WHERE p.parent_id IS NOT NULL AND s.parent_id = p.parent_id AND s.id <> p.id
        UNION SELECT unnest(par2.observers) FROM mem par2 WHERE par2.id = p.parent_id
      ) t WHERE x IS NOT NULL AND x <> '' AND x <> COALESCE(own.pm_id, '')
          AND NOT (x = ANY(own.editors)) AND NOT (x = ANY(own.observers)) ORDER BY x) AS inh_observers
  FROM projects p
  JOIN mem own ON own.id = p.id
  LEFT JOIN projects par_p ON par_p.id = p.parent_id)
"""

# Полный SELECT строки проекта вместе с деревом. Порядок и состав _PROJ_COLS сохранён —
# добавлены только новые колонки в хвост, поэтому project_shim совместим с обеими формами.
_PROJ_SELECT = (_TREE_CTE + "SELECT p.id, p.name, p.identifier, p.meta::text AS meta, p.version, "
                "p.created_at, p.updated_at, p.parent_id, t.parent_code, t.parent_identifier, "
                "t.parent_name, t.parent_budget_rate, t.subprojects_count, t.inh_editors, t.inh_observers "
                # `WHERE TRUE` — опора для композиции: вызывающие дописывают " AND …" либо
                # сразу " ORDER BY …". Без неё первая же добавка ломала бы синтаксис.
                "FROM projects p JOIN tree t ON t.id = p.id WHERE TRUE")


def _rec(r, key, default=None):
    """Значение колонки, если она вообще есть в строке.

    Строки из INSERT ... RETURNING _PROJ_COLS приходят БЕЗ колонок дерева, и обращение по
    отсутствующему ключу у asyncpg.Record бросает. Один хелпер вместо try/except на каждой.
    """
    try:
        return r[key]
    except (KeyError, IndexError):
        return default


async def fetch_project_rows(owner_scope: Optional[str] = None) -> list:
    # id DESC — так отдавал GET /api/v3/projects; от порядка зависят /projects, /portfolio и срезы [:N]
    if owner_scope is None:
        sql = _PROJ_SELECT + " ORDER BY p.id DESC"   # те же строки в том же порядке, плюс дерево
        args: list = []
    else:
        # RBAC-предфильтр в SQL (мета — тип json, ->> работает; НЕ jsonb — порядок ключей в контракте):
        # владелец по pm_id ИЛИ в _editors, плюс наблюдатель в _observers (только чтение —
        # write-гарды спрашивают _owns_item отдельно и наблюдателя не пускают). Python-фильтр _owns_item у вызывающих остаётся страховкой,
        # поэтому SQL может лишь НЕ-доотдать — чего не будет (аудит: _editors всегда массив, pm_id скаляр).
        sql = (
            _PROJ_SELECT + " AND (p.meta->>'pm_id' = $1 "
            "OR EXISTS (SELECT 1 FROM json_array_elements_text("
            "  CASE WHEN json_typeof(p.meta->'_editors') = 'array' THEN p.meta->'_editors' ELSE '[]'::json END"
            ") AS e(val) WHERE e.val = $1) "
            "OR EXISTS (SELECT 1 FROM json_array_elements_text("
            "  CASE WHEN json_typeof(p.meta->'_observers') = 'array' THEN p.meta->'_observers' ELSE '[]'::json END"
            ") AS o(val) WHERE o.val = $1) "
            # Ветки дерева: те же массивы, что потом перепроверит Python в _owns_item/_observes_item.
            # SQL может лишь НЕ-доотдать — расходиться им не на чем, источник один.
            "OR $1 = ANY(t.inh_editors) OR $1 = ANY(t.inh_observers)) "
            "ORDER BY p.id DESC"
        )
        args = [owner_scope]
    async with pool().acquire() as con:
        rows = await con.fetch(sql, *args)
    return [project_shim(r) for r in rows]


async def get_project_row(pid) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(_PROJ_SELECT + " AND p.id = $1", int(pid))
    return project_shim(r) if r else None


async def fetch_project_rows_by_ids(ids) -> list:
    """Строки проектов по списку id — тем же SELECT, что и всё остальное (значит с деревом)."""
    wanted = [int(x) for x in (ids or [])]
    if not wanted:
        return []
    async with pool().acquire() as con:
        rows = await con.fetch(_PROJ_SELECT + " AND p.id = ANY($1::int[]) ORDER BY p.id DESC", wanted)
    return [project_shim(r) for r in rows]


async def child_project_ids(pid) -> list:
    """id подпроектов зонтика. Без меты и без дерева — нужен только список."""
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT id FROM projects WHERE parent_id = $1 ORDER BY id DESC", int(pid))
    return [str(r["id"]) for r in rows]


async def set_project_parent(child_id, parent_id) -> str:
    """Привязать подпроект к зонтику (parent_id=None — отвязать). Возвращает КОД исхода.

    Код, а не исключение: маршрут сам решает, какой это HTTP-статус, а тексты отказов — часть
    контракта. Вся проверка внутри ОДНОЙ транзакции с `FOR UPDATE` на обеих строках: правило
    «уровень ровно один» касается двух записей сразу, и без блокировки два одновременных
    запроса могли бы построить трёхуровневую цепочку, каждый по отдельности проверив «всё ок».

    `version` намеренно НЕ увеличиваем: связь не часть паспорта, и открытый у кого-то паспорт
    не должен получить ложный конфликт версий.
    """
    cid = int(child_id)
    pidv = None if parent_id in (None, "", 0) else int(parent_id)
    if pidv is not None and pidv == cid:
        return "self"
    async with pool().acquire() as con:
        async with con.transaction():
            ids = sorted({cid} | ({pidv} if pidv is not None else set()))   # один порядок блокировок — нет дедлока
            rows = await con.fetch("SELECT id, parent_id FROM projects WHERE id = ANY($1::int[]) FOR UPDATE", ids)
            by_id = {r["id"]: r for r in rows}
            if cid not in by_id or (pidv is not None and pidv not in by_id):
                return "missing"
            if pidv is not None:
                if by_id[pidv]["parent_id"] is not None:
                    return "parent_has_parent"      # зонтик сам подпроект — второй уровень запрещён
                cur = by_id[cid]["parent_id"]
                if cur is not None and cur != pidv:
                    return "child_already_linked"
                kids = await con.fetchval("SELECT count(*) FROM projects WHERE parent_id = $1", cid)
                if kids:
                    return "child_has_children"     # у ребёнка свои дети — он сам зонтик
            await con.execute("UPDATE projects SET parent_id = $1, updated_at = $2 WHERE id = $3",
                              pidv, _op_now(), cid)
    return "ok"


async def update_project_meta(pid, meta_raw: str, expected_version: int, name: Optional[str] = None,
                              colls: Optional[dict] = None) -> bool:
    """Оптимистичная блокировка: False = кто-то опередил (аналог 409 lockVersion).

    `colls` (нормализованные коллекции _action_log/_meetings/_backlog/_notes) переписываются
    в ТОЙ ЖЕ транзакции, что и мета — version-bump сериализует и их записи, поэтому
    оптимистичная блокировка защищает коллекции от потери обновлений, как раньше в meta.
    """
    async with pool().acquire() as con:
        async with con.transaction():
            if name is None:
                res = await con.execute(
                    "UPDATE projects SET meta = $1::json, version = version + 1, updated_at = $2 "
                    "WHERE id = $3 AND version = $4", meta_raw, _op_now(), int(pid), int(expected_version))
            else:
                res = await con.execute(
                    "UPDATE projects SET meta = $1::json, name = $2, version = version + 1, updated_at = $3 "
                    "WHERE id = $4 AND version = $5", meta_raw, name, _op_now(), int(pid), int(expected_version))
            ok = res.split()[-1] != "0"
            if ok and colls is not None:
                for coll, items in colls.items():
                    await con.execute("DELETE FROM project_docs WHERE project_id = $1 AND coll = $2",
                                      int(pid), coll)
                    for seq, doc in enumerate(items or []):
                        await con.execute(
                            "INSERT INTO project_docs (project_id, coll, seq, doc) VALUES ($1, $2, $3, $4::json)",
                            int(pid), coll, int(seq), json.dumps(doc, ensure_ascii=False))
    return ok


async def load_project_docs(pid) -> dict:
    """Нормализованные коллекции одного проекта: {coll: [doc, …]} в порядке seq."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT coll, doc::text AS doc FROM project_docs WHERE project_id = $1 ORDER BY coll, seq ASC",
            int(pid))
    out: dict = {}
    for r in rows:
        out.setdefault(r["coll"], []).append(json.loads(r["doc"]))
    return out


async def load_all_project_docs() -> dict:
    """Bulk для fetch_projects: {pid(str): {coll: [doc, …]}} одним запросом."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT project_id, coll, doc::text AS doc FROM project_docs ORDER BY project_id, coll, seq ASC")
    out: dict = {}
    for r in rows:
        out.setdefault(str(r["project_id"]), {}).setdefault(r["coll"], []).append(json.loads(r["doc"]))
    return out


async def load_project_docs_for(pids) -> dict:
    """Как load_all_project_docs, но только по заданным pid (scoped-ветка fetch_projects для pm-скоупа).
    Та же выборка/группировка/порядок (project_id, coll, seq ASC) → merge меты байт-идентичен."""
    if not pids:
        return {}
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT project_id, coll, doc::text AS doc FROM project_docs "
            "WHERE project_id = ANY($1::bigint[]) ORDER BY project_id, coll, seq ASC",
            [int(p) for p in pids])
    out: dict = {}
    for r in rows:
        out.setdefault(str(r["project_id"]), {}).setdefault(r["coll"], []).append(json.loads(r["doc"]))
    return out


async def append_action_log(pid, entry: dict, cap: int) -> None:
    """Append-only запись в журнал действий БЕЗ бампа projects.version — правка задачи/риска
    больше не конфликтует с параллельной правкой паспорта (ложный 409). Advisory-lock сериализует
    конкурентные append по проекту (иначе гонка seq → нарушение PRIMARY KEY). Триммит до cap записей."""
    if _pool is None:
        return  # оффлайн-юнит-тесты без Postgres
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"alog:{int(pid)}")
            seq = await con.fetchval(
                "SELECT COALESCE(MAX(seq)+1, 0) FROM project_docs WHERE project_id=$1 AND coll='_action_log'",
                int(pid))
            await con.execute(
                "INSERT INTO project_docs (project_id, coll, seq, doc) VALUES ($1, '_action_log', $2, $3::json)",
                int(pid), seq, json.dumps(entry, ensure_ascii=False))
            # оставить только последние cap записей (по seq)
            await con.execute(
                "DELETE FROM project_docs WHERE project_id=$1 AND coll='_action_log' AND seq <= "
                "(SELECT COALESCE(MAX(seq), -1) FROM (SELECT seq FROM project_docs "
                " WHERE project_id=$1 AND coll='_action_log' ORDER BY seq DESC OFFSET $2) t)",
                int(pid), cap)


async def insert_project(name: str, identifier: str, meta_raw: str, con=None) -> dict:
    now = _op_now()
    sql = ("INSERT INTO projects (name, identifier, meta, version, created_at, updated_at) "
           f"VALUES ($1, $2, $3::json, 0, $4, $4) RETURNING {_PROJ_COLS}")
    if con is not None:
        r = await con.fetchrow(sql, name, identifier, meta_raw, now)
    else:
        async with pool().acquire() as c:
            r = await c.fetchrow(sql, name, identifier, meta_raw, now)
    return project_shim(r)


async def delete_project(pid) -> None:
    async with pool().acquire() as con:
        await con.execute("DELETE FROM projects WHERE id = $1", int(pid))


# ─────────────────────────── задачи и риски ───────────────────────────

# JSON-колонки выбираем как ТЕКСТ: asyncpg иначе отдаёт их строкой без гарантий, а шим
# (task_extra) разбирает единообразно — тот же приём, что у `risks.updates`.
_TASK_COLS = ("id, project_id, title, description, task_type, status, planned_start, planned_end, "
              "progress, parent_id, version, created_at, "
              + ", ".join((c + "::text AS " + c) if c in _TASK_JSON_COLS else c
                          for c in _TASK_EXTRA_COLS))
_RISK_COLS = ("id, project_id, title, description, version, created_at, updates::text AS updates, "
              + ", ".join(_RISK_EXTRA_COLS))


async def fetch_tasks(pid, only_type: Optional[str] = None):
    q = f"SELECT {_TASK_COLS} FROM tasks WHERE project_id = $1"
    args: list = [int(pid)]
    if only_type:
        q += " AND task_type = $2"
        args.append(only_type)
    async with pool().acquire() as con:
        return await con.fetch(q + " ORDER BY id ASC", *args)


async def fetch_tasks_bulk(pids, only_type: Optional[str] = None):
    if not pids:
        return {}
    q = f"SELECT {_TASK_COLS} FROM tasks WHERE project_id = ANY($1::int[])"
    args: list = [[int(p) for p in pids]]
    if only_type:
        q += " AND task_type = $2"
        args.append(only_type)
    async with pool().acquire() as con:
        rows = await con.fetch(q + " ORDER BY id ASC", *args)
    out: dict = {str(p): [] for p in pids}
    for r in rows:
        out[str(r["project_id"])].append(r)
    return out


async def fetch_risks(pid):
    async with pool().acquire() as con:
        return await con.fetch(f"SELECT {_RISK_COLS} FROM risks WHERE project_id = $1 ORDER BY id ASC", int(pid))


async def fetch_risks_bulk(pids):
    if not pids:
        return {}
    async with pool().acquire() as con:
        rows = await con.fetch(
            f"SELECT {_RISK_COLS} FROM risks WHERE project_id = ANY($1::int[]) ORDER BY id ASC",
            [int(p) for p in pids])
    out: dict = {str(p): [] for p in pids}
    for r in rows:
        out[str(r["project_id"])].append(r)
    return out


async def get_task(tid):
    async with pool().acquire() as con:
        return await con.fetchrow(f"SELECT {_TASK_COLS} FROM tasks WHERE id = $1", int(tid))


async def get_risk(rid):
    async with pool().acquire() as con:
        return await con.fetchrow(f"SELECT {_RISK_COLS} FROM risks WHERE id = $1", int(rid))


async def task_in_project(tid, pid) -> bool:
    """Типизированная anti-IDOR проверка: задача действительно принадлежит проекту."""
    async with pool().acquire() as con:
        return bool(await con.fetchval(
            "SELECT 1 FROM tasks WHERE id = $1 AND project_id = $2", int(tid), int(pid)))


async def project_task_ids(pid) -> set:
    """Множество id всех задач проекта одним запросом — для batch-валидации reorder (без N+1)."""
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT id FROM tasks WHERE project_id = $1", int(pid))
    return {str(r["id"]) for r in rows}


async def project_task_parents(pid) -> dict:
    """{id: parent_id|None} по всему проекту — чтобы проверить reorder на петлю в памяти."""
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT id, parent_id FROM tasks WHERE project_id = $1", int(pid))
    return {str(r["id"]): (str(r["parent_id"]) if r["parent_id"] is not None else None) for r in rows}


async def risk_in_project(rid, pid) -> bool:
    """Типизированная anti-IDOR проверка: риск действительно принадлежит проекту."""
    async with pool().acquire() as con:
        return bool(await con.fetchval(
            "SELECT 1 FROM risks WHERE id = $1 AND project_id = $2", int(rid), int(pid)))


async def insert_task(pid, fields: dict, con=None):
    fields = {k: v for k, v in fields.items() if v is not None or k in ("planned_start", "planned_end")}
    cols = ["project_id", "created_at"] + list(fields)
    vals = [int(pid), _op_now()] + list(fields.values())
    ph = ", ".join(f"${i+1}" for i in range(len(vals)))
    sql = f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({ph}) RETURNING {_TASK_COLS}"
    if con is not None:
        return await con.fetchrow(sql, *vals)
    async with pool().acquire() as c:
        return await c.fetchrow(sql, *vals)


async def insert_tasks(pid, rows: list) -> list:
    """Массовое создание задач в ОДНОЙ транзакции (атомарно, без частичной вставки).
    Возвращает id в порядке rows (id из последовательности растут монотонно со вставкой)."""
    ids = []
    async with transaction() as con:
        for fields in rows:
            r = await insert_task(pid, fields, con=con)
            ids.append(r["id"])
    return ids


async def insert_risk(pid, fields: dict, con=None):
    cols = ["project_id", "created_at"] + list(fields)
    vals = [int(pid), _op_now()] + list(fields.values())
    ph = ", ".join(f"${i+1}" for i in range(len(vals)))
    sql = f"INSERT INTO risks ({', '.join(cols)}) VALUES ({ph}) RETURNING {_RISK_COLS}"
    if con is not None:
        return await con.fetchrow(sql, *vals)
    async with pool().acquire() as c:
        return await c.fetchrow(sql, *vals)


async def update_row(table: str, rid, fields: dict, cols: str):
    """UPDATE с инкрементом version. Пустой fields = просто вернуть строку."""
    if not fields:
        async with pool().acquire() as con:
            return await con.fetchrow(f"SELECT {cols} FROM {table} WHERE id = $1", int(rid))
    sets = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool().acquire() as con:
        return await con.fetchrow(
            f"UPDATE {table} SET {sets}, version = version + 1 WHERE id = $1 RETURNING {cols}",
            int(rid), *fields.values())


async def update_task(tid, fields: dict):
    return await update_row("tasks", tid, fields, _TASK_COLS)


async def update_risk(rid, fields: dict):
    return await update_row("risks", rid, fields, _RISK_COLS)


async def delete_wp(table: str, wid) -> None:
    """Удаление задачи/риска + чистка того, что в OpenProject уносил каскад движка."""
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("DELETE FROM activities WHERE wp_id = $1", int(wid))
            await con.execute("DELETE FROM attachments WHERE wp_id = $1", int(wid))
            if table == "tasks":
                await con.execute("DELETE FROM deps WHERE task_id = $1 OR depends_on_id = $1", int(wid))
            await con.execute(f"DELETE FROM {table} WHERE id = $1", int(wid))


async def wp_project_id(wid) -> Optional[int]:
    """Проект, которому принадлежит WP (анти-IDOR: _wp_in_project)."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT project_id FROM tasks WHERE id = $1 UNION ALL SELECT project_id FROM risks WHERE id = $1",
            int(wid))
    return r["project_id"] if r else None


async def task_by_bitrix(bx_id) -> Optional[dict]:
    """+ status и bx_status: входящему вебхуку они нужны, чтобы отличить правку человека
    от эха собственного push'а. Наружу эта строка не сериализуется."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT id, project_id, status, bx_status FROM tasks WHERE bitrix24_task_id = $1", int(bx_id))
    return dict(r) if r else None


async def tasks_with_bitrix(pid) -> list:
    """Задачи проекта, связанные с задачей в Bitrix (для PULL-синка статусов и фактических дат).
    Отдаём id/status/bx_status/bitrix24_task_id: bx_status нужен для того же echo-guard, что во
    входящем вебхуке. actual_start/actual_end — чтобы синк МОГ СРАВНИТЬ и не писал неизменившееся:
    update_row бампает version на каждом вызове, а синк ходит раз в 15 минут."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, status, bx_status, bitrix24_task_id, actual_start, actual_end FROM tasks "
            "WHERE project_id = $1 AND bitrix24_task_id IS NOT NULL", int(pid))
    return [dict(r) for r in rows]


async def set_task_bx_status(tid, code: Optional[str]) -> None:
    """Запомнить код статуса, который сейчас стоит в Bitrix. Версию задачи НЕ бампаем:
    это служебная отметка интеграции, а не правка пользователя — иначе открытая у РП
    карточка ловила бы ложный 409 на ровном месте."""
    if _pool is None:
        return
    async with pool().acquire() as con:
        await con.execute("UPDATE tasks SET bx_status = $2 WHERE id = $1", int(tid), code)


# ───────────────────── журнал синхронизации Bitrix24 ─────────────────────

_BX_LOG_CAP = 200   # окно журнала; фронт показывает последние 50


async def append_bitrix_log(entry: dict) -> None:
    """Дописать запись и подрезать хвост. Журнал — вспомогательный: без пула (юнит-тесты
    без Postgres) молча выходим, ошибку записи наружу не пускаем."""
    if _pool is None:
        return
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO bitrix_sync_log (task_id, bitrix24_task_id, sync_action, status, error_message, synced_at) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            int(entry["task_id"]) if entry.get("task_id") else None,
            int(entry["bitrix24_task_id"]) if entry.get("bitrix24_task_id") else None,
            str(entry.get("sync_action") or ""), str(entry.get("status") or ""),
            (entry.get("error_message") or None), str(entry.get("synced_at") or _op_now()))
        await con.execute(
            "DELETE FROM bitrix_sync_log WHERE id <= "
            "(SELECT COALESCE(MAX(id), 0) - $1 FROM bitrix_sync_log)", _BX_LOG_CAP)


async def fetch_bitrix_log(limit: int = 50) -> list:
    if _pool is None:
        return []
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, task_id, bitrix24_task_id, sync_action, status, error_message, synced_at "
            "FROM bitrix_sync_log ORDER BY id DESC LIMIT $1", int(limit))
    return [{"id": str(r["id"]),                                   # id наружу — строкой (контракт)
             "task_id": str(r["task_id"]) if r["task_id"] is not None else None,
             "bitrix24_task_id": r["bitrix24_task_id"],
             "sync_action": r["sync_action"], "status": r["status"],
             "error_message": r["error_message"], "synced_at": r["synced_at"]} for r in rows]


# ─────────────────────────── зависимости ───────────────────────────

async def fetch_deps(pid) -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, task_id, depends_on_id, dependency_type, lag_days FROM deps "
            "WHERE project_id = $1 ORDER BY seq ASC", int(pid))
    return [{"id": r["id"], "task_id": str(r["task_id"]), "depends_on_id": str(r["depends_on_id"]),
             "dependency_type": r["dependency_type"], "lag_days": r["lag_days"]} for r in rows]


async def insert_dep(pid, did: str, task_id, depends_on_id, dtype: str, lag: int, con=None) -> None:
    sql = ("INSERT INTO deps (id, project_id, task_id, depends_on_id, dependency_type, lag_days, seq) "
           "VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(seq)+1 FROM deps WHERE project_id=$2), 0))")
    args = (did, int(pid), int(task_id), int(depends_on_id), dtype, int(lag))
    if con is not None:
        await con.execute(sql, *args)
        return
    async with pool().acquire() as c:
        await c.execute(sql, *args)


async def reorder_tasks(items: list) -> None:
    """Атомарный многострочный reorder: sort_order/wbs_code пишем всегда, parent_id — если задан
    (setp=True; сохраняет прежнее значение, если ключ не прислан). Одна транзакция вместо N
    автокоммитов → нет частичного reorder при сбое. version бампается по строке, как раньше."""
    if not items:
        return
    ids, sos, wcs, setp, pids = [], [], [], [], []
    for tid, fields in items:
        ids.append(int(tid))
        sos.append(fields.get("sort_order"))
        wcs.append(fields.get("wbs_code"))
        has_parent = "parent_id" in fields
        setp.append(has_parent)
        pids.append(fields.get("parent_id") if has_parent else None)
    async with pool().acquire() as con:
        await con.execute(
            "UPDATE tasks AS t SET sort_order = v.so, wbs_code = v.wc, "
            "parent_id = CASE WHEN v.setp THEN v.pid ELSE t.parent_id END, version = t.version + 1 "
            "FROM unnest($1::bigint[], $2::int[], $3::text[], $4::bool[], $5::bigint[]) "
            "AS v(id, so, wc, setp, pid) WHERE t.id = v.id",
            ids, sos, wcs, setp, pids)


async def delete_dep(pid, did: str) -> None:
    async with pool().acquire() as con:
        await con.execute("DELETE FROM deps WHERE project_id = $1 AND id = $2", int(pid), did)


# ─────────────────────────── история / комментарии ───────────────────────────

async def fetch_activities(wpid) -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, version, user_title, comment, details::text AS details, created_at "
            "FROM activities WHERE wp_id = $1 ORDER BY version ASC", int(wpid))
    return [{"id": r["id"], "version": r["version"], "user": r["user_title"],
             "comment": r["comment"] or None, "details": json.loads(r["details"]),
             "created_at": r["created_at"]} for r in rows]


async def insert_activity(pid, wpid, comment: str, author_name: Optional[str] = None,
                          details: Optional[list] = None, user_title: Optional[str] = None) -> dict:
    now = _op_now()
    async with pool().acquire() as con:
        async with con.transaction():
            v = await con.fetchval("SELECT COALESCE(MAX(version), 0) + 1 FROM activities WHERE wp_id = $1", int(wpid))
            r = await con.fetchrow(
                "INSERT INTO activities (project_id, wp_id, version, user_title, author_name, comment, details, created_at) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7::json, $8) RETURNING id, created_at",
                int(pid), int(wpid), v, user_title, author_name, comment,
                json.dumps(details or [], ensure_ascii=False), now)
    return {"id": r["id"], "created_at": r["created_at"]}


# ─────────────────────────── вложения ───────────────────────────

async def fetch_attachments(wpid) -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, file_name, content_type, file_size, author_title, created_at "
            "FROM attachments WHERE wp_id = $1 ORDER BY id ASC", int(wpid))
    return [{"id": r["id"], "file_name": r["file_name"], "content_type": r["content_type"],
             "file_size": r["file_size"], "author": r["author_title"], "created_at": r["created_at"]} for r in rows]


# ─────────────────────── реестр проектов переходного периода ───────────────────────

_REG_COLS = "id, pm_name, name, kind, rag, customer, phase, note, project_id, sort_order, created_at, updated_at"
_REG_FIELDS = ("pm_name", "name", "kind", "rag", "customer", "phase", "note", "project_id", "sort_order")


def _registry_row(r) -> dict:
    return {"id": str(r["id"]), "pm_name": r["pm_name"], "name": r["name"], "kind": r["kind"],
            "rag": r["rag"], "customer": r["customer"], "phase": r["phase"], "note": r["note"],
            "project_id": str(r["project_id"]) if r["project_id"] is not None else None,
            "sort_order": r["sort_order"], "created_at": r["created_at"], "updated_at": r["updated_at"]}


async def fetch_registry() -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(f"SELECT {_REG_COLS} FROM portfolio_registry ORDER BY sort_order ASC, id ASC")
    return [_registry_row(r) for r in rows]


async def insert_registry(data: dict, now: str) -> dict:
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "INSERT INTO portfolio_registry (pm_name, name, kind, rag, customer, phase, note, "
            "project_id, sort_order, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10) "
            f"RETURNING {_REG_COLS}",
            data.get("pm_name"), data.get("name") or "", data.get("kind"), data.get("rag"),
            data.get("customer"), data.get("phase"), data.get("note"),
            int(data["project_id"]) if str(data.get("project_id") or "").isdigit() else None,
            data.get("sort_order"), now)
    return _registry_row(r)


async def update_registry(rid, data: dict, now: str):
    """Правим ТОЛЬКО присланные поля: строка правится по одной ячейке, как в таблице."""
    sets, args = [], []
    for f in _REG_FIELDS:
        if f not in data:
            continue
        args.append(int(data[f]) if f in ("project_id", "sort_order") and str(data[f] or "").isdigit()
                    else (None if f == "project_id" and not data[f] else data[f]))
        sets.append(f"{f} = ${len(args)}")
    if not sets:
        return None
    args.append(now)
    sets.append(f"updated_at = ${len(args)}")
    args.append(int(rid))
    async with pool().acquire() as con:
        r = await con.fetchrow(
            f"UPDATE portfolio_registry SET {', '.join(sets)} WHERE id = ${len(args)} RETURNING {_REG_COLS}", *args)
    return _registry_row(r) if r else None


async def delete_registry(rid) -> bool:
    async with pool().acquire() as con:
        res = await con.execute("DELETE FROM portfolio_registry WHERE id = $1", int(rid))
    return res.endswith("1")


async def fetch_project_attachments(pid) -> list:
    """Вложения всего проекта — БЕЗ содержимого файла.

    Колонку `data` тут не выбираем сознательно: список нужен, чтобы знать, что приложено
    и к какой задаче, а сами файлы наружу (помощнику) не отдаются.
    """
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, wp_id, file_name, content_type, file_size, author_title, created_at "
            "FROM attachments WHERE project_id = $1 ORDER BY id ASC", int(pid))
    return [{"id": str(r["id"]), "task_id": str(r["wp_id"]), "file_name": r["file_name"],
             "content_type": r["content_type"], "file_size": r["file_size"],
             "author": r["author_title"], "created_at": r["created_at"]} for r in rows]


async def fetch_project_comments(pid, limit: int = 200) -> list:
    """Комментарии по задачам проекта, новейшие сверху. Автоматические записи об изменениях
    (у них comment пуст) не берём: их место — в журнале действий, а здесь нужен людской текст."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, wp_id, user_title, author_name, comment, created_at FROM activities "
            "WHERE project_id = $1 AND comment IS NOT NULL AND comment <> '' "
            "ORDER BY id DESC LIMIT $2", int(pid), int(limit))
    return [{"id": str(r["id"]), "task_id": str(r["wp_id"]),
             "author": r["author_name"] or r["user_title"], "comment": r["comment"],
             "created_at": r["created_at"]} for r in rows]


async def insert_attachment(pid, wpid, file_name: str, content_type: str, data: bytes,
                            author_title: Optional[str]) -> dict:
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "INSERT INTO attachments (project_id, wp_id, file_name, content_type, file_size, author_title, data, created_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, file_name, content_type, file_size, author_title, created_at",
            int(pid), int(wpid), file_name, content_type, len(data), author_title, data, _op_now())
    return {"id": r["id"], "file_name": r["file_name"], "content_type": r["content_type"],
            "file_size": r["file_size"], "author": r["author_title"], "created_at": r["created_at"]}


async def get_attachment(aid) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT id, project_id, wp_id, file_name, content_type, file_size, data FROM attachments WHERE id = $1",
            int(aid))
    return dict(r) if r else None


async def get_attachment_meta(aid) -> Optional[dict]:
    """Метаданные вложения без BYTEA — для scope/delete-проверок без чтения до 25 МБ."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT id, project_id, wp_id, file_name, content_type, file_size FROM attachments WHERE id = $1",
            int(aid))
    return dict(r) if r else None


async def delete_attachment(aid) -> None:
    async with pool().acquire() as con:
        await con.execute("DELETE FROM attachments WHERE id = $1", int(aid))


# ─────────────────────────── «Сообщить о проблеме» (F6) ───────────────────────────

async def insert_problem(reporter_email: str, reporter_name: Optional[str], description: str,
                         page_url: Optional[str], user_agent: Optional[str],
                         screenshot: Optional[bytes], screenshot_type: Optional[str],
                         created_at: str) -> int:
    async with pool().acquire() as con:
        row = await con.fetchrow(
            "INSERT INTO problem_reports (reporter_email, reporter_name, description, page_url, "
            "user_agent, screenshot, screenshot_type, screenshot_size, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
            reporter_email, reporter_name, description, page_url, user_agent, screenshot,
            screenshot_type, (len(screenshot) if screenshot else None), created_at)
    return row["id"]


_PR_COLS = ("id, reporter_email, reporter_name, description, page_url, user_agent, "
            "screenshot_type, screenshot_size, created_at, status, resolution, resolved_at, "
            "resolved_by, (screenshot IS NOT NULL) AS has_screenshot")


async def fetch_problems(limit: int = 200) -> list:
    """Список репортов БЕЗ бинарника скрина — только метаданные + флаг наличия картинки."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            f"SELECT {_PR_COLS} FROM problem_reports ORDER BY id DESC LIMIT $1", limit)
    return [dict(r) for r in rows]


async def fetch_problems_by_reporter(email: str, limit: int = 50) -> list:
    """Репорты ОДНОГО человека — чтобы показать ему, что с его обращениями стало."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            f"SELECT {_PR_COLS} FROM problem_reports WHERE reporter_email = $1 "
            "ORDER BY id DESC LIMIT $2", str(email), int(limit))
    return [dict(r) for r in rows]


async def resolve_problem(rid, resolution: Optional[str], by: str, at: str) -> bool:
    """Закрыть репорт. ТОЛЬКО из состояния open — повторное «решено» не должно двигать дату и
    заново подсвечивать автору давно прочитанный ответ."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE problem_reports SET status = 'resolved', resolution = $1, resolved_by = $2, "
            "resolved_at = $3 WHERE id = $4 AND status <> 'resolved'",
            resolution, by, at, int(rid))
    return res.endswith(" 1")


async def get_problem_screenshot(rid) -> Optional[tuple]:
    async with pool().acquire() as con:
        r = await con.fetchrow("SELECT screenshot, screenshot_type FROM problem_reports WHERE id = $1", int(rid))
    return (r["screenshot"], r["screenshot_type"]) if r and r["screenshot"] else None


async def delete_problem(rid) -> None:
    async with pool().acquire() as con:
        await con.execute("DELETE FROM problem_reports WHERE id = $1", int(rid))


# ─────────────────────────── токены помощника (MCP) ───────────────────────────

async def insert_api_token(user_email: str, name: str, token_hash: str, token_hint: str,
                           scopes: str, created_at: str, expires_at: str,
                           oauth_client_id: Optional[str] = None) -> int:
    async with pool().acquire() as con:
        row = await con.fetchrow(
            "INSERT INTO api_tokens (user_email, name, token_hash, token_hint, scopes, created_at, expires_at, "
            "oauth_client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
            user_email, name, token_hash, token_hint, scopes, created_at, expires_at, oauth_client_id)
    return row["id"]


async def find_api_token(token_hash: str) -> Optional[dict]:
    """Живой токен по хешу. Отозванные и просроченные отсекает вызывающий: ему нужно
    различать «нет такого» и «был, но отозван», чтобы написать это в журнал обращений."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT id, user_email, name, scopes, created_at, expires_at, last_used_at, revoked_at, "
            "oauth_client_id FROM api_tokens WHERE token_hash = $1", token_hash)
    return dict(r) if r else None


async def fetch_api_tokens(user_email: Optional[str] = None) -> list:
    """Список токенов. Без user_email — все (для владельца портала). Значение токена не хранится."""
    async with pool().acquire() as con:
        if user_email:
            rows = await con.fetch(
                "SELECT id, user_email, name, token_hint, scopes, created_at, expires_at, last_used_at, "
                "revoked_at FROM api_tokens WHERE user_email = $1 ORDER BY id DESC", user_email)
        else:
            rows = await con.fetch(
                "SELECT id, user_email, name, token_hint, scopes, created_at, expires_at, last_used_at, "
                "revoked_at FROM api_tokens ORDER BY id DESC")
    return [dict(r) for r in rows]


async def revoke_api_token(tid, user_email: Optional[str], at: str) -> bool:
    """Отзыв. user_email задан → отозвать можно только свой токен (владелец портала шлёт None)."""
    async with pool().acquire() as con:
        if user_email:
            res = await con.execute(
                "UPDATE api_tokens SET revoked_at = $1 WHERE id = $2 AND user_email = $3 AND revoked_at IS NULL",
                at, int(tid), user_email)
        else:
            res = await con.execute(
                "UPDATE api_tokens SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", at, int(tid))
    return res.endswith(" 1")


async def touch_api_token(tid, at: str) -> None:
    async with pool().acquire() as con:
        await con.execute("UPDATE api_tokens SET last_used_at = $1 WHERE id = $2", at, int(tid))


async def append_mcp_log(at: str, user_email: str, token_id, tool: str, project_id,
                         ok: bool, detail: str = "") -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO mcp_access_log (at, user_email, token_id, tool, project_id, ok, detail) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7)",
            at, user_email, (int(token_id) if token_id else None), tool,
            (int(project_id) if project_id else None), ok, detail[:200])


async def insert_draft(project_id, author: str, source: str, title: str, items: list,
                       created_at: str) -> int:
    async with pool().acquire() as con:
        row = await con.fetchrow(
            "INSERT INTO project_drafts (project_id, author, source, title, items, status, created_at) "
            "VALUES ($1,$2,$3,$4,$5,'open',$6) RETURNING id",
            (int(project_id) if project_id else None), author, source, title,
            json.dumps(items, ensure_ascii=False), created_at)
    return row["id"]


async def fetch_drafts(project_id=None, status: Optional[str] = None, author: Optional[str] = None) -> list:
    where, args = [], []
    if project_id is not None:
        args.append(int(project_id))
        where.append(f"project_id = ${len(args)}")
    if status:
        args.append(status)
        where.append(f"status = ${len(args)}")
    if author:
        args.append(author)
        where.append(f"author = ${len(args)}")
    sql = ("SELECT id, project_id, author, source, title, items::text AS items, status, created_at, "
           "decided_at, decided_by FROM project_drafts")
    if where:
        sql += " WHERE " + " AND ".join(where)
    async with pool().acquire() as con:
        rows = await con.fetch(sql + " ORDER BY id DESC", *args)
    return [{**dict(r), "items": json.loads(r["items"] or "[]")} for r in rows]


async def get_draft(did) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT id, project_id, author, source, title, items::text AS items, status, created_at, "
            "decided_at, decided_by, result::text AS result FROM project_drafts WHERE id = $1", int(did))
    if not r:
        return None
    d = dict(r)
    d["items"] = json.loads(d["items"] or "[]")
    d["result"] = json.loads(d["result"]) if d.get("result") else None
    return d


async def update_draft_items(did, items: list) -> bool:
    """Переписать состав черновика. Возвращает False, если черновик уже закрыт: помощник
    дописывает в него пачками, и между чтением и записью человек мог его принять."""
    async with pool().acquire() as con:
        res = await con.execute("UPDATE project_drafts SET items = $1 WHERE id = $2 AND status = 'open'",
                                json.dumps(items, ensure_ascii=False), int(did))
    return res.split()[-1] != "0"


# ─────────────────────────── запросы доступа наблюдателем ───────────────────────────

_AR_COLS = ("id, project_id, requester_id, requester_name, requester_email, note, status, "
            "created_at, decided_at, decided_by")


def _ar_shim(r) -> dict:
    """Строка запроса наружу. id и project_id — СТРОКАМИ, как все id в этом контракте."""
    return {"id": str(r["id"]), "project_id": str(r["project_id"]),
            "requester_id": r["requester_id"], "requester_name": r["requester_name"],
            "requester_email": r["requester_email"], "note": r["note"], "status": r["status"],
            "created_at": r["created_at"], "decided_at": r["decided_at"], "decided_by": r["decided_by"]}


async def insert_access_request(project_id, requester_id: str, name: Optional[str],
                                email: Optional[str], note: Optional[str], at: str) -> Optional[dict]:
    """Создать запрос. None — уже есть открытый на эту пару (ловит частичный уникальный индекс).

    Полагаемся на индекс, а не на предварительный SELECT: два одновременных клика прошли бы
    обе проверки и создали дубликат. База — единственное место, где это решается честно.
    """
    async with pool().acquire() as con:
        try:
            r = await con.fetchrow(
                "INSERT INTO access_requests (project_id, requester_id, requester_name, "
                "requester_email, note, status, created_at) "
                f"VALUES ($1, $2, $3, $4, $5, 'open', $6) RETURNING {_AR_COLS}",
                int(project_id), str(requester_id), name, email, note, at)
        except asyncpg.UniqueViolationError:
            return None
    return _ar_shim(r)


async def last_access_decision(project_id, requester_id: str) -> Optional[dict]:
    """Последнее РЕШЁННОЕ обращение этой пары — по нему считается пауза после отказа."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            f"SELECT {_AR_COLS} FROM access_requests "
            "WHERE project_id = $1 AND requester_id = $2 AND status <> 'open' "
            "ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 1",
            int(project_id), str(requester_id))
    return _ar_shim(r) if r else None


async def fetch_access_requests(project_ids=None, requester_id: Optional[str] = None,
                                only_open: bool = True, limit: int = 200) -> list:
    """Запросы по проектам (для решающего) либо свои (для просителя)."""
    where, args = [], []
    if project_ids is not None:
        if not project_ids:
            return []
        args.append([int(x) for x in project_ids])
        where.append(f"project_id = ANY(${len(args)}::int[])")
    if requester_id is not None:
        args.append(str(requester_id))
        where.append(f"requester_id = ${len(args)}")
    if only_open:
        where.append("status = 'open'")
    sql = f"SELECT {_AR_COLS} FROM access_requests"
    if where:
        sql += " WHERE " + " AND ".join(where)
    args.append(int(limit))
    sql += f" ORDER BY id DESC LIMIT ${len(args)}"
    async with pool().acquire() as con:
        rows = await con.fetch(sql, *args)
    return [_ar_shim(r) for r in rows]


async def get_access_request(rid) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(f"SELECT {_AR_COLS} FROM access_requests WHERE id = $1", int(rid))
    return _ar_shim(r) if r else None


async def decide_access_request(rid, status: str, by: str, at: str) -> bool:
    """Закрыть запрос. ТОЛЬКО из состояния open — иначе два РП решили бы один запрос дважды,
    и второй «подтвердить» после «отклонить» тихо выдал бы доступ. Тот же приём, что у черновиков."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE access_requests SET status = $1, decided_by = $2, decided_at = $3 "
            "WHERE id = $4 AND status = 'open'", status, by, at, int(rid))
    return res.endswith(" 1")


async def decide_draft(did, status: str, by: str, at: str, result: Optional[dict] = None) -> bool:
    """Закрыть черновик. Только из состояния open — повторный приём не должен применяться дважды."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE project_drafts SET status = $1, decided_by = $2, decided_at = $3, result = $4 "
            "WHERE id = $5 AND status = 'open'",
            status, by, at, (json.dumps(result, ensure_ascii=False) if result else None), int(did))
    return res.endswith(" 1")


async def delete_old_drafts(before_iso: str) -> int:
    """Уборка нерешённых черновиков старше срока: иначе они копятся и мозолят глаза."""
    async with pool().acquire() as con:
        res = await con.execute(
            "DELETE FROM project_drafts WHERE status = 'open' AND created_at < $1", before_iso)
    try:
        return int(res.rsplit(" ", 1)[-1])
    except ValueError:
        return 0


async def fetch_mcp_log(limit: int = 200) -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT id, at, user_email, token_id, tool, project_id, ok, detail "
            "FROM mcp_access_log ORDER BY id DESC LIMIT $1", limit)
    return [dict(r) for r in rows]


# ─────────────────────────── бывшие файловые сторы ───────────────────────────

async def load_users() -> dict:
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT email, doc::text AS doc FROM users ORDER BY seq ASC")
    return {r["email"]: json.loads(r["doc"]) for r in rows}


async def save_users(users: dict) -> None:
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock(hashtext('pmo_users_store'))")
            # Free the unique seq range before reordering/upserting existing rows.
            await con.execute("UPDATE users SET seq = seq + 1000000000")
            for i, (email, doc) in enumerate(users.items()):
                await con.execute(
                    """INSERT INTO users (email, seq, doc) VALUES ($1, $2, $3::json)
                       ON CONFLICT (email) DO UPDATE SET seq = EXCLUDED.seq, doc = EXCLUDED.doc""",
                    email, i, json.dumps(doc, ensure_ascii=False))
            await con.execute("DELETE FROM users WHERE NOT (email = ANY($1::text[]))", list(users))


async def revoke_token_row(sig: str, exp: float) -> None:
    """Записать отозванный (logout) токен — переживает рестарт. No-op без пула (юнит-тесты)."""
    if _pool is None:
        return
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO revoked_tokens (signature, expires_at) VALUES ($1, $2) "
            "ON CONFLICT (signature) DO NOTHING", sig, float(exp))


async def load_revoked_tokens() -> dict:
    """Живые (не истёкшие) отозванные токены {sig: exp} — прогрев _REVOKED на старте."""
    if _pool is None:
        return {}
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT signature, expires_at FROM revoked_tokens WHERE expires_at >= $1", time.time())
    return {r["signature"]: r["expires_at"] for r in rows}


async def prune_revoked_tokens() -> None:
    """Удалить истёкшие записи (иначе таблица растёт). No-op без пула."""
    if _pool is None:
        return
    async with pool().acquire() as con:
        await con.execute("DELETE FROM revoked_tokens WHERE expires_at < $1", time.time())


async def run_with_job_lock(key: int, fn, *args, **kwargs):
    """Выполнить fn ТОЛЬКО если удалось взять advisory-lock (иначе задачу уже делает другой воркер).
    Лок держится на ОДНОМ соединении весь job и снимается на нём же (advisory-lock сессионный).
    Без пула (юнит-тесты) — выполняем без блокировки. Делает планировщик безопасным при --workers>1."""
    if _pool is None:
        return await fn(*args, **kwargs)
    async with pool().acquire() as con:
        if not await con.fetchval("SELECT pg_try_advisory_lock($1)", key):
            return None  # лок у другого воркера — пропускаем (не дублируем снимок/дайджест)
        try:
            return await fn(*args, **kwargs)
        finally:
            await con.execute("SELECT pg_advisory_unlock($1)", key)


async def load_persons() -> list:
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT doc::text AS doc FROM persons ORDER BY seq ASC")
    return [json.loads(r["doc"]) for r in rows]


async def save_persons(persons: list) -> None:
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock(hashtext('pmo_persons_store'))")
            for i, p in enumerate(persons):
                await con.execute(
                    """INSERT INTO persons (id, seq, doc) VALUES ($1, $2, $3::json)
                       ON CONFLICT (id) DO UPDATE SET seq = EXCLUDED.seq, doc = EXCLUDED.doc""",
                    str(p.get("id")), i, json.dumps(p, ensure_ascii=False))
            ids = [str(p.get("id")) for p in persons]
            await con.execute("DELETE FROM persons WHERE NOT (id = ANY($1::text[]))", ids)


async def upsert_persons(persons: list) -> None:
    """Точечный upsert БЕЗ удаления отсутствующих. Нужен синку Bitrix: он читает справочник,
    меняет в Python и пишет обратно, но между чтением и записью кто-то мог создать человека
    через POST /persons. `save_persons` удалил бы его (DELETE всех, кого нет в списке) — здесь
    этого нет, поэтому конкурентно созданный человек уцелеет. Уволенных синк не удаляет, а
    помечает is_active=false, так что DELETE ему и не нужен."""
    if _pool is None:
        return
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock(hashtext('pmo_persons_store'))")
            for i, p in enumerate(persons):
                await con.execute(
                    """INSERT INTO persons (id, seq, doc) VALUES ($1, $2, $3::json)
                       ON CONFLICT (id) DO UPDATE SET seq = EXCLUDED.seq, doc = EXCLUDED.doc""",
                    str(p.get("id")), i, json.dumps(p, ensure_ascii=False))


async def load_settings() -> dict:
    async with pool().acquire() as con:
        r = await con.fetchrow("SELECT doc::text AS doc FROM settings WHERE id = 1")
    return json.loads(r["doc"]) if r else {}


async def save_settings(doc: dict) -> None:
    async with pool().acquire() as con:
        await con.execute("UPDATE settings SET doc = $1::json WHERE id = 1", json.dumps(doc, ensure_ascii=False))


async def load_snapshots(since: Optional[str] = None) -> dict:
    async with pool().acquire() as con:
        if since:
            rows = await con.fetch(
                "SELECT snap_date, data::text AS data FROM snapshots WHERE snap_date >= $1 ORDER BY snap_date ASC",
                since)
        else:
            rows = await con.fetch("SELECT snap_date, data::text AS data FROM snapshots ORDER BY snap_date ASC")
    return {r["snap_date"]: json.loads(r["data"]) for r in rows}


async def upsert_snapshot(snap_date: str, data: dict) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO snapshots (snap_date, data) VALUES ($1, $2::json) "
            "ON CONFLICT (snap_date) DO UPDATE SET data = EXCLUDED.data",
            snap_date, json.dumps(data, ensure_ascii=False))


async def prune_snapshots(keep: int = 400) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "DELETE FROM snapshots WHERE snap_date NOT IN "
            "(SELECT snap_date FROM snapshots ORDER BY snap_date DESC LIMIT $1)", int(keep))


async def save_snapshots(store: dict) -> None:
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("DELETE FROM snapshots")
            for d, data in store.items():
                await con.execute("INSERT INTO snapshots (snap_date, data) VALUES ($1, $2::json)",
                                  d, json.dumps(data, ensure_ascii=False))


async def load_baselines() -> dict:
    async with pool().acquire() as con:
        rows = await con.fetch("SELECT project_id, doc::text AS doc FROM baselines ORDER BY project_id, seq ASC")
    out: dict = {}
    for r in rows:
        out.setdefault(str(r["project_id"]), []).append(json.loads(r["doc"]))
    return out


async def load_baselines_for(pid) -> list:
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT doc::text AS doc FROM baselines WHERE project_id = $1 ORDER BY seq ASC", int(pid))
    return [json.loads(r["doc"]) for r in rows]


async def load_latest_baselines() -> dict:
    """Только последний baseline каждого проекта — достаточно портфельной аналитике."""
    async with pool().acquire() as con:
        rows = await con.fetch(
            "SELECT DISTINCT ON (project_id) project_id, doc::text AS doc "
            "FROM baselines ORDER BY project_id, seq DESC")
    return {str(r["project_id"]): [json.loads(r["doc"])] for r in rows}


async def append_baseline(pid, doc: dict) -> None:
    """Точечная конкурентно-безопасная вставка без DELETE/перезаписи чужих проектов."""
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock($1)", int(pid))
            seq = await con.fetchval(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM baselines WHERE project_id = $1", int(pid))
            await con.execute(
                "INSERT INTO baselines (project_id, seq, doc) VALUES ($1, $2, $3::json)",
                int(pid), int(seq), json.dumps(doc, ensure_ascii=False))


async def delete_baseline(pid, bid: str) -> bool:
    async with pool().acquire() as con:
        res = await con.execute(
            "DELETE FROM baselines WHERE project_id = $1 AND doc->>'id' = $2", int(pid), str(bid))
    return res.split()[-1] != "0"


async def ensure_baselines(pid, items: list) -> None:
    """Однократный lazy-import legacy _baselines из meta без перезаписи уже мигрированных данных."""
    if not items:
        return
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock($1)", int(pid))
            exists = await con.fetchval("SELECT 1 FROM baselines WHERE project_id = $1 LIMIT 1", int(pid))
            if exists:
                return
            for seq, doc in enumerate(items):
                await con.execute(
                    "INSERT INTO baselines (project_id, seq, doc) VALUES ($1, $2, $3::json)",
                    int(pid), seq, json.dumps(doc, ensure_ascii=False))


async def save_baselines(store: dict) -> None:
    async with pool().acquire() as con:
        async with con.transaction():
            await con.execute("DELETE FROM baselines")
            for pid, items in store.items():
                for i, doc in enumerate(items):
                    await con.execute("INSERT INTO baselines (project_id, seq, doc) VALUES ($1, $2, $3::json)",
                                      int(pid), i, json.dumps(doc, ensure_ascii=False))


# ─────────────────────────── OAuth: клиенты, запросы согласия, коды ───────────────────────────

async def upsert_oauth_client(client_id: str, client_secret, client_name: str,
                              info: dict, created_at: str) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO oauth_clients (client_id, client_secret, client_name, info, created_at) "
            "VALUES ($1,$2,$3,$4::json,$5) "
            "ON CONFLICT (client_id) DO UPDATE SET client_secret = EXCLUDED.client_secret, "
            "client_name = EXCLUDED.client_name, info = EXCLUDED.info",
            client_id, client_secret, client_name, json.dumps(info, ensure_ascii=False), created_at)


async def get_oauth_client(client_id: str) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "SELECT client_id, client_secret, client_name, info, created_at, last_used_at "
            "FROM oauth_clients WHERE client_id = $1", client_id)
    if not r:
        return None
    d = dict(r)
    d["info"] = json.loads(d["info"]) if isinstance(d["info"], str) else d["info"]
    return d


async def touch_oauth_client(client_id: str, at: str) -> None:
    async with pool().acquire() as con:
        await con.execute("UPDATE oauth_clients SET last_used_at = $1 WHERE client_id = $2", at, client_id)


async def insert_oauth_request(rid: str, client_id: str, redirect_uri: str, redirect_explicit: bool,
                               code_challenge: str, scopes: str, state, resource,
                               created_at: str, expires_at: str) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO oauth_requests (id, client_id, redirect_uri, redirect_explicit, code_challenge, "
            "scopes, state, resource, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            rid, client_id, redirect_uri, bool(redirect_explicit), code_challenge, scopes,
            state, resource, created_at, expires_at)


async def get_oauth_request(rid: str) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow("SELECT * FROM oauth_requests WHERE id = $1", rid)
    return dict(r) if r else None


async def decide_oauth_request(rid: str, by: str, at: str) -> bool:
    """Пометить запрос решённым. Возвращает False, если его уже решили — тогда второй код
    не выпускается: иначе одно нажатие «Разрешить» можно было бы переиграть повторным запросом."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE oauth_requests SET decided_at = $1, decided_by = $2 WHERE id = $3 AND decided_at IS NULL",
            at, by, rid)
    return res.endswith(" 1")


async def insert_oauth_code(code_hash: str, client_id: str, user_email: str, redirect_uri: str,
                            redirect_explicit: bool, code_challenge: str, scopes: str,
                            resource, expires_at: str) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO oauth_codes (code_hash, client_id, user_email, redirect_uri, redirect_explicit, "
            "code_challenge, scopes, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            code_hash, client_id, user_email, redirect_uri, bool(redirect_explicit),
            code_challenge, scopes, resource, expires_at)


async def get_oauth_code(code_hash: str) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow("SELECT * FROM oauth_codes WHERE code_hash = $1", code_hash)
    return dict(r) if r else None


async def use_oauth_code(code_hash: str, at: str) -> bool:
    """Пометить код использованным. False — если его уже обменивали: код одноразовый по RFC 6749."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE oauth_codes SET used_at = $1 WHERE code_hash = $2 AND used_at IS NULL", at, code_hash)
    return res.endswith(" 1")


async def delete_expired_oauth(before_iso: str) -> None:
    """Уборка просроченных запросов и кодов. Оба живут минуты, но без уборки копятся вечно.
    Refresh-строки убираем по АБСОЛЮТНОМУ потолку цепочки: до него они нужны для распознавания
    повторного использования украденного значения."""
    async with pool().acquire() as con:
        await con.execute("DELETE FROM oauth_requests WHERE expires_at < $1", before_iso)
        await con.execute("DELETE FROM oauth_codes WHERE expires_at < $1", before_iso)
        await con.execute("DELETE FROM oauth_refresh_tokens WHERE chain_expires_at < $1", before_iso)


async def delete_unused_oauth_clients(registered_before: str) -> int:
    """Забыть клиентов, которые зарегистрировались раньше срока и так ни разу и не подключились.

    Регистрация анонимна по стандарту, и без уборки таблица растёт с каждой чужой попыткой.
    Уходит только клиент без единого следа: ни обмена кода (`last_used_at`), ни запроса
    согласия (человек, может быть, как раз сейчас нажимает «Разрешить»), ни кода, ни цепочки
    обновления, ни выданного доступа — даже отозванного: по нему «Отозвать» в Профиле и журнал
    помощника. Одним запросом и идемпотентно: повтор ничего не находит."""
    async with pool().acquire() as con:
        res = await con.execute(
            "DELETE FROM oauth_clients AS c WHERE c.created_at < $1 AND c.last_used_at IS NULL "
            "AND NOT EXISTS (SELECT 1 FROM oauth_requests x WHERE x.client_id = c.client_id) "
            "AND NOT EXISTS (SELECT 1 FROM oauth_codes x WHERE x.client_id = c.client_id) "
            "AND NOT EXISTS (SELECT 1 FROM oauth_refresh_tokens x WHERE x.client_id = c.client_id) "
            "AND NOT EXISTS (SELECT 1 FROM api_tokens x WHERE x.oauth_client_id = c.client_id)",
            registered_before)
    try:
        return int(res.rsplit(" ", 1)[-1])
    except ValueError:
        return 0


# ── refresh-цепочки помощника ────────────────────────────────────────────────────────────

async def insert_oauth_refresh(token_hash: str, chain_id: str, client_id: str, user_email: str,
                               scopes: str, access_token_id, resource, created_at: str,
                               chain_expires_at: str, expires_at: str) -> None:
    async with pool().acquire() as con:
        await con.execute(
            "INSERT INTO oauth_refresh_tokens (token_hash, chain_id, client_id, user_email, scopes, "
            "access_token_id, resource, created_at, chain_expires_at, expires_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            token_hash, chain_id, client_id, user_email, scopes,
            int(access_token_id) if access_token_id else None, resource,
            created_at, chain_expires_at, expires_at)


async def get_oauth_refresh(token_hash: str) -> Optional[dict]:
    """Сырая строка; отсев (использована/отозвана/просрочена/чужой клиент) — у вызывающего."""
    async with pool().acquire() as con:
        r = await con.fetchrow("SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1", token_hash)
    return dict(r) if r else None


async def spend_oauth_refresh(token_hash: str, at: str) -> Optional[str]:
    """Списать значение ОДНИМ запросом и вернуть chain_id. None — значение уже потрачено или
    отозвано: «прочитал → проверил → записал» здесь недопустимо, две параллельные вкладки
    получили бы по токену и кража стала бы неотличима от гонки."""
    async with pool().acquire() as con:
        return await con.fetchval(
            "UPDATE oauth_refresh_tokens SET used_at = $1 "
            "WHERE token_hash = $2 AND used_at IS NULL AND revoked_at IS NULL RETURNING chain_id",
            at, token_hash)


async def revoke_oauth_chain(chain_id: str, at: str) -> int:
    """Погасить цепочку целиком: и все её refresh-значения, и все выданные ею доступы.
    Половинчатый отзыв — это ровно тот случай, когда человек считает, что закрыл доступ."""
    async with pool().acquire() as con:
        async with con.transaction():
            ids = [r["access_token_id"] for r in await con.fetch(
                "SELECT access_token_id FROM oauth_refresh_tokens WHERE chain_id = $1", chain_id)
                if r["access_token_id"]]
            if ids:
                await con.execute(
                    "UPDATE api_tokens SET revoked_at = $1 WHERE id = ANY($2::bigint[]) AND revoked_at IS NULL",
                    at, ids)
            res = await con.execute(
                "UPDATE oauth_refresh_tokens SET revoked_at = $1 WHERE chain_id = $2 AND revoked_at IS NULL",
                at, chain_id)
    try:
        return int(res.split()[-1])
    except (ValueError, IndexError):
        return 0


async def chain_id_by_access_token(token_id) -> Optional[str]:
    """По id выданного доступа найти его цепочку — кнопка «Отозвать» обязана гасить и её."""
    async with pool().acquire() as con:
        return await con.fetchval(
            "SELECT chain_id FROM oauth_refresh_tokens WHERE access_token_id = $1 LIMIT 1", int(token_id))


async def revoke_refresh_chains_by_user(email: str, at: str) -> int:
    """Все цепочки человека — при деактивации учётной записи. Без этого клиент продолжал бы
    молча штамповать себе доступы, а при возврате учётки подключение воскресло бы само."""
    async with pool().acquire() as con:
        async with con.transaction():
            chains = [r["chain_id"] for r in await con.fetch(
                "SELECT DISTINCT chain_id FROM oauth_refresh_tokens "
                "WHERE lower(user_email) = lower($1) AND revoked_at IS NULL", email)]
            for chain in chains:
                ids = [r["access_token_id"] for r in await con.fetch(
                    "SELECT access_token_id FROM oauth_refresh_tokens WHERE chain_id = $1", chain)
                    if r["access_token_id"]]
                if ids:
                    await con.execute(
                        "UPDATE api_tokens SET revoked_at = $1 WHERE id = ANY($2::bigint[]) AND revoked_at IS NULL",
                        at, ids)
                await con.execute(
                    "UPDATE oauth_refresh_tokens SET revoked_at = $1 WHERE chain_id = $2 AND revoked_at IS NULL",
                    at, chain)
    return len(chains)


async def revoke_api_tokens_by_user(email: str, at: str) -> int:
    """Все живые токены человека разом — и личные из Профиля, и выданные по OAuth. Смена
    пароля, деактивация и увольнение обязаны закрывать и помощника: иначе доступ к проектам
    переживает и то, и другое (токен живёт 90 дней)."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE api_tokens SET revoked_at = $1 WHERE lower(user_email) = lower($2) AND revoked_at IS NULL",
            at, email)
    try:
        return int(res.split()[-1])
    except (ValueError, IndexError):
        return 0


async def revoke_api_token_by_hash(token_hash: str, at: str) -> bool:
    """Отзыв по значению токена — нужен для точки отзыва OAuth (RFC 7009): клиент присылает
    сам токен, а не его id."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE api_tokens SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL", at, token_hash)
    return res.endswith(" 1")


# ───────────────────── связка Fireflies → PMO + Битрикс (очередь fireflies_sync) ─────────────────────
# Одна строка на встречу Fireflies: очередь воркера, журнал шагов, ключ идемпотентности.
# Текстов протоколов в таблице нет — только id, статусы, кандидаты.

_FF_COLS = ("meeting_id", "event", "reprocessed_at", "status", "pmo_status", "bitrix_status", "decision",
            "basis", "reason", "pmo_project_id", "pmo_meeting_id", "bitrix_event_id",
            "bitrix_comment_id", "candidates", "attempts", "next_attempt_at", "last_error",
            "created_at", "updated_at")
# Что пишет воркер. meeting_id/event/reprocessed_at/created_at ставит только приём вебхука.
_FF_WRITABLE = frozenset(_FF_COLS) - {"meeting_id", "event", "reprocessed_at", "created_at", "updated_at"}
_FF_RETURNING = ", ".join(c if c != "candidates" else "candidates::text AS candidates" for c in _FF_COLS)
_FF_SELECT = "SELECT " + _FF_RETURNING + " FROM fireflies_sync"
_ANY = object()


def fireflies_reprocessed_text(value) -> Optional[str]:
    """reprocessed_at из вебхука (число мс или ISO-строка) → TEXT для колонки; пусто → None."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _ff_rp_time(value) -> Optional[float]:
    """Время resend в секундах UTC: число (мс или с) или ISO 8601. Не разобрать — None."""
    s = fireflies_reprocessed_text(value)
    if s is None:
        return None
    try:
        num = float(s)
        return num / 1000.0 if num > 1e11 else num
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def fireflies_reprocessed_newer(new, old) -> bool:
    """Дедуп по докам Fireflies: resend принимаем, только если его reprocessed_at СТРОГО новее
    сохранённого. Повторы доставки без reprocessed_at (исходное событие) — всегда дубль;
    поле timestamp ключом не служит (новое на каждом повторе)."""
    n = fireflies_reprocessed_text(new)
    if n is None:
        return False
    o = fireflies_reprocessed_text(old)
    if o is None:
        return True
    tn, to = _ff_rp_time(n), _ff_rp_time(o)
    if tn is not None and to is not None:
        return tn > to
    return n > o


def _ff_row(r) -> dict:
    d = {c: _rec(r, c) for c in _FF_COLS}
    raw = d.get("candidates")
    d["candidates"] = json.loads(raw) if isinstance(raw, str) and raw else (raw or None)
    return d



async def fireflies_sync_receive(meeting_id: str, event: str, reprocessed_at, now: str) -> str:
    """Приём вебхука: 'new' — встреча поставлена в очередь; 'resend' — правка заметок
    (reprocessed_at новее), встреча снова в очереди; 'duplicate' — повтор доставки, ничего не делаем.

    Resend возвращает в работу и протокол PMO (pmo_status done → pending: воркер перепишет его,
    только если человек не правил наш текст), но НЕ комментарий Битрикса — он один на протокол."""
    rp = fireflies_reprocessed_text(reprocessed_at)
    async with transaction() as con:
        inserted = await con.fetchval(
            "INSERT INTO fireflies_sync (meeting_id, event, reprocessed_at, status, attempts, next_attempt_at, "
            "created_at, updated_at) VALUES ($1, $2, $3, 'received', 0, $4, $4, $4) "
            "ON CONFLICT (meeting_id) DO NOTHING RETURNING meeting_id",
            meeting_id, event, rp, now)
        if inserted:
            return "new"
        old = await con.fetchrow("SELECT reprocessed_at FROM fireflies_sync WHERE meeting_id = $1 FOR UPDATE",
                                 meeting_id)
        if old is None or not fireflies_reprocessed_newer(rp, old["reprocessed_at"]):
            return "duplicate"
        await con.execute(
            "UPDATE fireflies_sync SET event = $2, reprocessed_at = $3, status = 'received', attempts = 0, "
            "next_attempt_at = $4, last_error = NULL, updated_at = $4, "
            "pmo_status = CASE WHEN pmo_status = 'done' THEN 'pending' ELSE pmo_status END "
            "WHERE meeting_id = $1",
            meeting_id, event, rp, now)
    return "resend"


# $1 = сейчас, $2 = брать ли готовые встречи, ждущие метода комментариев Битрикса.
_FF_DUE_WHERE = ("((status IN ('received', 'processing') AND next_attempt_at <= $1)"
                 " OR ($2::boolean AND status = 'done' AND bitrix_status = 'waiting_method'))")


async def fireflies_sync_due(now: str, limit: int = 20, waiting_bitrix: bool = False) -> list:
    """Строки, которым пора в работу. 'processing' с истёкшей арендой — тоже (воркер упал на ней).
    waiting_bitrix=True добирает готовые встречи, ждавшие метода комментариев Битрикса."""
    async with pool().acquire() as con:
        rows = await con.fetch(_FF_SELECT + " WHERE " + _FF_DUE_WHERE
                               + " ORDER BY next_attempt_at ASC NULLS FIRST, meeting_id LIMIT $3",
                               now, bool(waiting_bitrix), int(limit))
    return [_ff_row(r) for r in rows]


async def fireflies_sync_claim(meeting_id: str, now: str, lease_until: str,
                               waiting_bitrix: bool = False) -> Optional[dict]:
    """Взять строку в работу (status=processing, аренда до lease_until). None — она уже не в очереди."""
    async with pool().acquire() as con:
        r = await con.fetchrow(
            "UPDATE fireflies_sync SET status = 'processing', next_attempt_at = $3, updated_at = $1 "
            "WHERE meeting_id = $4 AND " + _FF_DUE_WHERE + " RETURNING " + _FF_RETURNING,
            now, bool(waiting_bitrix), lease_until, meeting_id)
    return _ff_row(r) if r else None


async def fireflies_sync_update(meeting_id: str, fields: dict, now: str, expect_reprocessed=_ANY) -> bool:
    """Записать итог шага. expect_reprocessed — защита от гонки с resend: если за время работы
    пришла правка заметок (reprocessed_at сменился), итог не пишем — строка уже снова в очереди."""
    bad = set(fields) - _FF_WRITABLE
    if bad:
        raise ValueError(f"fireflies_sync: неизвестные/закрытые колонки {sorted(bad)}")
    args: list = [meeting_id, now]
    sets = ["updated_at = $2"]
    for col, val in fields.items():
        if col == "candidates":
            val = None if val is None else json.dumps(val, ensure_ascii=False)
        elif col == "attempts":
            val = int(val or 0)
        elif val is not None:
            val = str(val)
        args.append(val)
        sets.append(f"{col} = ${len(args)}")
    sql = "UPDATE fireflies_sync SET " + ", ".join(sets) + " WHERE meeting_id = $1"
    if expect_reprocessed is not _ANY:
        args.append(fireflies_reprocessed_text(expect_reprocessed))
        sql += f" AND reprocessed_at IS NOT DISTINCT FROM ${len(args)}"
    async with pool().acquire() as con:
        res = await con.execute(sql, *args)
    return res.endswith(" 1")


async def fireflies_sync_get(meeting_id: str) -> Optional[dict]:
    async with pool().acquire() as con:
        r = await con.fetchrow(_FF_SELECT + " WHERE meeting_id = $1", meeting_id)
    return _ff_row(r) if r else None


async def fireflies_sync_list(status: Optional[str] = None, limit: int = 200) -> list:
    args: list = []
    sql = _FF_SELECT
    if status:
        args.append(status)
        sql += " WHERE status = $1"
    args.append(int(limit))
    sql += f" ORDER BY updated_at DESC, meeting_id LIMIT ${len(args)}"
    async with pool().acquire() as con:
        rows = await con.fetch(sql, *args)
    return [_ff_row(r) for r in rows]


async def fireflies_sync_retry(meeting_id: str, now: str, reset_bitrix_posting: bool = False) -> bool:
    """Ручной повтор (владелец портала): строка снова в очереди со свежим счётчиком попыток.
    Готовые шаги (done) воркер не повторяет — повторяется только недоделанное.
    reset_bitrix_posting — владелец проверил: комментария в Битриксе нет, шаг 'posting' (исход
    вызова неизвестен) можно публиковать заново. Без флага воркер такой шаг вслепую не повторяет."""
    async with pool().acquire() as con:
        res = await con.execute(
            "UPDATE fireflies_sync SET status = 'received', attempts = 0, next_attempt_at = $2, "
            "last_error = NULL, updated_at = $2, "
            "bitrix_status = CASE WHEN $3::boolean AND bitrix_status = 'posting' THEN NULL ELSE bitrix_status END "
            "WHERE meeting_id = $1", meeting_id, now, bool(reset_bitrix_posting))
    return res.endswith(" 1")
