import { describe, it, expect } from 'vitest'
import { addDaysToIsoDate, formatDate, isWithinDateRange, localIsoDate, parseDate, parseDateStrict } from './date'

describe('date utils', () => {
  it('formatDate ISO -> dd.mm.yyyy', () => {
    expect(formatDate('2026-03-30')).toBe('30.03.2026')
    expect(formatDate('2026-03-30T10:00:00Z')).toBe('30.03.2026')
  })
  it('formatDate empty -> fallback', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('', 'n/a')).toBe('n/a')
  })
  it('parseDate dd.mm.yyyy -> ISO (and passthrough)', () => {
    expect(parseDate('30.03.2026')).toBe('2026-03-30')
    expect(parseDate('bad')).toBe('bad')
  })
  it('parseDateStrict', () => {
    expect(parseDateStrict('01.02.2026')).toBe('2026-02-01')
    expect(parseDateStrict('bad')).toBeNull()
    expect(parseDateStrict(null)).toBeNull()
  })
  it('formats local calendar dates without UTC conversion', () => {
    expect(localIsoDate(new Date(2026, 6, 10, 0, 30))).toBe('2026-07-10')
    expect(localIsoDate(new Date(2026, 11, 31, 23, 30), 1)).toBe('2027-01-01')
  })
  it('adds calendar days to ISO dates', () => {
    expect(addDaysToIsoDate('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToIsoDate('not-a-date', 1)).toBe('not-a-date')
  })
})

describe('isWithinDateRange', () => {
  it('пустые границы пропускают всё, включая элементы без даты', () => {
    expect(isWithinDateRange('2026-03-15', '', '')).toBe(true)
    expect(isWithinDateRange(null, '', '')).toBe(true)
  })
  it('границы включительно — иначе «по 31 марта» теряет 31 марта', () => {
    expect(isWithinDateRange('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true)
    expect(isWithinDateRange('2026-03-31', '2026-03-01', '2026-03-31')).toBe(true)
    expect(isWithinDateRange('2026-02-28', '2026-03-01', '2026-03-31')).toBe(false)
    expect(isWithinDateRange('2026-04-01', '2026-03-01', '2026-03-31')).toBe(false)
  })
  it('одна граница открывает отрезок с другой стороны', () => {
    expect(isWithinDateRange('2026-01-01', '', '2026-03-31')).toBe(true)
    expect(isWithinDateRange('2026-12-31', '2026-03-01', '')).toBe(true)
  })
  it('элемент без даты не попадает в ЗАДАННЫЙ отрезок', () => {
    expect(isWithinDateRange(null, '2026-03-01', '')).toBe(false)
    expect(isWithinDateRange('', '', '2026-03-31')).toBe(false)
  })
  it('дата со временем сравнивается по дню, без сдвига через UTC', () => {
    expect(isWithinDateRange('2026-03-31T23:00:00Z', '2026-03-31', '2026-03-31')).toBe(true)
  })
})
