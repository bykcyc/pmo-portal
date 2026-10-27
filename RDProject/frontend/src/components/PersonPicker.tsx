import { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, X } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getPersons, createPerson } from '@/api/persons'
import { filterPersons } from '@/utils/personSearch'
import type { Person } from '@/types/person'

interface Props {
  value: string | null
  onChange: (value: string) => void
  onSelect?: (value: string) => void
  /** Отдаёт ВЫБРАННОГО человека целиком (с id/email/bitrix24_id) — вызывающий может сохранить
   *  стабильную идентичность. null = имя набрано руками и человеку в реестре не соответствует. */
  onPickPerson?: (person: Person | null) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** Только просмотр. Меряется селектором `:disabled`: «нарисовать текстом» не годится —
   *  без этого пропа поле человека оставалось единственным живым контролом в карточке,
   *  открытой читателем. */
  disabled?: boolean
  /** Имя поля для доступности. По умолчанию «Выбрать человека» — но когда таких полей на
   *  форме два («Ответственный» и «Запросил»), одинаковое имя их не различает. */
  ariaLabel?: string
}

/** Сколько строк реально рисуем. Больше — это уже не выбор, а прокрутка справочника. */
const MAX_OPTIONS = 50

// ARIA combobox option: either the "add person" action row or a person from the list.
type NavItem = { type: 'add' } | { type: 'person'; person: Person }

