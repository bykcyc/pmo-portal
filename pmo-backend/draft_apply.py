"""Приём черновика: применение отмеченных элементов к проекту в ПРАВИЛЬНОМ порядке.

Порядок здесь не декоративный — каждая позиция оплачена ловушкой портала, и внешний агент
их не знает. Держим знание на сервере, чтобы оно было одно на все способы заполнения:

1. Паспорт — раньше всего: остальное на него ссылается.
2. Люди и справочные разделы (команда, стейкхолдеры, допущения, коммуникации, KPI).
3. Фазы и задачи. Даты фазы записываются, ПОКА строка ещё обычная задача: PUT дат в строку
   с task_type="phase" молча ничего не делает, и на Ганте фаза выходит без срока.
4. Риски, решения, бюджет, бэклог.
5. Совещания — последними из создающих: их финализация сама переносит решения и поручения,
   и если те же пункты записать напрямую, получится дубль, которого финализация не видит.

Удаление применяется ПОСЛЕ добавлений: иначе ссылка на только что удалённый элемент
(зависимость задачи, риск на задаче) обрывается в середине приёма.
"""

import re
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from pmo_api import PmoApi

# Раздел черновика → ключ коллекции в мете. Всё, чего здесь нет, применяется отдельной веткой
# (задачи — в своей таблице) либо не применяется вовсе (паспорт — правкой меты).
_COLL_BY_SECTION = {
    "team": "_team",
    "stakeholders": "_stakeholders",
    "assumptions": "_assumptions",
    "communication-plan": "_comms",
    "kpis": "_kpis",
    "decisions": "_decisions",
    "backlog": "_backlog",
    "budget-items": "_budget",
    "meetings": "_meetings",
    "status-reports": "_reports",
}

# Порядок применения разделов. Ниже по списку — позже.
_ORDER = ["passport", "team", "stakeholders", "assumptions", "communication-plan", "kpis",
          "tasks", "task-dependencies", "risks", "decisions", "budget-items", "backlog",
          "status-reports", "meetings", "baselines"]

# Что приём УМЕЕТ: раздел → операции. Список нужен не самому приёму (он разбирает разделы
# ветками ниже), а проверке черновика в момент создания: раньше помощник узнавал о невыполнимом
# элементе только после того, как человек нажал «Принять» и ничего не произошло. Расхождение
# списка с ветками стережёт tests/test_draft_ops.py.
APPLIABLE_OPS: dict = {
    "passport": {"add", "edit"},
    "tasks": {"add", "edit", "delete"},
    "risks": {"add", "edit", "delete"},
    "task-dependencies": {"add", "delete"},   # правки у связи нет: снять и добавить заново
    "baselines": {"add"},                     # снимок плана только снимается
    **{sec: {"add", "edit", "delete"} for sec in _COLL_BY_SECTION},
}


def unappliable(items: list) -> list:
    """Элементы, которых приём заведомо не сделает: чужой раздел или невозможная операция.
    Возвращает по одному объяснению на элемент — помощнику есть что переделать до показа."""
    out = []
    for it in items:
        section, op = str(it.get("section") or ""), str(it.get("op") or "")
        if op in ("skip", "clash"):           # не применяются осознанно
            continue
        ops = APPLIABLE_OPS.get(section)
        if ops is None:
            why = ("раздел приёмом не поддерживается; доступны: "
                   + ", ".join(sorted(APPLIABLE_OPS)))
        elif op not in ops:
            why = (f"в разделе «{section}» операция «{op}» невозможна; доступны: "
                   + ", ".join(sorted(ops)))
        else:
            continue
        out.append({"item": it.get("id"), "section": section, "op": op, "why": why})
    return out


# Разделы, которые считаются чувствительными: их помощник и видит, и предлагает
# только при втором согласии владельца проекта.
SENSITIVE_SECTIONS = frozenset({"budget-items", "decisions", "stakeholders"})


