import type { CSSProperties } from 'react'
import type { ColDef } from '@/hooks/useColumnSettings'

export const TABLE_SCROLL_WRAP_CLASS = 'overflow-x-auto'
export const TABLE_BASE_CLASS = 'w-max min-w-full table-fixed border-collapse border-spacing-0'
export const TABLE_CELL_TEXT_CLASS = 'w-full cursor-pointer break-words line-clamp-2 rounded px-1 -mx-1 text-left leading-5 hover:bg-blue-50 dark:hover:bg-slate-800'
export const TABLE_DRAG_COL_WIDTH = 24
export const TABLE_ACTION_COL_WIDTH = 56
export const TABLE_ACTION_WIDE_COL_WIDTH = 84
// Ручка перетаскивания строк — ровно по иконке (14px) с малым отступом (жалоба владельца: колонка широкая).
// Ячейка — align-middle: иконка вертикально по центру строки (была прижата к верху).
export const TABLE_DRAG_HEAD_CLASS = '!w-6 !min-w-6 !max-w-6 w-6 min-w-6 max-w-6 overflow-hidden px-0 py-2 align-top'
export const TABLE_DRAG_CELL_CLASS = '!w-6 !min-w-6 !max-w-6 w-6 min-w-6 max-w-6 overflow-hidden px-0 py-1 align-middle text-center'
// sticky-колонка действий: фон должен совпадать с поверхностью таблицы в обеих темах
// (без dark: — в тёмной теме оставалась белая полоса справа).
export const TABLE_ACTION_HEAD_CLASS = 'sticky right-0 z-10 !w-[56px] !min-w-[56px] !max-w-[56px] w-[56px] min-w-[56px] max-w-[56px] overflow-hidden bg-white dark:bg-slate-900 px-0.5 py-2 align-top'
export const TABLE_ACTION_HEAD_WIDE_CLASS = 'sticky right-0 z-10 !w-[84px] !min-w-[84px] !max-w-[84px] w-[84px] min-w-[84px] max-w-[84px] overflow-hidden bg-white dark:bg-slate-900 px-0.5 py-2 align-top'
export const TABLE_ACTION_CELL_CLASS = 'sticky right-0 z-10 !w-[56px] !min-w-[56px] !max-w-[56px] w-[56px] min-w-[56px] max-w-[56px] overflow-hidden bg-white dark:bg-slate-900 px-0.5 py-1 align-top whitespace-nowrap'
export const TABLE_ACTION_CELL_WIDE_CLASS = 'sticky right-0 z-10 !w-[84px] !min-w-[84px] !max-w-[84px] w-[84px] min-w-[84px] max-w-[84px] overflow-hidden bg-white dark:bg-slate-900 px-0.5 py-1 align-top whitespace-nowrap'
export const TABLE_ACTION_GROUP_CLASS = 'flex items-center justify-end gap-0.5'
// A11Y-04: touch-target ≥ 36px (крупнее рекомендованного WCAG 2.2 AA 24px, ближе к 44px)
// без роста иконки — комфортно для планшетов, но не раздувает плотные таблицы вдвое.
export const TABLE_ICON_BUTTON_CLASS = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 dark:text-slate-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-800'
// Бейдж внутри ячейки таблицы (статус, приоритет, RAG).
//
// `table-fixed` берёт ширину колонки из <th>, а НЕРАЗРЫВНОЕ содержимое шире неё не переносится
// и не обрезается — оно рисуется ПОВЕРХ соседней ячейки. Так «Финализировано» (113px) наползало
// на «7 участников · 3 задач» в колонке 90px. Ширину колонки человек к тому же двигает мышью,
// а в латышском и английском те же статусы другой длины, поэтому «сделать колонку пошире» —
// не решение, а отсрочка.
//
// `max-w-full truncate` внутри ячейки с `min-w-0`: бейдж ужимается до ширины колонки и
// заканчивается многоточием. К нему обязателен `title` с полным текстом — обрезанный статус
// должен оставаться читаемым по наведению.
export const TABLE_BADGE_CLASS = 'inline-block max-w-full truncate rounded px-2 py-0.5 text-xs align-middle'
export const TABLE_FILL_HEAD_CLASS = 'w-full py-2 pr-3'
export const TABLE_FILL_CELL_CLASS = 'w-full py-1 pr-3'

export function getManagedTableStyle(
  cols: ColDef[],
  isVisible: (key: string) => boolean,
  getWidth: (key: string) => number,
  extraWidth = 48,
): CSSProperties {
  // Ширина таблицы = сумма видимых колонок (+ drag/action/запас). Таблица растёт по контенту
  // и горизонтально скроллится в обёртке (overflow-x-auto), а не сжимается/обрезается.
  const sum = cols.reduce((s, c) => (isVisible(c.key) ? s + (getWidth(c.key) || 0) : s), 0)
  const total = sum + TABLE_DRAG_COL_WIDTH + TABLE_ACTION_COL_WIDTH + extraWidth
  return {
    width: total,
    minWidth: '100%',
  }
}
