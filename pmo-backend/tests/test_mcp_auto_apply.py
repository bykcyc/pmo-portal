# -*- coding: utf-8 -*-
"""Автоприём черновиков для владельца портала и видимость непонятого.

Харнесс тот же, что в test_mcp_draft_append.py: поддельные db и api, монкейпатч токена.
"""
import asyncio
import json
from typing import Any, cast

import mcp_server
import main
import drafts_routes

OWNER = "owner@example.com"
PM = "pm@example.com"


class _Tok:
    def __init__(self, email, role):
        self.claims = {"user": {"email": email, "id": "u1", "role": role}, "token_id": "t1"}
        # Права токена: в бою их кладёт verify_token, и без «draft» инструменты записи
        # отказывают (test_mcp_scopes). Здесь проверяется другое — токен полноправный.
        self.scopes = ["read", "draft"]


class _Db:
    def __init__(self):
        self.drafts: list = []
        self._next = 100

    async def fetch_drafts(self, pid=None, status=None, author=None):
        return [d for d in self.drafts if not status or d.get("status") == status]

    async def insert_draft(self, pid, author, source, title, items, at):
        self._next += 1
        self.drafts.append({"id": str(self._next), "project_id": pid, "author": author,
                            "status": "open", "items": list(items)})
        return str(self._next)

    async def update_draft_items(self, did, items):
        for d in self.drafts:
            if str(d["id"]) == str(did):
                d["items"] = list(items)
        return True

    async def append_mcp_log(self, *a):
        pass


class _Api:
    """Фасад main в объёме, который трогает propose_changes."""

    def __init__(self, db, auto_apply=False):
        self.db = db
        self._auto = auto_apply
        self.accepted: list = []
        self.logged: list = []

    async def _append_action_log(self, pid, user, action, detail=""):
        self.logged.append((pid, user.get("email"), action, detail))

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    async def load_meta(self, pid):
        return {"id": pid}, {}

    def _owns_item(self, user, m):
        return True

    def _agent_access(self, m):
        return {"enabled": True, "sensitive": True}

    def _mcp_auto_apply(self):
        return self._auto

    async def draft_accept(self, did, user):
        self.accepted.append((str(did), user.get("email")))
        for d in self.db.drafts:
            if str(d["id"]) == str(did):
                d["status"] = "accepted"
        return {"data": {"id": str(did), "status": "accepted",
                         "report": {"created": [{"section": "tasks", "id": "1", "title": "Т"}],
                                    "updated": [], "deleted": [], "failed": [], "requested": 1}}}


def propose(api, items, monkeypatch, email=OWNER, role="owner", pid="5"):
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: _Tok(email, role))
    srv = mcp_server.build(cast(Any, api))
    res = asyncio.run(srv.call_tool("propose_changes", {
        "project_id": pid, "source": "проверка", "title": "Пачка", "items": json.dumps(items),
    }))
    return json.loads("".join(getattr(c, "text", "") for c in (res.content or [])))


ROW = {"section": "tasks", "op": "add", "data": {"title": "Разработка ТЗ"}}


def test_unclear_op_is_named_in_the_response(monkeypatch):
    """Помощник обязан узнать о непонятой операции сразу, а не от человека через сутки."""
    bad = {"section": "tasks", "op": "чтототакое", "target_id": "551",
           "data": {"title": "Разработка ТЗ"}}
    out = propose(_Api(_Db()), [ROW, bad], monkeypatch)
    assert len(out["unclear_ops"]) == 1
    assert out["unclear_ops"][0]["section"] == "tasks"
    assert "чтототакое" in out["unclear_ops"][0]["note"]


def test_clean_batch_has_no_unclear_ops(monkeypatch):
    out = propose(_Api(_Db()), [ROW], monkeypatch)
    assert "unclear_ops" not in out
def test_off_by_default_still_makes_a_draft(monkeypatch):
    api = _Api(_Db(), auto_apply=False)
    out = propose(api, [ROW], monkeypatch)
    assert api.accepted == [], "с выключенным тумблером применять нечего"
    assert out["draft_id"] == "101"
    assert "applied" not in out
    # «примите», а не «принять»: у первой пачки подсказка своя, у дописанной — своя
    # (её сторожит test_mcp_draft_append). Проверяем ту, что видит помощник здесь.
    assert "примите" in out["next"].lower()


def test_owner_with_toggle_on_applies_at_once(monkeypatch):
    api = _Api(_Db(), auto_apply=True)
    out = propose(api, [ROW], monkeypatch)
    assert api.accepted == [("101", OWNER)], "черновик обязан пройти через штатный приём"
    assert out["applied"] is True
    assert out["report"]["created"][0]["title"] == "Т"
    assert api.db.drafts[0]["status"] == "accepted"


