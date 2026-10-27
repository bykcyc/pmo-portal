"""Project metadata helpers with explicit persistence dependencies.

The API stores the project passport and the remaining lightweight collections in
the project description JSON.  Keeping persistence callables explicit makes this
module import-side-effect free and lets ``main.py`` preserve its historical
monkeypatch points while the implementation lives here.
"""

import copy
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException


ProjectRow = dict[str, Any]
Meta = dict[str, Any]
AsyncRowLoader = Callable[[str], Awaitable[ProjectRow | None]]
AsyncMetaWriter = Callable[..., Awaitable[bool]]
AsyncBaselineEnsurer = Callable[[str, list], Awaitable[None]]


def version_conflict() -> HTTPException:
    """Единый ответ на исчерпание оптимистичной блокировки (projects.version опередили).
    Один статус (409 Conflict) и одно тело для всех путей — и single-shot, и retry."""
    return HTTPException(status_code=409, detail="Конкурентные правки, повторите попытку")


def parse(el: ProjectRow) -> Meta:
    """Parse and cache metadata on a project shim for the current request.

    Normalized collections (``_action_log``/``_meetings``/``_backlog``/``_notes``) live in
    the ``project_docs`` table; when a row carries them under ``_docs`` (attached by
    ``load``/``fetch_projects``) they are merged into the parsed metadata so every reader
    (``_coll`` etc.) sees them exactly as before. A not-yet-migrated project keeps them in
    the raw JSON, so a per-collection override is safe either way.
    """
    cached = el.get("_meta_cache")
    if isinstance(cached, dict):
        return cached
    raw = ((el.get("description") or {}).get("raw")) or ""
    try:
        value = json.loads(raw)
        meta = value if isinstance(value, dict) else {}
    except Exception:  # noqa: BLE001 - malformed legacy metadata is treated as empty
        meta = {}
    docs = el.get("_docs")
    if isinstance(docs, dict):
        for coll, items in docs.items():
            meta[coll] = items
    # Дерево (зонтик/подпроекты и УНАСЛЕДОВАННЫЕ права) считает SQL — см. db._TREE_CTE.
    # Кладём его в мету, чтобы _owns_item/_observes_item спрашивали в одном месте, как и раньше.
    # В блоб это никогда не уедет: raw_for_save снимает `_tree` рядом с `_counts`.
    tree = el.get("_tree")
    if isinstance(tree, dict):
        meta["_tree"] = tree
    el["_meta_cache"] = meta
    return meta


async def load(
    pid: str,
    *,
    get_project_row: AsyncRowLoader,
    parse_meta: Callable[[ProjectRow], Meta],
    load_docs: Callable[[str], Awaitable[dict]] | None = None,
) -> tuple[ProjectRow, Meta]:
    row = await get_project_row(pid)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if load_docs is not None:
        row["_docs"] = await load_docs(pid)
    return row, parse_meta(row)


def serialize(
    pid: str,
    meta: Meta,
    *,
    desc_warn: int,
    desc_max: int,
    action_log_cap: int,
    logger: logging.Logger,
) -> str:
    """Serialize metadata while preserving legacy ordering and size behavior."""
    action_log = meta.get("_action_log")
    if isinstance(action_log, list) and len(action_log) > action_log_cap:
        meta["_action_log"] = action_log[-action_log_cap:]
    raw = json.dumps(meta, ensure_ascii=False, default=str)
    size = len(raw)
    if size > desc_max:
        logger.error("Project %s description JSON %d байт > лимита %d — отклонено", pid, size, desc_max)
        raise HTTPException(
            status_code=413,
            detail="Данные проекта превысили лимит хранения; вынесите тяжёлые коллекции в нативные поля",
        )
    if size > desc_warn:
        logger.warning("Project %s description JSON большой: %d байт (вынести тяжёлые коллекции?)", pid, size)
    return raw


async def raw_for_save(
    pid: str,
    meta: Meta,
    *,
    ensure_baselines: AsyncBaselineEnsurer,
    serialize_meta: Callable[[str, Meta], str],
    strip_colls: tuple[str, ...] = (),
) -> str:
    """Migrate legacy baselines and strip derived/normalized values before serialization."""
    legacy_baselines = meta.get("_baselines")
    if isinstance(legacy_baselines, list) and legacy_baselines:
        await ensure_baselines(pid, legacy_baselines)
        meta.pop("_baselines", None)
    meta.pop("_counts", None)
    meta.pop("_tree", None)                # вычисляемое дерево прав (db._TREE_CTE) — не данные проекта
    meta.pop("_pending_action_log", None)  # транзиентный буфер журнала (A2): сливается append-only, не в блоб
    for key in strip_colls:
        meta.pop(key, None)  # нормализованные коллекции хранятся в project_docs, не в meta
    return serialize_meta(pid, meta)