def _section_rank(section: str) -> int:
    try:
        return _ORDER.index(section)
    except ValueError:
        return len(_ORDER)


def selected_items(draft: dict) -> list:
    """Отмеченные и применимые. `skip` и `clash` не применяются никогда: первое — осознанный
    пропуск, второе — противоречие, которое решает человек, а не приём."""
    out = []
    for it in draft.get("items") or []:
        if not it.get("selected"):
            continue
        if it.get("op") not in ("add", "edit", "delete"):
            continue
        out.append(it)
    return out


def plan_order(items: list) -> list:
    """Отсортировать к применению: по разделу, внутри раздела — сначала add/edit, потом delete,
    а среди задач сначала фазы (у детей должен существовать родитель)."""
    by_id = {str(it.get("id")): it for it in items if it.get("id")}

    def depth(it, seen=None) -> int:
        """Глубина внутри ЭТОГО черновика: родитель обязан примениться раньше ребёнка.
        Ссылки наружу (на уже существующие задачи) дают 0 — тогда порядок ровно прежний."""
        seen = seen or set()
        ref = it.get("parent_ref") or (it.get("data") or {}).get("parent_id")
        key = str(ref or "")
        if not key or key in seen or key not in by_id:
            return 0
        seen.add(key)
        return 1 + depth(by_id[key], seen)

    def key(it):
        section = str(it.get("section") or "")
        is_delete = it.get("op") == "delete"
        # Обычно удаление идёт последним (см. докстринг модуля). У связей порядок обратный:
        # снимать нечего, кроме самой связи, а замена «A зависит от B» на «B зависит от A»
        # в одном черновике иначе невозможна — новую связь отбивают как цикл, пока жива старая,
        # и человек получает отчёт, в котором ничего не изменилось.
        op_rank = ((0 if is_delete else 1) if section == "task-dependencies"
                   else (1 if is_delete else 0))
        phase_rank = 0 if (section == "tasks" and (it.get("data") or {}).get("task_type") == "phase") else 1
        return (_section_rank(section), op_rank, depth(it), phase_rank)
    return sorted(items, key=key)


