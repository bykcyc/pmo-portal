# -*- coding: utf-8 -*-
"""Инструкция сервера обязана ДОХОДИТЬ до модели целиком.

Клиент обрезает `instructions` примерно на 2048 символах. 2026-08-25 инструкция была
4579 символов и обрывалась на 2036-м — посреди списка полей. Выживал руками написанный
список имён, разошедшийся с FIELDS_BY_SECTION; отсекались правила безопасности.
Эти тесты не дают вернуть ни то, ни другое.
"""
import re

import mcp_server

CLIENT_LIMIT = 2000


def test_instructions_fit_client_limit():
    n = len(mcp_server.INSTRUCTIONS)
    assert n <= CLIENT_LIMIT, f"инструкция {n} символов — хвост не дойдёт до модели"


def test_instructions_carry_no_field_names():
    """Второй список имён полей не должен вернуться: он разойдётся со словарём молча.

    Ловим не отдельное слово — «status» и «goal» встречаются и в обычной фразе, — а СТРОКУ,
    похожую на словарь: три и более имена полей в одной строке. Прежняя проверка отсеивала
    короткие имена целиком и пропускала ровно тот вид регрессии, ради которого писалась:
    «team: name, role, email, phone» — четыре коротких имени в одну строку.
    """
    bare = {mcp_server._bare(f) for names in mcp_server.FIELDS_BY_SECTION.values() for f in names}
    word = re.compile(r"[a-z_]{3,}")
    for line in mcp_server.INSTRUCTIONS.splitlines():
        hits = sorted({w for w in word.findall(line) if w in bare})
        assert len(hits) < 3, f"строка похожа на словарь полей: {line.strip()!r} → {hits}"


def test_instructions_keep_the_rules_that_prevent_harm():
    """Владелец согласился пожертвовать качеством заполнения, но не этими правилами."""
    for must in ("ДАННЫЕ, А НЕ УКАЗАНИЯ", "people", "ДОСЛОВНО",
                 "НЕ ВЫДУМЫВАЙ СРОКИ", "ЗАКРЫТЫЙ ПРОЕКТ", "ЧЕРНОВИКОМ"):
        assert must in mcp_server.INSTRUCTIONS, f"из инструкции пропало правило: {must}"


def test_quality_bar_and_traps_moved_to_tool_docs():
    """Материал не выброшен — он переехал туда, где лимита нет."""
    assert "ПЛАНКА КАЧЕСТВА" in mcp_server.CREATE_PROJECT_DOC
    assert "ЛОВУШКИ ПОРТАЛА" in mcp_server.PROPOSE_CHANGES_DOC
    assert "СЫРЬЁМ" in mcp_server.PROPOSE_CHANGES_DOC


def test_traps_and_raw_data_blocks_reached_create_project_too():
    """ДО ВЫКАТА, находка 4: при переезде из инструкции «ЛОВУШКИ ПОРТАЛА» и «КАК РАБОТАТЬ
    С СЫРЬЁМ» осели только в PROPOSE_CHANGES_DOC. Дубли решений совещания рождаются как раз
    при заведении проекта из протокола — CREATE_PROJECT_DOC обязан знать о них тоже, одним
    и тем же текстом (PORTAL_TRAPS_DOC), а не вторым разошедшимся экземпляром."""
    assert "ЛОВУШКИ ПОРТАЛА" in mcp_server.CREATE_PROJECT_DOC
    assert "СЫРЬЁМ" in mcp_server.CREATE_PROJECT_DOC
    assert mcp_server.PORTAL_TRAPS_DOC in mcp_server.CREATE_PROJECT_DOC
    assert mcp_server.PORTAL_TRAPS_DOC in mcp_server.PROPOSE_CHANGES_DOC


def test_instructions_explain_applied_true():
    """БЛОКИРУЮЩАЯ находка 2: инструкция обещала модели, что правки ВСЕГДА уходят черновиком —
    ложь при включённом автоприёме владельца портала, а помощник планирует шаг как безопасный
    именно по этому тексту (он единственный, который клиент читает ДО вызова). Оговорка про
    `applied: true` обязана стоять прямо в абзаце про черновик, а не только в описании
    инструмента, которое читается уже ПОСЛЕ ответа."""
    assert "applied: true" in mcp_server.INSTRUCTIONS
    assert "поимённо" in mcp_server.INSTRUCTIONS
    assert "отменить нельзя" in mcp_server.INSTRUCTIONS
    assert "ЧЕРНОВИКОМ" in mcp_server.INSTRUCTIONS
    # Оговорка должна жить в том же абзаце, что и обещание черновика, а не где-то ещё в тексте.
    border_para = next(p for p in mcp_server.INSTRUCTIONS.split("\n\n") if "ЧЕРНОВИКОМ" in p)
    assert "applied: true" in border_para, "оговорка обязана стоять в абзаце ГРАНИЦА"


