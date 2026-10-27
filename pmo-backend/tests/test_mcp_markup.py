# -*- coding: utf-8 -*-
"""Оформление описаний: что помощнику сказано и о чём его предупреждают.

Портал рисует ЛЁГКУЮ разметку ровно в двух полях — описание задачи и описание пункта бэклога.
Всё остальное, что помощник принесёт по привычке markdown (ссылки, таблицы, «~~зачёркнутое~~»),
останется в тексте буквально, и вычищать это человеку придётся руками по одному полю. Поэтому
правила лежат в описаниях инструментов, а несоответствия называются сразу, при создании
черновика, — пока черновик ещё можно переделать.
"""
import mcp_server


def _notes(section, **data):
    return mcp_server.markup_notes([{"id": "i1", "section": section, "data": data}])


# ── Что сказано помощнику ────────────────────────────────────────────────────────


def test_markup_rules_reach_both_writing_tools():
    """Блок один на оба инструмента: заводит проект и правит его один и тот же помощник.

    Держать текст в двух экземплярах — значит однажды поправить только один. Ровно это уже
    случалось с ловушками портала, ради чего их и вынесли в общий блок.
    """
    for doc in (mcp_server.PROPOSE_CHANGES_DOC, mcp_server.CREATE_PROJECT_DOC):
        assert "ОФОРМЛЕНИЕ ОПИСАНИЙ" in doc


def test_markup_rules_name_the_six_elements_and_their_place():
    doc = mcp_server.MARKUP_DOC
    for must in ("**жирный**", "*курсив*", "`моноширинный`", "## ", "- ", "1. "):
        assert must in doc, f"в правилах нет элемента: {must}"
    # Где разметка рисуется, а где нет — без этой оговорки помощник насыплет звёздочек туда,
    # где человек увидит звёздочки.
    assert "tasks" in doc and "backlog" in doc
    assert "риска" in doc and "паспорте" in doc


def test_markup_rules_name_what_the_portal_will_not_understand():
    doc = mcp_server.MARKUP_DOC
    for must in ("[текст](адрес)", "таблиц", "~~", "__", "```" if "```" in doc else "кода"):
        assert must in doc, f"в правилах не назван чужой markdown: {must}"


def test_description_fields_point_at_the_rules():
    """Словарь полей — единственный источник, и он доезжает до чтения раздела."""
    tasks = " ".join(mcp_server.FIELDS_BY_SECTION["tasks"])
    backlog = " ".join(mcp_server.FIELDS_BY_SECTION["backlog"])
    assert "оформлять" in tasks and "оформлять" in backlog
    # Пояснение живёт в скобках: _bare режет имя по первой скобке, иначе сломается и сравнение
    # имён полей, и проверка черновика.
    assert mcp_server._bare("description (можно оформлять, как у задачи)") == "description"


def test_instructions_stay_within_the_client_limit():
    """Правила разметки НЕ должны были уехать в инструкцию сервера: её режет клиент."""
    assert len(mcp_server.INSTRUCTIONS) <= 2000
    assert "ОФОРМЛЕНИЕ ОПИСАНИЙ" not in mcp_server.INSTRUCTIONS


# ── О чём предупреждаем ──────────────────────────────────────────────────────────


def test_foreign_markdown_is_named_at_draft_time():
    """Каждую конструкцию называем поимённо: «что-то не так» помощнику нечего переделывать."""
    cases = {
        "Смотри [тут](http://x)": "ссылка",
        "| a | b |": "таблиц",
        "> цитата": "цитата",
        "- [ ] сделать": "чекбокс",
        "~~старое~~": "зачёркнут",
        "__жирное__": "подчёркивани",
        "#### Глубже": "решёток",
        "---": "черта",
        "```py": "кода",
        "<b>жирный</b>": "HTML",
    }
    for text, expect in cases.items():
        issues = " ".join(i for n in _notes("tasks", description=text) for i in n["issues"])
        assert expect in issues, f"не назвали {expect!r} в {text!r}: {issues!r}"


def test_clean_description_with_our_markup_is_silent():
    """Ложная тревога дороже молчания: помощник перестанет оформлять вовсе."""
    text = "Первый абзац.\n\n## Что сделать\n- **собрать** требования\n- *согласовать*\n\n1. раз\n2. два"
    assert _notes("tasks", description=text) == []
    assert _notes("backlog", description=text) == []


def test_our_markup_outside_the_two_fields_is_reported():
    """У риска и решения то же имя поля, но текст показывается сырым."""
    for section in ("risks", "decisions", "kpis", "passport"):
        issues = " ".join(i for n in _notes(section, description="**важно**") for i in n["issues"])
        assert "не рисуется" in issues, f"промолчали про оформление в разделе {section}"


def test_plain_dash_list_outside_the_two_fields_is_not_a_complaint():
    """В обычном текстовом поле дефис — это просто дефис, и список из дефисов читается.

    Предупреждать о нём значит приучить помощника не писать списки вовсе.
    """
    assert _notes("meetings", minutes_content="Обсудили:\n- первое\n- второе") == []


def test_notes_name_the_field_not_just_the_item():
    """У совещания текстовых полей несколько — «что-то в элементе i1» искать негде."""
    notes = _notes("risks", mitigation_plan="**эскалация**", title="Срыв поставки")
    assert len(notes) == 1
    assert notes[0]["field"] == "mitigation_plan"


def test_non_string_values_do_not_break_the_check():
    """В данных приезжают числа, списки и None — проверка не имеет права падать."""
    assert mcp_server.markup_notes([
        {"id": "i1", "section": "tasks", "data": {"progress": 40, "tags": ["a"], "description": None}},
        {"id": "i2", "section": "tasks", "data": None},
        {"id": "i3", "section": "tasks"},
    ]) == []