async def apply_draft(api: "PmoApi", pid: str, draft: dict, user: dict) -> dict:
    """Применить отмеченное. Возвращает отчёт: что создано, что изменено, что не удалось.

    Один упавший элемент не отменяет остальные: человек уже утвердил их глазами, и терять
    девять хороших из-за одного кривого — худший из вариантов. Всё несделанное возвращается
    в отчёте поимённо.
    """
    report: dict[str, Any] = {"created": [], "updated": [], "deleted": [], "failed": []}
    items = plan_order(selected_items(draft))
    # Сколько элементов реально пошло в приём. Без этого числа потерю невозможно заметить
    # иначе как пересчитав строки глазами — ровно так и терялись задачи.
    report["requested"] = len(items)
    # Внутри одного приёма id только что созданных задач нужны их детям и зависимостям.
    new_ids: dict[str, str] = {}

    # Названия того, что собираемся удалить. Читаем ДО удаления и один раз на весь приём:
    # после удаления взять их будет негде, а «удалено 12» человеку ничего не говорит —
    # при автоприёме отчёт остаётся единственным свидетельством потери.
    titles: dict[str, str] = {}
    if any(it.get("op") == "delete" and it.get("section") in ("tasks", "risks", "task-dependencies")
           for it in items):
        _el, _m = await api.load_meta(pid)
        for row in (await api._wp_tasks(pid, _m)) + (await api._wp_risks(pid, _m)):
            if row.get("id") is not None and row.get("title"):
                titles[str(row["id"])] = str(row["title"])

    # Задачи, чьи даты черновик задаёт САМ. Каскад не имеет права их переписать: иначе сдвиг
    # от одной задачи ложится поверх значения, которое тот же черновик явно назначил другой
    # (см. main.draft_date_scope). Множество живое — созданные приёмом задачи в него дописывает
    # _apply_task, потому что их настоящие id известны только в момент создания.
    owned_dates = {str(it.get("target_id")) for it in items
                   if it.get("section") == "tasks" and it.get("op") == "edit" and it.get("target_id")
                   and ({"planned_start", "planned_end"} & set((it.get("data") or {}).keys()))}

    with api.draft_date_scope(owned_dates) as cascaded:
        for it in items:
            section = str(it.get("section") or "")
            op = str(it.get("op") or "")
            data = dict(it.get("data") or {})
            try:
                if section == "passport" and op in ("add", "edit"):
                    await _apply_passport(api, pid, data, user)
                    report["updated"].append({"section": section, "id": pid})
                elif section == "tasks":
                    res = await _apply_task(api, pid, op, it, data, new_ids, user, titles)
                    report["created" if op == "add" else ("deleted" if op == "delete" else "updated")].append(res)
                    if op == "add" and res.get("id"):
                        # Созданное в этом же приёме может быть тут же и удалено (plan_order ставит
                        # add раньше delete, а _resolve умеет ссылаться на драфтовый id). В карте,
                        # построенной ДО цикла, такой задачи нет и быть не может.
                        titles[str(res["id"])] = str(res.get("title") or res["id"])
                elif section == "risks":
                    res = await _apply_risk(api, pid, op, it, data, user, titles)
                    report["created" if op == "add" else ("deleted" if op == "delete" else "updated")].append(res)
                    if op == "add" and res.get("id"):
                        # Созданное в этом же приёме может быть тут же и удалено (plan_order ставит
                        # add раньше delete, а _resolve умеет ссылаться на драфтовый id). В карте,
                        # построенной ДО цикла, такой задачи нет и быть не может.
                        titles[str(res["id"])] = str(res.get("title") or res["id"])
                elif section == "task-dependencies":
                    if op == "add":
                        report["created"].append(await _apply_dep(api, pid, data, new_ids, user))
                    elif op == "delete":
                        report["deleted"].append(await _apply_dep_delete(api, pid, it, new_ids, titles, user))
                    else:
                        raise ValueError("связь можно только добавить или снять: правки нет — "
                                         "снимите старую связь и добавьте новую")
                elif section == "baselines" and op == "add":
                    res = await _apply_baseline(api, pid, data, user)
                    report["created"].append(res)
                elif section in _COLL_BY_SECTION:
                    res = await _apply_coll(api, pid, _COLL_BY_SECTION[section], section, op, it, data, user)
                    report["created" if op == "add" else ("deleted" if op == "delete" else "updated")].append(res)
                else:
                    report["failed"].append({"item": it.get("id"), "section": section,
                                             "title": (data or {}).get("title") or (data or {}).get("name"),
                                             "why": "раздел не поддерживается приёмом; доступны: "
                                                    + ", ".join(["passport", "tasks", "risks", *_COLL_BY_SECTION])})
            except Exception as exc:  # noqa: BLE001 — падение одного элемента не отменяет остальные
                api.logger.warning("приём черновика: элемент %s (%s/%s) не применён: %s",
                                   it.get("id"), section, op, exc)
                report["failed"].append({"item": it.get("id"), "section": section,
                                         "title": (data or {}).get("title") or (data or {}).get("name"),
                                         "why": str(exc)[:200]})
    # Задачи, которые сдвинул каскад. Черновик их не называл, и без этого списка человек
    # узнаёт о сдвиге, только сверив даты глазами: так уезжает заметная часть задач.
    if cascaded:
        report["cascaded"] = [{"id": tid, **row} for tid, row in cascaded.items()]

    # Сторож баланса: сумма исходов обязана сойтись с числом принятых элементов. Именно этой
    # проверки не хватало, когда задачи исчезали без единой ошибки.
    done = len(report["created"]) + len(report["updated"]) + len(report["deleted"]) + len(report["failed"])
    if done != report["requested"]:
        report["failed"].append({"item": None, "section": "",
                                 "why": f"элементов пропало без объяснения: {report['requested'] - done}"})
    return report


