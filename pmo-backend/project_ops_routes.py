"""Project-scoped operations: budget, baselines, meeting lifecycle, backlog-promote, status-report/risks-summary, bulk tasks."""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Body, Depends, HTTPException


def _person_key(item: dict) -> tuple:
    """Ключ человека в поручении: id → email → свёрнутое имя. По нему кэшируем резолв, чтобы
    повторный прогон _mut (конфликт версии) не ходил в реестр людей заново."""
    return (str(item.get("assignee_person_id") or ""),
            str(item.get("assignee_email") or "").strip().casefold(),
            " ".join(str(item.get("assignee_name") or "").split()).casefold())


def _from_meeting_keys(mid: str, item: dict, text: str, prefix: str = "") -> tuple:
    """Ключ переноса пункта совещания в бэклог/журнал — и его ЛЕГАСИ-вариант.

    Пункт опознаём по собственному id: он переживает правку текста и не склеивает два поручения
    с одинаковым началом. Но у пунктов, созданных ДО появления стабильных id, в проекте лежит
    ключ по тексту — его обязаны узнавать, иначе первое же сохранение формы (оно проставит id)
    при повторной финализации сделает вторую копию."""
    base = f"meeting:{mid}:{prefix}"
    legacy = f"{base}{text[:40]}"
    iid = str(item.get("id") or "").strip()
    return (f"{base}{iid}" if iid else legacy), legacy