def test_pm_never_gets_auto_apply(monkeypatch):
    """Тумблер общий, но право — только у владельца портала."""
    api = _Api(_Db(), auto_apply=True)
    out = propose(api, [ROW], monkeypatch, email=PM, role="pm")
    assert api.accepted == []
    assert "applied" not in out


def test_two_batches_apply_without_waiting(monkeypatch):
    """Ради этого всё и делалось: между пачками ожидания нет."""
    api = _Api(_Db(), auto_apply=True)
    propose(api, [ROW], monkeypatch)
    propose(api, [ROW], monkeypatch)
    assert len(api.accepted) == 2
    assert [d["status"] for d in api.db.drafts] == ["accepted", "accepted"]


def test_locked_project_is_still_refused(monkeypatch):
    """Автоприём снимает подтверждение, а не доступ."""
    from mcp.server.mcpserver.exceptions import ToolError
    api = _Api(_Db(), auto_apply=True)
    api._agent_access = lambda m: {"enabled": False, "sensitive": False}
    try:
        propose(api, [ROW], monkeypatch)
    except ToolError as exc:
        assert "закрыт" in str(exc)
    else:
        raise AssertionError("закрытый замок обязан отказывать и при автоприёме")


def test_foreign_open_draft_blocks_auto_apply(monkeypatch):
    """Финальное ревью, блокирующая находка 1: раньше проверка чужого открытого черновика
    стояла НИЖЕ ветки автоприёма и при включённом тумблере не выполнялась вовсе. Сценарий:
    РП разбирает свой черновик по проекту, а владелец портала в это время автоприёмом меняет
    и удаляет те же задачи — «Принять» у РП частично падает, частично ложится поверх уже
    изменённых данных, и ни один экран его об этом не предупреждает. Чужой черновик обязан
    отбивать автоприём ДО применения, тем же текстом отказа, что и в обычном режиме."""
    from mcp.server.mcpserver.exceptions import ToolError
    api = _Api(_Db(), auto_apply=True)
    api.db.drafts.append({"id": "77", "project_id": "5", "author": PM, "status": "open",
                          "items": [dict(ROW, id="x1")]})
    try:
        propose(api, [ROW], monkeypatch, email=OWNER, role="owner", pid="5")
    except ToolError as exc:
        assert "другого автора" in str(exc)
        assert "№77" in str(exc)
    else:
        raise AssertionError("чужой открытый черновик обязан блокировать автоприём")
    assert api.accepted == [], "применения быть не должно — тумблер отбит чужим черновиком"
    assert len(api.db.drafts) == 1, "новый черновик поверх чужого создаваться не должен"
    assert api.db.drafts[0]["status"] == "open", "чужой черновик обязан остаться нетронутым"


def test_unclear_op_is_named_when_auto_applied(monkeypatch):
    """Непонятая операция не применяется — и при автоприёме об этом сказать особенно важно:
    человека, который заметил бы её в черновике, в цепочке больше нет."""
    bad = {"section": "tasks", "op": "чтототакое", "target_id": "551",
           "data": {"title": "Разработка ТЗ"}}
    api = _Api(_Db(), auto_apply=True)
    out = propose(api, [ROW, bad], monkeypatch)
    assert out["applied"] is True
    assert len(out["unclear_ops"]) == 1
    assert "чтототакое" in out["unclear_ops"][0]["note"]


def test_auto_apply_leaves_its_own_trace_in_the_action_log(monkeypatch):
    """Отличить автоприменённое от принятого руками можно только по журналу — но старая
    проверка смотрела лишь на имя действия, выбрасывая проект, автора и текст следа. А вся
    содержательная часть (какой черновик, сколько элементов) лежит именно в тексте: без неё
    владелец портала не найдёт в журнале ни ЧТО применилось само, ни ГДЕ."""
    api = _Api(_Db(), auto_apply=True)
    out = propose(api, [ROW], monkeypatch, pid="5")
    trace = next((row for row in api.logged if row[2] == "draft.auto_accept"), None)
    assert trace is not None, "автоприём обязан оставить отдельную строку в журнале"
    pid, _user, _action, detail = trace
    assert pid == "5", "запись обязана лечь именно в тот проект, где применили черновик"
    assert f"№{out['draft_id']}" in detail, "номер черновика — единственная зацепка найти его в портале"
    assert "элементов 1" in detail, "число элементов — единственный способ увидеть потерю"


# ── Блокирующая находка 1: заглушка _Api.draft_accept выше проверяет только сам факт вызова.
# Ниже — тот же путь, но НАСТОЯЩИЙ: api.draft_accept берётся из drafts_routes.build_router
# (как это делает main.py:2969), и приём идёт настоящим draft_apply.apply_draft. ─────────────