async def _apply_passport(api: "PmoApi", pid: str, data: dict, user: dict) -> None:
    """Паспорт правим через тот же путь, что и форма: с валидацией, журналом версий и номером."""
    payload = {k: v for k, v in data.items() if k not in ("id", "pm_id", "code")}
    await api._save_meta(pid, payload, user.get("full_name") or user.get("email") or "помощник", user)


async def _apply_task(api: "PmoApi", pid: str, op: str, it: dict, data: dict,
                      new_ids: dict, user: dict, titles: Optional[dict] = None) -> dict:
    """Зовём ТЕ ЖЕ хендлеры, что и интерфейс: одна валидация, один журнал, один формат ответа.

    Свой путь в базу означал бы вторую реализацию правил, которая разойдётся с первой на первой
    же правке — и разойдётся молча.
    """
    if op == "delete":
        tid = _resolve(it.get("target_id"), new_ids)
        name = (titles or {}).get(str(tid)) or str(tid)
        await api.tasks_delete(pid, str(tid), user)
        return {"section": "tasks", "id": str(tid), "title": name}

    payload = dict(data)
    parent = payload.get("parent_id")
    if not parent and it.get("parent_ref"):
        # Родитель создаётся в этом же приёме (иерархия из плана): его настоящий id
        # становится известен только сейчас. Не разрешилось — значит родитель не создан,
        # и об этом надо сказать понятно, а не отдавать глухое «Parent task not found».
        ref = str(it["parent_ref"])
        resolved = new_ids.get(ref)
        if not resolved:
            raise ValueError("родительская задача не создана — потомок пропущен")
        payload["parent_id"] = resolved
    elif parent:
        payload["parent_id"] = _resolve(parent, new_ids)

    if op == "add":
        is_phase = str(payload.get("task_type") or "") == "phase"
        if is_phase:
            # ЛОВУШКА ПОРТАЛА: даты фазы сервер не выводит из детей и не принимает после
            # превращения строки в фазу — PUT молча ничего не делает, и на Ганте фаза выходит
            # без срока. Поэтому создаём обычной задачей С ДАТАМИ, а тип меняем вторым шагом.
            payload["task_type"] = "task"
        created = (await api.tasks_create(pid, payload, user))["data"]
        tid = str(created.get("id"))
        if is_phase:
            await api.tasks_update(pid, tid, {"task_type": "phase"}, user)
        if it.get("id"):
            new_ids[str(it["id"])] = tid
        if payload.get("planned_start") or payload.get("planned_end"):
            # Даты задачи заданы черновиком явно — каскаду от соседей их не двигать.
            api.draft_owns_task(tid)
        return {"section": "tasks", "id": tid, "title": payload.get("title")}

    tid = str(_resolve(it.get("target_id"), new_ids))
    # ТА ЖЕ ЛОВУШКА, что при создании, только с другой стороны: у строки, которая УЖЕ фаза,
    # сервер молча выбрасывает planned_start/planned_end — PUT отвечает успехом, а даты
    # остаются пустыми. Поэтому правку дат фазы делаем в два шага: снимаем тип, пишем даты,
    # возвращаем тип. Обход руками (два edit подряд) больше не нужен.
    dates = {k: payload[k] for k in ("planned_start", "planned_end") if k in payload}
    if dates and str(payload.get("task_type") or "") != "task":
        is_phase = str(payload.get("task_type") or "") == "phase" or await _row_is_phase(api, pid, tid, user)
        if is_phase:
            rest = {k: v for k, v in payload.items() if k not in ("planned_start", "planned_end", "task_type")}
            await api.tasks_update(pid, tid, {**rest, **dates, "task_type": "task"}, user)
            await api.tasks_update(pid, tid, {"task_type": "phase"}, user)
            return {"section": "tasks", "id": tid, "title": payload.get("title")}
    await api.tasks_update(pid, tid, payload, user)
    return {"section": "tasks", "id": tid, "title": payload.get("title")}


