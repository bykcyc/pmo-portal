"""Generic modular-collection CRUD factory on the stable ``main`` facade.

``register`` reproduces the former ``main._register_collection`` verbatim, but
registers on a passed ``router`` and resolves every helper/state through ``api``
at call time (load_meta, _coll, with_meta_retry, _recount, _log_action, _next_code,
_validate_generic_item, _item_label, _diff_detail, _now_iso, rbac). Route names,
paths, methods and response bytes are unchanged.
"""

import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Body, Depends, HTTPException


def register(api: "PmoApi", router: APIRouter, url: str, key: str, reorder: bool = False,
             sort: bool = True, recount: bool = False, code_prefix: str = "",
             on_delete: str = "", protected: tuple = (), before_write: str = ""):
    """on_delete — ИМЯ хелпера на `api`, который вызывается ПОСЛЕ удаления элемента.

    Имя, а не функция: хелперы этого проекта резолвятся через `api` в момент вызова —
    только так работают monkeypatch в тестах и подмена в рантайме. Захваченная при
    регистрации ссылка молча жила бы своей жизнью.

    Нужен там, где у элемента есть двойник во внешней системе: у совещания это событие
    в календаре Bitrix, которое иначе остаётся жить вечно, потеряв ссылку на себя вместе
    с удалённым документом. Провал хука НЕ отменяет удаление в портале — оно уже произошло.

    before_write — ИМЯ хелпера на `api`, вызываемого ВНУТРИ mutate перед тем, как элемент
    ляжет в коллекцию: `hook(m, item, payload)`. Здесь есть вся мета проекта (а значит и
    ставка часа, и транзиентное дерево), но нет похода в базу — mutate синхронный и
    повторяется до четырёх раз. Поэтому здесь место ТОЛЬКО тем производным, что считаются
    по данным того же проекта; всё межпроектное живёт в своих маршрутах.

    protected — поля, которые ставит СЕРВЕР и не вправе прислать клиент.

    Без этого списка обычный PUT элемента переписывал любое поле: у совещания так можно было
    подсунуть чужой `bitrix_event_id` и `bitrix_event_owner`, а потом нажать «убрать из Bitrix» —
    и вебхук интеграции удалил бы произвольное событие из чужого календаря.
    """
    base = f"/projects/{{pid}}/{url}"
    # id/project_id/created_at защищены всегда: они и раньше не принимались от клиента.
    guarded = ("id", "project_id", "created_at") + tuple(protected)

    async def _list(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        data = api._coll(m, key)
        if user.get("role") == "public":  # анонимный share: убрать контактный PII (email/phone/рассылка)
            data = api._redact_public(data)
        return {"data": data}

    def _hook():
        return getattr(api, before_write, None) if before_write else None   # резолвим В МОМЕНТ вызова

    async def _create(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_generic_item(payload)
        item = {k: v for k, v in payload.items() if k not in protected}
        item["id"] = payload.get("id") or str(uuid.uuid4())
        item.setdefault("created_at", api._now_iso())

        def mut(m):
            items = api._coll(m, key)
            item["project_id"] = m.get("_src_id") or pid
            hook = _hook()
            if hook:
                hook(m, item, payload, {})       # создание: «до» нет
            # Авто-код PREFIX-NN (нумерация как у рисков) — если ещё не задан.
            if code_prefix and not item.get("code"):
                item["code"] = api._next_code(items, code_prefix)
            if sort:
                item.setdefault("sort_order", len(items))
            items.append(item)
            m[key] = items
            if recount:
                api._recount(m)
            api._log_action(m, user, f"{url}.create", api._item_label(item))
            return item
        return {"data": await api.with_meta_retry(pid, mut)}

    async def _update(pid: str, item_id: str, payload: dict, user: dict = Depends(api.rbac)):
        api._validate_generic_item(payload)

        def mut(m):
            found = None
            for it in api._coll(m, key):
                if str(it.get("id")) == item_id:
                    pre = {k: it.get(k) for k in payload if k not in guarded}
                    for k, v in payload.items():
                        if k not in guarded:
                            it[k] = v
                    hook = _hook()
                    if hook:
                        # `pre` — значения ДО правки: производным полям нужно знать, что
                        # именно изменилось, а не только то, что прислали.
                        hook(m, it, payload, pre)
                    found = it
                    # правки полей тоже журналируем (раньше — только create/delete,
                    # и журнал раздела выглядел «выборочной историей»)
                    diff = api._diff_detail(pre, payload, pre.keys())
                    if diff:
                        api._log_action(m, user, f"{url}.update", f"{api._item_label(it)}: {diff}")
                    break
            if not found:
                raise HTTPException(status_code=404, detail="Item not found")
            if recount:
                api._recount(m)
            return found
        return {"data": await api.with_meta_retry(pid, mut)}

    async def _delete(pid: str, item_id: str, user: dict = Depends(api.rbac)):
        removed: dict = {}

        def mut(m):
            gone = next((it for it in api._coll(m, key) if str(it.get("id")) == item_id), None)
            if gone is not None:
                removed["item"] = gone      # хуку нужен сам элемент: из меты он уже исчезнет
            m[key] = [it for it in api._coll(m, key) if str(it.get("id")) != item_id]
            if recount:
                api._recount(m)
            api._log_action(m, user, f"{url}.delete", api._item_label(gone or {"id": item_id}))
            return {"id": item_id}
        res = await api.with_meta_retry(pid, mut)
        hook = getattr(api, on_delete, None) if on_delete else None   # резолвим В МОМЕНТ вызова
        if hook and removed.get("item"):
            try:
                await hook(pid, removed["item"], user)
            except Exception as exc:  # noqa: BLE001 — внешняя система не отменяет удаление у нас
                api.logger.warning("%s.on_delete для %s не отработал: %s", url, item_id, exc)
        return {"data": res}

    router.add_api_route(base, _list, methods=["GET"], name=f"{key}_list")
    router.add_api_route(base, _create, methods=["POST"], name=f"{key}_create")
    router.add_api_route(base + "/{item_id}", _update, methods=["PUT"], name=f"{key}_update")
    router.add_api_route(base + "/{item_id}", _delete, methods=["DELETE"], name=f"{key}_delete")
    if reorder:
        async def _reorder(pid: str, payload: list = Body(...), user: dict = Depends(api.rbac)):
            """Переставляет САМ МАССИВ, а не только клеит метку sort_order.

            Раньше писалось лишь поле sort_order, а коллекция отдаётся читателям в порядке
            хранения и по sort_order никто не сортирует — поэтому перетаскивание строки не
            переживало обновление данных: строка возвращалась на место. Элементы, которых нет
            в теле запроса, сохраняют относительный порядок и уходят в хвост; в конце sort_order
            нормализуется в 0..n-1, чтобы после удалений не оставалось дыр и дублей."""
            order: dict = {}
            for idx, x in enumerate(payload or []):
                if not isinstance(x, dict) or x.get("id") in (None, ""):
                    raise HTTPException(status_code=422, detail="Для reorder обязателен id элемента")
                so = x.get("sort_order")
                order[str(x["id"])] = so if isinstance(so, int) and not isinstance(so, bool) else idx

            def mut(m):
                items = api._coll(m, key)

                def pos(pair):
                    i, it = pair
                    oid = str(it.get("id"))
                    return (0, order[oid], i) if oid in order else (1, 0, i)
                ordered = [it for _, it in sorted(enumerate(items), key=pos)]
                for i, it in enumerate(ordered):
                    it["sort_order"] = i
                m[key] = ordered
                return {"ok": True}
            return {"data": await api.with_meta_retry(pid, mut)}
        router.add_api_route(base + "/reorder", _reorder, methods=["POST"], name=f"{key}_reorder")