class _RealDb:
    """Одно хранилище черновика на весь сквозной путь: и то, что зовёт propose_changes
    (insert/fetch/update), и то, что зовёт настоящий роут приёма (get/decide). Раздельные
    поддельные db для «создания» и «приёма» и были причиной того, что приём никто не проверял
    по-настоящему — здесь черновик один и тот же объект от начала до конца."""

    def __init__(self):
        self.drafts: dict = {}
        self._next = 100

    async def fetch_drafts(self, pid=None, status=None, author=None):
        return [d for d in self.drafts.values() if not status or d.get("status") == status]

    async def insert_draft(self, pid, author, source, title, items, at):
        self._next += 1
        did = str(self._next)
        self.drafts[did] = {"id": did, "project_id": pid, "author": author, "source": source,
                            "title": title, "status": "open", "items": list(items), "created_at": at}
        return did

    async def update_draft_items(self, did, items):
        d = self.drafts.get(str(did))
        if not d or d["status"] != "open":
            return False
        d["items"] = list(items)
        return True

    async def get_draft(self, did):
        d = self.drafts.get(str(did))
        return dict(d) if d else None

    async def decide_draft(self, did, status, by, at, result=None):
        d = self.drafts.get(str(did))
        if not d or d["status"] != "open":
            return False
        d["status"], d["decided_by"], d["decided_at"], d["result"] = status, by, at, result
        return True

    async def append_mcp_log(self, *a):
        pass


class _RealApi:
    """Фасад в объёме, который трогают И propose_changes (как _Api выше), И настоящий
    draft_apply.apply_draft на пути создания задачи (как _ApiDraft в test_draft_ops.py —
    он взят за основу). draft_accept здесь НЕ переопределён: его подставляет
    _wire_real_accept настоящей функцией роута, это и есть проверяемый путь."""

    logger = type("L", (), {"warning": staticmethod(lambda *a: None)})()

    # Область дат черновика (см. main.draft_date_scope): каскад не двигает то, что черновик
    # задаёт явно. Берём НАСТОЯЩУЮ реализацию — своя разошлась бы с порталом молча.
    draft_date_scope = staticmethod(main.draft_date_scope)
    draft_owns_task = staticmethod(main.draft_owns_task)

    def __init__(self, db, auto_apply=True):
        self.db = db
        self._auto = auto_apply
        self.logged: list = []
        self.tasks_created: list = []

    async def current_user(self, authorization: str = ""):
        """Не вызывается: Depends(api.current_user) в drafts_routes лишь ссылается на этот
        атрибут при сборке роутера, а в тестах user всегда передаётся явным аргументом."""
        return {}

    async def _append_action_log(self, pid, user, action, detail=""):
        self.logged.append((pid, user.get("email"), action, detail))

    def _now_iso(self):
        return "2026-08-25T00:00:00"

    async def load_meta(self, pid):
        return {"id": pid}, {}

    def _owns_item(self, user, m):
        return True

    def _agent_access(self, m):
        return {"enabled": True, "sensitive": True}

    def _mcp_auto_apply(self):
        return self._auto

    async def _wp_tasks(self, pid, m):
        return []

    async def _wp_risks(self, pid, m):
        return []

    async def tasks_create(self, pid, payload, user):
        self.tasks_created.append((str(pid), dict(payload)))
        return {"data": {"id": "501"}}

    async def with_meta_retry(self, pid, mut):
        return mut({})


def _wire_real_accept(api):
    """Подставить в api.draft_accept НАСТОЯЩУЮ функцию роута приёма — то же самое, что делает
    main.py:2969, распаковывая шестёрку из drafts_routes.build_router(api) (draft_accept —
    пятый элемент, draft_reject — шестой)."""
    (_router, _list, _get, _patch, accept, _reject) = drafts_routes.build_router(cast(Any, api))
    api.draft_accept = accept
    return api


