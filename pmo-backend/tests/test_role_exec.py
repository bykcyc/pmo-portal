# -*- coding: utf-8 -*-
"""Роль «Руководство компании» (exec): видит все проекты, правит только свои.

Ради этой роли пришлось развести два понятия, которые раньше были одним множеством: «видит всё»
(READ_ALL_ROLES) и «правит всё» (WRITE_ALL_ROLES). Если их снова слить, руководство получит право
менять чужую работу — молча и без единой ошибки в тестах. Поэтому проверки здесь идут парами:
на каждое «видит» есть «а изменить нельзя».
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402


def test_read_and_write_scopes_are_different_sets():
    """Главный инвариант роли. Слияние множеств — тихая выдача прав на чужие проекты."""
    assert "exec" in main.READ_ALL_ROLES, "руководство обязано видеть все проекты"
    assert "exec" not in main.WRITE_ALL_ROLES, "но не править чужие"
    assert main.WRITE_ALL_ROLES == {"owner"}, "сквозная запись — только у руководителя портфеля"
    assert "exec" in main.WRITE_ROLES, "свои проекты руководство ведёт как обычный РП"
    assert "exec" in main._VALID_ROLES


def test_exec_is_not_a_portfolio_manager():
    """Админка, настройки и реестр остаются у одного человека: require_owner про роль owner."""
    import inspect
    src = inspect.getsource(main.require_owner)
    assert '"owner"' in src or "'owner'" in src
    assert "exec" not in src, "руководство не должно попадать в админский гард"


def test_rbac_picks_the_write_scope_for_mutations():
    """В `rbac` один гейт на чтение и запись — важно, что множество выбирается по методу."""
    import inspect
    src = inspect.getsource(main.rbac)
    assert "WRITE_ALL_ROLES if write else READ_ALL_ROLES" in src


def test_project_ops_guards_use_the_write_scope():
    """Рассылка протокола, событие в Bitrix и базовый план — это записи в чужой проект."""
    import inspect

    import project_ops_routes
    src = inspect.getsource(project_ops_routes)
    assert "api.READ_ALL_ROLES" not in src, "в операциях проекта не должно остаться read-гардов на запись"
    assert src.count("api.WRITE_ALL_ROLES") == 5


def test_someone_elses_calendar_stays_with_the_portfolio_manager():
    """Чужая занятость — персональные данные, а не портфельные: расширять доступ не просили."""
    import inspect

    import bitrix_calendar_routes
    src = inspect.getsource(bitrix_calendar_routes)
    assert "api.READ_ALL_ROLES" not in src
    assert src.count("api.WRITE_ALL_ROLES") == 2
