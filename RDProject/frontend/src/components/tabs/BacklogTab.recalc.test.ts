/** 3-связь бэклога: начало ↔ кол-во дней ↔ окончание (календарные дни, включительно). */
import { describe, it, expect } from 'vitest'
import { recalcDates } from '@/utils/backlog'

describe('recalcDates', () => {
  it('начало + дни → окончание (5-дневная задача: 01→05)', () => {
    const r = recalcDates({ planned_start: '2026-09-01', planned_end: null, estimated_days: 5 }, 'estimated_days')
    expect(r.planned_end).toBe('2026-09-05')
  })

  it('начало + окончание → дни (01..05 = 5)', () => {
    const r = recalcDates({ planned_start: '2026-09-01', planned_end: '2026-09-05', estimated_days: null }, 'planned_end')
    expect(r.estimated_days).toBe(5)
  })

  it('сдвиг начала при заданных днях — сохраняет длительность (10 + 4 = 14)', () => {
    const r = recalcDates({ planned_start: '2026-09-10', planned_end: '2026-09-05', estimated_days: 5 }, 'planned_start')
    expect(r.planned_end).toBe('2026-09-14')
    expect(r.estimated_days).toBe(5)
  })

  it('сдвиг начала при заданном окончании (без дней) — пересчитывает дни', () => {
    const r = recalcDates({ planned_start: '2026-09-03', planned_end: '2026-09-05', estimated_days: null }, 'planned_start')
    expect(r.estimated_days).toBe(3)
  })

  it('без начала ничего не считает', () => {
    const r = recalcDates({ planned_start: null, planned_end: null, estimated_days: 5 }, 'estimated_days')
    expect(r.planned_end).toBeNull()
  })

  it('1 день = начало равно окончанию', () => {
    const r = recalcDates({ planned_start: '2026-09-01', planned_end: null, estimated_days: 1 }, 'estimated_days')
    expect(r.planned_end).toBe('2026-09-01')
  })

  // Границы, на которых таблица и карточка обязаны вести себя ОДИНАКОВО. До сих пор их
  // поведение не было записано нигде, а карточка правит те же три поля в другом порядке.
  it('очистка начала ничего не пересчитывает — пустое поле не повод двигать сроки', () => {
    const r = recalcDates({ planned_start: null, planned_end: '2026-09-05', estimated_days: 5 }, 'planned_start')
    expect(r.planned_end).toBe('2026-09-05')
    expect(r.estimated_days).toBe(5)
  })

  it('ноль дней окончание не двигает', () => {
    const r = recalcDates({ planned_start: '2026-09-01', planned_end: '2026-09-05', estimated_days: 0 }, 'estimated_days')
    expect(r.planned_end).toBe('2026-09-05')
  })

  it('обратный интервал не даёт отрицательных дней — молча один день', () => {
    const r = recalcDates({ planned_start: '2026-09-10', planned_end: '2026-09-05', estimated_days: null }, 'planned_end')
    expect(r.estimated_days).toBe(1)
  })
})
