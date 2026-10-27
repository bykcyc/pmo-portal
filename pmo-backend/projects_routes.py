"""Project CRUD + lifecycle (archive/template/transfer/editors/clone/summary/version_log/action-log)."""

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException


# Исходы db.set_project_parent → HTTP. Таблицей: тексты отказов часть контракта, и держать их
# рядом с проверками, а не размазывать по веткам, — единственный способ не дать им разъехаться.
_SUBPROJECT_ERRORS = {
    "self": {"status_code": 422, "detail": "Проект нельзя сделать подпроектом самого себя"},
    "missing": {"status_code": 404, "detail": "Проект не найден"},
    "parent_has_parent": {"status_code": 422, "detail": "Подпроект не может быть зонтиком: уровень только один"},
    "child_has_children": {"status_code": 422, "detail": "У этого проекта есть свои подпроекты — уровень только один"},
    "child_already_linked": {"status_code": 409, "detail": "Проект уже привязан к другому зонтику"},
}


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/projects")
    async def projects(status: str = "", priority: str = "", project_kind: str = "", pm_id: str = "", include_archived: bool = False,
                       page: int = 1, per_page: int = 50, user: dict = Depends(api.rbac)):
        # Список не читает нормализованные коллекции → грузим проекты без project_docs (перф).
        items = [api.to_list_item(e) for e in await api.fetch_projects(with_docs=False)]
        items = [i for i in items if not i.get("code", "").startswith("__")]  # скрыть служебные
        items = [i for i in items if not i.get("is_template")]                # шаблоны — не в общем списке
        if not include_archived:
            items = [i for i in items if not i.get("archived")]              # архивные — по умолчанию скрыты
        # pm видит свои проекты, те, где он со-РП, и те, где он наблюдатель (только чтение).
        if user.get("role") not in api.READ_ALL_ROLES:
            items = [i for i in items if api._can_read_item(user, i)]
        if status:
            items = [i for i in items if i["status"] == status]
        if priority:
            items = [i for i in items if i["priority"] == priority]
        if project_kind:
            items = [i for i in items if i.get("project_kind") == project_kind]
        if pm_id:
            items = [i for i in items if i["pm_id"] == pm_id]
        total = len(items)
        start = (page - 1) * per_page
        page_items = items[start:start + per_page]
        wps_by_pid = await api._fetch_wps_bulk([i["id"] for i in page_items], api.TASK_TYPE_IDS)
        for item in page_items:
            c = api._task_counts(wps_by_pid.get(item["id"], []))
            item.update({k: c[k] for k in ("progress", "tasks_total", "tasks_completed")})
        return {"data": page_items, "total": total, "page": page, "per_page": per_page}

    @router.get("/projects/{pid}")
    async def project_get(pid: str, user: dict = Depends(api.rbac)):
        d = await api.db.get_project_row(pid)
        if not d:
            raise HTTPException(status_code=404, detail="Project not found")
        data = api.to_project(d)
        # Анонимная ссылка ходит СЮДА, а не в /public/{token}: тот отдаёт только заголовок и
        # список разделов, а паспорт публичная страница берёт обычным маршрутом с ?share=…
        # (rbac выдаёт role="public"). Редакция, поставленная в `_public_project_view`, этот
        # путь не закрывала — и `editors`/`observers` (внутренние id людей) уезжали наружу.
        # Тот же приём, что у `_redact_public` в tasks/risks/collections: правка ТОЛЬКО для
        # role="public", у owner/pm/exec байты не двигаются.
        if user.get("role") == "public":
            data = {k: v for k, v in data.items() if k not in api._PUBLIC_HIDDEN_FIELDS}
        return {"data": data}

    @router.put("/projects/{pid}")
    async def project_put(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        return {"data": await api._save_meta(pid, payload, author=user.get("full_name") or user.get("email"), user=user)}

    @router.post("/projects")
    async def project_create(payload: dict, user: dict = Depends(api.rbac)):
        # Валидация ДО INSERT: невалидный payload не должен оставлять проект-сироту с пустой meta.
        api._validate_project_payload(payload)
        code = payload.get("code") or "PRJ"
        ident = "".join(ch if ch.isalnum() else "-" for ch in code.lower())[:90] + "-" + str(int(time.time()))[-5:]
        d = await api.db.insert_project(payload.get("name") or code, ident, "{}")
        # Создатель становится РП нового проекта. Иначе РП сразу получит 403 на свои же данные
        # (rbac: pm правит только свои). Именно это ломало Excel-импорт: pm_name брался из файла,
        # pm_id не задавался → проект «ничей» → все под-создания (команда/задачи/…) падали 403.
        # WP2: РПП (owner) теперь тоже пишет и МОЖЕТ назначить другого РП прямо при создании;
        # выбор опционален — по умолчанию РП становится он сам (решение владельца).
        target = user
        if user.get("role") == "owner":
            want = str(payload.get("pm_id") or "").strip()
            if want and want != str(user.get("id")):
                _, tu = api._find_user_by_id(want)
                if not tu or not tu.get("is_active", True) or tu.get("role") not in api.WRITE_ROLES:
                    raise HTTPException(status_code=422,
                                        detail="Руководителем проекта может быть только активный пользователь с правом записи")
                target = tu
        payload = {**payload, "pm_id": target.get("id"), "pm_name": target.get("full_name")}
        pid = str(d["id"])
        try:
            return {"data": await api._save_meta(pid, payload)}
        except Exception:
            # Компенсация на редкий сбой сериализации/первичного UPDATE после успешного INSERT.
            # Это не заменяет транзакцию, но не оставляет невидимый пустой проект при штатной ошибке.
            try:
                await api.db.delete_project(pid)
            except Exception as cleanup_error:  # noqa: BLE001
                api.logger.error("Не удалось удалить проект-сироту %s после ошибки create: %s", pid, cleanup_error)
            raise

    @router.delete("/projects/{pid}")
    async def project_delete(pid: str, user: dict = Depends(api.rbac)):
        await api.db.delete_project(pid)
        # Удаление зонтика освобождает подпроекты (ON DELETE SET NULL) и отменяет наследование
        # на них; удаление подпроекта убирает его людей из читающих зонтик и соседей. Кэш о
        # дереве не знает, поэтому чистим целиком — удаление проекта бывает раз в месяц.
        api._invalidate_tree_access()
        return {"data": {"id": pid}}

    @router.get("/projects/{pid}/summary")
    async def project_summary(pid: str, user: dict = Depends(api.rbac)):
        d = await api.db.get_project_row(pid)
        if d:
            d["_docs"] = await api.db.load_project_docs(pid)  # _collection_counts читает _meetings
        m = api._meta(d) if d else {}
        task_wps, risk_wps = await asyncio.gather(
            api._fetch_wps(pid, api.TASK_TYPE_IDS),
            api._fetch_wps(pid, [api.RISK_TYPE_ID]),
        )
        risks = api._risks_from_wps(risk_wps, m, pid)
        c = {
            **api._collection_counts(m),
            **api._task_counts(task_wps),
            **api._risk_counts(risks),
        }
        done = (api.to_project(d).get("status") in ("completed", "cancelled")) if d else False
        # Цвет — через ту же точку, что портфель: по листовым работам, без фаз и отменённых.
        # Выводимые ниже счётчики (tasks_total, overdue_tasks) остаются прежними — это контракт.
        today_s = datetime.now(timezone.utc).date().isoformat()
        rag = api._project_rag(m, api._tasks_from_wps(task_wps, m, pid), risks, today_s, done)
        return {"data": {
            "project_id": pid,
            "tasks_total": c.get("tasks_total", 0),
            "tasks_completed": c.get("tasks_completed", 0),
            "risks_open": c.get("risks_open", 0),
            "decisions_total": c.get("decisions_total", 0),
            "open_actions": c.get("open_actions", 0),
            # сверка с портфелем изнутри проекта (закрытый — тихий, как в дашборде)
            "overdue_tasks": 0 if done else c.get("overdue_tasks", 0),
            "progress": c.get("progress", 0),
            "risks_high": c.get("risks_high", 0),
            "risks_medium": c.get("risks_medium", 0),
            "rag": rag,
        }}

    @router.get("/projects/{pid}/version_log")
    async def version_log(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        vlog = m.get("_version_log") or []
        return {"data": list(reversed(vlog))}  # новейшие сверху

    @router.post("/projects/{pid}/version/close")
    async def close_version(pid: str, user: dict = Depends(api.rbac)):
        """Зафиксировать текущую версию паспорта: номер перестаёт меняться, следующая правка
        уйдёт в новый. Нужно, когда паспорт печатают или отправляют на согласование прямо
        сейчас, — иначе напечатанный 1.0003 продолжит впитывать правки и через час это будет
        уже другой документ под тем же номером. Ждать истечения сеанса (15 мин) не надо."""
        def _mut(m):
            vlog = m.get("_version_log") or []
            if not vlog:
                return {"version": m.get("version") or "", "closed": False}
            vlog[-1]["closed"] = True
            m["_version_log"] = vlog
            api._log_action(m, user, "project.version_closed", str(m.get("version") or ""))
            return {"version": m.get("version") or "", "closed": True}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/projects/{pid}/action-log")
    async def project_action_log(pid: str, user: dict = Depends(api.rbac)):
        """Журнал действий проекта, новейшие сверху (кто удалил задачу / передал проект и т.п.)."""
        _, m = await api.load_meta(pid)
        return {"data": list(reversed(m.get("_action_log") or []))}

    @router.post("/projects/{pid}/archive")
    async def project_archive(pid: str, user: dict = Depends(api.rbac)):
        """Архивировать проект (soft-hide): скрыт из списков/портфеля, данные целы, обратимо."""
        def _mut(m):
            m["_archived"] = True
            api._log_action(m, user, "project.archive", "")
            return {"id": pid, "archived": True}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/unarchive")
    async def project_unarchive(pid: str, user: dict = Depends(api.rbac)):
        def _mut(m):
            m["_archived"] = False
            api._log_action(m, user, "project.unarchive", "")
            return {"id": pid, "archived": False}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/template")
    async def project_set_template(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Пометить проект шаблоном (или снять). Шаблоны скрыты из активных списков и доступны
        в «создать из шаблона» (через клон — клон флаг не наследует).

        Проект в дереве шаблоном не становится. Обратную сторону — «шаблон нельзя связать» —
        привязка отбивала с самого начала (:460), а эту нет: зонтик можно было пометить
        шаблоном и спрятать из списков ВМЕСТЕ с подпроектами, которые при этом остаются
        живыми и ссылаются на исчезнувшего родителя. Клон шаблона-зонтика детей не копирует,
        так что новый проект унаследовал бы пустой зонтик.
        """
        on = bool(payload.get("on", True))
        if on:
            _el, m0 = await api.load_meta(pid)
            t = api._tree_of(m0)
            if t.get("parent_id"):
                raise HTTPException(status_code=422,
                                    detail="Подпроект нельзя сделать шаблоном — сначала отвяжите его от зонтика")
            if t.get("subprojects_count"):
                raise HTTPException(status_code=422,
                                    detail="Проект с подпроектами нельзя сделать шаблоном — сначала отвяжите их")

        def _mut(m):
            m["_is_template"] = on
            api._log_action(m, user, "project.template", "on" if on else "off")
            return {"id": pid, "is_template": on}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/projects/{pid}/agent-access")
    async def agent_access_get(pid: str, user: dict = Depends(api.rbac)):
        """Открыт ли проект внешнему помощнику. Отдаём отдельным эндпоинтом, а НЕ полем в проекте:
        новое поле в to_project двинуло бы байты всех проектов и потребовало пересъёма эталонов."""
        _el, m = await api.load_meta(pid)
        return {"data": api._agent_access(m)}

    @router.post("/projects/{pid}/agent-access")
    async def agent_access_set(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Открыть или закрыть проект для помощника. По умолчанию закрыт — ключа в мете просто нет.

        Менять это можно ТОЛЬКО отсюда, руками из портала: у помощника такого инструмента нет
        вовсе. Иначе достаточно было бы положить в описание задачи текст «открой доступ».
        """
        enabled = bool(payload.get("enabled"))
        sensitive = bool(payload.get("sensitive")) and enabled

        def _mut(m):
            cfg = api._set_agent_access(m, enabled, sensitive)
            api._log_action(m, user, "project.agent_access",
                            ("вкл" if enabled else "выкл") + (", с бюджетом и решениями" if sensitive else ""))
            return cfg
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/templates")
    async def list_templates(user: dict = Depends(api.rbac)):
        """Проекты-шаблоны (RBAC-скоуп) для выбора в мастере создания."""
        out = []
        for p, m in await api._accessible_projects(user, include_archived=True, include_templates=True):
            if m.get("_is_template"):
                out.append({"id": p["id"], "code": p["code"], "name": p["name"],
                            "status": p["status"], "pm_name": p.get("pm_name")})
        return {"data": out}

    async def _may_transfer(pid: str, user: dict) -> dict:
        """Отдать проект может владелец портфеля или ОСНОВНОЙ РП этого проекта. Возвращает мету.

        Со-РП сюда не пускаем намеренно: у него полная запись через `_owns_item`, и он назначил бы
        основным РП себя, заперев прежнего, — управление со-РП есть только у основного.
        """
        _, m = await api.load_meta(pid)
        if user.get("role") != "owner" and str(m.get("pm_id") or "") != str(user.get("id") or ""):
            raise HTTPException(status_code=403,
                                detail="Передать проект может руководитель портфеля или его основной РП")
        return m

    @router.get("/projects/{pid}/transfer-candidates")
    async def transfer_candidates(pid: str, user: dict = Depends(api.rbac)):
        """Кому можно отдать ЭТОТ проект.

        Отдельный маршрут, потому что список людей диалог брал из /admin/users, а тот только для
        владельца портфеля: у РП диалог открывался пустым. Заодно правило «кто может быть РП»
        теперь живёт на сервере в одном месте, а не зеркалится на фронте.
        """
        m = await _may_transfer(pid, user)
        cur = str(m.get("pm_id") or "")
        return {"data": [{"id": str(u.get("id")), "full_name": u.get("full_name"), "email": e}
                         for e, u in api.USERS.items()
                         if u.get("is_active", True) and u.get("role") in api.WRITE_ROLES
                         and str(u.get("id")) != cur]}

    @router.post("/admin/projects/{pid}/transfer")
    async def project_transfer(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Передача проекта другому РП. Чинит мисконфиг владельца и замену на отпуск —
        раньше owner не мог править проекты вообще, а pm — только свои (замкнутый круг).

        Доступно и основному РП: владельческая учётка может быть одна на весь портал, и без
        этого РП не мог бы передать даже собственный проект. Кто отдаёт — остаётся со-РП (см. `_mut`).
        """
        await _may_transfer(pid, user)
        new_pm_id = str(payload.get("pm_id") or "").strip()
        new_pm_name = str(payload.get("pm_name") or "").strip()
        if not new_pm_id and not new_pm_name:
            raise HTTPException(status_code=422, detail="Нужен pm_id или pm_name нового РП")
        # S3: если пришло только имя — резолвим его в конкретного пользователя (pm_id), чтобы владение
        # не опиралось на строку-имя, которую пользователь может себе поменять.
        target = None
        if new_pm_id:
            target = next((u for u in api.USERS.values() if str(u.get("id")) == new_pm_id), None)
        elif new_pm_name:
            target = next((u for u in api.USERS.values()
                           if (u.get("full_name") or "").strip().casefold() == new_pm_name.casefold()), None)
            if target:
                new_pm_id = str(target.get("id"))
        if new_pm_id and not target:
            raise HTTPException(status_code=404, detail="Пользователь с таким pm_id не найден")
        # transfer-валидация: новый РП должен быть активен и уметь писать (WP2: роль viewer удалена,
        # проверяем не «не viewer», а «есть право записи» — иначе проект остался бы без хозяина).
        if target:
            if not target.get("is_active", True):
                raise HTTPException(status_code=422, detail="Нельзя передать проект неактивному пользователю")
            if target.get("role") not in api.WRITE_ROLES:
                raise HTTPException(status_code=422, detail="Наблюдатель (viewer) не может быть ведущим РП")

        def _mut(m):
            old = m.get("pm_name")
            old_id = str(m.get("pm_id") or "")
            if new_pm_id:
                m["pm_id"] = new_pm_id
            if new_pm_name:
                m["pm_name"] = new_pm_name
            # Отдал проект сам — остаёшься со-РП. Иначе человек нажимает «Передать» и в ту же
            # секунду теряет доступ к собственному проекту, а вернуть его может только владелец
            # портфеля. Владелец, передающий чужой проект, сюда не попадает: у него другой id.
            if old_id and old_id == str(user.get("id") or "") and old_id != new_pm_id:
                eds = [str(x) for x in (m.get("_editors") or [])]
                if old_id not in eds:
                    m["_editors"] = eds + [old_id]
            api._log_action(m, user, "project.transfer", f"{old or '—'} → {m.get('pm_name') or '—'}")
            return {"pm_id": m.get("pm_id"), "pm_name": m.get("pm_name")}
        result = await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after)
        return {"data": result}

    @router.get("/projects/{pid}/editors")
    async def project_editors_list(pid: str, user: dict = Depends(api.rbac)):
        """Со-РП проекта (соавторы с правом правки). rbac уже проверил доступ к проекту."""
        _, m = await api.load_meta(pid)
        return {"data": [api._editor_view(x) for x in (m.get("_editors") or [])]}

    @router.post("/projects/{pid}/editors")
    async def project_editor_add(pid: str, payload: dict, user: dict = Depends(api.current_user)):
        """Добавить со-РП (заместитель/соавтор). Может основной РП проекта или owner.
        Со-РП получает те же права на проект, что и РП (через _owns_item), но НЕ управляет со-РП."""
        new_id = str(payload.get("user_id") or "").strip()
        if not new_id:
            raise HTTPException(status_code=422, detail="Нужен user_id со-РП")
        target = next((u for u in api.USERS.values() if str(u.get("id")) == new_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        def _mut(m):
            # Проверка прав ВНУТРИ mutate — против свежей меты каждой попытки (иначе TOCTOU:
            # передача проекта параллельным запросом между pre-check и записью). Raise пробрасывается
            # из with_meta_retry (mutate не обёрнут try) без ретрая.
            if not api._is_primary_pm_or_owner(user, m):
                raise HTTPException(status_code=403, detail="Только основной РП проекта или owner могут добавлять со-РП")
            if m.get("pm_id") and str(m["pm_id"]) == new_id:
                raise HTTPException(status_code=422, detail="Пользователь уже основной РП проекта")
            eds = [str(x) for x in (m.get("_editors") or [])]
            if new_id not in eds:
                eds.append(new_id)
                api._log_action(m, user, "project.editor_add", target.get("full_name") or new_id)
            m["_editors"] = eds
            # Повышение наблюдателя до со-РП: из наблюдателей убираем. Обратное направление
            # (со-РП → наблюдатель) маршрут наблюдателей запрещает: понижение — потеря прав,
            # его делают осознанно. А ЗДЕСЬ прав только прибавляется, поэтому не отказ, а перевод.
            # Без этого человек оставался в обоих списках разом: в колонках «Со-РП» и
            # «Наблюдатели» одно имя, а снятие со-РП тихо оставляло бы ему доступ на чтение.
            obs = [str(x) for x in (m.get("_observers") or [])]
            if new_id in obs:
                m["_observers"] = [x for x in obs if x != new_id]
                api._log_action(m, user, "project.observer_remove", target.get("full_name") or new_id)
            return {"editors": [api._editor_view(x) for x in eds]}
        res = await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after, new_id)
        return {"data": res}

    @router.delete("/projects/{pid}/editors/{uid}")
    async def project_editor_remove(pid: str, uid: str, user: dict = Depends(api.current_user)):
        """Убрать со-РП. Может основной РП проекта или owner."""
        def _mut(m):
            # Проверка прав против свежей меты каждой попытки (не TOCTOU) — см. project_editor_add.
            if not api._is_primary_pm_or_owner(user, m):
                raise HTTPException(status_code=403, detail="Только основной РП проекта или owner могут убирать со-РП")
            eds = [str(x) for x in (m.get("_editors") or []) if str(x) != str(uid)]
            api._log_action(m, user, "project.editor_remove", str(uid))
            m["_editors"] = eds
            return {"editors": [api._editor_view(x) for x in eds]}
        res = await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after, uid)
        return {"data": res}

    @router.get("/projects/{pid}/observers")
    async def project_observers_list(pid: str, user: dict = Depends(api.rbac)):
        """Наблюдатели проекта (просмотр без права правки). rbac уже проверил доступ."""
        _, m = await api.load_meta(pid)
        return {"data": [api._editor_view(x) for x in (m.get("_observers") or [])]}

    @router.post("/projects/{pid}/observers")
    async def project_observer_add(pid: str, payload: dict, user: dict = Depends(api.current_user)):
        """Добавить наблюдателя. Может основной РП проекта или owner — как у со-РП.

        Наблюдатель видит проект целиком, но не может изменить ничего: право чтения даёт
        `_can_read_item`, а все гарды записи спрашивают `_owns_item`, куда наблюдатели
        намеренно не входят.
        """
        new_id = str(payload.get("user_id") or "").strip()
        if not new_id:
            raise HTTPException(status_code=422, detail="Нужен user_id наблюдателя")
        target = next((u for u in api.USERS.values() if str(u.get("id")) == new_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        def _mut(m):
            # Права проверяем против свежей меты каждой попытки — см. project_editor_add.
            if not api._is_primary_pm_or_owner(user, m):
                raise HTTPException(status_code=403,
                                    detail="Только основной РП проекта или owner могут добавлять наблюдателей")
            if m.get("pm_id") and str(m["pm_id"]) == new_id:
                raise HTTPException(status_code=422, detail="Пользователь уже основной РП проекта")
            # Со-РП уже видит проект и умеет его править: понижать его до наблюдателя
            # незаметной командой нельзя — сначала снимите со-РП.
            if new_id in [str(x) for x in (m.get("_editors") or [])]:
                raise HTTPException(status_code=422, detail="Пользователь уже со-РП проекта")
            obs = [str(x) for x in (m.get("_observers") or [])]
            if new_id not in obs:
                obs.append(new_id)
                api._log_action(m, user, "project.observer_add", target.get("full_name") or new_id)
            m["_observers"] = obs
            return {"observers": [api._editor_view(x) for x in obs]}
        res = await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after, new_id)
        return {"data": res}

    @router.delete("/projects/{pid}/observers/{uid}")
    async def project_observer_remove(pid: str, uid: str, user: dict = Depends(api.current_user)):
        """Убрать наблюдателя. Может основной РП проекта или owner."""
        def _mut(m):
            if not api._is_primary_pm_or_owner(user, m):
                raise HTTPException(status_code=403,
                                    detail="Только основной РП проекта или owner могут убирать наблюдателей")
            obs = [str(x) for x in (m.get("_observers") or []) if str(x) != str(uid)]
            api._log_action(m, user, "project.observer_remove", str(uid))
            m["_observers"] = obs
            return {"observers": [api._editor_view(x) for x in obs]}
        res = await api.with_meta_retry(pid, _mut)
        _, m_after = await api.load_meta(pid)
        api._invalidate_after_membership_change(pid, m_after, uid)
        return {"data": res}

    # ── дерево проектов: зонтик и подпроекты ──────────────────────────────────────────────
    # Связь ставится ОТДЕЛЬНЫМ маршрутом, а не полем паспорта: она раздаёт права (РП зонтика
    # правит подпроект, участники подпроектов читают друг друга), и такое не должно проезжать
    # обычным PUT вместе с названием.

    @router.get("/projects/{pid}/subprojects")
    async def subprojects_list(pid: str, user: dict = Depends(api.rbac)):
        """Строки подпроектов в форме портфеля: прогресс, просрочка, риски, RAG, бюджет.

        Отдельного фильтра доступа тут не нужно: кто прочитал зонтик, тот по правилу дерева
        читает и все его подпроекты. Страховку `_can_read_item` всё же оставляем — она по
        построению ничего не отсекает, но переживёт смену правила.
        """
        kids = await api._readable_children(pid, user)
        if not kids:
            return {"data": []}
        els = [el for el, _p, _m in kids]
        today_s = datetime.now(timezone.utc).date().isoformat()
        pids = [str(e.get("id")) for e in els]
        wps, rwps, bl = await asyncio.gather(
            api._fetch_wps_bulk(pids, api.TASK_TYPE_IDS),
            api._fetch_wps_bulk(pids, [api.RISK_TYPE_ID]),
            api.db.load_latest_baselines())
        rows = []
        for _el, p, m in kids:
            row = api._portfolio_row(
                p, m,
                api._tasks_from_wps(wps.get(p["id"], []), m, p["id"]),
                api._risks_from_wps(rwps.get(p["id"], []), m, p["id"]),
                bl, today_s)
            row["pm_id"] = p.get("pm_id")
            rows.append(row)
        rows.sort(key=lambda r: (str(r.get("code") or ""), str(r.get("id"))))
        return {"data": rows}

    @router.post("/projects/{pid}/subprojects")
    async def subproject_add(pid: str, payload: dict, user: dict = Depends(api.current_user)):
        """Привязать существующий проект к зонтику.

        Право: владелец портфеля — либо основной РП зонтика, НО только если он и подпроектом
        владеет. Иначе привязка была бы способом присвоить чужой проект: связал — и получил
        на него полные права. Обратное направление («подпроект сам выбирает зонтик») тоже
        закрыто: она открыла бы его данные всем участникам чужого дерева без их ведома.
        """
        child = str(payload.get("project_id") or "").strip()
        if not child:
            raise HTTPException(status_code=422, detail="Нужен project_id подпроекта")
        _, um = await api.load_meta(pid)
        child_el = await api.db.get_project_row(child)
        if not child_el:
            raise HTTPException(status_code=404, detail="Проект не найден")
        cm = api._meta(child_el)
        if not (user.get("role") == "owner"
                or (api._is_primary_pm_or_owner(user, um) and api._owns_item(user, cm))):
            raise HTTPException(status_code=403,
                                detail="Привязать подпроект может owner или основной РП зонтика, ведущий этот проект")
        if um.get("_is_template") or cm.get("_is_template"):
            raise HTTPException(status_code=422, detail="Шаблон нельзя связать с проектом")
        if um.get("_archived"):
            raise HTTPException(status_code=422, detail="Сначала разархивируйте проект-зонтик")
        code = await api.db.set_project_parent(child, pid)
        if code != "ok":
            raise HTTPException(**_SUBPROJECT_ERRORS[code])
        api._invalidate_tree_access()
        await api._append_action_log(pid, user, "project.subproject_add", cm.get("code") or child)
        await api._append_action_log(child, user, "project.parent_set", um.get("code") or pid)
        return {"data": {"project_id": child, "parent_id": pid}}

    @router.delete("/projects/{pid}/subprojects/{child_id}")
    async def subproject_remove(pid: str, child_id: str, user: dict = Depends(api.current_user)):
        """Отвязать подпроект. Только owner или основной РП зонтика.

        РП самого подпроекта отвязаться не может намеренно: иначе он выходил бы из-под надзора
        зонтика по своему усмотрению — ровно то, ради чего связь и заводят.
        """
        _, um = await api.load_meta(pid)
        if not api._is_primary_pm_or_owner(user, um):
            raise HTTPException(status_code=403,
                                detail="Отвязать подпроект может только основной РП зонтика или owner")
        child_el = await api.db.get_project_row(child_id)
        if not child_el or str((api._meta(child_el).get("_tree") or {}).get("parent_id") or "") != str(pid):
            raise HTTPException(status_code=404, detail="Это не подпроект данного проекта")
        code = await api.db.set_project_parent(child_id, None)
        if code != "ok":
            raise HTTPException(**_SUBPROJECT_ERRORS[code])
        api._invalidate_tree_access()
        cm = api._meta(child_el)
        await api._append_action_log(pid, user, "project.subproject_remove", cm.get("code") or child_id)
        await api._append_action_log(child_id, user, "project.parent_unset", um.get("code") or pid)
        return {"data": {"project_id": str(child_id), "parent_id": None}}

    @router.post("/projects/{pid}/clone")
    async def project_clone(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Клон проекта как шаблон: копирует паспорт + структурные коллекции (команда/стейкхолдеры/
        допущения/коммуникации/KPI/решения/встречи/бюджет/бэклог/baseline/отчёты) + WBS (work packages
        с иерархией и зависимостями) + риски (WP типа Risk). Новый проект — у клонирующего PM."""
        _, src = await api.load_meta(pid)
        # Код клона делаем уникальным: PRJ-COPY, затем PRJ-COPY-2, PRJ-COPY-3 … —
        # иначе два клона одного проекта получают одинаковый код (путаница в списке/хлебных крошках).
        if payload.get("code"):
            code = str(payload.get("code"))[:60]
        else:
            existing = [api._meta(el).get("code") for el in await api.fetch_projects(with_docs=False)]  # нужны только коды из блоба
            code = api._unique_code(f"{src.get('code', 'PRJ')}-COPY", existing)
        name = payload.get("name") or f"{src.get('name') or 'Project'} (копия)"
        ident = "".join(ch if ch.isalnum() else "-" for ch in code.lower())[:90] + "-" + str(int(time.time()))[-5:]
        # Источник читаем ДО транзакции; WBS/зависимости/риски создаём атомарно внутри неё —
        # частичный клон (сбой на середине) не оставляет осиротевший проект.
        src_tasks = sorted(await api._wp_tasks(pid, src), key=lambda x: x.get("level", 0))
        src_deps = await api.db.fetch_deps(pid)
        src_risks = await api._wp_risks(pid, src)
        src_baselines = await api.db.load_baselines_for(pid)  # базовые планы — в своей таблице, не в мете
        newpid = None
        try:
            async with api.db.transaction() as con:
                d = await api.db.insert_project(name, ident, "{}", con=con)
                newpid = str(d["id"])
                idmap: dict = {}
                for tk in src_tasks:                    # родители раньше детей (отсортировано по level)
                    fields = api._task_fields({"title": tk.get("title"), "task_type": tk.get("task_type"),
                                           "status": tk.get("status"), "description": tk.get("description"),
                                           "planned_start": tk.get("planned_start"), "planned_end": tk.get("planned_end"),
                                           "progress": tk.get("progress")}, for_create=True)
                    for k in api._EXTRA_KEYS:            # extra-колонки исходной задачи (кроме bitrix24_task_id)
                        if k != "bitrix24_task_id" and tk.get(k) is not None:
                            fields[k] = tk.get(k)
                    op_id = str(tk.get("parent_id")) if tk.get("parent_id") else None
                    if op_id and idmap.get(op_id):
                        fields["parent_id"] = int(idmap[op_id])
                    row = await api.db.insert_task(newpid, fields, con=con)
                    idmap[str(tk["id"])] = str(row["id"])
                for dp in src_deps:                     # зависимости с ремапом id
                    nt, nd = idmap.get(str(dp.get("task_id"))), idmap.get(str(dp.get("depends_on_id")))
                    if nt and nd:
                        await api.db.insert_dep(newpid, str(uuid.uuid4()), nt, nd,
                                            dp.get("dependency_type") or "finish_to_start",
                                            dp.get("lag_days") or 0, con=con)
                for rk in src_risks:                    # риски (строки risks) с ремапом related_task_id
                    rfields = {"title": (rk.get("title") or "Риск")[:255]}
                    if rk.get("description"):
                        rfields["description"] = rk["description"]
                    for k in api._RISK_EXTRA_KEYS:
                        if rk.get(k) is not None:
                            rfields[k] = rk.get(k)
                    if rfields.get("related_task_id"):
                        rfields["related_task_id"] = idmap.get(str(rfields["related_task_id"]), rfields["related_task_id"])
                    await api.db.insert_risk(newpid, rfields, con=con)
            # транзакция зафиксирована — теперь паспорт + структурные коллекции (свой version-checked commit)
            new_meta: dict = {}
            for k, v in src.items():                    # паспорт-скаляры (не коллекции, не системные)
                if k.startswith("_") or k in ("code", "name", "id"):
                    continue
                new_meta[k] = v
            new_meta["code"] = code
            new_meta["name"] = name
            if user.get("role") == "pm":                # клон — у клонирующего PM (редактируем)
                new_meta["pm_id"] = user.get("id")
                new_meta["pm_name"] = user.get("full_name")
            for key in api._CLONE_COLLECTIONS:              # структурные коллекции с новыми id
                items = src.get(key)
                if isinstance(items, list):
                    cloned = []
                    for it in items:
                        ni = dict(it)
                        ni["id"] = str(uuid.uuid4())
                        ni["project_id"] = newpid
                        ni.pop("bitrix24_task_id", None)
                        # Серверные поля коллекции (событие Битрикса, связка Fireflies) — про
                        # оригинал: в клоне они указывали бы на чужое событие и чужой протокол.
                        for k in api._protected_fields(key):
                            ni.pop(k, None)
                        # parent_item_id — ссылка на блок бюджета ЧУЖОГО зонтика. У клона
                        # этого зонтика нет, и связь указывала бы в пустоту (клон не копирует
                        # parent_id — он самостоятельный проект).
                        ni.pop("parent_item_id", None)
                        cloned.append(ni)
                    new_meta[key] = cloned
            el, _ = await api.load_meta(newpid)
            await api.save_meta_full(newpid, el, new_meta)
            # Базовые планы живут в таблице baselines (не в мете) → копируем явно, ремапя task_id
            # на новые id задач; иначе клон терял историю baseline и не совпадал с новой WBS.
            for bl in src_baselines:
                nb = dict(bl)
                nb["id"] = str(uuid.uuid4())
                nb["tasks"] = [{**t, "id": idmap.get(str(t.get("id")), t.get("id")),
                                "task_id": idmap.get(str(t.get("task_id")), t.get("task_id"))}
                               for t in (bl.get("tasks") or [])]
                await api.db.append_baseline(newpid, nb)
            el2, _ = await api.load_meta(newpid)
            return {"data": api.to_project(el2)}
        except Exception:
            if newpid:  # компенсация: снести проект (каскад чистит WBS/deps/risks/docs)
                try:
                    await api.db.delete_project(newpid)
                except Exception:  # noqa: BLE001 - best-effort cleanup
                    pass
            raise

    return (router, projects, project_get, project_put, project_create, project_delete,
            project_summary, version_log, close_version, project_action_log, project_archive,
            project_unarchive, project_set_template, list_templates, project_transfer,
            transfer_candidates,
            project_editors_list, project_editor_add, project_editor_remove,
            project_observers_list, project_observer_add, project_observer_remove,
            subprojects_list, subproject_add, subproject_remove, project_clone)