def colls_snapshot(extract_colls: Callable[[Meta], dict] | None, meta: Meta) -> dict:
    """ГЛУБОКАЯ копия нормализованных коллекций ДО мутации. Deep-copy обязателен: _log_action и
    генерик-CRUD правят списки/элементы на месте, а списки шарятся между meta и row['_docs'] —
    поверхностный снимок мутировал бы вместе с ними и «изменение» терялось бы."""
    if extract_colls is None:
        return {}
    return copy.deepcopy(extract_colls(meta))


def dirty_colls(before: dict, after: dict) -> dict:
    """Только реально изменившиеся коллекции (после mutate) → не переписываем нетронутые строки
    project_docs (устраняет write-amplification: правка одной секции не DELETE/re-INSERT-ит все).
    Байт-идентично: пишутся те же строки, что и поменялись; порядок/содержимое коллекций те же."""
    return {k: v for k, v in after.items() if v != before.get(k, [])}


async def save_full(
    pid: str,
    row: ProjectRow,
    meta: Meta,
    *,
    update_project_meta: AsyncMetaWriter,
    get_project_row: AsyncRowLoader,
    meta_raw_for_save: Callable[[str, Meta], Awaitable[str]],
    extract_colls: Callable[[Meta], dict] | None = None,
    flush_log: Callable[[str, list], Awaitable[None]] | None = None,
) -> ProjectRow | None:
    # save_full зовёт clone для НОВОГО проекта — все коллекции новые, пишем все (selective не нужен).
    colls = extract_colls(meta) if extract_colls else None
    pending_log = list(meta.get("_pending_action_log") or [])  # захват ДО сериализации (raw_for_save стрипит ключ)
    ok = await update_project_meta(
        pid,
        await meta_raw_for_save(pid, meta),
        expected_version=row["lockVersion"],
        colls=colls,
    )
    if not ok:
        raise version_conflict()
    if flush_log is not None:
        await flush_log(pid, pending_log)  # журнал append-only после успешной записи меты (A2)
    return await get_project_row(pid)


async def with_retry(
    pid: str,
    mutate: Callable[[Meta], Any],
    *,
    attempts: int,
    load_meta: Callable[[str], Awaitable[tuple[ProjectRow, Meta]]],
    update_project_meta: AsyncMetaWriter,
    meta_raw_for_save: Callable[[str, Meta], Awaitable[str]],
    extract_colls: Callable[[Meta], dict] | None = None,
    flush_log: Callable[[str, list], Awaitable[None]] | None = None,
) -> Any:
    """Run an optimistic-lock metadata mutation with the legacy error contract."""
    for attempt in range(attempts):
        row, meta = await load_meta(pid)
        before = colls_snapshot(extract_colls, meta)  # снимок ДО mutate (deep-copy)
        result = mutate(meta)
        # A2: журнал (_log_action) складывается в транзиентный _pending_action_log; забираем его ДО
        # сериализации (raw_for_save стрипит ключ) и сливаем append-only только на УСПЕШНОЙ попытке —
        # на ретрае mutate перечитывает свежую мету, буфер пуст, дублей нет.
        pending_log = list(meta.get("_pending_action_log") or [])
        colls = dirty_colls(before, extract_colls(meta)) if extract_colls else None  # только изменённые
        ok = await update_project_meta(
            pid,
            await meta_raw_for_save(pid, meta),
            expected_version=row["lockVersion"],
            colls=colls,
        )
        if ok:
            if flush_log is not None:
                await flush_log(pid, pending_log)
            return result
        if attempt < attempts - 1:
            continue
        raise version_conflict()
    raise version_conflict()


def collection_counts(meta: Meta) -> dict[str, int]:
    """Derive counters for collections that still live in project metadata."""
    counts = {"decisions_total": len(meta.get("_decisions", []) or [])}
    open_actions = 0
    for meeting in meta.get("_meetings") or []:
        if not isinstance(meeting, dict):
            continue
        for action in meeting.get("action_items") or meeting.get("actions") or []:
            if isinstance(action, dict) and action.get("status") not in ("done", "completed"):
                open_actions += 1
    counts["open_actions"] = open_actions
    return counts


def collection(meta: Meta, key: str) -> list:
    value = meta.get(key)
    return value if isinstance(value, list) else []
