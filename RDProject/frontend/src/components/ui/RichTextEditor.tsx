import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bold, Italic, Code, List, ListOrdered, Heading, Eye, Pencil } from 'lucide-react'
import { hasMarkup, renderRichText } from '@/utils/richText'
import { ICON_SM } from '@/constants/ui'

/**
 * Поле длинного текста с лёгким оформлением: кнопки над полем и вкладка «Просмотр».
 *
 * Не WYSIWYG. Человек видит тот же текст, который сохранится, — а кнопки лишь расставляют
 * маркеры вокруг выделения. Это осознанно: настоящий визуальный редактор пришлось бы хранить
 * в HTML, а описание задачи пишут ещё и внешний помощник, и синхронизация с Bitrix, то есть
 * недоверенный ввод. Маркеры читаются и без портала — в письме, в Bitrix, в выгрузке.
 */

type Wrap = { before: string; after: string } | { line: string }

export default function RichTextEditor({ value, onChange, rows = 12, disabled, ariaLabel, placeholder, docKey }: {
  value: string
  onChange: (v: string) => void
  rows?: number
  disabled?: boolean
  ariaLabel?: string
  /** Что за документ сейчас в поле (обычно id задачи или пункта). По СМЕНЕ этого признака
   *  поле заново решает, показать текст оформленным или открыть на правке. Сам текст для
   *  такого решения не годится: он меняется на каждое нажатие клавиши, и режим переключался
   *  бы у человека под руками — ровно в тот момент, когда он дописал вторую звёздочку. */
  docKey?: string
  /** Своя подсказка пустого поля. Без неё в бэклоге висело бы «Опишите задачу…», а там
   *  не задача, а запрос — и это первое, что видит человек в пустой карточке. */
  placeholder?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  // Текст, в котором УЖЕ что-то размечено, показываем оформленным сразу. Иначе первое, что
  // человек видит в описании, — звёздочки и решётки: разметка рисовалась только по кнопке
  // «Просмотр», и её никто не нажимал. Пустое поле открывается на правке — смотреть там нечего.
  // В режиме «только просмотр» правки нет вовсе, значит и выбора нет.
  const decide = () => disabled || hasMarkup(value)
  const [preview, setPreview] = useState(decide)
  const opened = useRef(`${docKey}|${disabled}`)
  useEffect(() => {
    const now = `${docKey}|${disabled}`
    if (opened.current === now) return          // тот же документ — выбор человека уважаем
    opened.current = now
    setPreview(decide())
    // decide читает свежие value/disabled на момент вызова; добавлять их в зависимости значит
    // вернуть переключение режима на каждое нажатие.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, disabled])

  /** Обернуть выделение маркерами или поставить маркер в начало строки.
   *  Курсор возвращаем внутрь вставленного — иначе после кнопки «Ж» человек печатает
   *  за пределами жирного и не понимает, почему не работает. */
  const apply = (w: Wrap) => {
    const el = ref.current
    if (!el || disabled) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = value ?? ''

    if ('line' in w) {
      const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const next = text.slice(0, lineStart) + w.line + text.slice(lineStart)
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + w.line.length, end + w.line.length)
      })
      return
    }

    const selected = text.slice(start, end) || t('richText.sample', { defaultValue: 'текст' })
    const next = text.slice(0, start) + w.before + selected + w.after + text.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + w.before.length, start + w.before.length + selected.length)
    })
  }

  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
  const tools: Array<{ key: string; icon: typeof Bold; title: string; w: Wrap }> = [
    { key: 'bold', icon: Bold, title: t('richText.bold', { defaultValue: 'Жирный' }), w: { before: '**', after: '**' } },
    { key: 'italic', icon: Italic, title: t('richText.italic', { defaultValue: 'Курсив' }), w: { before: '*', after: '*' } },
    { key: 'code', icon: Code, title: t('richText.code', { defaultValue: 'Моноширинный' }), w: { before: '`', after: '`' } },
    { key: 'h', icon: Heading, title: t('richText.heading', { defaultValue: 'Подзаголовок' }), w: { line: '## ' } },
    { key: 'ul', icon: List, title: t('richText.bullet', { defaultValue: 'Список' }), w: { line: '- ' } },
    { key: 'ol', icon: ListOrdered, title: t('richText.numbered', { defaultValue: 'Нумерованный список' }), w: { line: '1. ' } },
  ]

  return (
    <div className="rounded-md border border-gray-300 dark:border-slate-600">
      <div className="flex items-center gap-0.5 border-b border-gray-200 px-1 py-1 dark:border-slate-700">
        {tools.map(({ key, icon: Icon, title, w }) => (
          <button key={key} type="button" title={title} aria-label={title} disabled={disabled || preview}
            onClick={() => apply(w)} className={btn}>
            <Icon size={ICON_SM} />
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-slate-700" />
        <button type="button" onClick={() => setPreview((v) => !v)} disabled={disabled}
          className={`${btn} w-auto gap-1 px-2 text-xs`}
          title={preview ? t('richText.edit', { defaultValue: 'Правка' }) : t('richText.preview', { defaultValue: 'Просмотр' })}>
          {preview ? <Pencil size={ICON_SM} /> : <Eye size={ICON_SM} />}
          {preview ? t('richText.edit', { defaultValue: 'Правка' }) : t('richText.preview', { defaultValue: 'Просмотр' })}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[8rem] px-2.5 py-2 text-sm text-gray-800 dark:text-slate-100"
          style={{ minHeight: `${rows * 1.5}rem` }}>
          {renderRichText(value).length
            ? renderRichText(value)
            : <p className="text-gray-400 dark:text-slate-500">{t('richText.empty', { defaultValue: 'Пусто' })}</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          rows={rows}
          disabled={disabled}
          aria-label={ariaLabel}
          className="w-full resize-y rounded-b-md border-0 bg-transparent px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:text-slate-100 dark:placeholder:text-slate-500"
          value={value}
          placeholder={placeholder ?? t('richText.placeholder', { defaultValue: 'Опишите задачу. **жирный**, *курсив*, «- » для списка.' })}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
