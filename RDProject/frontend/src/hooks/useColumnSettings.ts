import { useState, useRef } from 'react'

export interface ColDef {
  key: string
  label: string
  defaultWidth: number
  required?: boolean   // cannot be hidden
  minWidth?: number
  hint?: string        // tooltip text for column header
}

export interface SortState { field: string; dir: 'asc' | 'desc' }

interface Stored {
  hidden: string[]
  widths: Record<string, number>
  sort: SortState | null
}

const BLANK: Stored = { hidden: [], widths: {}, sort: null }
const COLUMN_SETTINGS_VERSION = 3

/** Потолок ширины ОДНОЙ колонки. Суммой видимых колонок не ограничиваем: таблица намеренно
 *  шире контейнера и скроллится горизонтально (см. tableStyles.ts). Прежний кламп по ширине
 *  видимой области схлопывал колонку в минимум на любом перетаскивании — 16 колонок WBS дают
 *  ~1590px против ~800-900px видимых, поэтому `maxTotalWidth - usedByOthers` уходил в минус.
 *  И не Infinity: один резкий рывок сохранил бы колонку в 20000px без пути назад. */
const MAX_COL_WIDTH = 900

/** Лечение ширин, испорченных тем самым клампом: ширина, ровно равная минимуму колонки, —
 *  его подпись (любое перетаскивание жало колонку в пол, и mouseup это сохранял). Такие записи
 *  выбрасываем — `getW` вернёт defaultWidth. `hidden` и `sort` переносим дословно: у людей
 *  настроены свои наборы колонок, сбрасывать их заодно — видимая регрессия.
 *  Трейдофф: тот, кто СОЗНАТЕЛЬНО сжал колонку ровно в минимум, потеряет эту одну настройку.
 *  Поэтому лечим ОДИН раз при переезде v2→v3, а не на каждом чтении — иначе намеренный
 *  минимум стал бы недостижим навсегда. */
export function healStoredWidths(cols: ColDef[], stored: Stored): Stored {
  const widths: Record<string, number> = {}
  for (const [k, w] of Object.entries(stored.widths ?? {})) {
    const min = cols.find(c => c.key === k)?.minWidth ?? 40
    if (w > min) widths[k] = w
  }
  return { ...stored, widths }
}

function readStored(tableId: string, cols: ColDef[]): Stored {
  const keyV3 = `pmtool:cols:v${COLUMN_SETTINGS_VERSION}:${tableId}`
  try {
    const raw = localStorage.getItem(keyV3)
    if (raw) return { ...BLANK, ...JSON.parse(raw) }
  } catch { return BLANK }
  try {
    const rawV2 = localStorage.getItem(`pmtool:cols:v2:${tableId}`)
    if (!rawV2) return BLANK
    const healed = healStoredWidths(cols, { ...BLANK, ...JSON.parse(rawV2) })
    localStorage.setItem(keyV3, JSON.stringify(healed))   // v2 не удаляем — след для отката
    return healed
  } catch { return BLANK }
}

interface UseColumnSettingsOptions {
  /** @deprecated Больше не используется: кламп по суммарной ширине и был причиной схлопывания.
   *  Параметр принимается, чтобы вкладки продолжали компилироваться; удаляется следующим коммитом. */
  maxTotalWidth?: number
}

export function useColumnSettings(tableId: string, cols: ColDef[], options?: UseColumnSettingsOptions) {
  const key = `pmtool:cols:v${COLUMN_SETTINGS_VERSION}:${tableId}`

  const [state, setState] = useState<Stored>(() => readStored(tableId, cols))

  // Keep a ref so resize closures always read the latest width without re-creating handlers
  const stateRef = useRef(state)
  stateRef.current = state

  const persist = (next: Stored) => {
    setState(next)
    localStorage.setItem(key, JSON.stringify(next))
  }

  const visibleCols = cols.filter(c => !state.hidden.includes(c.key))
  const isVis = (k: string) => !state.hidden.includes(k)
  const getW = (k: string) => state.widths[k] ?? cols.find(c => c.key === k)?.defaultWidth ?? 100

  const getResizeBounds = (keyName: string) => ({
    min: cols.find(c => c.key === keyName)?.minWidth ?? 40,
    max: MAX_COL_WIDTH,
  })

  const toggleCol = (k: string) => {
    if (cols.find(c => c.key === k)?.required) return
    persist({
      ...state,
      hidden: state.hidden.includes(k)
        ? state.hidden.filter(h => h !== k)
        : [...state.hidden, k],
    })
  }

  const startResize = (k: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = stateRef.current.widths[k] ?? cols.find(c => c.key === k)?.defaultWidth ?? 100
    const { min, max } = getResizeBounds(k)

    const onMove = (ev: MouseEvent) => {
      const w = Math.min(max, Math.max(min, w0 + ev.clientX - x0))
      setState(s => ({ ...s, widths: { ...s.widths, [k]: w } }))
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const w = Math.min(max, Math.max(min, w0 + ev.clientX - x0))
      setState(s => {
        const next = { ...s, widths: { ...s.widths, [k]: w } }
        localStorage.setItem(key, JSON.stringify(next))
        return next
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /**
   * Три такта: по возрастанию → по убыванию → БЕЗ сортировки.
   *
   * Третий такт обязателен. Пока сортировка стоит, ручной порядок строк выключен (таблицы
   * снимают draggable), а состояние живёт в localStorage и переживает перезагрузку — то есть
   * один случайный клик по заголовку навсегда лишал человека возможности двигать строки
   * выше/ниже. Именно на это и пожаловались в Плане коммуникаций.
   */
  const setSort = (field: string) => {
    const cur = state.sort
    if (cur?.field === field) {
      if (cur.dir === 'asc') return persist({ ...state, sort: { field, dir: 'desc' } })
      return persist({ ...state, sort: null })
    }
    persist({ ...state, sort: { field, dir: 'asc' } })
  }

  return {
    visibleCols,
    isVis,
    toggleCol,
    getW,
    startResize,
    sort: state.sort,
    setSort,
    hidden: state.hidden,
    nVisible: visibleCols.length,
  }
}
