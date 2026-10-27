/**
 * «Как это считается» — подсказка прямо в портфеле.
 *
 * Кнопка открывает окно с нужным разделом объяснения: не надо уходить со страницы, теряя
 * фильтры и раскрытые группы, и не надо искать глазами нужный кусок статьи.
 *
 * Текст НЕ дублируется: окно рендерит те же блоки, что и страница справки
 * (/wiki/portfolio-metrics), тем же рендерером. Значит, правка формулы правится в одном месте
 * и на трёх языках сразу, а окно и справка не могут разойтись по определению.
 *
 * Слева — список всех тем: человек пришёл за «дельтой дней», но соседний вопрос («а почему
 * красный?») возникает через секунду, и ради него закрывать окно не нужно.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { findWikiPage } from '@/content/wiki'
import WikiRenderer from '@/components/wiki/WikiRenderer'
import { Surface } from '@/components/ui/surface'
import { ICON_SM } from '@/constants/ui'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const SLUG = 'portfolio-metrics'
const TITLE_ID = 'portfolio-help-title'

function HelpDialog({ anchor, onClose }: { anchor?: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const page = useMemo(() => findWikiPage(SLUG, i18n.language), [i18n.language])
  // Раздел по якорю; если якоря нет (опечатка в вызове) — первый, чтобы окно не осталось пустым.
  const [active, setActive] = useState(
    () => page?.sections.find(s => s.id === anchor)?.id ?? page?.sections[0]?.id ?? '',
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useFocusTrap(dialogRef, true)

  if (!page) return null
  const section = page.sections.find(s => s.id === active) ?? page.sections[0]

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <Surface
        className="flex max-h-[88vh] w-full max-w-4xl flex-col p-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h3 id={TITLE_ID} className="text-sm font-semibold text-slate-900 dark:text-slate-100">{page.title}</h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{page.summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Закрыть' })}
            className="shrink-0 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X size={ICON_SM} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Темы: колонкой на широком экране, лентой чипов на узком. */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 p-3 dark:border-slate-700 md:w-60 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {page.sections.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={s.id === active ? 'true' : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs md:whitespace-normal ${
                  s.id === active
                    ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            <WikiRenderer sections={[section]} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <Link
            to={`/wiki/${SLUG}#${section.id}`}
            onClick={onClose}
            className="text-xs text-blue-700 hover:underline dark:text-blue-300"
          >
            {t('portfolio.openInWiki', { defaultValue: 'Открыть всю статью в справке' })}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('common.close', { defaultValue: 'Закрыть' })}
          </button>
        </div>
      </Surface>
    </div>,
    document.body,
  )
}

/** compact — только иконка (для тесных заголовков колонок таблицы). */
export default function MetricHelp({ anchor, label, compact }: { anchor?: string; label?: string; compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const text = label ?? t('portfolio.howCounted', { defaultValue: 'Как это считается' })

  return (
    <>
      <button
        type="button"
        // Кнопка живёт и внутри кликабельного заголовка колонки (он сортирует таблицу) —
        // гасим оба события, иначе подсказка заодно меняла бы сортировку.
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        onMouseDown={(e) => e.stopPropagation()}
        title={text}
        aria-label={compact ? text : undefined}
        // slate-600, а не 500: в классической светлой теме 500 не добирает контраста
        // до AA на карточке — гейт a11y это ловит (A11Y-02).
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap align-middle text-xs font-normal text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
      >
        <HelpCircle size={14} aria-hidden />
        {!compact && <span>{text}</span>}
      </button>
      {open && <HelpDialog anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  )
}