export default function PersonPicker({
  value, onChange, onSelect, onPickPerson, placeholder = '...', className, autoFocus, disabled, ariaLabel,
}: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState(value ?? '')
  const [adding, setAdding] = useState(false)
  const [isFiltering, setIsFiltering] = useState(false)
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [dupError, setDupError] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  /** Последнее значение, которое МЫ отдали наверх. Родитель возвращает его обратно в `value` —
   *  это наше собственное эхо, а не внешняя правка. Без этого различения эффект ниже гасил
   *  фильтр на КАЖДОМ нажатии клавиши, и поиск был мёртв во всех 14 местах использования. */
  const emittedRef = useRef<string | null>(null)
  const committedRef = useRef(false)

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => getPersons(),
    staleTime: 60_000,
  })

  useEffect(() => {
    const next = value ?? ''
    if (emittedRef.current !== null && next === emittedRef.current) return  // эхо нашего onChange
    // Настоящая внешняя смена (форма догрузила данные, строку переоткрыли) — синхронизируемся
    // и сбрасываем фильтр, чтобы он не «залипал» с прошлого запроса.
    emittedRef.current = null
    setInput(next)
    setIsFiltering(false)
  }, [value])

  const updatePos = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1
    setPos({
      top: rect.bottom / zoom + window.scrollY / zoom + 2,
      left: rect.left / zoom + window.scrollX / zoom,
      width: rect.width / zoom,
    })
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (inputRef.current?.contains(target)) return
      if (dropRef.current?.contains(target)) return
      setOpen(false)
      setAdding(false)
      // isFiltering здесь НЕ сбрасываем: набранный запрос должен пережить закрытие списка,
      // иначе при возврате в поле снова вываливается весь справочник.
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  // Технические логины («Portfolio Owner» и прочие, попавшие в справочник при первичном
  // заполнении из USERS) в списке выбора исполнителя只 мешают. Прячем их ЗДЕСЬ, а не в
  // GET /persons: тот же кэш ['persons'] обслуживает и справочник в Настройках, где скрытые
  // обязаны быть видны — иначе галочку не снять.
  // Исключение: уже ВЫБРАННОГО человека не прячем никогда, иначе его нельзя вернуть обратно
  // после случайной замены — поле показывало бы имя, которого нет в списке.
  const pickable = useMemo(
    () => persons.filter(p => !p.hidden_from_pickers || p.full_name === value),
    [persons, value],
  )
  // Совпадения: со снятием диакритики («Liga» находит «Līga Ozoliņa») и по токенам —
  // люди ищут и по имени, и по фамилии, в любом порядке.
  const matched = useMemo(
    () => (isFiltering ? filterPersons(pickable, input) : pickable),
    [pickable, input, isFiltering],
  )
  // Рисуем не больше MAX_OPTIONS: сотни кнопок в контейнере высотой 224px — это и есть то самое
  // «ищу человека руками в списке». Обрезаем ЗДЕСЬ, чтобы navItems и aria-activedescendant
  // указывали ровно на то, что видно на экране.
  const filtered = useMemo(() => matched.slice(0, MAX_OPTIONS), [matched])
  const hiddenCount = matched.length - filtered.length

  // ARIA combobox options in keyboard-navigation order: the "add person" action row
  // (reachable via Arrow keys, not just the mouse) followed by the filtered persons.
  // While the inline add-person form is open, it manages its own focus/Enter/Escape,
  // so it isn't part of this list.
  const navItems: NavItem[] = useMemo(() => {
    if (adding) return []
    return [{ type: 'add' as const }, ...filtered.map(p => ({ type: 'person' as const, person: p }))]
  }, [adding, filtered])

  const handleChange = (nextValue: string) => {
    setInput(nextValue)
    setIsFiltering(true)
    emittedRef.current = nextValue   // помечаем: следующее value от родителя — наше эхо
    committedRef.current = false
    onChange(nextValue)
    onPickPerson?.(null)  // набрано руками → это не человек из реестра, идентичность сбрасываем
    setOpen(true)
    setAdding(false)
    setActiveIndex(-1)
  }

  const handlePick = (person: Person) => {
    setInput(person.full_name)
    setIsFiltering(false)
    emittedRef.current = person.full_name
    committedRef.current = true
    onChange(person.full_name)
    onPickPerson?.(person)  // отдаём идентичность целиком (id/email/bitrix24_id)
    setOpen(false)
    setAdding(false)
    setActiveIndex(-1)
    if (onSelect) onSelect(person.full_name)
  }

  /**
   * Подтвердить СВОБОДНЫЙ текст («разработчики», «Отдел контента»).
   *
   * Раньше ячейка человека коммитилась ТОЛЬКО через выбор из реестра, а завести одним словом
   * человека нельзя (форма требует имя и фамилию) — получался замкнутый круг: добавить строку
   * можно, отредактировать нельзя. Теперь Enter и уход фокуса сохраняют набранное, как это давно
   * делают обычные текстовые ячейки в тех же таблицах.
   *
   * `onSelect` нигде не означает «выбран человек из реестра» — идентичность едет отдельным
   * пропом `onPickPerson`. Поэтому свободный текст здесь безопасен, а компоненты, которые
   * `onSelect` не передают (паспорт, карточка задачи, RowForm), ничего не замечают.
   */
  const commitFreeText = () => {
    if (!onSelect || committedRef.current) return
    committedRef.current = true
    onSelect(input)
  }

  const openAddMode = () => {
    setAdding(true)
    setIsFiltering(false)
    setNewFirst('')
    setNewLast('')
    setDupError('')
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Гасим ТОЛЬКО верхний слой. Карточки портала слушают Escape на document, и без этой
      // остановки первое же нажатие закрывало список вместе со всей карточкой — вместе с
      // несохранённым описанием.
      if (open || adding) e.stopPropagation()
      setOpen(false)
      setAdding(false)
      setIsFiltering(false)
      setActiveIndex(-1)
    }
    if (e.key === 'ArrowDown') {
      if (navItems.length === 0) return
      e.preventDefault()
      setOpen(true)
      setActiveIndex(i => Math.min(i + 1, navItems.length - 1))
    }
    if (e.key === 'ArrowUp') {
      if (navItems.length === 0) return
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter') {
      const active = activeIndex >= 0 ? navItems[activeIndex] : undefined
      if (active?.type === 'add') {
        e.preventDefault()
        openAddMode()
        return
      }
      if (active?.type === 'person') {
        e.preventDefault()
        handlePick(active.person)
        return
      }
      // Ничего не подсвечено — значит набран свободный текст. Коммитим его, но ТОЛЬКО там, где
      // есть onSelect (инлайн-ячейки таблиц). В паспорте пикер живёт внутри <form>, и безусловный
      // preventDefault убил бы сохранение по Enter.
      if (onSelect) {
        e.preventDefault()
        setOpen(false)
        commitFreeText()
        return
      }
      setOpen(false)
      setIsFiltering(false)
    }
  }

  const closeAddMode = () => {
    setAdding(false)
    setNewFirst('')
    setNewLast('')
    setDupError('')
  }

  const handleAddPerson = async () => {
    if (!newFirst.trim() || !newLast.trim()) return
    const fullName = `${newFirst.trim()} ${newLast.trim()}`.toLowerCase()
    const dup = persons.find(p => p.full_name.toLowerCase() === fullName)
    if (dup) {
      setDupError(t('persons.duplicate'))
      return
    }

    setDupError('')
    try {
      const person = await createPerson({
        first_name: newFirst.trim(),
        last_name: newLast.trim(),
      })
      await qc.invalidateQueries({ queryKey: ['persons'] })
      handlePick(person)
    } catch {
      // ignore create failure here; page-level error handling remains unchanged
    }

    closeAddMode()
  }

  const dropdown = open ? createPortal(
    <div
      ref={dropRef}
      // в режиме «добавить» контейнер держит форму (не option'ы) → не listbox
      role={adding ? undefined : 'listbox'}
      id={listboxId}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        width: Math.max(pos.width, 220),
        zIndex: 9999,
      }}
      className="max-h-56 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
    >
      {!adding ? (
        <button
          type="button"
          id={`${baseId}-option-0`}
          role="option"
          aria-selected={activeIndex === 0}
          className={`flex w-full items-center gap-1 border-b border-gray-100 px-2 py-1 text-left text-xs text-primary-500 hover:bg-primary-50 dark:border-gray-600 dark:hover:bg-gray-700 ${activeIndex === 0 ? 'bg-primary-50 dark:bg-gray-700' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onMouseEnter={() => setActiveIndex(0)}
          onClick={openAddMode}
        >
          <Plus size={12} /> {t('persons.add')}
        </button>
      ) : (
        <div className="border-b border-gray-100 px-2 py-1.5 dark:border-gray-600">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs focus:border-blue-400 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200"
              placeholder={t('persons.firstName')}
              value={newFirst}
              onChange={e => {
                setNewFirst(e.target.value)
                setDupError('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddPerson()
                // Escape гасим здесь ровно по той же причине, что и в поле выше (см. handleKeyDown):
                // мини-форма живёт в портале, у самого `body`, поэтому нажатие уходит на document,
                // где его ждут карточки задачи, пункта бэклога и риска. Человек жал Escape, чтобы
                // передумать заводить человека, — а закрывалась вся карточка вместе с правками.
                if (e.key === 'Escape') { e.stopPropagation(); closeAddMode() }
              }}
            />
            <input
              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs focus:border-blue-400 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200"
              placeholder={t('persons.lastName')}
              value={newLast}
              onChange={e => {
                setNewLast(e.target.value)
                setDupError('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddPerson()
                // Escape гасим здесь ровно по той же причине, что и в поле выше (см. handleKeyDown):
                // мини-форма живёт в портале, у самого `body`, поэтому нажатие уходит на document,
                // где его ждут карточки задачи, пункта бэклога и риска. Человек жал Escape, чтобы
                // передумать заводить человека, — а закрывалась вся карточка вместе с правками.
                if (e.key === 'Escape') { e.stopPropagation(); closeAddMode() }
              }}
            />
            <button
              type="button"
              className="p-0.5 text-green-600 hover:text-green-800"
              onMouseDown={e => e.preventDefault()}
              onClick={handleAddPerson}
            >
              <Check size={ICON_SM} />
            </button>
            <button
              type="button"
              className="p-0.5 text-gray-400 hover:text-gray-600"
              onMouseDown={e => e.preventDefault()}
              onClick={closeAddMode}
            >
              <X size={ICON_SM} />
            </button>
          </div>
          {dupError && <p className="mt-0.5 px-0.5 text-xs text-red-500">{dupError}</p>}
        </div>
      )}

      {!adding && hiddenCount > 0 && (
        <div
          role="option"
          aria-disabled="true"
          aria-selected={false}
          className="border-b border-gray-100 px-2 py-1 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400"
        >
          {t('persons.showingFirst', { shown: filtered.length, hidden: hiddenCount })}
        </div>
      )}

      {!adding && filtered.map((person, i) => {
        // +1: the "add person" row occupies nav index 0 (see navItems).
        const navIndex = i + 1
        return (
          <button
            key={person.id}
            id={`${baseId}-option-${navIndex}`}
            role="option"
            aria-selected={activeIndex === navIndex}
            type="button"
            className={`w-full truncate px-2 py-1 text-left text-sm text-gray-800 hover:bg-primary-50 dark:text-gray-200 dark:hover:bg-gray-700 ${activeIndex === navIndex ? 'bg-primary-50 dark:bg-gray-700' : ''}`}
            onMouseDown={e => e.preventDefault()}
            onMouseEnter={() => setActiveIndex(navIndex)}
            onClick={() => handlePick(person)}
          >
            {person.full_name}
          </button>
        )
      })}
    </div>,
    document.body,
  ) : null

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? t('persons.pick', { defaultValue: 'Выбрать человека' })}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined}
        className={className}
        disabled={disabled}
        value={input}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => {
          // Программный фокус доходит и до отключённого поля в части браузеров — список
          // выбора в режиме «только просмотр» открываться не должен.
          if (disabled) return
          setOpen(true)
          setAdding(false)
          // isFiltering не сбрасываем: вернулись в поле с набранным запросом — список должен
          // остаться отфильтрованным, а не показать снова всех.
          updatePos()
        }}
        onBlur={e => {
          if (adding) return                                    // открыли форму «+ Добавить» — не коммитим
          const next = e.relatedTarget as Node | null
          if (next && dropRef.current?.contains(next)) return   // фокус ушёл ВНУТРЬ выпадающего списка
          setOpen(false)
          commitFreeText()                                      // без onSelect — no-op
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {dropdown}
    </div>
  )
}
