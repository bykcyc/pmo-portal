import { useEffect, useRef } from 'react'
import { useConfirmStore } from '@/store/confirmStore'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const MESSAGE_ID = 'confirm-dialog-message'

export default function ConfirmDialog() {
  const { t } = useTranslation()
  const { open, message, confirmLabel, cancelLabel, altLabel, variant, close, accept, acceptAlt } = useConfirmStore()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useFocusTrap(dialogRef, open, cancelRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const confirmCls = variant === 'danger'
    ? 'px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400'
    : 'px-4 py-2 text-sm font-medium text-btn-primary-fg bg-btn-primary rounded-lg hover:bg-btn-primary-hover focus:outline-none focus:ring-2 focus:ring-primary-400'

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={MESSAGE_ID}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 max-w-sm mx-4 border border-gray-100 dark:border-slate-800 ${altLabel ? 'w-96' : 'w-80'}`}
        onMouseDown={e => e.stopPropagation()}
      >
        <p id={MESSAGE_ID} className="text-sm text-gray-700 dark:text-slate-200 leading-relaxed mb-5">{message}</p>
        {/* Три кнопки не влезают в ряд на узком экране — там же они и переносятся (flex-wrap). */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={close}
            className="px-4 py-2 text-sm text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 focus:outline-none"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          {altLabel && (
            <button
              onClick={acceptAlt}
              className="px-4 py-2 text-sm text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {altLabel}
            </button>
          )}
          <button
            onClick={accept}
            className={confirmCls}
          >
            {/* без явного лейбла: danger-действие (удаление) → «Удалить», иначе «Подтвердить» — локализовано */}
            {confirmLabel || t(variant === 'danger' ? 'common.delete' : 'common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
