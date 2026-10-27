/**
 * Порядок строк с учётом дерева: зонтик, под ним его подпроекты.
 *
 * ОДИН хелпер на список проектов и на портфель. Разложить дерево «по месту» в каждом из них
 * было бы на четыре строки короче — и это ровно тот приём, из-за которого на этом проекте уже
 * расходились копии одного правила. Сортировка приходит снаружи: колонки в списке и в портфеле
 * разные, а порядок внутри группы обязан слушаться выбранной колонки.
 */

export interface TreeRow {
  id: string
  parent_id?: string | null
  subprojects_count?: number
}

export interface Placed {
  /** 0 — верхний уровень, 1 — подпроект под своим зонтиком. */
  depth: number
  /** Ребёнок, чей зонтик в текущую выборку не попал (фильтр, архив, нет прав). */
  orphan: boolean
}

/**
 * @param rows   строки как есть
 * @param cmp    сравнение ВНУТРИ уровня (та же функция, что сортирует таблицу)
 * @returns      те же объекты в порядке дерева, каждый с `depth` и `orphan`
 */
export function orderAsTree<T extends TreeRow>(rows: T[], cmp: (a: T, b: T) => number): (T & Placed)[] {
  const present = new Set(rows.map(r => String(r.id)))
  const kids = new Map<string, T[]>()
  const tops: T[] = []
  for (const r of rows) {
    const parent = r.parent_id == null ? '' : String(r.parent_id)
    // Ребёнок без видимого зонтика остаётся на верхнем уровне: спрятать его было бы хуже, чем
    // показать без отступа — человек искал бы проект, который «пропал» из своего же списка.
    if (parent && present.has(parent)) kids.set(parent, [...(kids.get(parent) ?? []), r])
    else tops.push(r)
  }
  const out: (T & Placed)[] = []
  for (const top of [...tops].sort(cmp)) {
    const parent = top.parent_id == null ? '' : String(top.parent_id)
    out.push({ ...top, depth: 0, orphan: Boolean(parent) && !present.has(parent) })
    for (const kid of [...(kids.get(String(top.id)) ?? [])].sort(cmp)) {
      out.push({ ...kid, depth: 1, orphan: false })
    }
  }
  return out
}
