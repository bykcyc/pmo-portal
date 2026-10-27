import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { search as apiSearch, type SearchHit, type SearchResults } from '@/api/search'

const GROUPS: { key: keyof SearchResults; def: string }[] = [
  { key: 'projects', def: 'Projects' },
  { key: 'tasks', def: 'Tasks' },
  { key: 'risks', def: 'Risks' },
  { key: 'decisions', def: 'Decisions' },
]

type FlatItem = SearchHit & { groupKey: keyof SearchResults }

export default function GlobalSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchResults | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null)
      return
    }
    const id = setTimeout(async () => {
      try {
        setRes(await apiSearch(q))
        setOpen(true)
        setActiveIndex(-1)
      } catch {
        /* ignore */
      }
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  // Flat, keyboard-navigable order across all groups (projects → tasks → risks → decisions).
  const flatItems: FlatItem[] = useMemo(() => {
    if (!res) return []
    return GROUPS.flatMap((g) => res[g.key].map((it) => ({ ...it, groupKey: g.key })))
  }, [res])

  const goToItem = (item: FlatItem) => {
    setOpen(false)
    setQ('')
    setActiveIndex(-1)
    const go = () => navigate(`/projects/${item.project_id}/${item.section}`)
    go()
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Ctrl+K / Cmd+K — фокус на глобальный поиск; Escape — закрыть дропдаун.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const total = flatItems.length

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (total === 0) return
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      if (total === 0) return
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && flatItems[activeIndex]) {
        e.preventDefault()
        goToItem(flatItems[activeIndex])
      }
    }
  }

  return (
    <div ref={ref} className="relative px-2 pb-2 pt-1">
      <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5" title="Ctrl+K">
        <Search size={14} className="shrink-0 text-slate-600 dark:text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => res && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder', { defaultValue: 'Search…' })}
          aria-label={t('common.search')}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined}
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
        />
      </div>
      {open && res && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('common.search')}
          className="absolute left-2 right-2 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 text-slate-700 dark:text-slate-200 shadow-xl"
        >
          {total === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{t('search.noResults', { defaultValue: 'Nothing found' })}</p>
          ) : (
            (() => {
              let flatIndex = -1
              return GROUPS.filter((g) => res[g.key].length > 0).map((g) => {
                const headerId = `${baseId}-group-${g.key}`
                return (
                  <div key={g.key} role="group" aria-labelledby={headerId}>
                    <p id={headerId} className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {t(`search.${g.key}`, { defaultValue: g.def })}
                    </p>
                    {res[g.key].map((it) => {
                      flatIndex += 1
                      const idx = flatIndex
                      return (
                        <button
                          key={`${g.key}-${it.id}`}
                          id={`${baseId}-option-${idx}`}
                          role="option"
                          aria-selected={activeIndex === idx}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => goToItem({ ...it, groupKey: g.key })}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${activeIndex === idx ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                        >
                          <span className="shrink-0 font-mono text-[10px] text-slate-600 dark:text-slate-400">{it.project_code}</span>
                          <span className="truncate">{it.title}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            })()
          )}
        </div>
      )}
    </div>
  )
}
