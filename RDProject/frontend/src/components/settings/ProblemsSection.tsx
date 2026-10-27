import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bug, Check, Image, Trash2, X } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { formatDateTime } from '@/utils/date'
import { getProblems, deleteProblem, resolveProblem, fetchProblemScreenshot } from '@/api/problems'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'

/**
 * «Сообщения о проблемах» (F6): владелец портфеля видит баг-репорты пользователей, смотрит
 * приложенный скриншот и удаляет разобранные. Скрин тянем блобом с авторизацией (owner-only).
 */
export default function ProblemsSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const showConfirm = useConfirmStore((s) => s.show)
  const showToast = useToastStore((s) => s.show)
  const [shotUrl, setShotUrl] = useState<string | null>(null)

  const { data: problems = [], isLoading } = useQuery({
    queryKey: ['problems'], queryFn: getProblems, refetchInterval: 60000,
  })

  const viewShot = async (id: string) => {
    try {
      setShotUrl(await fetchProblemScreenshot(id))
    } catch {
      showToast(t('common.error', { defaultValue: 'Ошибка' }), 'error')
    }
  }
  const closeShot = () => { if (shotUrl) URL.revokeObjectURL(shotUrl); setShotUrl(null) }

  /** Отметить решённой. Короткая приписка — то, что автор увидит в уведомлении. */
  const resolve = (id: string) => {
    const note = window.prompt(t('problem.resolvePrompt',
      { defaultValue: 'Что сделали? Это увидит тот, кто сообщил о проблеме (можно оставить пустым)' }) || '', '')
    if (note === null) return
    void (async () => {
      await resolveProblem(id, note)
      await qc.invalidateQueries({ queryKey: ['problems'] })
    })()
  }

  const remove = (id: string) => {
    showConfirm(t('problem.deleteConfirm', { defaultValue: 'Удалить сообщение?' }), async () => {
      await deleteProblem(id)
      qc.invalidateQueries({ queryKey: ['problems'] })
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <Bug size={ICON_SM} className="text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">
          {t('problem.settingsTitle', { defaultValue: 'Сообщения о проблемах' })}
        </h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-slate-400">
        {t('problem.settingsHint', { defaultValue: 'Что присылают пользователи кнопкой «Сообщить о проблеме».' })}
      </p>

      {isLoading ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('common.loading')}</p>
      ) : problems.length === 0 ? (
        <p className="text-xs italic text-gray-500 dark:text-slate-400">
          {t('problem.settingsEmpty', { defaultValue: 'Сообщений пока нет.' })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                {[t('settings.timeCol'), t('problem.reporterCol', { defaultValue: 'От кого' }),
                  t('problem.descCol', { defaultValue: 'Проблема' }), ''].map((h, i) => (
                  <th key={i} className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 dark:border-slate-800 align-top">
                  <td className="whitespace-nowrap py-1.5 pr-4 text-gray-500 dark:text-slate-400">{formatDateTime(p.created_at)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-4 text-gray-700 dark:text-slate-200">{p.reporter_name || p.reporter_email}</td>
                  <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">
                    <p className="max-w-md whitespace-pre-wrap">{p.description}</p>
                    {p.page_url && <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-slate-500">{p.page_url}</p>}
                    {p.status === 'resolved' && (
                      <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                        {t('problem.resolvedBy', { defaultValue: 'Решено' })}
                        {p.resolved_by ? ` · ${p.resolved_by}` : ''}
                        {p.resolution ? ` · ${p.resolution}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    {p.has_screenshot && (
                      <button onClick={() => viewShot(p.id)} aria-label={t('problem.viewShot', { defaultValue: 'Скриншот' })}
                        title={t('problem.viewShot', { defaultValue: 'Скриншот' })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-primary-600">
                        <Image size={14} />
                      </button>
                    )}
                    {p.status !== 'resolved' && (
                      // «Решено» вместо удаления: удаление уносит и жалобу, и возможность
                      // ответить. Автор узнаёт о починке в колокольчике.
                      <button onClick={() => resolve(p.id)}
                        aria-label={t('problem.resolve', { defaultValue: 'Отметить решённой' })}
                        title={t('problem.resolve', { defaultValue: 'Отметить решённой' })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50">
                        <Check size={14} />
                      </button>
                    )}
                    <button onClick={() => remove(p.id)} aria-label={t('common.delete')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shotUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={closeShot} role="dialog" aria-modal="true">
          <div className="relative max-h-[90vh] max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeShot} aria-label={t('common.close')}
              className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
              <X size={16} />
            </button>
            <img src={shotUrl} alt="" className="max-h-[88vh] rounded-lg" />
          </div>
        </div>
      )}
    </section>
  )
}
