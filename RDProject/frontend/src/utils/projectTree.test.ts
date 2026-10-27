/**
 * Порядок дерева в списках. Тонкое место здесь одно: ребёнок, чей зонтик в выборку не попал.
 * Спрятать его нельзя — человек искал бы проект, «пропавший» из собственного списка.
 */
import { describe, it, expect } from 'vitest'
import { orderAsTree } from './projectTree'

interface Row { id: string; code: string; parent_id?: string | null }
const byCode = (a: Row, b: Row) => a.code.localeCompare(b.code)
const codes = (rows: { code: string; depth: number }[]) => rows.map(r => `${'  '.repeat(r.depth)}${r.code}`)

describe('orderAsTree', () => {
  it('ставит подпроекты под своим зонтиком, а не по общей сортировке', () => {
    const rows: Row[] = [
      { id: '1', code: 'A-умбрелла' },
      { id: '2', code: 'Z-ребёнок', parent_id: '1' },
      { id: '3', code: 'B-сам-по-себе' },
    ]
    // «Z» по алфавиту последний, но он ребёнок «A» и обязан стоять сразу под ним.
    expect(codes(orderAsTree(rows, byCode))).toEqual(['A-умбрелла', '  Z-ребёнок', 'B-сам-по-себе'])
  })

  it('внутри уровня слушается переданной сортировки', () => {
    const rows: Row[] = [
      { id: '1', code: 'U' },
      { id: '2', code: 'U-2', parent_id: '1' },
      { id: '3', code: 'U-1', parent_id: '1' },
    ]
    expect(codes(orderAsTree(rows, byCode))).toEqual(['U', '  U-1', '  U-2'])
    const desc = (a: Row, b: Row) => -byCode(a, b)
    expect(codes(orderAsTree(rows, desc))).toEqual(['U', '  U-2', '  U-1'])
  })

  it('ребёнок без видимого зонтика остаётся в списке, но помечен', () => {
    // Зонтик отфильтрован (архив, чужой, другой вид) — ребёнок обязан остаться видимым.
    const rows: Row[] = [{ id: '2', code: 'сирота', parent_id: '999' }, { id: '3', code: 'обычный' }]
    const out = orderAsTree(rows, byCode)
    expect(out.map(r => r.code)).toEqual(['обычный', 'сирота'])
    expect(out.find(r => r.code === 'сирота')?.orphan).toBe(true)
    expect(out.find(r => r.code === 'сирота')?.depth).toBe(0)
    expect(out.find(r => r.code === 'обычный')?.orphan).toBe(false)
  })

  it('ничего не теряет и не задваивает', () => {
    const rows: Row[] = [
      { id: '1', code: 'U' }, { id: '2', code: 'C1', parent_id: '1' },
      { id: '3', code: 'C2', parent_id: '1' }, { id: '4', code: 'X' },
      { id: '5', code: 'сирота', parent_id: '404' },
    ]
    const out = orderAsTree(rows, byCode)
    expect(out).toHaveLength(rows.length)
    expect(new Set(out.map(r => r.id)).size).toBe(rows.length)
  })

  it('пустой список — пустой ответ', () => {
    expect(orderAsTree([] as Row[], byCode)).toEqual([])
  })
})