def test_owner_auto_apply_really_moves_data_through_the_real_accept_route(monkeypatch):
    """Раньше (_Api.draft_accept выше) весь сквозной путь проверял только то, что у объекта
    позвали атрибут с таким именем: заглушка сама ставила статус и возвращала зашитый отчёт,
    не заглядывая в элементы. Доказано мутацией: замени в mcp_server.py в ветке автоприёма
    `norm` на `[]` в вызове insert_draft (то есть отправь в черновик пустоту вместо собранного
    состава) — все девять прежних тестов оставались зелёными, потому что ни один не смотрел,
    что именно легло в проект. Реальный сценарий: поменяется умолчание `selected` в
    draft_apply.normalize_items или потеряется состав — автоприём ответит applied: true,
    помощник отрапортует «пачка перенесена», а в проекте будет ноль.

    Здесь api.draft_accept — не заглушка, а функция из drafts_routes.build_router, и
    применение идёт настоящим draft_apply.apply_draft: проверяем, что tasks_create реально
    позвался с присланным названием, что черновик закрылся статусом accepted, и что в
    отчёте, вернувшемся помощнику, эта задача есть.
    """
    db = _RealDb()
    api = _wire_real_accept(_RealApi(db, auto_apply=True))
    out = propose(cast(Any, api), [ROW], monkeypatch)

    assert out["applied"] is True
    assert len(api.tasks_created) == 1, "элемент обязан дойти до создающего хендлера задач"
    assert api.tasks_created[0][1]["title"] == "Разработка ТЗ"
    assert db.drafts[out["draft_id"]]["status"] == "accepted", \
        "черновик обязан закрыться настоящим приёмом, а не остаться открытым"
    assert out["report"]["created"], "в отчёте, вернувшемся помощнику, обязана быть эта задача"
    assert out["report"]["created"][0]["title"] == "Разработка ТЗ"


# ── Блокирующая находка 2: связь api.draft_accept с роутом приёма держится на позиции
# в кортеже, а не на имени. ────────────────────────────────────────────────────────────────

def test_api_draft_accept_is_bound_to_the_real_accept_function():
    """main.py:2969 распаковывает `drafts_routes.build_router(_API)` позиционно:
    `(_drafts_router, drafts_list, draft_get, draft_patch, draft_accept, draft_reject)`.
    Переставь возврат в build_router (или добавь новый роут не последним) — и то, что
    попадёт в переменную draft_accept, окажется draft_reject: он вернёт
    `{"data": {"id", "status": "rejected"}}`, автоприём положит report: null, ответит
    applied: true — и не применит ничего, а прогон при этом останется зелёным.

    Здесь — та же распаковка, что в main.py, и проверяется не факт, что переменная
    существует, а ЧТО именно в ней лежит — по __name__ самой функции."""
    (_drafts_router, drafts_list, draft_get, draft_patch, draft_accept, draft_reject) = \
        drafts_routes.build_router(cast(Any, _RealApi(_RealDb())))
    assert draft_accept.__name__ == "draft_accept", \
        "позиция в кортеже сдвинулась — то, что дойдёт до api.draft_accept, больше не приём"
    assert draft_reject.__name__ == "draft_reject"
    assert draft_accept.__name__ != draft_reject.__name__


# ── ДО ВЫКАТА, находка 3: create_project молча глотает неизвестные имена полей ──────────────

class _CreateApi(_RealApi):
    """_RealApi (см. выше) плюс то, чего не хватает create_project: сам заводит проект и
    открывает замок — оба шага идут до разбора плана, apply_draft их не трогает."""

    async def project_create(self, payload, user):
        return {"data": {"id": "900"}}

    def _set_agent_access(self, m, enabled, sensitive=True):
        return m


def create(api, plan, monkeypatch, email=OWNER, role="owner", name="Проект", code="P1"):
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: _Tok(email, role))
    srv = mcp_server.build(cast(Any, api))
    res = asyncio.run(srv.call_tool("create_project", {
        "name": name, "code": code, "plan": json.dumps(plan),
    }))
    return json.loads("".join(getattr(c, "text", "") for c in (res.content or [])))


def test_create_project_reports_warnings_for_unknown_field_names(monkeypatch):
    """propose_changes гоняет состав через warnings_for и предупреждает о полях не из словаря
    раздела; create_project этого не делал — возвращал только project_id/url/report. Тот же
    состав команды с `name`/`role` вместо `full_name`/`project_role` (или, как здесь, задача
    с полем не из словаря) при заведении проекта уходил молча, и человек получал пустые строки.
    """
    api = _CreateApi(_RealDb(), auto_apply=False)
    plan = {"tasks": [{"title": "Задача", "responsible": "Иванов"}]}
    out = create(api, plan, monkeypatch)
    assert out["project_id"] == "900"
    assert len(api.tasks_created) == 1, "задача обязана дойти до приёма несмотря на лишнее поле"
    assert out.get("warnings"), "неизвестное поле обязано попасть в warnings, как у propose_changes"
    assert out["warnings"][0]["unknown_fields"] == ["responsible"]
    assert out["note"] == mcp_server.UNKNOWN_FIELDS_NOTE


def test_create_project_has_no_warnings_for_clean_plan(monkeypatch):
    api = _CreateApi(_RealDb(), auto_apply=False)
    plan = {"tasks": [{"title": "Задача"}]}
    out = create(api, plan, monkeypatch)
    assert "warnings" not in out
    assert "note" not in out
