import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { bulkCreateTasks } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'

/** Модалка массового создания задач: по одной на строку → POST /tasks/bulk. */
export default function BulkTaskDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const titles = text.split('\n').map((s) => s.trim()).filter(Boolean)
    if (titles.length === 0) { onClose(); return }
    setBusy(true)
    try {
      await bulkCreateTasks(projectId, titles)
      await invalidateProjectTasks(qc, projectId)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('bulk.title', { defaultValue: 'Массовое добавление задач' })}</h3>
          <button type="button" onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-300"><X size={18} /></button>
        </div>
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">{t('bulk.hint', { defaultValue: 'По одной задаче на строку' })}</p>
        <textarea
          rows={7}
          value={text}
          aria-label={t('bulk.title', { defaultValue: 'Список задач (по одной на строку)' })}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('bulk.placeholder', { defaultValue: 'Задача 1\nЗадача 2' })}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {t('bulk.add', { defaultValue: 'Создать' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
