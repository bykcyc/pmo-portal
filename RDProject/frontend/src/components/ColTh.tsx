import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { useTranslation } from 'react-i18next'
import type { ColDef, SortState } from '@/hooks/useColumnSettings'

// ── Resizable + sortable <th> ────────────────────────────────────────────────

interface ColThProps {
  col: ColDef
  sort: SortState | null
  onSort: (k: string) => void
  width: number
  onResize: (e: React.MouseEvent) => void
  onResizePrev?: (e: React.MouseEvent) => void
  className?: string
}

export function ColTh({ col, sort, onSort, width, onResize, onResizePrev, className = '' }: ColThProps) {
  const active = sort?.field === col.key
  return (
    <th
      style={{ width, minWidth: col.minWidth ?? 40 }}
      className={`group relative py-2 pr-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 select-none align-top ${className}`}
    >
      {onResizePrev && (
        <div
          className="absolute -left-1 top-0 z-10 h-full w-3 cursor-col-resize group/handle"
          onMouseDown={onResizePrev}
        >
          <div className="absolute left-1 top-1/4 h-1/2 w-0.5 rounded bg-gray-300 dark:bg-slate-600 opacity-0 transition-opacity group-hover:opacity-60 group-hover/handle:opacity-100 group-hover/handle:bg-primary-400" />
        </div>
      )}
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          className="flex min-w-0 items-start gap-0.5 text-left hover:text-gray-800 dark:hover:text-slate-100"
          onClick={() => onSort(col.key)}
        >
          <span className="whitespace-normal break-words leading-4" title={col.hint || undefined}>{col.label}</span>
          {active
            ? sort!.dir === 'asc'
              ? <ChevronUp size={11} className="text-primary-500 ml-0.5" />
              : <ChevronDown size={11} className="text-primary-500 ml-0.5" />
            : null}
        </button>
      </div>
      {/* Drag-resize handle on right edge */}
      <div
        className="absolute -right-1 top-0 h-full w-3 cursor-col-resize z-10 group/handle"
        onMouseDown={onResize}
      >
        <div className="absolute right-1 top-1/4 h-1/2 w-0.5 rounded bg-gray-300 opacity-0 transition-opacity group-hover:opacity-60 group-hover/handle:opacity-100 group-hover/handle:bg-primary-400" />
      </div>
    </th>
  )
}

// ── Column visibility toggle button + dropdown ────────────────────────────────

interface TogglerProps {
  cols: ColDef[]
  hidden: string[]
  onToggle: (key: string) => void
  align?: 'left' | 'right'
}

export function ColumnToggler({ cols, hidden, onToggle, align = 'right' }: TogglerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 400 })

  // Позиционируем меню через портал в body с fixed — иначе оно обрезается контейнером
  // таблицы (overflow-x-auto клипает и по вертикали). Высоту ограничиваем свободным местом
  // и раскрываем ВВЕРХ, если снизу мало (иначе меню «прилипало к низу» и не доскроллить).
  const reposition = () => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const width = 190
    const left = align === 'right'
      ? Math.max(8, r.right - width)
      : Math.min(r.left, window.innerWidth - width - 8)
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    if (below < 220 && above > below) {
      // раскрываем вверх
      setPos({ top: Math.max(8, r.top - Math.min(above, 480)), left, maxHeight: Math.min(above, 480) })
    } else {
      setPos({ top: r.bottom + 6, left, maxHeight: Math.max(160, below) })
    }
  }
  useLayoutEffect(() => { if (open) reposition() }, [open, align])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // при скролле/ресайзе окна пересчитываем позицию (fixed-меню не должно «уезжать»)
    const onScrollResize = () => reposition()
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScrollResize)
    window.addEventListener('scroll', onScrollResize, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScrollResize)
      window.removeEventListener('scroll', onScrollResize, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleable = cols.filter(c => !c.required)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title={t('table.columns')}
        // ml-auto здесь, а не в каждой из десяти вкладок: кнопка настройки колонок — не часть
        // заголовка, и стоять сразу за названием раздела ей незачем. Одно место — один вид
        // во всех таблицах; align по умолчанию 'right', иначе меню у правого края уезжало бы
        // за экран.
        className={`ml-auto shrink-0 p-1 rounded transition-colors ${open ? 'text-primary-600 bg-primary-50 dark:text-primary-300 dark:bg-primary-950/40' : 'text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
      >
        <SlidersHorizontal size={ICON_SM} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 190, maxHeight: pos.maxHeight }}
          className="z-[9999] flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl py-1"
        >
          <p className="shrink-0 px-3 py-1.5 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-100 dark:border-slate-800">
            {t('table.showColumns')}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {toggleable.map(col => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-xs text-gray-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  className="w-3 h-3 rounded accent-primary-600"
                  checked={!hidden.includes(col.key)}
                  onChange={() => onToggle(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
