"""Календарь Bitrix24 (WP6).

Ручки здесь — РОВНО те три, которые фронт (`BitrixCalendar.tsx`) уже вызывал и получал 404:
недельная сетка событий, занятость участников и создание события. Формы ответов подогнаны
под уже написанный UI, а не наоборот.

Две вещи, которые легко сделать неправильно:

1. **Даты.** Bitrix отдаёт «13.07.2026 12:00:00» + отдельным полем TZ_FROM. Браузер такое
   не разбирает (`new Date("13.07.2026 …")` → Invalid Date), поэтому нормализуем в ISO
   со смещением: «2026-07-13T12:00:00+03:00».
2. **Приватность.** `calendar.accessibility.get` возвращает НАЗВАНИЯ чужих встреч
   («Ведение проектов — Имя Фамилия»). РП, подбирающий время, не должен читать, чем занят
   коллега, — наружу уходят только интервалы.
"""
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Optional
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Depends, HTTPException

PORTAL_TZ = "Europe/Riga"           # одна организация — один часовой пояс


def _to_iso(raw, tz_name: Optional[str] = None) -> str:
    """«13.07.2026 12:00:00» → «2026-07-13T12:00:00+03:00». Уже-ISO отдаём как есть."""
    s = str(raw or "").strip()
    if not s:
        return ""
    tz = ZoneInfo(tz_name or PORTAL_TZ)
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=tz).isoformat()
        except ValueError:
            continue
    return s                         # неизвестный формат отдаём как есть — молча не портим