async def _row_is_phase(api: "PmoApi", pid: str, tid: str, user: dict) -> bool:
    """Строка проекта уже является фазой? Отдельной ручки «одна задача» у портала нет —
    спрашиваем список (он же используется вкладкой) и ищем нужный id. Не смогли прочитать —
    считаем, что не фаза: тогда правка идёт прежним, безопасным путём."""
    try:
        rows = (await api.tasks_list(pid, user)).get("data") or []
    except Exception:  # noqa: BLE001 — знание о типе строки не должно ронять приём
        return False
    row = next((r for r in rows if str(r.get("id")) == str(tid)), None)
    return str((row or {}).get("task_type") or "") == "phase"


async def _apply_dep(api: "PmoApi", pid: str, data: dict, new_ids: dict, user: dict) -> dict:
    """Связь «задача зависит от задачи». Обе ссылки могут указывать на задачи, созданные
    в этом же приёме, — поэтому идут через тот же резолв, что и родитель."""
    payload = dict(data)
    for key in ("task_id", "depends_on_id"):
        if payload.get(key):
            payload[key] = _resolve(payload[key], new_ids)
    dep = (await api.dep_create(pid, payload, user))["data"]
    return {"section": "task-dependencies", "id": str(dep.get("id")),
            "title": f"{payload.get('task_id')} ← {payload.get('depends_on_id')}"}


async def _apply_dep_delete(api: "PmoApi", pid: str, it: dict, new_ids: dict,
                            titles: dict, user: dict) -> dict:
    """Снять связь «задача зависит от задачи».

    Связь ищем ДО удаления по двум причинам. Первая: роут удаления отвечает успехом и на
    несуществующий id — без проверки отчёт сообщал бы о снятии того, чего в проекте нет.
    Вторая: «удалена связь 3f21…» человеку ничего не говорит, а имена задач есть только пока
    связь жива.
    """
    did = str(_resolve(it.get("target_id"), new_ids) or "")
    dep = next((d for d in await api.db.fetch_deps(pid) if str(d.get("id")) == did), None)
    if not dep:
        raise ValueError(f"связь {did} в проекте не найдена — возможно, её уже сняли")
    await api.dep_delete(pid, did, user)

    def name(x) -> str:
        return titles.get(str(x)) or str(x)

    return {"section": "task-dependencies", "id": did,
            "title": f"{name(dep.get('task_id'))} ← {name(dep.get('depends_on_id'))}"}


async def _apply_baseline(api: "PmoApi", pid: str, data: dict, user: dict) -> dict:
    """Снимок плана. Снимается ПОСЛЕДНИМ (см. _ORDER): задача, добавленная после снимка,
    навсегда числится появившейся сверх плана."""
    created = (await api.baseline_create(pid, dict(data), user))["data"]
    return {"section": "baselines", "id": str(created.get("id")), "title": data.get("name")}


async def _apply_risk(api: "PmoApi", pid: str, op: str, it: dict, data: dict,
                      user: dict, titles: Optional[dict] = None) -> dict:
    """Тоже через штатный хендлер — иначе риск приедет без кода R-NN и без записи в журнал."""
    if op == "delete":
        rid = str(it.get("target_id"))
        name = (titles or {}).get(rid) or rid
        await api.risks_delete(pid, rid, user)
        return {"section": "risks", "id": rid, "title": name}
    if op == "add":
        created = (await api.risks_create(pid, dict(data), user))["data"]
        return {"section": "risks", "id": str(created.get("id")),
                "title": data.get("title"), "code": created.get("code")}
    rid = str(it.get("target_id"))
    await api.risks_update(pid, rid, dict(data), user)
    return {"section": "risks", "id": rid, "title": data.get("title")}


