/**
 * Опорные точки паспорта. Правило одно на все проекты: есть фазы — это фазы, фаз нет — это
 * задачи верхнего уровня. Третьего источника (списка, набранного в паспорте текстом) больше
 * нет: он расходился с планом — у одного проекта та же веха стояла в тексте на 1 июля, а в
 * задаче на 30 сентября.
 */
import { describe, it, expect } from 'vitest'
import { planMilestones } from './milestones'
import type { Task } from '@/types/task'

const task = (p: Partial<Task>): Task => ({
  id: 't1', title: 'Задача', task_type: 'task', status: 'not_started',
  parent_id: null, planned_start: null, planned_end: null, progress: 0,
} as Task)

const mk = (over: Partial<Task>) => ({ ...task({}), ...over } as Task)

describe('выбор источника', () => {
  it('есть фазы — опорные точки это фазы, задачи не показываются', () => {
    const rows = planMilestones([
      mk({ id: 'p1', title: 'Подготовка', task_type: 'phase' }),
      mk({ id: 'p2', title: 'Запуск', task_type: 'phase' }),
      mk({ id: 't1', title: 'Купить лицензии', parent_id: 'p1' }),
      mk({ id: 't2', title: 'Задача вне фаз' }),
    ])
    expect(rows.map(r => r.title)).toEqual(['Подготовка', 'Запуск'])
  })

  it('фаз нет — показываем задачи верхнего уровня', () => {
    const rows = planMilestones([
      mk({ id: 't1', title: 'Футбол' }),
      mk({ id: 't2', title: 'День леса' }),
    ])
    expect(rows.map(r => r.title)).toEqual(['Футбол', 'День леса'])
  })

  it('подзадачи в опорные точки не попадают: это детализация, а не точка отчёта', () => {
    const rows = planMilestones([
      mk({ id: 't1', title: 'Футбол' }),
      mk({ id: 't2', title: 'Заказать поле', parent_id: 't1' }),
    ])
    expect(rows.map(r => r.title)).toEqual(['Футбол'])
  })

  it('плана нет — нет и опорных точек (раздел свернётся в «пока пусто»)', () => {
    expect(planMilestones([])).toEqual([])
  })

  it('дата берётся из планового окончания; её отсутствие — это null, а не пустая строка', () => {
    const rows = planMilestones([mk({ id: 't1', title: 'Футбол', planned_end: '2026-09-13' }),
                                 mk({ id: 't2', title: 'Без даты' })])
    expect(rows[0].date).toBe('2026-09-13')
    expect(rows[1].date).toBeNull()
  })
})

describe('отметка выполнения — по статусу, а не по проценту', () => {
  it('задача со статусом «выполнена» отмечена', () => {
    const rows = planMilestones([mk({ id: 't1', title: 'Летнее мероприятие', status: 'completed' })])
    expect(rows[0].state).toBe('done')
  })

  it('задача «в работе» с прогрессом 99% НЕ отмечена', () => {
    // Наполовину сделанная точка отчёта не наступила. Прогресс проекта в портале тоже
    // считается только по статусу — правило должно быть одно.
    const rows = planMilestones([mk({ id: 't1', title: 'Почти', status: 'in_progress', progress: 99 })])
    expect(rows[0].state).toBe('open')
  })

  it('отменённая — отдельным состоянием, не «выполнена»', () => {
    const rows = planMilestones([mk({ id: 't1', title: 'Отпало', status: 'cancelled' })])
    expect(rows[0].state).toBe('cancelled')
  })
})

describe('фаза', () => {
  it('закрыта сама — отмечена', () => {
    const rows = planMilestones([mk({ id: 'p1', title: 'Этап', task_type: 'phase', status: 'completed' })])
    expect(rows[0].state).toBe('done')
  })

  it('все задачи внутри закрыты — отмечена, даже если саму фазу закрыть забыли', () => {
    const rows = planMilestones([
      mk({ id: 'p1', title: 'Этап', task_type: 'phase', status: 'in_progress' }),
      mk({ id: 't1', title: 'Раз', parent_id: 'p1', status: 'completed' }),
      mk({ id: 't2', title: 'Два', parent_id: 'p1', status: 'completed' }),
    ])
    expect(rows[0].state).toBe('done')
  })

  it('одна задача внутри не закрыта — фаза не отмечена', () => {
    const rows = planMilestones([
      mk({ id: 'p1', title: 'Этап', task_type: 'phase' }),
      mk({ id: 't1', title: 'Раз', parent_id: 'p1', status: 'completed' }),
      mk({ id: 't2', title: 'Два', parent_id: 'p1', status: 'in_progress' }),
    ])
    expect(rows[0].state).toBe('open')
  })

  it('отменённые задачи не мешают закрыть фазу', () => {
    const rows = planMilestones([
      mk({ id: 'p1', title: 'Этап', task_type: 'phase' }),
      mk({ id: 't1', title: 'Раз', parent_id: 'p1', status: 'completed' }),
      mk({ id: 't2', title: 'Отпало', parent_id: 'p1', status: 'cancelled' }),
    ])
    expect(rows[0].state).toBe('done')
  })

  it('пустая фаза выполненной не считается', () => {
    // Иначе «все ноль задач закрыты» читалось бы как достижение — а это пустой заголовок.
    const rows = planMilestones([mk({ id: 'p1', title: 'Пустой этап', task_type: 'phase' })])
    expect(rows[0].state).toBe('open')
  })

  it('все задачи внутри отменены — фаза отменена, а не выполнена', () => {
    const rows = planMilestones([
      mk({ id: 'p1', title: 'Этап', task_type: 'phase' }),
      mk({ id: 't1', title: 'Отпало', parent_id: 'p1', status: 'cancelled' }),
    ])
    expect(rows[0].state).toBe('cancelled')
  })
})
