type OrderableRow = {
  id: string
  sort_order?: number | null
}

export function moveManualRows<T extends OrderableRow>(
  rows: T[],
  visibleRows: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const fromId = visibleRows[fromIndex]?.id
  const toId = visibleRows[toIndex]?.id
  if (!fromId || !toId || fromId === toId) return rows

  const nextRows = [...rows]
  const sourceIndex = nextRows.findIndex((item) => item.id === fromId)
  const targetIndex = nextRows.findIndex((item) => item.id === toId)
  if (sourceIndex < 0 || targetIndex < 0) return rows

  const [moved] = nextRows.splice(sourceIndex, 1)
  nextRows.splice(targetIndex, 0, moved)

  return nextRows.map((item, index) => ({
    ...item,
    sort_order: index,
  }))
}

export function toSortOrderPayload<T extends Pick<OrderableRow, 'id'>>(rows: T[]) {
  return rows.map((item, index) => ({
    id: item.id,
    sort_order: index,
  }))
}
