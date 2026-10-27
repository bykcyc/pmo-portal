/**
 * «Попросить доступ наблюдателем» — из «Моих задач», прямо там, где человек упёрся в замочек.
 *
 * Раньше он видел только замок и шёл искать руководителя в чате. Здесь видно, КОГО он просит,
 * и можно объяснить зачем: без причины руководитель не поймёт, что решать, а имя из списка
 * сотрудников само по себе ничего не объясняет.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { requestAccess } from '@/api/access'
import { ICON_SM } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { useToastStore } from '@/store/toastStore'

const NOTE_MAX = 500

export function RequestAccessDialog({
  projectId,
  projectCode,
  projectName,
  pmName,
  onClose,
}: {
  projectId: string
  projectCode: string
  projectName: string
  pmName?: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSend = async () => {
    setBusy(true)
    try {
      await requestAccess(projectId, note.trim())
      await queryClient.invalidateQueries({ queryKey: ['access-requests'] })
      showToast(t('access.sent', { defaultValue: 'Запрос отправлен руководителю проекта' }), 'success')
      onClose()
    } catch (err) {
      // Отказы сервера здесь осмысленные (уже отправлен, недавно отклонён, проект уже открыт) —
      // показываем его текст, а не общее «ошибка»: только он объясняет, что делать дальше.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <Surface className="mx-4 w-full max-w-md p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('access.requestTitle', { defaultValue: 'Запросить доступ к проекту' })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel', { defaultValue: 'Отмена' })}
            className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X size={ICON_SM} />
          </button>
        </div>

        <p className="mb-1 text-sm text-slate-700 dark:text-slate-200">
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{projectCode}</span>{' '}
          {projectName}
        </p>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {pmName
            ? t('access.willAsk', { defaultValue: 'Решение принимает руководитель проекта: {{name}}.', name: pmName })
            : t('access.willAskUnknown', { defaultValue: 'Решение принимает руководитель проекта.' })}
          {' '}
          {t('access.observerHint', { defaultValue: 'Доступ будет на просмотр: править ничего нельзя.' })}
        </p>

        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor="access-note">
          {t('access.noteLabel', { defaultValue: 'Зачем вам доступ (необязательно)' })}
        </label>
        <textarea
          id="access-note"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={t('access.notePlaceholder', { defaultValue: 'Например: веду соседний модуль, нужны сроки по этому' })}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Отмена' })}
          </Button>
          <Button onClick={() => void handleSend()} disabled={busy}>
            {t('access.send', { defaultValue: 'Отправить запрос' })}
          </Button>
        </div>
      </Surface>
    </div>
  )
}

export default RequestAccessDialog