async def _apply_coll(api: "PmoApi", pid: str, key: str, section: str, op: str,
                      it: dict, data: dict, user: dict) -> dict:
    """Обычная коллекция в мете — тем же путём, что и роут раздела (with_meta_retry + журнал)."""
    import uuid

    target = str(it.get("target_id") or "")

    # Серверные поля коллекции — из ОДНОГО списка на весь портал (main._COLLECTION_PROTECTED).
    # Этот путь записи не проходит через фабрику коллекций, и раньше знал только про
    # id/project_id/created_at: помощник мог проставить владельца события Bitrix (и потом
    # удалить чужое событие из календаря) или отнести расходы к чужому блоку бюджета.
    guarded = ("id", "project_id", "created_at") + tuple(api._protected_fields(key))

    def mut(m):
        items = api._coll(m, key)
        if op == "add":
            item = {k: v for k, v in data.items() if k not in api._protected_fields(key)}
            item["id"] = item.get("id") or str(uuid.uuid4())
            item.setdefault("created_at", api._now_iso())
            item["project_id"] = m.get("_src_id") or pid
            items.append(item)
            m[key] = items
            api._log_action(m, user, f"{section}.create", api._item_label(item))
            return {"section": section, "id": str(item["id"]), "title": api._item_label(item)}
        if op == "delete":
            gone = next((x for x in items if str(x.get("id")) == target), None)
            m[key] = [x for x in items if str(x.get("id")) != target]
            label = api._item_label(gone or {"id": target})
            api._log_action(m, user, f"{section}.delete", label)
            # Название удалённого — в отчёт: «удалено 12» человеку ничего не говорит,
            # а при автоприёме это единственное, что он о потере узнает.
            return {"section": section, "id": target, "title": label}
        found = next((x for x in items if str(x.get("id")) == target), None)
        if not found:
            raise ValueError(f"элемент {target} не найден в разделе {section}")
        for k, v in data.items():
            if k not in guarded:
                found[k] = v
        api._log_action(m, user, f"{section}.update", api._item_label(found))
        return {"section": section, "id": target, "title": api._item_label(found)}

    return await api.with_meta_retry(pid, mut)


def _resolve(ref: Any, new_ids: dict) -> Any:
    """Ссылка может указывать на элемент, созданный в этом же приёме, — тогда id ещё «черновой»."""
    key = str(ref or "")
    return new_ids.get(key, ref)


def summary(draft: dict) -> dict:
    """Счётчики для списка и для экрана согласования."""
    counts = {"add": 0, "edit": 0, "delete": 0, "skip": 0, "clash": 0, "selected": 0}
    for it in draft.get("items") or []:
        op = str(it.get("op") or "")
        if op in counts:
            counts[op] += 1
        if it.get("selected") and op in ("add", "edit", "delete"):
            counts["selected"] += 1
    return counts


def sensitive_used(items: list) -> bool:
    return any(str(it.get("section") or "") in SENSITIVE_SECTIONS for it in items or [])


# Поля, где портал ждёт дату. Внешний помощник пишет их как человек — «01.09.2026», — а колонки
# дат в базе TEXT: задача с таким значением падает на разборе, а паспорт МОЛЧА сохраняет мусор,
# который потом ломает сортировку, Гант и признак просрочки. Приводим здесь, в единственной
# точке входа для обоих способов записи; знание о ловушке остаётся на сервере, как и обещано.
_DATE_KEYS = frozenset({
    "planned_start", "planned_end", "actual_start", "actual_end",
    "start_date", "end_date", "due_date", "date", "decided_at", "report_date",
})
_DDMMYYYY = re.compile(r"^(\d{2})[./-](\d{2})[./-](\d{4})$")