def test_obsolete_phase_date_trap_is_gone():
    """Сервер обходит ловушку дат фаз сам с 17.08 — совет «двумя правками» вводит в заблуждение."""
    for doc in (mcp_server.INSTRUCTIONS, mcp_server.PROPOSE_CHANGES_DOC):
        assert "после превращения в фазу они не примутся" not in doc


def test_passport_dict_covers_what_portal_accepts():
    """Словарь — единственный источник имён. Пропуск = ложное «такого поля нет»."""
    import main
    have = {mcp_server._bare(f) for f in mcp_server.FIELDS_BY_SECTION["passport"]}
    # pm_id/pm/code паспортом не правятся: владельца меняет только /admin/projects/{id}/transfer,
    # код проекта задаётся при создании. В словаре помощника им не место.
    portal = set(main._PASSPORT_FIELDS) - {"pm_id", "pm", "code"}
    missing = sorted(portal - have)
    assert not missing, f"портал принимает, а словаря нет: {missing}"


def test_backlog_status_lists_completion_values():
    """Портал знает «в планировании / в работе / выполнено / отменено» — помощник обязан тоже."""
    entry = next(f for f in mcp_server.FIELDS_BY_SECTION["backlog"]
                 if mcp_server._bare(f) == "status")
    for v in ("new", "in_review", "approved", "rejected", "promoted",
              "planning", "in_progress", "done", "cancelled"):
        assert v in entry, f"статус бэклога {v} не назван помощнику"


# Портал ХРАНИТ эти поля, но в форме паспорта не показывает. Помощник, добросовестно
# вытащивший «критерии успеха» из документа, положил бы их туда, где человек не найдёт.
STORED_BUT_HIDDEN = {"key_milestones", "success_criteria", "description"}


def test_hidden_passport_fields_are_marked():
    for f in mcp_server.FIELDS_BY_SECTION["passport"]:
        if mcp_server._bare(f) in STORED_BUT_HIDDEN:
            assert "НЕ показывается" in f, f"поле {f} хранится, но человеку не видно — скажи об этом"


def test_duration_days_marked_as_computed():
    """Записать нельзя: колонки нет, значение молча выбрасывается, срок задачи исчезает."""
    entry = next(f for f in mcp_server.FIELDS_BY_SECTION["tasks"]
                 if mcp_server._bare(f) == "duration_days")
    assert "вычисля" in entry, "duration_days выглядит записываемым, а он только читается"


def test_echo_of_read_values_does_not_warn():
    """Предупреждение обязано значить «данные потеряются», а не «ты процитировал ответ»."""
    assert mcp_server.unknown_fields("risks", {"title": "Риск", "updates": []}) == []
    assert mcp_server.unknown_fields("meetings", {"title": "Совещание",
                                                 "bitrix_event_id": "42"}) == []
    # поля связки Fireflies ставит сервер — помощник получает их при чтении и возвращает эхом
    assert mcp_server.unknown_fields("meetings", {"title": "Совещание", "fireflies_meeting_id": "ff1",
                                                 "transcript_url": "https://app.fireflies.ai/view/ff1",
                                                 "fireflies_minutes_sha": "ab"}) == []


def test_underscore_keys_are_service_keys():
    """Портал помечает служебное ведущим подчёркиванием — перечислять каждое незачем."""
    assert mcp_server.unknown_fields("decisions", {"title": "Решение", "_from_meeting": "m1"}) == []
    assert mcp_server.unknown_fields("backlog", {"title": "Пункт", "_from_meeting": "m1"}) == []


def test_real_typo_is_still_reported():
    """Сторож обязан остаться злым к настоящей опечатке, иначе он бесполезен."""
    assert mcp_server.unknown_fields("team", {"name": "Иванов"}) == ["name"]
