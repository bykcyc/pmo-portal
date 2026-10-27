import { Plus } from 'lucide-react'
import { EmptyState } from './feedback'

interface EmptyValueStateProps {
  /** Фраза ценности: что РП получит, если заполнит раздел. */
  message: string
  /** Подпись кнопки добавления; не передавать при read-only. */
  actionLabel?: string
  /** Действие добавления (дублирует существующую кнопку таба). */
  onAction?: () => void
  /** Компактный вид без карточки-Surface — для рендера внутри ячейки таблицы (<td colSpan>). */
  inline?: boolean
}

/**
 * Пустое состояние таба: фраза ценности + видимая кнопка «+ Добавить» (при canWrite).
 * По умолчанию — та же карточка (Surface + иконка), что и пустые состояния верхнеуровневых
 * страниц (`ui/feedback`'s EmptyState). Внутри таблицы (`inline`) карточка смотрится инородно
 * (bordered Surface в ячейке), поэтому там — компактное центрированное сообщение без карточки.
 */
export function EmptyValueState({ message, actionLabel, onAction, inline }: EmptyValueStateProps) {
  const addButton = onAction && actionLabel ? (
    <button
      onClick={onAction}
      className="flex items-center gap-1 rounded-md bg-btn-primary px-3 py-1.5 text-xs font-medium text-btn-primary-fg hover:bg-btn-primary-hover"
    >
      <Plus size={12} /> {actionLabel}
    </button>
  ) : undefined
  if (inline) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-gray-500 dark:text-slate-400">{message}</p>
        {addButton}
      </div>
    )
  }
  return <EmptyState title={message} action={addButton} />
}
