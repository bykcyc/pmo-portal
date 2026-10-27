# -*- coding: utf-8 -*-
"""Смена РП в паспорте = передача проекта: pm_id и pm_name меняются ВМЕСТЕ.

Раньше это были два независимых поля. `pm_name` считалось «косметическим» и правилось любым,
у кого есть запись в проект, а владение (`pm_id`) менял только руководитель портфеля через
отдельную кнопку «Передать РП». Так в паспорте проекта мог значиться один руководитель, а сам
проект лежать в папке другого — и «Мои проекты» у названного РП оставались пусты без всякого
объяснения. Запись в журнале читалась абсурдно:
«project.transfer: PM One → PM One» — отображаемое имя не менялось
НИКОГДА, менялся только невидимый владелец.

Правило после правки: поле «Руководитель проекта» в паспорте — это владелец. Менять его может
только руководитель портфеля (то же право, что у /admin/projects/{pid}/transfer), и человек
обязан иметь учётную запись в портале — иначе у проекта не будет хозяина, который может войти.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
import pytest  # noqa: E402

OWNER = {"id": "own1", "role": "owner", "full_name": "Portfolio Owner"}
CO_PM = {"id": "co", "role": "pm", "full_name": "Co PM"}
NEW_PM = {"id": "newpm", "full_name": "New PM", "role": "pm", "is_active": True}


@pytest.fixture
def project(monkeypatch):
    """Проект с владельцем «old» и отображаемым РП «Old PM»; слой БД замокан."""
    state = {"meta": {"pm_id": "old", "pm_name": "Old PM"}, "saved": None}

    async def fake_row(pid):
        import json
        return {"lockVersion": 1, "name": "P",
                "description": {"raw": json.dumps(state["meta"], ensure_ascii=False)}}

    async def fake_docs(pid):
        return {}

    async def fake_update(pid, meta_raw, expected_version, name=None, colls=None):
        import json
        # слой БД получает мету СТРОКОЙ json — разбираем, чтобы тесты читали поля, а не подстроки
        state["saved"] = json.loads(meta_raw) if isinstance(meta_raw, str) else meta_raw
        return True

    async def fake_append_log(pid, entry, cap):
        # журнал НЕ едет в блоб меты (A2: транзиентный буфер сливается append-only отдельно) —
        # ловим его там же, где его пишет продакшн
        state.setdefault("log", []).append(entry)

    monkeypatch.setattr(main.db, "get_project_row", fake_row)
    monkeypatch.setattr(main.db, "load_project_docs", fake_docs)
    monkeypatch.setattr(main.db, "update_project_meta", fake_update)
    monkeypatch.setattr(main.db, "append_action_log", fake_append_log)
    monkeypatch.setattr(main, "to_project", lambda d: {"ok": True})
    monkeypatch.setitem(main.USERS, "new@company.com", dict(NEW_PM))
    return state


def _put(payload, user, author="Кто-то"):
    return asyncio.run(main._save_meta("5", payload, author=author, user=user))


def test_owner_changing_pm_name_moves_the_project(project):
    """Главное утверждение: назвал нового РП — проект уехал к нему, а не остался у прежнего."""
    _put({"pm_name": "New PM"}, OWNER)
    saved = project["saved"]
    assert saved["pm_name"] == "New PM"
    assert saved["pm_id"] == "newpm", "владение обязано следовать за именем, иначе папка «Мои проекты» пуста"


def test_transfer_from_passport_is_written_to_the_action_log(project):
    """Передача через паспорт должна быть видна в журнале так же, как через кнопку «Передать РП»."""
    _put({"pm_name": "New PM"}, OWNER)
    entries = project.get("log") or []
    transfer = next((e for e in entries if e.get("action") == "project.transfer"), None)
    assert transfer, "смена владельца без следа в журнале — потом не восстановить, кто и когда передал"
    assert "Old PM" in transfer["detail"] and "New PM" in transfer["detail"], \
        "в журнале должно быть видно «от кого → кому», иначе запись бесполезна"


def test_co_pm_cannot_change_the_pm(project):
    """Со-РП имеет полную запись в проект — но не право сделать себя основным РП."""
    with pytest.raises(main.HTTPException) as e:
        _put({"pm_name": "Co PM"}, CO_PM)
    assert e.value.status_code == 403
    assert project["saved"] is None, "отказ обязан быть ДО записи, иначе имя уедет без владения"


def test_person_without_a_portal_account_is_refused(project):
    """Справочник людей шире списка учёток: у проекта не может быть хозяина, который не войдёт."""
    with pytest.raises(main.HTTPException) as e:
        _put({"pm_name": "Человек Без Учётки"}, OWNER)
    assert e.value.status_code == 422
    assert "учётн" in e.value.detail.lower(), "человеку надо объяснить, почему не сохранилось"


def test_inactive_or_read_only_user_cannot_become_the_pm(project, monkeypatch):
    """Та же валидация, что у кнопки «Передать РП»: проект не остаётся без дееспособного хозяина."""
    monkeypatch.setitem(main.USERS, "fired@company.com",
                        {"id": "fired", "full_name": "Fired PM", "role": "pm", "is_active": False})
    monkeypatch.setitem(main.USERS, "watch@company.com",
                        {"id": "watch", "full_name": "Watch Only", "role": "exec_readonly", "is_active": True})
    for name in ("Fired PM", "Watch Only"):
        with pytest.raises(main.HTTPException) as e:
            _put({"pm_name": name}, OWNER)
        assert e.value.status_code == 422


def test_unchanged_pm_name_is_not_a_transfer(project):
    """Паспорт автосохраняется и шлёт ВСЕ поля на каждой правке — то же имя не должно тревожить гейт."""
    _put({"pm_name": "Old PM", "priority": "high"}, CO_PM)
    assert project["saved"]["pm_id"] == "old"
    assert project["saved"]["priority"] == "high"


def test_project_creation_still_sets_the_owner(project):
    """На создании (author=None) владелец выставляется штатно — гейт не должен ломать заведение."""
    assert asyncio.run(main._save_meta("5", {"pm_id": "newpm", "pm_name": "New PM"})) == {"ok": True}
    assert project["saved"]["pm_id"] == "newpm"
