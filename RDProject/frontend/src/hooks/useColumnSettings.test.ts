import { describe, it, expect } from 'vitest'
import { healStoredWidths, type ColDef } from './useColumnSettings'

const COLS: ColDef[] = [
  { key: 'title', label: 'Название', defaultWidth: 300, minWidth: 160 },
  { key: 'status', label: 'Статус', defaultWidth: 120, minWidth: 90 },
  { key: 'noMin', label: 'Без минимума', defaultWidth: 100 },   // minWidth не задан → дефолт 40
]

describe('healStoredWidths — лечение ширин, схлопнутых прежним клампом', () => {
  it('выбрасывает ширину, равную минимуму колонки (подпись бага)', () => {
    const healed = healStoredWidths(COLS, { hidden: [], widths: { title: 160, status: 90 }, sort: null })
    // getW вернётся к defaultWidth, а не к полу
    expect(healed.widths).toEqual({})
  })

  it('сохраняет ширины, выставленные осознанно (больше минимума)', () => {
    const healed = healStoredWidths(COLS, { hidden: [], widths: { title: 420, status: 90 }, sort: null })
    expect(healed.widths).toEqual({ title: 420 })
  })

  it('для колонки без minWidth порогом служат дефолтные 40', () => {
    const healed = healStoredWidths(COLS, { hidden: [], widths: { noMin: 40 }, sort: null })
    expect(healed.widths).toEqual({})
    expect(healStoredWidths(COLS, { hidden: [], widths: { noMin: 41 }, sort: null }).widths)
      .toEqual({ noMin: 41 })
  })

  it('выбрасывает и ширину НИЖЕ минимума — такой её не выставить руками', () => {
    const healed = healStoredWidths(COLS, { hidden: [], widths: { title: 41 }, sort: null })
    expect(healed.widths).toEqual({})
  })

  it('НЕ трогает hidden и sort: свои наборы колонок люди настраивали руками', () => {
    const stored = { hidden: ['status'], widths: { title: 160 }, sort: { field: 'title', dir: 'asc' as const } }
    const healed = healStoredWidths(COLS, stored)
    expect(healed.hidden).toEqual(['status'])
    expect(healed.sort).toEqual({ field: 'title', dir: 'asc' })
  })

  it('переживает отсутствующий widths (старая или битая запись)', () => {
    const healed = healStoredWidths(COLS, { hidden: [], sort: null } as never)
    expect(healed.widths).toEqual({})
  })

  it('идемпотентна: повторный прогон ничего больше не выбрасывает', () => {
    const once = healStoredWidths(COLS, { hidden: [], widths: { title: 420, status: 90 }, sort: null })
    expect(healStoredWidths(COLS, once)).toEqual(once)
  })
})
