import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToastStore } from '@/store/toastStore'
import { useConfirmStore } from '@/store/confirmStore'

interface SavedView {
  name: string
  filters: Record<string, unknown>
}

interface SavedViewsProps {
  storageKey: string
  current: Record<string, unknown>
  onApply: (v: Record<string, unknown>) => void
}

function readViews(storageKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(`pm-views:${storageKey}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is SavedView => v && typeof v.name === 'string' && typeof v.filters === 'object')
  } catch {
    return []
  }
}

function writeViews(storageKey: string, views: SavedView[]): void {
  try {
    localStorage.setItem(`pm-views:${storageKey}`, JSON.stringify(views))
  } catch {
    /* ignore quota / serialization errors */
  }
}

const selectCls =
  'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 shadow-sm outline-none transition-colors focus:border-slate-500'
const inputCls =
  'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 shadow-sm outline-none transition-colors focus:border-slate-500'

export default function SavedViews({ storageKey, current, onApply }: SavedViewsProps) {
  const { t } = useTranslation()
  const toast = useToastStore((s) => s.show)
  const showConfirm = useConfirmStore((s) => s.show)
  const [views, setViews] = useState<SavedView[]>(() => readViews(storageKey))
  const [active, setActive] = useState('')
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  // Re-read when the storage key changes (e.g. user switches).
  useEffect(() => {
    setViews(readViews(storageKey))
    setActive('')
  }, [storageKey])

  const persist = (next: SavedView[]) => {
    setViews(next)
    writeViews(storageKey, next)
  }

  const handleSelect = (name: string) => {
    setActive(name)
    if (!name) return
    const view = views.find((v) => v.name === name)
    if (view) onApply(view.filters)
  }

  const commitSave = () => {
    const name = draftName.trim()
    if (!name) {
      setNaming(false)
      setDraftName('')
      return
    }
    const doSave = () => {
      setNaming(false)
      setDraftName('')
      const next = [...views.filter((v) => v.name !== name), { name, filters: current }].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      persist(next)
      setActive(name)
      toast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    }
    const exists = views.some((v) => v.name === name)
    if (exists) {
      showConfirm(t('views.overwrite', { defaultValue: 'Вид с таким именем уже существует. Перезаписать?' }), doSave, { variant: 'primary' })
      return
    }
    doSave()
  }

  const handleDelete = () => {
    if (!active) return
    persist(views.filter((v) => v.name !== active))
    setActive('')
    toast(t('views.deleted', { defaultValue: 'Вид удалён' }), 'success')
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex items-center">
        <select
          aria-label={t('views.none', { defaultValue: '— виды —' })}
          value={active}
          onChange={(e) => handleSelect(e.target.value)}
          className={`${selectCls} ${active ? 'pr-8' : ''}`}
        >
          <option value="">{t('views.none', { defaultValue: '— виды —' })}</option>
          {views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label={t('common.delete', { defaultValue: 'Удалить' })}
            title={t('common.delete', { defaultValue: 'Удалить' })}
            className="absolute right-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {naming ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSave()
              if (e.key === 'Escape') {
                setNaming(false)
                setDraftName('')
              }
            }}
            placeholder={t('views.placeholder', { defaultValue: 'Имя вида' })}
            aria-label={t('views.placeholder', { defaultValue: 'Имя вида' })}
            className={inputCls}
          />
          {/* Размер по умолчанию: кнопка стоит в одном ряду с «Показать архив» и «Export»,
              и «sm» выбивалась из строки — это и было заметно на экране. */}
          <Button icon={<Check size={14} />} onClick={commitSave}>
            {t('common.save', { defaultValue: 'Сохранить' })}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon={<Save size={14} />} onClick={() => setNaming(true)}>
          {t('views.save', { defaultValue: 'Сохранить вид' })}
        </Button>
      )}
    </div>
  )
}
