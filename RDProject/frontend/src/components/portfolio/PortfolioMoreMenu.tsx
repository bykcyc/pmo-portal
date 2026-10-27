/**
 * Меню «Ещё» в панели фильтров портфеля.
 *
 * Кнопки архива и двух экспортов помещались только на очень широком экране, а на обычном
 * переносились на вторую строку и ломали панель. Внутрь убрано именно то, чем пользуются
 * изредка: фильтры и поиск нужны каждый раз, выгрузка — раз в неделю.
 *
 * Своя реализация, а не общий компонент: у шапки проекта такое меню уже есть, но оно завязано
 * на действия конкретного проекта — вытаскивать его в общий примитив ради двух пунктов дороже,
 * чем повторить двадцать строк разметки.
 */
import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { Archive, Check, Download, FileDown, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  t: TFunction
  showArchived: boolean
  onToggleArchived: () => void
  onExportXlsx: () => void
  onExportPdf: () => void
  exporting: boolean
}

const itemCls =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800'

export default function PortfolioMoreMenu({ t, showArchived, onToggleArchived, onExportXlsx, onExportPdf, exporting }: Props) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Клик мимо и Escape закрывают меню — иначе оно висит поверх списка и мешает.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant={showArchived ? 'primary' : 'secondary'}
        icon={<MoreHorizontal size={14} />}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t('common.more', { defaultValue: 'Ещё' })}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onToggleArchived() }}>
            <Archive size={14} className="text-slate-600 dark:text-slate-400" />
            <span className="flex-1">{t('portfolio.showArchived', { defaultValue: 'Показать архив' })}</span>
            {showArchived && <Check size={14} className="text-blue-700 dark:text-blue-300" />}
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onExportXlsx() }}>
            <Download size={14} className="text-slate-600 dark:text-slate-400" />
            {t('portfolio.export', { defaultValue: 'Экспорт' })}
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onExportPdf() }} disabled={exporting}>
            <FileDown size={14} className="text-slate-600 dark:text-slate-400" />
            {exporting
              ? t('common.saving', { defaultValue: 'Сохранение…' })
              : t('portfolio.exportPdf', { defaultValue: 'Экспорт PDF' })}
          </button>
        </div>
      )}
    </div>
  )
}
