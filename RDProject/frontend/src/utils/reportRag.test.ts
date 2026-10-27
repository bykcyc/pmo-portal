import { describe, it, expect } from 'vitest'
import { suggestTimelineRag, suggestBudgetRag, worstRag } from './reportRag'
import type { Task } from '@/types/task'

const task = (p: Partial<Task>): Task => ({
  id: '1', project_id: '5', title: 't', task_type: 'task', status: 'not_started',
  planned_start: null, planned_end: null, progress: 0,
  ...(p as object),
} as Task)

describe('светофор статус-отчёта: сроки', () => {
  it('просроченная незакрытая задача красит в красный', () => {
    const tasks = [task({ status: 'in_progress', planned_end: '2026-08-10' })]
    expect(suggestTimelineRag(tasks, '2026-08-17')).toBe('red')
  })

  it('просроченная, но ЗАВЕРШЁННАЯ задача — не повод для красного', () => {
    const tasks = [task({ status: 'completed', planned_end: '2026-08-10' })]
    expect(suggestTimelineRag(tasks, '2026-08-17')).toBe('green')
  })

  it('отменённая задача тоже не считается просрочкой', () => {
    const tasks = [task({ status: 'cancelled', planned_end: '2026-08-01' })]
    expect(suggestTimelineRag(tasks, '2026-08-17')).toBe('green')
  })

  it('не начатая задача со сроком на этой неделе — жёлтый', () => {
    const tasks = [task({ status: 'not_started', planned_end: '2026-08-20' })]
    expect(suggestTimelineRag(tasks, '2026-08-17')).toBe('amber')
  })

  it('фазы не учитываются: их срок производный от вложенных задач', () => {
    const tasks = [task({ task_type: 'phase', status: 'not_started', planned_end: '2026-08-01' })]
    expect(suggestTimelineRag(tasks, '2026-08-17')).toBe('green')
  })

  it('задача без плановой даты ничего не красит', () => {
    expect(suggestTimelineRag([task({ status: 'in_progress' })], '2026-08-17')).toBe('green')
  })
})

describe('светофор статус-отчёта: бюджет', () => {
  const s = (planned: number, actual: number) => ({ total_planned: planned, total_actual: actual } as never)

  it('перерасход — красный', () => expect(suggestBudgetRag(s(1000, 1200))).toBe('red'))
  it('израсходовано 90% и больше — жёлтый', () => expect(suggestBudgetRag(s(1000, 900))).toBe('amber'))
  it('половина бюджета — зелёный', () => expect(suggestBudgetRag(s(1000, 500))).toBe('green'))

  it('бюджета у проекта нет — зелёный, а не красный', () => {
    // Проект без денег не должен получать тревожный цвет из-за деления на ноль.
    expect(suggestBudgetRag(s(0, 0))).toBe('green')
    expect(suggestBudgetRag(undefined)).toBe('green')
  })
})

describe('общий статус', () => {
  it('не может быть лучше самой больной части', () => {
    expect(worstRag('green', 'red')).toBe('red')
    expect(worstRag('green', 'amber')).toBe('amber')
    expect(worstRag('green', 'green')).toBe('green')
  })
})