def _iso_date(value):
    """«01.09.2026» → «2026-09-01». ISO пропускаем как есть, непонятное не трогаем: лучше
    отдать серверу как прислали и получить внятный отказ, чем угадать не тот день."""
    if not isinstance(value, str):
        return value
    v = value.strip()
    m = _DDMMYYYY.match(v)
    if not m:
        return value
    day, month, year = m.groups()
    try:
        datetime(int(year), int(month), int(day))
    except ValueError:
        return value                     # 31.02.2026 — пусть ругается сервер, а не мы молча
    return f"{year}-{month}-{day}"


def normalize_dates(data: dict) -> dict:
    if not isinstance(data, dict):
        return data
    return {k: (_iso_date(v) if k in _DATE_KEYS else v) for k, v in data.items()}


_TASK_CHILD_KEYS = ("tasks", "children", "subtasks")
_MAX_TASK_DEPTH = 8
_MAX_PLAN_ROWS = 500


def expand_task_rows(rows: Any) -> tuple:
    """Раскрыть план работ в ПЛОСКИЙ список с явными ссылками на родителя.

    Принимает оба способа, которыми внешний агент естественно описывает иерархию:
      • дерево — у строки фазы вложенный массив `tasks` (или `children`/`subtasks`);
      • плоский список с `wbs_code`/`parent_wbs` — родитель находится по префиксу кода
        («1.1» → «1»).
    Раньше не работал ни один: вложенный массив уезжал внутрь данных задачи и молча
    отбрасывался на уровне колонок, а `wbs_code` доезжал до базы, но иерархию портал
    строит не по нему, а по parent_id. В обоих случаях у человека исчезала треть плана
    или план оставался плоским списком — без единой ошибки.

    Возвращает (items, rejected): всё, что раскрыть не удалось, возвращается поимённо,
    а не исчезает.
    """
    items: list = []
    rejected: list = []
    by_code: dict = {}

    def walk(row: Any, parent_ref: Optional[str], depth: int, path: str) -> None:
        if len(items) >= _MAX_PLAN_ROWS:
            rejected.append({"section": "tasks", "title": str((row or {}).get("title") if isinstance(row, dict) else row)[:80],
                             "why": f"в плане больше {_MAX_PLAN_ROWS} строк — остальные не приняты"})
            return
        if not isinstance(row, dict):
            rejected.append({"section": "tasks", "title": str(row)[:80], "why": "строка плана не объект"})
            return
        if depth > _MAX_TASK_DEPTH:
            rejected.append({"section": "tasks", "title": str(row.get("title") or "")[:80],
                             "why": f"вложенность глубже {_MAX_TASK_DEPTH} уровней"})
            return
        children: list = []
        data = {}
        for k, v in row.items():
            if k in _TASK_CHILD_KEYS and isinstance(v, list):
                children.extend(v)
            else:
                data[k] = v
        rid = f"t{path}"
        item = {"section": "tasks", "op": "add", "selected": True, "id": rid, "data": data}
        if parent_ref:
            item["parent_ref"] = parent_ref
        code = str(data.get("wbs_code") or "").strip()
        if code:
            by_code[code] = rid
        items.append(item)
        for i, child in enumerate(children, start=1):
            walk(child, rid, depth + 1, f"{path}.{i}")

    for i, row in enumerate(rows or [], start=1):
        walk(row, None, 0, str(i))

    # Плоский список с кодами ИСР: родитель — самый длинный известный префикс кода.
    for item in items:
        if item.get("parent_ref") or (item["data"] or {}).get("parent_id"):
            continue
        code = str((item["data"] or {}).get("parent_wbs") or "").strip()
        if not code:
            own = str((item["data"] or {}).get("wbs_code") or "").strip()
            if "." in own:
                code = own.rsplit(".", 1)[0]
        if code and by_code.get(code) and by_code[code] != item["id"]:
            item["parent_ref"] = by_code[code]
    return items, rejected


