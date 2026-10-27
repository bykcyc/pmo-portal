# -*- coding: utf-8 -*-
"""Чтение разделов помощником: связи задач.

Связи помощник умел создавать, но не читать: раздела не было в списке, и свою же работу
по Ганту он проверить не мог. Здесь закреплено, что раздел есть, что он называется в подсказке
при опечатке и что названия задач приходят рядом с id — иначе список пар чисел нечитаем.
"""
import asyncio
import json
from typing import Any, cast

import mcp_server
from mcp.server.mcpserver.exceptions import ToolError


class _Tok:
    def __init__(self):
        self.claims = {"user": {"email": "pm@example.com", "id": "u1", "role": "pm"}, "token_id": "t1"}


class _Db:
    def __init__(self, deps):
        self._deps = deps
        self.logged = []

    async def fetch_deps(self, pid):
        return list(self._deps)

    async def fetch_project_attachments(self, pid):
        # Ровно то, что отдаёт настоящий хелпер: без колонки data.
        return [{"id": "1", "task_id": "10", "file_name": "смета.xlsx", "content_type": "application/xlsx",
                 "file_size": 4096, "author": "Иванов", "created_at": "2026-08-17T10:00:00"}]

    async def fetch_project_comments(self, pid, limit=200):
        return [{"id": "5", "task_id": "11", "author": "Петров", "comment": "Подрядчик сдвигает срок",
                 "created_at": "2026-08-17T11:00:00"}]

    async def append_mcp_log(self, *a):
        self.logged.append(a)

    async def load_persons(self):
        return []


class _Api:
    """Двойник фасада main: ровно то, что трогает чтение раздела."""

    # sensitive=True по умолчанию — как на сервере: одна галочка открывает проект целиком.
    def __init__(self, deps=(), tasks=(), enabled=True, sensitive=True):
        self.db = _Db(list(deps))
        self._tasks = list(tasks)
        self._acc = {"enabled": enabled, "sensitive": sensitive}

    def _now_iso(self):
        return "2026-08-17T00:00:00"

    async def load_meta(self, pid):
        return {"id": pid}, {}

    def _owns_item(self, user, m):
        return True

    def _agent_access(self, m):
        return dict(self._acc)

    async def _wp_tasks(self, pid, m):
        return list(self._tasks)

    async def _wp_risks(self, pid, m):
        return []

    def _coll(self, m, key):
        return [{"entity_type": "task", "entity_id": "10", "content": "созвониться с подрядчиком"}] \
            if key == "_notes" else []

    # ── готовые сводки и журналы: те же роуты, что зовёт портал ──────────────────
    async def baselines_list(self, pid, user):
        return {"data": [{"id": "b1", "name": "План 1.0", "created_at": "2026-08-01",
                          "tasks": [{"id": "10"}, {"id": "11"}]}]}

    async def project_action_log(self, pid, user):
        return {"data": [{"at": "2026-08-17T14:47:00", "user_name": "Иванов", "action": "draft.accept",
                          "detail": "принято 15, не удалось 0"}]}

    async def version_log(self, pid, user):
        return {"data": [{"version": "1.1", "created_at": "2026-08-17", "author": "Иванов",
                          "changed_fields": [{"field": "goal", "old": "—", "new": "цель"}]}]}

    async def project_summary(self, pid, user):
        return {"data": {"progress": 42, "rag": "amber", "tasks_total": 13, "overdue_tasks": 2}}

    async def budget_summary(self, pid, user):
        return {"data": {"total_planned": 48000, "total_actual": 1200, "by_category": []}}

    async def risks_summary(self, pid, user):
        return {"data": {"total": 5, "open": 3, "by_level": {"high": 1, "medium": 2, "low": 2}}}

    async def project_workload(self, pid, user):
        return {"data": [{"assignee": "Иванов", "open_tasks": 7, "overdue": 2, "overallocated": True}]}

    async def gantt_data(self, pid, user):
        return {"data": {"tasks": [{"id": "10", "critical": True, "base_start": "2026-09-01"}],
                         "links": [{"source": "10", "target": "11"}]}}


def _call(api, section, monkeypatch, pid="5"):
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: _Tok())
    srv = mcp_server.build(cast(Any, api))
    res = asyncio.run(srv.call_tool("project_section", {"project_id": pid, "section": section}))
    text = "".join(getattr(c, "text", "") for c in (res.content or []))
    return res, text


TASKS = [{"id": "10", "title": "Аналитика"}, {"id": "11", "title": "Разработка"}]
DEPS = [{"id": "d1", "task_id": "11", "depends_on_id": "10",
         "dependency_type": "finish_to_start", "lag_days": 0}]


