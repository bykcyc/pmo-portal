# -*- coding: utf-8 -*-
"""Связи задач: чего портал не должен принимать.

Три типичные ошибки в данных: задача зависит от собственной родительской фазы; пара задач
ссылается друг на друга по кругу; одна и та же связь заведена дважды. Раньше портал принимал
всё это молча.

Опасность не в падении, а в тишине: критический путь строится ТОЛЬКО по листьям, поэтому связь
с фазой он не видит вовсе, а цикл выбрасывает из топологической сортировки. Стрелка при этом
нарисована, и человек считает, что план посчитан.
"""
import domain

# Фаза 2 (20) с двумя задачами внутри; отдельная фаза 1 (10) с задачей.
TASKS = [
    {"id": "10", "title": "Фаза 1. Подготовка", "task_type": "phase", "parent_id": None},
    {"id": "11", "title": "Собрать требования", "task_type": "task", "parent_id": "10"},
    {"id": "20", "title": "Фаза 2. Разработка", "task_type": "phase", "parent_id": None},
    {"id": "21", "title": "Сделать прототип", "task_type": "task", "parent_id": "20"},
    {"id": "22", "title": "Провести испытания", "task_type": "task", "parent_id": "20"},
]


def test_task_cannot_depend_on_its_own_phase():
    why = domain.dep_conflict(TASKS, [], "21", "20")
    assert why and "собственной фазы" in why
    assert "Сделать прототип" in why and "Фаза 2" in why, "человеку нужны названия, а не номера"


def test_phase_cannot_depend_on_its_own_task():
    why = domain.dep_conflict(TASKS, [], "20", "21")
    assert why and "внутри" in why


def test_dependency_on_a_foreign_phase_is_allowed():
    """«Начать после того, как закроется Фаза 1» — осмысленно и должно работать."""
    assert domain.dep_conflict(TASKS, [], "21", "10") is None


def test_neighbours_inside_one_phase_are_allowed():
    assert domain.dep_conflict(TASKS, [], "22", "21") is None


def test_direct_cycle_is_refused():
    deps = [{"task_id": "22", "depends_on_id": "21"}]
    why = domain.dep_conflict(TASKS, deps, "21", "22")
    assert why and "круг" in why


def test_long_cycle_is_refused():
    """A→B→C уже есть; C→A замкнёт кольцо через две связи, а не одну."""
    tasks = TASKS + [{"id": "23", "title": "Обучить", "task_type": "task", "parent_id": "20"}]
    deps = [{"task_id": "22", "depends_on_id": "21"},
            {"task_id": "23", "depends_on_id": "22"}]
    why = domain.dep_conflict(tasks, deps, "21", "23")
    assert why and "круг" in why


def test_duplicate_pair_is_refused():
    deps = [{"task_id": "22", "depends_on_id": "21"}]
    assert domain.dep_conflict(TASKS, deps, "22", "21") == "Такая связь уже есть"


def test_self_dependency_and_empty_ids():
    assert domain.dep_conflict(TASKS, [], "21", "21")
    assert domain.dep_conflict(TASKS, [], "", "20")


def test_broken_parent_chain_does_not_hang():
    """В данных уже может лежать испорченная иерархия — проверка обязана завершиться."""
    loop = [{"id": "a", "title": "A", "parent_id": "b"}, {"id": "b", "title": "B", "parent_id": "a"}]
    assert domain.dep_conflict(loop, [], "a", "b")  # b — «предок» a по такой цепочке
    assert domain.dep_conflict(loop, [], "a", "c") is None