def _due_date(item: dict):
    """Срок поручения → planned_end пункта бэклога. Только строгая ISO-дата: форма умеет прислать
    пустую строку или сырой текст («к пятнице»), а колонки дат TEXT и сравниваются строками —
    мусор в них хуже пустоты."""
    v = str(item.get("due_date") or "").strip()[:10]
    try:
        return date.fromisoformat(v).isoformat() if v else None
    except ValueError:
        return None


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.post("/projects/{pid}/backlog/{bid}/promote")
    async def backlog_promote(pid: str, bid: str, user: dict = Depends(api.rbac)):
        _, m0 = await api.load_meta(pid)
        item = next((it for it in api._coll(m0, "_backlog") if str(it.get("id")) == bid), None)
        if not item:
            raise HTTPException(status_code=404, detail="Backlog item not found")
        # Создаём НАСТОЯЩУЮ задачу. WBS читает таблицу tasks, а не JSON-коллекцию _tasks,
        # поэтому старый код (append в _tasks) приводил к тому, что задача «пропадала» — её нигде не видно.
        # Переносим в задачу заполненные в бэклоге поля: даты и исполнителя (раньше терялись —
        # приходилось дозаполнять руками после эскалации). Даты кладём как есть (однозначны);
        # исполнителя резолвим из assignee_person_id в name/email через _task_identity_fields.
        src = {"title": item.get("title") or "Из бэклога", "description": item.get("description"),
               "task_type": "task", "priority": item.get("priority") or "medium",
               "planned_start": item.get("planned_start"), "planned_end": item.get("planned_end")}
        # Исполнителя резолвим ТОЛЬКО если он задан (иначе лишний поход в реестр людей).
        identity = {}
        if item.get("assignee_person_id"):
            src["assignee_person_id"] = item["assignee_person_id"]
            identity = await api._task_identity_fields(src)
        # Номер задачи Bitrix24 переезжает ВМЕСТЕ с пунктом: это тот же самый рабочий элемент,
        # а не копия (ср. клон проекта — там номер снимают намеренно). Без переноса портал
        # забывал про уже поставленную задачу: колонка Bitrix у новой задачи снова предлагала
        # «Создать», и исполнитель получал в Bitrix вторую такую же; входящий вебхук со статусом
        # не находил ни задачу, ни удалённый пункт.
        bx = item.get("bitrix24_task_id")
        if bx:
            try:
                bx = int(bx)  # колонка BIGINT: строка из меты уронила бы INSERT
            except (TypeError, ValueError):
                bx = None
            # Один номер — одна задача. Задача создаётся ДО того, как пункт исчезнет из меты
            # (это одна из точек, где перенос может оборваться), поэтому повторное нажатие
            # «Перенести» нашло бы пункт на месте и выдало бы номер ВТОРОЙ задаче. Дальше
            # «Удалить задачу из Bitrix24» на любой из них снесло бы общую задачу в Bitrix.
            if bx and not await api.db.task_by_bitrix(bx):
                src["bitrix24_task_id"] = bx
        fields = {**api._task_fields(src, for_create=True),
                  **api._extra_fields(src, api._EXTRA_KEYS), **identity}
        row = await api.db.insert_task(pid, fields)  # задача создаётся одним INSERT
        wpid = str(row["id"])

        def _mut(m):
            m["_backlog"] = [it for it in api._coll(m, "_backlog") if str(it.get("id")) != bid]
            api._log_action(m, user, "backlog.promote", str(item.get("title") or wpid)[:80])
            return {"task_id": wpid, "backlog_id": bid}
        return {"data": await api.with_meta_retry(pid, _mut)}

    # ---------- meetings: финализация + авто-перенос решений в журнал решений ----------
    @router.post("/projects/{pid}/meetings/{mid}/finalize")
    async def meeting_finalize(pid: str, mid: str, user: dict = Depends(api.rbac)):
        """Финализирует встречу (status=final): решения → Журнал решений, поручения → Бэклог действий.
        Идемпотентно: записи помечаются _from_meeting, повторная финализация не дублирует."""
        # Исполнителей поручений резолвим ДО версионной транзакции: _mut синхронный, а
        # resolve_person — async; вдобавок with_meta_retry вправе прогнать _mut повторно, поэтому
        # карта резолва живёт по ключу человека, а не по объекту поручения.
        _, m0 = await api.load_meta(pid)
        mt0 = next((x for x in api._coll(m0, "_meetings") if str(x.get("id")) == mid), None)
        if not mt0:
            raise HTTPException(status_code=404, detail="Meeting not found")
        people: dict = {}
        for ai0 in (mt0.get("actions") or mt0.get("action_items") or []):
            if not isinstance(ai0, dict):
                continue
            k = _person_key(ai0)
            if k == ("", "", "") or k in people:
                continue
            people[k] = await api.resolve_person(person_id=ai0.get("assignee_person_id"),
                                                 email=ai0.get("assignee_email"),
                                                 name=ai0.get("assignee_name"))

        def _mut(m):
            mt = next((x for x in api._coll(m, "_meetings") if str(x.get("id")) == mid), None)
            if not mt:
                raise HTTPException(status_code=404, detail="Meeting not found")
            mt["status"] = "final"
            # Поручения встречи → записи в Бэклог действий (аналогично решениям).
            backlog = api._coll(m, "_backlog")
            existing_bl = {b.get("_from_meeting") for b in backlog if b.get("_from_meeting")}
            actions_added = 0
            for ai in (mt.get("actions") or mt.get("action_items") or []):
                if not isinstance(ai, dict):
                    continue
                atext = (ai.get("action_text") or ai.get("title") or "").strip()
                if not atext:
                    continue
                asrc, alegacy = _from_meeting_keys(mid, ai, atext, "act:")
                if asrc in existing_bl or alegacy in existing_bl:
                    continue
                p = people.get(_person_key(ai)) or {}
                backlog.append({
                    "id": str(uuid.uuid4()), "project_id": m.get("_src_id") or pid,
                    "code": api._next_code(backlog, "B"), "title": atext,
                    "description": ai.get("notes"), "priority": "medium", "status": "new",
                    # Исполнитель поручения — это «Ответственный» пункта, а не «Запросил»:
                    # иначе поручение не находит хозяина ни в «Моих задачах», ни в календаре.
                    # person_id ставим ТОЛЬКО при уникальном совпадении в реестре (resolve_person),
                    # иначе оставляем свободный текст: лучше пусто, чем не тот человек.
                    "assignee_person_id": p.get("person_id") or None,
                    "assignee_name": p.get("full_name") or (ai.get("assignee_name") or None),
                    "requested_by": mt.get("title"),
                    "estimated_days": None, "planned_start": None, "planned_end": _due_date(ai),
                    "promoted_to_task_id": None, "bitrix24_task_id": None,
                    "_from_meeting": asrc, "created_at": api._now_iso(),
                })
                existing_bl.add(asrc)
                actions_added += 1
            m["_backlog"] = backlog
            decisions = api._coll(m, "_decisions")
            existing_src = {d.get("_from_meeting") for d in decisions if d.get("_from_meeting")}
            added = 0
            for md in (mt.get("decisions") or []):
                if not isinstance(md, dict):
                    continue
                text = (md.get("decision_text") or md.get("title") or "").strip()
                if not text:
                    continue
                src, slegacy = _from_meeting_keys(mid, md, text)
                if src in existing_src or slegacy in existing_src:
                    continue
                decisions.append({
                    "id": str(uuid.uuid4()), "project_id": m.get("_src_id") or pid,
                    "code": api._next_code(decisions, "D"), "date": mt.get("meeting_date"),
                    "title": text, "description": None, "rationale": md.get("rationale"),
                    "alternatives": None, "impact": None,
                    "decided_by": md.get("decided_by") or mt.get("title"),
                    "related_task_id": None, "status": "active",
                    "_from_meeting": src, "created_at": api._now_iso(),
                })
                existing_src.add(src)
                added += 1
            m["_decisions"] = decisions
            api._recount(m)
            extra = []
            if added:
                extra.append(f"+{added} решений в журнал")
            if actions_added:
                extra.append(f"+{actions_added} поручений в бэклог")
            api._log_action(m, user, "meetings.finalize",
                        f"{mt.get('title') or mid}" + (f" ({', '.join(extra)})" if extra else ""))
            return {"id": mid, "status": "final", "decisions_added": added, "actions_added": actions_added}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/meetings/{mid}/distribute")
    async def meeting_distribute(pid: str, mid: str, user: dict = Depends(api.rbac)):
        """Рассылка протокола участникам (email) + событие в календаре Bitrix.
        Если SMTP не настроен — письма идут в OUTBOX (dry-run). Событие создаётся, только когда
        Bitrix настроен и у вебхука есть права на календарь; иначе статус говорит, чего не хватило."""
        _, m0 = await api.load_meta(pid)
        if user.get("role") not in api.WRITE_ALL_ROLES and not api._owns_item(user, m0):
            raise HTTPException(status_code=403, detail="Только РП проекта может рассылать протокол")
        mt = next((x for x in api._coll(m0, "_meetings") if str(x.get("id")) == mid), None)
        if not mt:
            raise HTTPException(status_code=404, detail="Meeting not found")
        subject = f"Протокол встречи: {mt.get('title') or ''} ({mt.get('meeting_date') or ''})"
        body = api._meeting_protocol_body(mt)
        recipients = []
        for a in (mt.get("attendees") or []):
            if not isinstance(a, dict):
                continue
            nm = (a.get("name") or "").strip()
            # Адрес ищем в РЕЕСТРЕ ЛЮДЕЙ (persons), а не среди логинов портала: участник
            # совещания — обычно сотрудник без аккаунта в PMO. Раньше искали по USERS,
            # и рассылка почти всегда давала «отправлено: 0».
            email = a.get("email")
            if not email:
                p = await api.resolve_person(person_id=a.get("person_id"), name=nm)
                email = (p or {}).get("email")
            if email:
                api._email_bg(email, subject, body)
                recipients.append({"name": nm, "email": email, "sent": True})
            else:
                recipients.append({"name": nm, "email": None, "sent": False})
        sent = sum(1 for r in recipients if r["sent"])

        # Календарь Bitrix: раньше здесь стояла заглушка «not_configured». Теперь (при правах
        # вебхука на календарь) создаём настоящее событие и зовём в него тех участников, у кого есть
        # профиль в Bitrix. Провал календаря НЕ роняет рассылку писем: статус честно скажет, что
        # пошло не так, а протокол уже ушёл.
        calendar_status = "not_configured"
        bitrix_event_id = mt.get("bitrix_event_id")
        bitrix_event_owner = None
        bitrix_event_start = ""
        if api._bitrix_url():
            owner_bx = api._coerce_bitrix_id(user.get("bitrix24_user_id"))
            start = api._meeting_start_iso(mt)
            if not owner_bx:
                calendar_status = "no_bitrix_user"      # профиль организатора не связан с Bitrix
            elif not start:
                calendar_status = "no_date"             # без даты и времени событие не создать
            else:
                guests = []
                for a in (mt.get("attendees") or []):
                    if not isinstance(a, dict):
                        continue
                    bx = api._coerce_bitrix_id(a.get("bitrix24_id"))
                    if not bx:
                        p = await api.resolve_person(person_id=a.get("person_id"), email=a.get("email"),
                                                     name=a.get("name"))
                        bx = api._coerce_bitrix_id((p or {}).get("bitrix24_id"))
                    if bx:
                        guests.append(bx)
                end = api._meeting_end_iso(mt)
                eid, err = await api.bx_add_calendar_event(
                    owner_bx, f"{mt.get('title') or 'Совещание'}", start, end,
                    description=body[:1500], attendees=guests,
                    location=str(mt.get("location") or ""))
                if eid:
                    bitrix_event_id = eid
                    bitrix_event_owner = owner_bx
                    bitrix_event_start = start
                    calendar_status = "created"
                else:
                    calendar_status = f"error: {err}"[:120]

        dist = {"at": api._now_iso(), "by": user.get("full_name"), "recipients": recipients,
                "sent": sent, "email_live": api.mailer.is_configured(), "calendar_status": calendar_status}

        def _mut(m):
            target = next((x for x in api._coll(m, "_meetings") if str(x.get("id")) == mid), None)
            if target is not None:
                target["_distribution"] = dist
                # id события кладём в ТУ ЖЕ version-checked запись, что и отметку о рассылке,
                # иначе он потеряется при конкурентной правке совещания.
                if bitrix_event_id:
                    target["bitrix_event_id"] = bitrix_event_id
                # Владелец календаря и дата — рядом с id: по ним потом ищут и удаляют событие.
                if bitrix_event_owner:
                    target["bitrix_event_owner"] = bitrix_event_owner
                    target["bitrix_event_from"] = bitrix_event_start
            api._log_action(m, user, "meetings.distribute",
                        f"{mt.get('title') or mid}: разослано {sent}"
                        + ("" if api.mailer.is_configured() else " (dry-run)"))
            return dist
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/meetings/{mid}/bitrix-event")
    async def meeting_bitrix_create(pid: str, mid: str, payload: dict = Body(default={}), user: dict = Depends(api.rbac)):
        """Создать событие совещания в календаре Bitrix — ОТДЕЛЬНО от рассылки протокола.
        Хранит bitrix_event_id на совещании (по нему видно «создано в Bitrix» и можно удалить).
        description в теле — правка описания на форме создания; иначе берём протокол совещания."""
        _, m0 = await api.load_meta(pid)
        if user.get("role") not in api.WRITE_ALL_ROLES and not api._owns_item(user, m0):
            raise HTTPException(status_code=403, detail="Только РП проекта может создать событие в Bitrix")
        mt = next((x for x in api._coll(m0, "_meetings") if str(x.get("id")) == mid), None)
        if not mt:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")
        owner_bx = api._coerce_bitrix_id(user.get("bitrix24_user_id"))
        if not owner_bx:
            raise HTTPException(status_code=400, detail="Профиль не связан с Bitrix24")
        start = api._meeting_start_iso(mt)
        if not start:
            raise HTTPException(status_code=400, detail="У совещания не указана дата")
        # exclude_bitrix_ids — кого НЕ звать (владелец решил «создать без занятых»). Хоста не касается.
        exclude = {api._coerce_bitrix_id(x) for x in (payload.get("exclude_bitrix_ids") or [])}
        exclude.discard(None)
        guests = []
        for a in (mt.get("attendees") or []):
            if not isinstance(a, dict):
                continue
            bx = api._coerce_bitrix_id(a.get("bitrix24_id"))
            if not bx:
                p = await api.resolve_person(person_id=a.get("person_id"), email=a.get("email"), name=a.get("name"))
                bx = api._coerce_bitrix_id((p or {}).get("bitrix24_id"))
            if bx and bx not in exclude:
                guests.append(bx)
        desc = payload.get("description") if isinstance(payload, dict) else None
        eid, err = await api.bx_add_calendar_event(
            owner_bx, f"{mt.get('title') or 'Совещание'}", start, api._meeting_end_iso(mt),
            description=str(desc if desc is not None else (mt.get("minutes_content") or ""))[:1500],
            attendees=guests, location=str(mt.get("location") or ""))
        if not eid:
            raise HTTPException(status_code=502, detail=f"Bitrix: {err or 'событие не создано'}"[:200])

        def _mut(m):
            target = next((x for x in api._coll(m, "_meetings") if str(x.get("id")) == mid), None)
            if target is not None:
                target["bitrix_event_id"] = eid
                # Владельца календаря и дату СОХРАНЯЕМ: событие живёт в календаре создателя, и
                # удалять/искать его надо там же. Без этого удаление шло от имени нажавшего —
                # со-РП бил в чужой календарь, а сверка не знала, где искать событие.
                target["bitrix_event_owner"] = owner_bx
                target["bitrix_event_from"] = start
            api._log_action(m, user, "meetings.bitrix_create", f"{mt.get('title') or mid}: событие Bitrix {eid}")
            return {"bitrix_event_id": eid, "bitrix_event_owner": owner_bx}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.delete("/projects/{pid}/meetings/{mid}/bitrix-event")
    async def meeting_bitrix_delete(pid: str, mid: str, force: bool = False, user: dict = Depends(api.rbac)):
        """Удалить событие совещания в Bitrix и снять отметку bitrix_event_id.

        Отвязка обязана быть ИДЕМПОТЕНТНОЙ. Пока «события нет» считалось ошибкой, совещание,
        чьё событие удалили в самом Bitrix, застревало навсегда: 502 на каждую попытку, отметка
        «✓ Bitrix» не снимается, кнопка создания под ней спрятана. `force=true` — последний
        выход: снять отметку в портале, честно записав в журнал, что в Bitrix не проверено.
        """
        _, m0 = await api.load_meta(pid)
        if user.get("role") not in api.WRITE_ALL_ROLES and not api._owns_item(user, m0):
            raise HTTPException(status_code=403, detail="Только РП проекта может удалить событие в Bitrix")
        mt = next((x for x in api._coll(m0, "_meetings") if str(x.get("id")) == mid), None)
        if not mt:
            raise HTTPException(status_code=404, detail="Meeting not found")
        eid = api._coerce_bitrix_id(mt.get("bitrix_event_id"))
        owner_bx = api._meeting_event_owner(mt, m0, user)   # календарь СОЗДАТЕЛЯ, не нажавшего
        # Запись в журнал ставит КАЖДАЯ ветка. Раньше здесь стояло «событие Bitrix удалено» по
        # умолчанию, и когда Bitrix не настроен вовсе, журнал бодро сообщал об удалении события,
        # которого никто не трогал.
        note = "отметка снята локально"
        if eid and owner_bx and api._bitrix_url():
            ok, err = await api.bx_delete_calendar_event(owner_bx, eid)
            if ok:
                note = "событие Bitrix удалено"
            else:
                # Второй вопрос Bitrix: может, события и правда уже нет, а текст ошибки другой.
                # Верим этому ответу ТОЛЬКО когда календарь известен (владелец сохранён при
                # создании). У старой записи владелец угадан, и пустой ответ чужого календаря
                # означал бы лишь «не здесь» — рвать по нему связку с живым событием нельзя.
                known = bool(api._coerce_bitrix_id(mt.get("bitrix_event_owner")))
                start = str(mt.get("bitrix_event_from") or api._meeting_start_iso(mt))[:10]
                ids = None
                if known and len(start) == 10:
                    # То же окно, что у сверки: встречу могли перенести в самом Bitrix, и запрос
                    # одним днём не нашёл бы живое событие — портал счёл бы его удалённым.
                    lo, hi = api._bx_event_window(start)
                    if lo and hi:
                        ids, _e = await api.bx_calendar_event_ids(owner_bx, lo, hi)
                if ids is not None and eid not in ids:
                    note = "событие Bitrix уже было удалено"
                elif force:
                    note = f"отметка снята принудительно (Bitrix: {err})"[:120]
                else:
                    raise HTTPException(status_code=502, detail=f"Bitrix: {err or 'не удалено'}"[:200])
        elif eid and not owner_bx:
            note = "отметка снята локально: неизвестен календарь события"
        elif eid:
            note = "отметка снята локально: Bitrix не настроен"

        def _mut(m):
            target = next((x for x in api._coll(m, "_meetings") if str(x.get("id")) == mid), None)
            if target is not None:
                for k in ("bitrix_event_id", "bitrix_event_owner", "bitrix_event_from"):
                    target.pop(k, None)
            api._log_action(m, user, "meetings.bitrix_delete", f"{mt.get('title') or mid}: {note}")
            return {"ok": True}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/meetings/{mid}/unfinalize")
    async def meeting_unfinalize(pid: str, mid: str, user: dict = Depends(api.rbac)):
        """Снять финализацию (status=draft), чтобы дополнить совещание и завершить заново.
        Повторная финализация НЕ плодит дубли: перенос в бэклог/журнал дедуплицируется по
        _from_meeting, а уже перенесённые записи остаются на месте."""
        def _mut(m):
            mt = next((x for x in api._coll(m, "_meetings") if str(x.get("id")) == mid), None)
            if not mt:
                raise HTTPException(status_code=404, detail="Meeting not found")
            mt["status"] = "draft"
            api._log_action(m, user, "meetings.unfinalize", f"{mt.get('title') or mid}")
            return {"id": mid, "status": "draft"}
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.post("/projects/{pid}/meetings/{mid}/recur")
    async def meeting_recur(pid: str, mid: str, count: int = 1, recurrence: str = "weekly", user: dict = Depends(api.rbac)):
        """Создаёт N будущих экземпляров встречи с частотой `recurrence` (weekly/biweekly/monthly).
        Частоту выбирает пользователь в диалоге «Повторить»; если не передана — берётся из встречи.
        Копирует повестку/участников, НЕ копирует протокол/action items."""
        step_by = {"weekly": 7, "biweekly": 14, "monthly": 30}
        n = max(1, min(int(count or 1), 12))
        freq = recurrence if recurrence in step_by else "weekly"

        def mut(m):
            meetings = api._coll(m, "_meetings")
            src = next((x for x in meetings if str(x.get("id")) == mid), None)
            if not src:
                raise HTTPException(status_code=404, detail="Встреча не найдена")
            step = step_by.get(freq or src.get("recurrence") or "weekly", 7)
            base = src.get("meeting_date") or src.get("next_meeting_date")
            try:
                d0 = date.fromisoformat(str(base)) if base else datetime.now(timezone.utc).date()
            except Exception:  # noqa: BLE001
                d0 = datetime.now(timezone.utc).date()
            # bitrix_event_id в копию НЕ едет: событие в календаре одно, а копии — новые встречи.
            # Пока он копировался, все копии показывали «✓ Bitrix», кнопка создания у них была
            # спрятана, а корзина в любой из них удаляла ОДНО И ТО ЖЕ событие оригинала.
            # То же со связкой Fireflies (fireflies_meeting_id/transcript_url/хеш): у копии протокола
            # нет, а чужой id встречи делал бы её «связанной» с прошлым протоколом — следующая
            # встреча попадала бы в conflict, а resend прошлой — в unmatched. Список серверных
            # полей один: _protected_fields('_meetings').
            skip = {"id", "created_at", "action_items", "actions", "minutes", "protocol",
                    "minutes_content", "decisions", "_distribution", "status",
                    *api._protected_fields("_meetings")}
            created = []
            for i in range(1, n + 1):
                copy = {k: v for k, v in src.items() if k not in skip}
                copy["id"] = str(uuid.uuid4())
                copy["project_id"] = m.get("_src_id") or pid
                copy["created_at"] = api._now_iso()
                copy["meeting_date"] = (d0 + timedelta(days=step * i)).isoformat()
                copy["recurrence"] = freq
                copy["status"] = "draft"
                # Новый экземпляр — пустой протокол; массивы ВСЕГДА присутствуют (иначе фронт падал
                # на m.actions.length при рендере списка — «Cannot read properties of undefined»).
                copy["agenda_items"] = src.get("agenda_items") or []
                copy["attendees"] = src.get("attendees") or []
                copy["actions"] = []
                copy["decisions"] = []
                copy["minutes_content"] = None
                meetings.append(copy)
                created.append(copy["id"])
            m["_meetings"] = meetings
            return {"created": created, "count": len(created)}
        return {"data": await api.with_meta_retry(pid, mut)}

    # ---------- status reports: один + risks-summary ----------
    @router.get("/projects/{pid}/status-reports/{rid}")
    async def status_report_get(pid: str, rid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        it = next((r for r in api._coll(m, "_reports") if str(r.get("id")) == rid), None)
        if not it:
            raise HTTPException(status_code=404, detail="Report not found")
        if user.get("role") == "public":  # анонимный share: единый режим редакции публичной выдачи
            it = api._redact_public(it)
        return {"data": it}

    @router.get("/projects/{pid}/risks-summary")
    async def risks_summary(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        risks = await api._wp_risks(pid, m)
        by_status, by_level, by_category = {}, {"high": 0, "medium": 0, "low": 0}, {}
        for r in risks:
            st = r.get("status") or "open"
            by_status[st] = by_status.get(st, 0) + 1
            s = api._risk_score(r.get("probability"), r.get("impact"))
            lvl = "high" if s >= 6 else ("medium" if s >= 3 else "low")
            by_level[lvl] += 1
            cat = r.get("category") or "—"
            by_category[cat] = by_category.get(cat, 0) + 1
        open_r = [r for r in risks if (r.get("status") or "open") not in ("closed", "mitigated")]
        return {"data": {"total": len(risks), "open": len(open_r),
                         "by_status": by_status, "by_level": by_level, "by_category": by_category,
                         "high": by_level["high"], "medium": by_level["medium"], "low": by_level["low"]}}

    # ---------- budget: monthly + summary ----------
    @router.put("/projects/{pid}/budget-items/{bid}/monthly")
    async def budget_monthly(pid: str, bid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Помесячные план/факт статьи. Массив приходит целиком и целиком же заменяет прежний.

        Подрядчик присылает факт ЧАСАМИ по блокам («40 часов по блоку X за месяц»),
        поэтому у записи есть `actual_hours`. Деньги из часов считает сервер ЗДЕСЬ, в момент
        записи, и складывает рядом — а не выводит при каждом чтении. Так смена ставки в июле не
        переписывает январь, и `_budget_actual` (domain.py) остаётся без единой правки: все, кто
        его зовёт, продолжают видеть деньги, а не «деньги, если знать ставку».
        """
        entries = payload.get("entries", [])
        if not isinstance(entries, list):
            raise HTTPException(status_code=422, detail="entries: ожидается список записей")

        def _mut(m):
            it = next((b for b in api._coll(m, "_budget") if str(b.get("id")) == bid), None)
            if not it:
                raise HTTPException(status_code=404, detail="Budget item not found")
            rate = api._effective_rate(m)
            out = []
            for e in entries:
                if not isinstance(e, dict):
                    raise HTTPException(status_code=422, detail="entries: запись должна быть объектом")
                e = dict(e)
                # Те же числа и здесь: помесячная запись приходит от клиента целиком, мимо
                # фабрики коллекций и её хука. Без разбора «12 000» в ячейке месяца молча
                # превратилось бы в 0 у бэкенда и в сумму месяцев у фронта.
                for k in ("planned", "actual", "actual_hours"):
                    if e.get(k) is not None and str(e.get(k)).strip() != "":
                        e[k] = api.parse_money(e[k], k)
                if e.get("actual_hours") not in (None, ""):
                    e["actual_hours"] = api._num(e["actual_hours"])
                    # `e.get("actual") or ""` считало бы пустым и ЧЕСТНЫЙ ноль: «работ по статье
                    # в этом месяце не было» затиралось бы расчётом часы×ставка. Ноль — это
                    # значение, а не отсутствие значения; та же ошибка уже была у ставки.
                    money_empty = e.get("actual") is None or str(e.get("actual")).strip() == ""
                    if money_empty:
                        money = api._money_from_hours(e["actual_hours"], rate)
                        if money is not None:
                            e["actual"] = money
                out.append(e)
            it["monthly"] = out
            return it
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/projects/{pid}/budget-summary")
    async def budget_summary(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        items = api._coll(m, "_budget")
        exp = [i for i in items if api._budget_kind(i) == "expense"]
        inc = [i for i in items if api._budget_kind(i) == "income"]
        ep = sum(api._budget_planned(i) for i in exp); ea = sum(api._budget_actual(i) for i in exp)
        ip = sum(api._budget_planned(i) for i in inc); ia = sum(api._budget_actual(i) for i in inc)
        by_category, monthly = api._budget_aggregates(exp)     # burndown — по расходам
        years = sorted({int(e["year"]) for i in items for e in (i.get("monthly") or [])
                        if str(e.get("year") or "").strip().isdigit()})
        return {"data": {"currency": m.get("budget_currency") or "EUR",
                         "total_planned": ep, "total_actual": ea, "total_variance": ep - ea,   # backward-compat = расходы
                         "expense_planned": ep, "expense_actual": ea,
                         "income_planned": ip, "income_actual": ia,
                         "profit_planned": ip - ep, "profit_actual": ia - ea,
                         "target": api._num(m.get("budget_target")) or None,
                         "income_target": api._num(m.get("income_target")) or None,
                         "years": years,
                         "items_count": len(items), "by_category": by_category, "monthly": monthly,
                         # Хвост — новые поля фазы C, строго после существующих: байты этого
                         # ответа читает и фронт, и эталон, и порядок ключей — часть контракта.
                         # `or None` превратило бы ставку 0 в «не задано»: проект, где часы
                         # намеренно не тарифицируют, показывал бы «—», а экран прятал часы.
                         "rate": _rate_out(m),
                         "rate_inherited": _rate_out(m) is not None and _own_rate(m) is None,
                         "parent_project_id": str((m.get("_tree") or {}).get("parent_id") or "") or None,
                         "subprojects_count": (m.get("_tree") or {}).get("subprojects_count") or 0}}

    # ---------- сводный бюджет по дереву (фаза C) ----------

    def _own_rate(m):
        v = m.get("budget_rate")
        return None if (v is None or str(v).strip() == "") else api._num(v)

    def _rate_out(m):
        """Ставка наружу: своя, иначе унаследованная, иначе None. Ноль — это ставка."""
        own = _own_rate(m)
        if own is not None:
            return own
        inh = (m.get("_tree") or {}).get("parent_budget_rate")
        return None if (inh is None or str(inh).strip() == "") else api._num(inh)


    @router.post("/projects/{pid}/budget-items/{bid}/link")
    async def budget_item_link(pid: str, bid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Отнести статью подпроекта к блоку зонтика.

        ОТДЕЛЬНЫЙ маршрут, а не поле в обычном PUT: `parent_item_id` — ссылка в ЧУЖОЙ проект, и
        проверить её можно только сходив в базу, тогда как mutate синхронный и повторяется до
        четырёх раз. Поэтому поле объявлено `protected` (его ставит только сервер) — тем же
        приёмом, что `bitrix_event_owner` у совещаний, где клиентская запись открывала дыру.
        """
        # load_meta, а не get_project_row: коллекции нормализованы в project_docs, и без них
        # `_coll(m, "_budget")` вернул бы пусто. Тот же путь, что у всех остальных читателей.
        _el, m = await api.load_meta(pid)
        parent_id = (m.get("_tree") or {}).get("parent_id")
        if not parent_id:
            raise HTTPException(status_code=422, detail="Проект не входит в состав другого проекта")
        target = str(payload.get("parent_item_id") or "").strip()
        if not target:
            raise HTTPException(status_code=422, detail="Нужен parent_item_id блока зонтика")
        _pel, pm = await api.load_meta(str(parent_id))
        blk = next((i for i in api._coll(pm, "_budget") if str(i.get("id")) == target), None)
        if blk is None:
            raise HTTPException(status_code=404, detail="Блок бюджета в зонтике не найден")
        # Через _budget_kind, а не по сырому полю: доходом считается и легаси-статья без kind
        # с категорией revenue — наивная проверка пропустила бы её как расходную, и факт
        # подпроекта сложился бы с доходами зонтика.
        if api._budget_kind(blk) != "expense":
            raise HTTPException(status_code=422, detail="Отнести можно только к расходному блоку")
        cur, pcur = m.get("budget_currency") or "EUR", pm.get("budget_currency") or "EUR"
        if cur != pcur:
            # Конвертации в портале нет. Сложить EUR с KZT молча — значит показать
            # сумму, завышенную в сотни раз, без единого признака ошибки.
            raise HTTPException(status_code=422,
                                detail=f"Валюты не совпадают: у проекта {cur}, у зонтика {pcur}")

        def _mut(mm):
            it = next((b for b in api._coll(mm, "_budget") if str(b.get("id")) == bid), None)
            if not it:
                raise HTTPException(status_code=404, detail="Budget item not found")
            it["parent_item_id"] = target
            api._log_action(mm, user, "budget.link",
                            f"{it.get('name') or bid} → {blk.get('name') or target}")
            return it
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.delete("/projects/{pid}/budget-items/{bid}/link")
    async def budget_item_unlink(pid: str, bid: str, user: dict = Depends(api.rbac)):
        def _mut(mm):
            it = next((b for b in api._coll(mm, "_budget") if str(b.get("id")) == bid), None)
            if not it:
                raise HTTPException(status_code=404, detail="Budget item not found")
            it.pop("parent_item_id", None)
            api._log_action(mm, user, "budget.unlink", str(it.get("name") or bid))
            return it
        return {"data": await api.with_meta_retry(pid, _mut)}

    @router.get("/projects/{pid}/budget-consolidated")
    async def budget_consolidated(pid: str, user: dict = Depends(api.rbac)):
        """Одна картина по дереву. `view` говорит фронту, что показывать, — маршрут один.

        umbrella — матрица «блоки × подпроекты» с остатком по каждому блоку: ровно то, ради
        чего затевалась связка (нужен остаток по блоку бюджета, а не сумма цифр, собранная
        по вкладкам всех подпроектов).
        subproject — блоки зонтика с планом, общим потреблением и «моей» долей: это же список,
        из которого выбирают, к чему отнести свою статью.
        none — проект вне дерева; экран сводки прячется.
        """
        _el, m = await api.load_meta(pid)
        tree = m.get("_tree") or {}
        if tree.get("subprojects_count"):
            children = [(p2['id'], p2.get('code'), p2.get('name'), m2)
                        for _el, p2, m2 in await api._readable_children(pid, user)]
            data = api._consolidate_budget(m, children)
            return {"data": {"view": "umbrella", "project_id": str(pid), **data}}
        parent_id = tree.get("parent_id")
        if parent_id:
            # Права на ЗОНТИК проверяем явно. `rbac` проверил только этот проект, а ниже в ответ
            # уходят плановые суммы зонтика — то есть бюджет всей программы. Наследование прав
            # идёт ВНИЗ: чтение зонтика получают РП и со-РП подпроектов, но не их наблюдатели
            # (db._TREE_CTE тянет вверх только pm+editors). Без этой проверки внешний участник,
            # добавленный наблюдателем в один подпроект, читал бы бюджет всей программы.
            if not await api._user_can_read_project(user, str(parent_id)):
                return {"data": {"view": "none"}}
            try:
                _pel, pm = await api.load_meta(str(parent_id))
            except HTTPException:
                return {"data": {"view": "none"}}   # зонтик удалили между чтениями — не 404 на ребёнке
            # По ВСЕМ детям, а не по видимым: остаток по блоку — это план минус то, что откусили
            # ВСЕ подпроекты. Посчитанный по видимым он завышен, и человек планирует по нему
            # следующие расходы. Пускать ли сюда вообще — решено выше, правами на зонтик;
            # наружу уходят только суммы блоков и МОЯ доля, соседи по именам не называются.
            siblings = [(p2['id'], p2.get('code'), p2.get('name'), m2)
                         for _el, p2, m2 in await api._child_rows(str(parent_id))]
            full = api._consolidate_budget(pm, siblings)
            blocks = []
            for b in full["blocks"]:
                mine = sum(c["actual"] for c in b["by_child"] if str(c["project_id"]) == str(pid))
                blocks.append({"item_id": b["item_id"], "name": b["name"], "category": b["category"],
                               "planned": b["planned"], "consumed": b["consumed"],
                               "remaining": b["remaining"], "my_actual": round(mine, 2)})
            return {"data": {"view": "subproject", "project_id": str(pid),
                             "parent_project_id": str(parent_id),
                             "parent_code": tree.get("parent_code"), "parent_name": tree.get("parent_name"),
                             "currency": full["currency"], "rate": full["rate"], "blocks": blocks}}
        return {"data": {"view": "none"}}

    @router.put("/projects/{pid}/budget-settings")
    async def budget_settings(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Плановые ориентиры проекта: общий бюджет (расходы), целевой доход, валюта и ставка часа.

        Ставка — единственное поле здесь, которое проверяется и приводится к числу. Причина в
        последствиях ошибки: сумма с опечаткой врёт про одну статью, а ставка множит собой все
        часовые статьи проекта И всех его подпроектов. Молчаливый ноль обнулил бы программу
        целиком, после чего `_budget_rollup` подставил бы вместо неё утверждённый лимит — в
        портфеле стояла бы цифра, которой нет ни в одной статье.
        """
        rate = api.parse_money(payload.get("budget_rate"), "Ставка часа") if "budget_rate" in payload else None

        def _mut(m):
            for k in ("budget_target", "income_target", "budget_currency"):
                if k in payload:
                    m[k] = payload[k]
            if "budget_rate" in payload:
                # Явный None вместо удаления ключа: «ставка снята» и «ставки не было» ведут
                # себя одинаково (_effective_rate смотрит на пустоту, а не на наличие ключа),
                # но ключ в мете нужен, чтобы правку было видно в журнале версий.
                m["budget_rate"] = rate
                api._log_action(m, user, "budget.rate",
                                "ставка часа: %s" % ("снята" if rate is None else rate))
            return {k: m.get(k) for k in ("budget_target", "income_target", "budget_currency")}
        return {"data": await api.with_meta_retry(pid, _mut)}

    # ---------- baselines (снимки) ----------
    @router.get("/projects/{pid}/baselines")
    async def baselines_list(pid: str, user: dict = Depends(api.rbac)):
        _, m = await api.load_meta(pid)
        return {"data": await api._project_baselines(pid, m)}

    @router.post("/projects/{pid}/baselines")
    async def baseline_create(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        _, m0 = await api.load_meta(pid)
        if user.get("role") not in api.WRITE_ALL_ROLES and not api._owns_item(user, m0):
            raise HTTPException(status_code=403, detail="Только РП проекта может создавать базовый план")
        # task_id — контракт фронта (таблица отклонений матчится по нему); id — легаси-дубль.
        snap = [{"id": str(t.get("id")), "task_id": str(t.get("id")), "task_title": t.get("title"),
                 "planned_start": t.get("planned_start"), "planned_end": t.get("planned_end")}
                for t in await api._wp_tasks(pid, m0)]
        bl = {"id": str(uuid.uuid4()), "project_id": m0.get("_src_id") or pid,
              "name": payload.get("name") or "Базовый план", "description": payload.get("description"),
              "created_at": api._now_iso(), "baseline_date": api._now_iso(), "task_count": len(snap), "tasks": snap}
        # Точечная INSERT только этого проекта; без DELETE/reinsert общего baseline-стора.
        await api.db.append_baseline(pid, bl)
        return {"data": bl}

    @router.delete("/projects/{pid}/baselines/{bid}")
    async def baseline_delete(pid: str, bid: str, user: dict = Depends(api.rbac)):
        _, m0 = await api.load_meta(pid)
        if user.get("role") not in api.WRITE_ALL_ROLES and not api._owns_item(user, m0):
            raise HTTPException(status_code=403, detail="Только РП проекта может удалять базовый план")
        await api.db.delete_baseline(pid, bid)
        return {"data": {"id": bid}}

    @router.post("/projects/{pid}/tasks/bulk")
    async def tasks_bulk(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Массовое создание задач: payload.titles = список строк или объектов {title,...}.
        Создаёт N work packages за один вызов; счётчики читаются живьём из таблицы tasks."""
        raw = payload.get("titles") or payload.get("items") or []
        if len(raw) > 500:  # разумный предел на один вызов (защита от гигантской транзакции)
            raise HTTPException(status_code=422, detail="За один раз можно создать не более 500 задач")
        rows = []
        for t in raw:
            src = {"title": t, "task_type": "task"} if isinstance(t, str) else dict(t)
            title = (src.get("title") or "").strip()
            if not title:
                continue
            # Исполнителя приводит к реестру людей СЕРВЕР — как в tasks_create/update. Без этого
            # bulk-путь оставался единственным, где клиент напрямую диктует assignee_name/email,
            # а assignee_person_id не проставляется (человек не свяжется, письма/Bitrix не сработают).
            # _CLIENT_EXTRA_KEYS, а не _EXTRA_KEYS: здесь `src` — тело запроса, и номер задачи
            # Bitrix24 клиент диктовать не вправе (см. main._CLIENT_EXTRA_KEYS). Этот путь уже был
            # единственным, где клиент диктовал исполнителя, — второй раз наступать не будем.
            rows.append({**api._task_fields(src, for_create=True), **api._extra_fields(src, api._CLIENT_EXTRA_KEYS),
                         **await api._task_identity_fields(src)})
        ids = await api.db.insert_tasks(pid, rows)  # одна транзакция, порядок сохраняется
        created = [str(i) for i in ids]
        return {"data": {"created": created, "count": len(created)}}

    return (router, backlog_promote, meeting_finalize, meeting_distribute, meeting_recur,
            status_report_get, risks_summary, budget_monthly, budget_summary, budget_settings,
            baselines_list, baseline_create, baseline_delete, tasks_bulk)