def test_dependencies_are_readable_with_titles(monkeypatch):
    _res, text = _call(_Api(deps=DEPS, tasks=TASKS), "task-dependencies", monkeypatch)
    out = json.loads(text)
    assert out["section"] == "task-dependencies" and len(out["items"]) == 1
    row = out["items"][0]
    assert row["task_id"] == "11" and row["depends_on_id"] == "10"
    assert row["task_title"] == "Разработка" and row["depends_on_title"] == "Аналитика"
    # Словарь полей раздела приходит вместе с данными: имена нужны ровно перед правкой.
    assert "dependency_type (finish_to_start|…)" in out["fields"]


def test_unknown_task_id_does_not_break_reading(monkeypatch):
    """Связь на задачу, которой уже нет: название пустое, но строка возвращается."""
    broken = [{"id": "d2", "task_id": "99", "depends_on_id": "10",
               "dependency_type": "finish_to_start", "lag_days": 2}]
    _res, text = _call(_Api(deps=broken, tasks=TASKS), "task-dependencies", monkeypatch)
    row = json.loads(text)["items"][0]
    assert row["task_title"] is None and row["depends_on_title"] == "Аналитика"


def test_typo_lists_dependencies_among_known_sections(monkeypatch):
    """Помощник угадывает словарь («deps», «dependencies») — подсказка обязана назвать верное имя."""
    try:
        _call(_Api(), "dependencies", monkeypatch)
        raise AssertionError("неизвестный раздел — это ошибка, а не пустой ответ")
    except ToolError as exc:
        assert "task-dependencies" in str(exc), "в подсказке нет верного имени раздела"


def test_dependencies_are_not_sensitive(monkeypatch):
    """Связи — не деньги и не суждения о людях: второй галочки для них не требуется."""
    import draft_apply
    assert "task-dependencies" not in draft_apply.SENSITIVE_SECTIONS
    _res, text = _call(_Api(deps=DEPS, tasks=TASKS, sensitive=False), "task-dependencies", monkeypatch)
    assert json.loads(text)["items"]


# ── Разделы только для чтения ────────────────────────────────────────────────────
# Помощник не видел ни результата собственной работы (приняли черновик или нет), ни готовых
# сводок портала — и считал итоги сам, ошибаясь там, где портал считает точно.


def test_summaries_arrive_ready_made(monkeypatch):
    """Сводки приходят из ТЕХ ЖЕ роутов, что рисуют экран, — цифры не могут разойтись."""
    for section, key, value in (("summary", "progress", 42),
                                ("budget-summary", "total_planned", 48000),
                                ("risks-summary", "open", 3)):
        _res, text = _call(_Api(), section, monkeypatch)
        out = json.loads(text)
        assert "items" not in out, "сводка — объект, а не список"
        assert out["summary"][key] == value
        assert out["fields"], "к сводке обязан приходить состав полей"


def test_gantt_gives_critical_path_and_baseline_dates(monkeypatch):
    _res, text = _call(_Api(), "gantt", monkeypatch)
    out = json.loads(text)["summary"]
    assert out["tasks"][0]["critical"] is True and out["tasks"][0]["base_start"]
    assert out["links"], "связи — часть картины Ганта"


def test_workload_is_wrapped_but_readable(monkeypatch):
    _res, text = _call(_Api(), "workload", monkeypatch)
    people = json.loads(text)["summary"]["people"]
    assert people[0]["assignee"] == "Иванов" and people[0]["overallocated"] is True


def test_baselines_come_without_snapshot_tasks(monkeypatch):
    """Снимок плана — это сотни строк. Помощнику нужна шапка, а отклонения он берёт из gantt."""
    _res, text = _call(_Api(), "baselines", monkeypatch)
    row = json.loads(text)["items"][0]
    assert row["name"] == "План 1.0" and row["tasks_count"] == 2
    assert "tasks" not in row, "задачи снимка раздувают ответ и не нужны для ответа на вопрос"


def test_attachments_list_never_carries_file_content(monkeypatch):
    """Список файлов — да, сами файлы — нет: содержимое наружу не отдаётся."""
    _res, text = _call(_Api(deps=(), tasks=TASKS), "attachments", monkeypatch)
    row = json.loads(text)["items"][0]
    assert row["file_name"] == "смета.xlsx" and row["task_title"] == "Аналитика"
    assert "data" not in row and "content" not in row


def test_comments_and_logs_are_readable(monkeypatch):
    """По журналу действий помощник видит, приняли ли его черновик и что человек поправил."""
    _res, text = _call(_Api(deps=(), tasks=TASKS), "comments", monkeypatch)
    row = json.loads(text)["items"][0]
    assert row["comment"].startswith("Подрядчик") and row["task_title"] == "Разработка"

    _res, text = _call(_Api(), "action-log", monkeypatch)
    assert "draft.accept" in json.loads(text)["items"][0]["action"]
    _res, text = _call(_Api(), "version-log", monkeypatch)
    assert json.loads(text)["items"][0]["changed_fields"]

    _res, text = _call(_Api(), "notes", monkeypatch)
    assert json.loads(text)["items"][0]["content"]


