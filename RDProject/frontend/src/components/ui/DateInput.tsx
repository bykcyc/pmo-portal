import { useEffect, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { formatDate, parseDateStrict } from '@/utils/date'

/**
 * Поле даты портала: видимый текст «дд.мм.гггг» + браузерный календарь по значку.
 *
 * Существует потому, что голый `<input type="date">` рисует маску по локали БРАУЗЕРА: у части
 * РП это MM/DD/YYYY, и на одной странице дата выглядела так, а на соседней — dd.mm.yyyy.
 * Договориться с браузером нельзя (Chrome берёт формат из языка интерфейса, Firefox — из
 * региональных настроек ОС), поэтому формат рисуем сами, а нативным полем пользуемся только
 * как календарём.
 *
 * Жил внутри PassportForm и потому не переиспользовался — отсюда и разнобой. Здесь он общий.
 *
 * Наружу отдаётся ISO `гггг-мм-дд` либо пустая строка. Первый день недели в самом календаре
 * по-прежнему за браузером: чтобы задать его, нужен свой календарь, а не нативный.
 */
export default function DateInput({ value, onChange, className, ariaLabel, disabled }: {
  value: string
  onChange: (iso: string) => void
  className: string
  ariaLabel?: string
  /** Только просмотр. Меряется селектором `:disabled` — «нарисовать текстом» не годится:
   *  ровно на этом уже ловились, принимая за блокировку отсутствие рамки. */
  disabled?: boolean
}) {
  const [display, setDisplay] = useState(formatDate(value, ''))
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDisplay(formatDate(value, '')) }, [value])

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="дд.мм.гггг"
        aria-label={ariaLabel}
        disabled={disabled}
        className={`${className} pr-7`}
        value={display}
        onChange={e => {
          const raw = e.target.value
          setDisplay(raw)
          // Наружу отдаём ТОЛЬКО полную дату либо явную очистку поля. Иначе уезжало бы то,
          // что человек успел набрать («1», «12.0»), а колонки дат — TEXT, и серверная
          // проверка сравнивает их как строки: мусор она не поймает.
          const iso = parseDateStrict(raw)
          if (iso) onChange(iso)
          else if (raw.trim() === '') onChange('')
        }}
        // Ушли из поля с недописанной датой — показываем то, что реально сохранено, иначе на
        // экране остаётся текст, которого в проекте нет.
        onBlur={() => setDisplay(formatDate(value, ''))}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onClick={() => pickerRef.current?.showPicker?.()}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
      >
        <Calendar size={ICON_SM} />
      </button>
      {/* value обязателен: без него календарь открывается пустым и на текущем месяце, а его
          кнопка «Очистить» не меняет значения — значит не шлёт change, и очистка не доходит. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={value || ''}
        onChange={e => { onChange(e.target.value); setDisplay(formatDate(e.target.value, '')) }}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}
