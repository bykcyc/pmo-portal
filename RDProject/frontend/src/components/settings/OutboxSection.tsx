import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Mail, AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import api from '@/api/client'
import { formatDateTime } from '@/utils/date'

/**
 * Журнал писем. Эндпоинт /admin/outbox существовал, но его никто не вызывал — а если SMTP
 * не настроен, ТУДА ПАДАЕТ ВСЁ (dry-run). То есть единственное место, где видно, какие письма
 * портал вообще шлёт и кому, было невидимым.
 */
interface OutboxEntry {
  to: string
  subject: string
  at: string
  sent?: boolean
  dry_run?: boolean
  error?: string
}

async function getOutbox(): Promise<{ items: OutboxEntry[]; smtpConfigured: boolean }> {
  const r = await api.get('/admin/outbox')
  return { items: r.data.data ?? [], smtpConfigured: !!r.data.smtp_configured }
}

export default function OutboxSection() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['outbox'], queryFn: getOutbox, refetchInterval: 30000,
  })
  const items = [...(data?.items ?? [])].reverse()   // свежие сверху

  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <Mail size={ICON_SM} className="text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{t('settings.outboxTitle')}</h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-slate-400">
        {data && !data.smtpConfigured ? t('settings.outboxDryRun') : t('settings.outboxHint')}
      </p>

      {isLoading ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs italic text-gray-500 dark:text-slate-400">{t('settings.outboxEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                {[t('settings.timeCol'), t('settings.outboxTo'), t('settings.outboxSubject'), t('common.status')].map(h => (
                  <th key={h} className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 50).map((m, i) => (
                <tr key={`${m.at}-${i}`} className="border-b border-gray-50 dark:border-slate-800">
                  <td className="whitespace-nowrap py-1.5 pr-4 text-gray-500 dark:text-slate-400">{formatDateTime(m.at)}</td>
                  <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{m.to}</td>
                  <td className="max-w-64 truncate py-1.5 pr-4 text-gray-600 dark:text-slate-300">{m.subject}</td>
                  <td className="py-1.5 pr-4">
                    {m.sent ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t('settings.outboxSent')}
                      </span>
                    ) : m.error ? (
                      <span title={m.error} className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-red-600 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertTriangle size={11} /> {t('common.error')}
                      </span>
                    ) : (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('settings.outboxDryRunBadge')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