def test_read_only_sections_stay_out_of_the_writing_vocabulary():
    """Всё, что ТОЛЬКО читается, приёму черновика неизвестно — иначе помощник предложит правку
    журнала действий, а откажет сервер уже после того, как человек нажал кнопку.

    Исключение ровно одно: базовый план и читается, и снимается — он есть в обоих словарях.
    """
    import draft_apply
    writable = set(mcp_server.FIELDS_BY_SECTION)
    read_only = set(mcp_server.READ_ONLY_SECTIONS)
    assert read_only & writable == {"baselines"}
    appliable = {"passport", "tasks", "task-dependencies", "risks", "baselines",
                 *draft_apply._COLL_BY_SECTION}
    assert (read_only - {"baselines"}) & appliable == set()


# ── Словарь полей ───────────────────────────────────────────────────────────────
# Второй заход помощника показал: неполный словарь ХУЖЕ отсутствующего. Он объявлял
# неизвестными протокол совещания, участников, повестку, решения, поручения и вехи отчёта,
# а совет предлагал «исправить имена» — то есть удалить содержимое ради несуществующих имён.


def test_array_fields_are_matched_without_brackets():
    """«attendees[]» в словаре — пометка «массив», а не имя. Клиент шлёт `attendees`."""
    assert mcp_server.unknown_fields("meetings", {
        "agenda_items": [], "attendees": [], "actions": [], "decisions": []}) == []


def test_meeting_dictionary_covers_what_the_portal_stores():
    """Протокол, место, тип и длительность портал хранит и показывает — они обязаны быть в словаре."""
    assert mcp_server.unknown_fields("meetings", {
        "title": "Планёрка", "meeting_type": "Статус", "meeting_date": "2026-09-01",
        "meeting_time": "10:00", "duration_minutes": 45, "location": "Zoom",
        "minutes_content": "Обсудили сроки", "status": "final",
        "next_meeting_date": "2026-09-08", "next_meeting_type": "Статус",
        "next_meeting_participants": "те же", "attendees": [], "actions": []}) == []


def test_report_dictionary_covers_period_conclusions_and_milestones():
    assert mcp_server.unknown_fields("status-reports", {
        "report_date": "2026-08-17", "period": "Август 2026", "summary": "…",
        "next_steps": "…", "conclusions": "…", "milestones": [{"name": "Веха"}],
        "status_overall": "green", "budget_plan": 100}) == []


def test_team_field_names_are_the_portal_ones():
    """Ловушка: у участника команды имя — full_name, роль — project_role. «name»/«role» пропадут."""
    assert mcp_server.unknown_fields("team", {
        "full_name": "Иванов", "project_role": "Аналитик", "position": "Ведущий", "email": "a@b.lv"}) == []
    assert sorted(mcp_server.unknown_fields("team", {"name": "Иванов", "role": "Аналитик"})) == ["name", "role"]


def test_kpi_stored_but_hidden_fields_are_not_unknown():
    """target/current_value/unit портал хранит (и отдаёт), просто не рисует в таблице."""
    assert mcp_server.unknown_fields("kpis", {
        "name": "Доля", "target": "90", "current_value": "40", "unit": "%"}) == []


def test_dictionary_entries_yield_clean_identifiers():
    """Контракт словаря: что бы ни было в скобках, сравнение идёт по чистому имени."""
    for section, names in mcp_server.FIELDS_BY_SECTION.items():
        for raw in names:
            bare = mcp_server._bare(raw)
            assert bare and bare.replace("_", "").replace("-", "").isalnum(), f"{section}: {raw!r} → {bare!r}"


def test_warning_note_never_advises_deleting_data():
    """Совет обязан быть безопасным даже если словарь снова окажется неполным."""
    note = mcp_server.UNKNOWN_FIELDS_NOTE.lower()
    assert "ничего не удаляй" in note
    assert "заново" not in note, "совет «пришли черновик заново» уже приводил к вырезанию содержимого"


def test_echoed_titles_do_not_raise_a_warning():
    """Помощник вернул то, что сам прочитал: предупреждение должно значить «поле потеряется»,
    а не «ты процитировал ответ»."""
    assert mcp_server.unknown_fields("task-dependencies", {
        "task_id": "11", "depends_on_id": "10", "task_title": "Разработка",
        "depends_on_title": "Аналитика"}) == []
    assert mcp_server.unknown_fields("task-dependencies", {"predecessor": "10"}) == ["predecessor"]