def _parse_slot(raw, tz_name: Optional[str] = None) -> Optional[datetime]:
    iso = _to_iso(raw, tz_name)
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def build_router(api: "PmoApi"):
    router = APIRouter()

    def _need_bitrix() -> None:
        if not api._bitrix_url():
            raise HTTPException(status_code=400, detail="Bitrix24 не настроен")

    @router.get("/admin/bitrix24/calendar/events")
    async def calendar_events(user_id: int, from_date: str, to_date: str,
                              user: dict = Depends(api.rbac)):
        """События недели. Это единственная ручка, которая отдаёт НАЗВАНИЯ встреч, поэтому
        чужой календарь может смотреть только Руководитель портфеля. Свой — кто угодно
        (UI и так просит только свой)."""
        _need_bitrix()
        api._require_write_role(user)
        if int(user_id) != int(user.get("bitrix24_user_id") or 0) and user.get("role") not in api.WRITE_ALL_ROLES:
            raise HTTPException(status_code=403, detail="Чужой календарь доступен только Руководителю портфеля")
        d, err = await api.bx_call("calendar.event.get",
                                   {"type": "user", "ownerId": int(user_id),
                                    "from": from_date, "to": to_date})
        if err:
            await api._bx_log("calendar.events", "error", err)
            raise HTTPException(status_code=502, detail=f"Bitrix24: {err}")
        out = []
        for e in (d or {}).get("result") or []:
            tz = e.get("TZ_FROM") or PORTAL_TZ
            # Фронт ждёт ATTENDEES_LIST, Bitrix отдаёт ATTENDEE_LIST (и null в первом).
            att = e.get("ATTENDEE_LIST") or e.get("ATTENDEES_LIST") or []
            out.append({
                "ID": str(e.get("ID") or ""),
                "NAME": e.get("NAME") or "",
                "DATE_FROM": _to_iso(e.get("DATE_FROM"), tz),
                "DATE_TO": _to_iso(e.get("DATE_TO"), e.get("TZ_TO") or tz),
                "DESCRIPTION": e.get("DESCRIPTION") or "",
                "LOCATION": e.get("LOCATION") or "",
                "ATTENDEES_LIST": [{"id": a.get("id"), "status": a.get("status")} for a in att],
            })
        return {"data": out}

    @router.get("/admin/bitrix24/calendar/accessibility")
    async def calendar_accessibility(user_ids: str, from_date: str, to_date: str,
                                     user: dict = Depends(api.rbac)):
        """Занятость участников: ТОЛЬКО интервалы. Названия встреч Bitrix присылает, но наружу
        они не уходят — иначе любой РП читал бы, чем занят коллега. Ключи from/to в нижнем
        регистре: так их читает уже написанный UI."""
        _need_bitrix()
        api._require_write_role(user)
        ids = [int(x) for x in str(user_ids or "").split(",") if x.strip().isdigit()]
        if not ids:
            return {"data": {}}
        d, err = await api.bx_call("calendar.accessibility.get",
                                   {"users": ids, "from": from_date, "to": to_date})
        if err:
            await api._bx_log("calendar.accessibility", "error", err)
            raise HTTPException(status_code=502, detail=f"Bitrix24: {err}")
        res = (d or {}).get("result") or {}
        out: dict = {}
        for uid in ids:
            items = res.get(str(uid)) or res.get(uid) or []
            out[str(uid)] = [{"from": _to_iso(i.get("DATE_FROM"), i.get("TZ_FROM")),
                              "to": _to_iso(i.get("DATE_TO"), i.get("TZ_TO") or i.get("TZ_FROM"))}
                             for i in items]
        return {"data": out}

    @router.post("/admin/bitrix24/calendar/event")
    async def calendar_event_create(payload: dict, user: dict = Depends(api.rbac)):
        """Создать событие в календаре Bitrix. Пишем только в СВОЙ календарь (owner_id из
        payload обязан совпасть с bitrix24_user_id пользователя), кроме РПП."""
        _need_bitrix()
        api._require_write_role(user)
        owner = int(payload.get("owner_id") or user.get("bitrix24_user_id") or 0)
        if not owner:
            raise HTTPException(status_code=400, detail="Профиль не связан с Bitrix24")
        if owner != int(user.get("bitrix24_user_id") or 0) and user.get("role") not in api.WRITE_ALL_ROLES:
            raise HTTPException(status_code=403, detail="Событие можно создать только в своём календаре")
        name = str(payload.get("name") or "").strip()
        if not name or not payload.get("from") or not payload.get("to"):
            raise HTTPException(status_code=422, detail="Нужны название, начало и конец")
        eid, err = await api.bx_add_calendar_event(
            owner, name, payload.get("from"), payload.get("to"),
            description=str(payload.get("description") or ""),
            attendees=payload.get("attendees") or [],
            location=str(payload.get("location") or ""))
        if err:
            raise HTTPException(status_code=502, detail=f"Bitrix24: {err}")
        return {"data": {"id": eid}}

    @router.post("/projects/{pid}/meetings/suggest-slots")
    async def suggest_slots(pid: str, payload: dict, user: dict = Depends(api.rbac)):
        """Подобрать время, когда участники свободны одновременно.

        Участников берём ИЗ ФОРМЫ (payload.attendees) — подбирать время нужно, пока совещание
        ещё создаётся, а не после сохранения. Если формы нет, можно указать meeting_id и взять
        участников из сохранённого совещания.

        Кто такой участник: человек из справочника с bitrix24_id. У кого его нет — календаря
        в Bitrix не имеет, и молча считать его «свободным» нельзя: он уедет в `unresolved`,
        а UI честно покажет, что за него мы не ручаемся.
        """
        _need_bitrix()
        attendees = payload.get("attendees")
        duration = payload.get("duration_minutes")
        if not isinstance(attendees, list) or not attendees:
            _, m = await api.load_meta(pid)
            mt = next((x for x in (m.get("_meetings") or [])
                       if str(x.get("id")) == str(payload.get("meeting_id") or "")), None)
            if not mt:
                raise HTTPException(status_code=422, detail="Не переданы участники")
            attendees = mt.get("attendees") or []
            duration = duration or mt.get("duration_minutes")

        resolved: dict = {}
        unresolved: list = []
        for a in attendees:
            if not isinstance(a, dict):
                continue
            p = await api.resolve_person(person_id=a.get("person_id"), email=a.get("email"),
                                         name=a.get("name"))
            # bitrix24_id может прийти строкой (из справочника или прямо из тела запроса) —
            # int() на «abc» уронил бы весь подбор 500-й. Нормализуем, нечисловое → unresolved.
            bx = api._coerce_bitrix_id((p or {}).get("bitrix24_id")) or api._coerce_bitrix_id(a.get("bitrix24_id"))
            if bx is not None:
                resolved[bx] = (p or {}).get("full_name") or a.get("name") or ""
            elif (a.get("name") or "").strip():
                unresolved.append(a.get("name"))
        # Организатор (хост) обязан быть свободен в предложенном слоте — его календарь тоже в проверке.
        # setdefault: если он уже среди участников, имя из справочника не перетираем и не считаем дважды
        # (resolved с ключом-int → дедуп сам). bitrix24_user_id=None (логин не связан с Bitrix) — не добавляем.
        host_bx = api._coerce_bitrix_id(user.get("bitrix24_user_id"))
        if host_bx is not None:
            resolved.setdefault(host_bx, user.get("full_name") or "")
        if not resolved:
            return {"data": {"slots": [], "conflict_free": False, "unresolved": unresolved,
                             "resolved": []}}

        days = max(1, min(int(payload.get("days") or 30), 60))   # шире окно: свободные слоты ищем дальше
        tz = ZoneInfo(PORTAL_TZ)
        now = datetime.now(tz)
        start = now                       # по умолчанию «не раньше, чем сейчас» — прошлое не предлагаем
        # Если совещание запланировано на будущую дату — подбираем ОТ неё, а не от сегодня: иначе
        # для встречи на 04.11 показывались бы занятые слоты этой недели. from_date шлёт фронт.
        fd = str(payload.get("from_date") or "").strip()[:10]
        if fd:
            for _f in ("%Y-%m-%d", "%d.%m.%Y"):
                try:
                    parsed = datetime.strptime(fd, _f).replace(tzinfo=tz)
                    if parsed.date() > now.date():
                        start = parsed
                    break
                except ValueError:
                    continue
        end = start + timedelta(days=days)
        d, err = await api.bx_call("calendar.accessibility.get",
                                   {"users": list(resolved), "from": start.strftime("%Y-%m-%d"),
                                    "to": end.strftime("%Y-%m-%d")})
        if err:
            await api._bx_log("calendar.accessibility", "error", err)
            raise HTTPException(status_code=502, detail=f"Bitrix24: {err}")
        res = (d or {}).get("result") or {}

        busy: dict = {}
        for uid in resolved:
            raw = res.get(str(uid))
            if raw is None:
                raw = res.get(uid)
            if raw is None:
                # Bitrix не вернул занятость для этого участника (нет доступа к его календарю).
                # Считать его «свободным» опасно — предложим занятый слот. Честнее увести в
                # unresolved: UI покажет «за него не ручаемся», а не соврёт «все свободны».
                unresolved.append(resolved[uid])
                continue
            spans = []
            for i in raw:
                b0 = _parse_slot(i.get("DATE_FROM"), i.get("TZ_FROM"))
                b1 = _parse_slot(i.get("DATE_TO"), i.get("TZ_TO") or i.get("TZ_FROM"))
                if b0 and b1:
                    spans.append((b0, b1))
            busy[uid] = spans

        out = api.find_free_slots(busy, start, end, duration_min=int(duration or 60))
        out["unresolved"] = unresolved
        out["resolved"] = [{"bitrix24_id": k, "name": v} for k, v in resolved.items() if k in busy]
        return {"data": out}

    return (router, calendar_events, calendar_accessibility, calendar_event_create, suggest_slots)