def plan_items(data: Any) -> tuple:
    """План проекта → элементы приёма. Всё, что не удалось разобрать, возвращается в rejected.

    Живёт здесь, а не в mcp_server: здесь же лежит и знание о порядке разделов, и обход
    ловушек портала. Две реализации разбора разошлись бы на первой же правке.
    """
    items: list = []
    rejected: list = []
    for section, payload in (data or {}).items():
        if section in ("status", "code", "name"):
            continue
        if section == "passport" and isinstance(payload, dict):
            items.append({"section": "passport", "op": "add", "selected": True, "data": payload})
            continue
        if section == "tasks":
            got, bad = expand_task_rows(payload if isinstance(payload, list) else [payload])
            items.extend(got)
            rejected.extend(bad)
            continue
        if isinstance(payload, list):
            for row in payload:
                if isinstance(row, dict):
                    items.append({"section": section, "op": "add", "selected": True, "data": row})
                else:
                    rejected.append({"section": section, "title": str(row)[:80], "why": "строка не объект"})
            continue
        rejected.append({"section": section, "title": "", "why": "раздел ожидает список объектов"})
    return items, rejected


# Как модели называют операции на самом деле. Приведение к нашим пяти именам — не вежливость:
# без него «update» превращалось в «добавить», и вместо правки в проекте появлялся дубль.
_OP_SYNONYMS = {
    "update": "edit", "modify": "edit", "change": "edit", "patch": "edit", "set": "edit",
    "remove": "delete", "del": "delete", "drop": "delete",
    "create": "add", "insert": "add", "new": "add",
    "ignore": "skip", "duplicate": "skip",
    "conflict": "clash",
}
_OPS = ("add", "edit", "delete", "skip", "clash")


def normalize_items(raw: Any) -> list:
    """Привести состав к нашей форме и не пустить внутрь мусор от внешнего агента."""
    out = []
    for i, it in enumerate(raw or []):
        if not isinstance(it, dict):
            continue
        op = str(it.get("op") or "add").strip().lower()
        unclear = ""
        if op not in _OPS:
            # Название операции приходит извне и может быть какой угодно длины. Режем здесь,
            # а не при склейке: ниже к нему добавляется присланный note, уже ограниченный 400.
            op, unclear = _OP_SYNONYMS.get(op, ""), op[:120]
            # Не поняли — значит НЕ «добавить». clash уже означает «решает человек» и не
            # применяется никогда: нераспознанная операция не может создать данные.
            if not op:
                op = "clash"
        section = str(it.get("section") or "")
        # Достаём ОДИН раз и сужаем тип на месте: два отдельных .get() проверяющий типы
        # не связывает между собой, и «а вдруг None» становится ошибкой сборки.
        data = it.get("data")
        was = it.get("was")
        item = {
            "id": str(it.get("id") or f"i{i + 1}"),
            "section": section,
            "op": op,
            # По умолчанию отмечено только то, что реально применяется: пропуски и противоречия
            # человек отмечает сам, осознанно.
            "selected": bool(it.get("selected", op in ("add", "edit", "delete"))),
            "data": normalize_dates(data) if isinstance(data, dict) else {},
            "note": (f"сервер не понял операцию «{unclear}» — применять не стал, решает человек. "
                     if unclear and op == "clash" else "") + str(it.get("note") or "")[:400],
        }
        if it.get("target_id"):
            item["target_id"] = str(it["target_id"])
        # Ссылка на родителя ВНУТРИ этого же черновика (её ставит expand_task_rows).
        # Без явного переноса она терялась: элемент пересобирается по белому списку ключей.
        if it.get("parent_ref"):
            item["parent_ref"] = str(it["parent_ref"])
        if isinstance(was, dict):
            item["was"] = normalize_dates(was)
        out.append(item)
    return out


def find_open_draft(drafts: list) -> Optional[dict]:
    return next((d for d in drafts if d.get("status") == "open"), None)
