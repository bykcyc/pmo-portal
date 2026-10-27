import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * Ячейка таблицы, которая показывает свой текст целиком, если он не поместился.
 *
 * Зачем: в разделах без карточки (стейкхолдеры, команда, допущения, коммуникации, решения, KPI)
 * текст режется двумя строками, а ширину колонок тянет мышь. Прочитать длинное примечание было
 * негде: карточки нет, а расширять колонку — двигать соседние.
 *
 * Два правила, без которых лекарство хуже болезни:
 *
 * 1. ОКНО НЕ ЛОВИТ МЫШЬ (`pointer-events-none`). Кликабелен сам текст ячейки — клик включает
 *    правку. Панель с обычными pointer-events съела бы и клик, и подсветку под курсором:
 *    «навёл и уже не могу отредактировать». Тот же приём в портале у всплывающих сообщений.
 * 2. ВНУТРИ НЕТ НИЧЕГО ФОКУСИРУЕМОГО. Правка в этих таблицах сохраняется по потере фокуса,
 *    и любая кнопка в панели закрывала бы правку и записывала значение.
 *
 * Панель рисуется порталом с `position: fixed`: обёртка таблицы — `overflow-x-auto`, и она режет
 * абсолютные блоки ещё и по вертикали (тем же порталом живёт меню колонок).
 */
export default function TruncatedCell({
  text,
  className,
  onActivate,
  children,
}: {
  /** Полный текст — его и покажем в окне. */
  text: string | null | undefined
  className: string
  /** Клик или Enter/Пробел по ячейке. Нет — ячейка только читается (публичный вид, режим просмотра). */
  onActivate?: () => void
  /** Что рисовать в ячейке, если это не просто текст (бейдж, имя с иконкой). */
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number; below: boolean } | null>(null)
  const tipId = useId()
  // На планшете наведения нет: показывали бы окно по тапу — и оно закрыло бы ячейку, в которую
  // человек метил. Клавиатурный путь (фокус) от этого не зависит и работает везде.
  const hoverCapable = useMediaQuery('(hover: hover)')
  const full = (text ?? '').trim()

  const close = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setBox(null)
  }, [])

  /** Показываем ТОЛЬКО если текст действительно не влез. Мерить надо в момент наведения:
   *  ширину колонок тянут мышью, и заранее посчитанный ответ устаревает. */
  const open = useCallback(() => {
    const el = ref.current
    if (!el || !full) return
    const clipped = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
    if (!clipped) return
    const r = el.getBoundingClientRect()
    const width = Math.min(Math.max(r.width, 260), 420)
    const below = r.bottom + 160 < window.innerHeight || r.top < 160
    setBox({
      top: below ? r.bottom + 6 : r.top - 6,
      left: Math.min(Math.max(r.left, 8), window.innerWidth - width - 8),
      width,
      below,
    })
  }, [full])

  useEffect(() => {
    if (!box) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    // Прокрутка и перетаскивание уводят ячейку из-под панели — честнее закрыть, чем гнаться.
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('dragstart', close)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('dragstart', close)
    }
  }, [box, close])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const delayedOpen = () => {
    if (!hoverCapable) return
    if (timer.current) clearTimeout(timer.current)
    // Задержка, чтобы окна не выскакивали каскадом, пока мышь просто идёт через таблицу.
    timer.current = setTimeout(open, 350)
  }

  return (
    <>
      <span
        ref={ref}
        className={className}
        role="button"
        tabIndex={0}
        aria-describedby={box ? tipId : undefined}
        onMouseEnter={delayedOpen}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={() => { close(); onActivate?.() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); onActivate?.() }
        }}
      >
        {children ?? (full || '—')}
      </span>
      {box && createPortal(
        <div
          id={tipId}
          role="tooltip"
          // z-index между липкой колонкой действий (z-10) и меню колонок (z-[9999]).
          className="pointer-events-none fixed z-[500] whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700 shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          style={{
            top: box.below ? box.top : undefined,
            bottom: box.below ? undefined : window.innerHeight - box.top,
            left: box.left,
            width: box.width,
          }}
        >
          {full}
        </div>,
        document.body,
      )}
    </>
  )
}
