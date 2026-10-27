import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Bug, X } from 'lucide-react'
import { Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useToastStore } from '@/store/toastStore'
import { createProblem } from '@/api/problems'

const TITLE_ID = 'report-problem-title'

/**
 * «Сообщить о проблеме» — глобальная кнопка + модалка. Любой пользователь описывает проблему и
 * прикладывает скриншот ТЕКУЩЕЙ страницы. Скрин снимаем html2canvas ДО открытия модалки, иначе
 * она попадёт в кадр. Тёмную тему НЕ трогаем — репорт должен показать, что пользователь реально видел.
 */
export default function ReportProblemWidget({ collapsed }: { collapsed?: boolean }) {
  const { t } = useTranslation()
  const showToast = useToastStore((s) => s.show)
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [description, setDescription] = useState('')
  const [shot, setShot] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => {
    setOpen(false)
    setDescription('')
    setShot(null)
    if (preview) { URL.revokeObjectURL(preview); setPreview(null) }
  }

  const start = async () => {
    setCapturing(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const el = (document.querySelector('main') as HTMLElement) || document.body
      const canvas = await html2canvas(el, { scale: 1, useCORS: true, backgroundColor: null, logging: false })
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      setShot(blob)
      setPreview(blob ? URL.createObjectURL(blob) : null)
    } catch {
      setShot(null); setPreview(null)   // без скрина — не беда, отправим только текст
    } finally {
      setCapturing(false)
      setOpen(true)
    }
  }

  const submit = async () => {
    if (!description.trim()) return
    setSubmitting(true)
    try {
      await createProblem(description.trim(), window.location.href, shot)
      showToast(t('problem.sent', { defaultValue: 'Спасибо! Сообщение отправлено' }), 'success')
      close()
    } catch {
      showToast(t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={capturing}
        title={collapsed ? t('problem.button', { defaultValue: 'Сообщить о проблеме' }) : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-white/12 hover:text-white ${collapsed ? 'justify-center' : ''} disabled:opacity-50`}
      >
        <Bug size={18} />
        {!collapsed && <span className="truncate">{t('problem.button', { defaultValue: 'Сообщить о проблеме' })}</span>}
      </button>

      {open && createPortal(
        <div
          ref={dialogRef}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
        >
          <Surface
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-4 py-3">
              <p id={TITLE_ID} className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                {t('problem.title', { defaultValue: 'Сообщить о проблеме' })}
              </p>
              <button onClick={close} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <div>
                <label htmlFor="problem-desc" className="text-xs font-medium text-gray-600 dark:text-slate-300">
                  {t('problem.descLabel', { defaultValue: 'Что не так?' })}
                </label>
                <textarea
                  id="problem-desc"
                  autoFocus
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('problem.descPlaceholder', { defaultValue: 'Опишите проблему: что делали, что ожидали, что произошло.' })}
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              {preview && (
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
                    {t('problem.screenshot', { defaultValue: 'Скриншот страницы приложен' })}
                  </p>
                  <img src={preview} alt="" className="max-h-48 w-full rounded border border-gray-200 dark:border-slate-700 object-contain object-top bg-white dark:bg-slate-900" />
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={close}>{t('common.cancel', { defaultValue: 'Отмена' })}</Button>
              <Button size="sm" onClick={submit} disabled={submitting || !description.trim()}>
                {submitting ? t('common.saving', { defaultValue: 'Отправка…' }) : t('problem.send', { defaultValue: 'Отправить' })}
              </Button>
            </div>
          </Surface>
        </div>,
        document.body,
      )}
    </>
  )
}
