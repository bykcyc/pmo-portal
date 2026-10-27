import type { TFunction } from 'i18next'
import type { QueryClient } from '@tanstack/react-query'
import { formatDateTime } from '@/utils/date'
import type { SyncLogEntry } from './settingsTypes'

interface SyncLogSectionProps {
  t: TFunction
  qc: QueryClient
  syncLog: SyncLogEntry[]
  logLoading: boolean
}

export default function SyncLogSection({ t, qc, syncLog, logLoading }: SyncLogSectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{t('settings.syncLogTitle')}</h2>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['sync_log'] })}
              className="text-xs text-primary-600 dark:text-blue-400 hover:underline">{t('settings.refreshBtn')}</button>
          </div>
          {logLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('common.loading')}</p>
          ) : syncLog.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-4">{t('settings.noSyncOps')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    {[
                      t('settings.timeCol'),
                      t('common.actions'),
                      t('common.status'),
                      t('settings.taskIdCol'),
                      t('settings.bitrixIdCol'),
                      t('common.error'),
                    ].map(h => (
                      <th key={h} className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {syncLog.map(log => (
                    <tr key={log.id} className="border-b border-gray-50 dark:border-slate-800">
                      <td className="py-1.5 pr-4 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDateTime(log.synced_at)}
                      </td>
                      <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{log.sync_action ?? '—'}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${log.status === 'ok' ? 'bg-green-100 dark:bg-emerald-950/40 text-green-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-rose-950/40 text-red-600 dark:text-rose-300'}`}>
                          {log.status ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-gray-500 dark:text-slate-400 text-xs truncate max-w-24">{log.task_id?.slice(0, 8) ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">{log.bitrix24_task_id ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-red-500 dark:text-rose-300 max-w-48 truncate">{log.error_message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
  )
}
