import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { SectionCard } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useToastStore } from '@/store/toastStore'
import { useConfirmStore } from '@/store/confirmStore'
import { getAllTokens, getMcpLog, revokeToken } from '@/api/agent'
import { getMcpSettings, putMcpSettings } from '@/api/settings'

const cellCls = 'px-3 py-2 text-xs text-slate-700 dark:text-slate-200'
const headCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400'

/**
 * Владельцу портала: кто выпустил токены помощника и что через них делали.
 *
 * Журнал обращений — ОТДЕЛЬНАЯ таблица, не журнал действий проекта: у того кап 50 записей,
 * и поток запросов от помощника вытеснил бы историю проекта за сутки.
 */
export default function AgentAdminSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToastStore((s) => s.show)
  const confirm = useConfirmStore((s) => s.show)

  const { data: tokens, isLoading } = useQuery({ queryKey: ['admin-agent-tokens'], queryFn: getAllTokens })
  const { data: log } = useQuery({ queryKey: ['admin-mcp-log'], queryFn: getMcpLog })
  const { data: mcp, isLoading: mcpLoading } = useQuery({ queryKey: ['admin-mcp-settings'], queryFn: getMcpSettings })

  // Тумблер включает автоприём удалений во ВСЕ проекты без подтверждения — цена неверного
  // отображения выше обычной. checked ведёт себя оптимистично и всегда возвращается к серверной
  // правде в finally, поэтому неудачное сохранение не может оставить чекбокс во «включённом»
  // положении, когда на сервере он выключен.
  const [optimisticAutoApply, setOptimisticAutoApply] = useState<boolean | null>(null)
  const [autoApplySaving, setAutoApplySaving] = useState(false)
  const autoApplyChecked = optimisticAutoApply ?? mcp?.auto_apply ?? false

  const toggleAutoApply = async (on: boolean) => {
    setOptimisticAutoApply(on)
    setAutoApplySaving(true)
    try {
      await putMcpSettings({ auto_apply: on })
      await qc.invalidateQueries({ queryKey: ['admin-mcp-settings'] })
      toast(on
        ? t('agentAdmin.autoApplyOn', { defaultValue: 'Автоприём включён' })
        : t('agentAdmin.autoApplyOff', { defaultValue: 'Автоприём выключен' }), 'success')
    } catch {
      toast(t('errors.generic', { defaultValue: 'Не удалось сохранить' }), 'error')
    } finally {
      setOptimisticAutoApply(null)
      setAutoApplySaving(false)
    }
  }

  const revoke = (id: string, label: string) => {
    confirm(
      t('agentAdmin.revokeAsk', { defaultValue: 'Отозвать токен «{{name}}»?', name: label }),
      async () => {
        try {
          await revokeToken(id)
          await qc.invalidateQueries({ queryKey: ['admin-agent-tokens'] })
          toast(t('agentTokens.revoked', { defaultValue: 'Токен отозван' }), 'success')
        } catch {
          toast(t('errors.generic', { defaultValue: 'Не удалось сохранить' }), 'error')
        }
      },
    )
  }

  return (
    <SectionCard title={t('agentAdmin.title', { defaultValue: 'Помощники (MCP)' })}>
      <div className="flex flex-col gap-5">
        <div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autoApplyChecked}
              disabled={mcpLoading || autoApplySaving}
              onChange={(e) => toggleAutoApply(e.target.checked)}
            />
            <span>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('agentAdmin.autoApply', {
                  defaultValue: 'Применять черновики помощника сразу, без подтверждения',
                })}
              </span>
              <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                {t('agentAdmin.autoApplyHelp', {
                  defaultValue: 'Действует только под вашей учётной записью и на все проекты портала, включая чужие. Удаления тоже применяются сразу, и отменить их средствами помощника нельзя. Включайте на время массового переноса.',
                })}
              </span>
            </span>
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('agentAdmin.tokens', { defaultValue: 'Выпущенные токены' })}
          </p>
          {isLoading ? (
            <SkeletonRows rows={2} />
          ) : (tokens ?? []).length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('agentTokens.empty', { defaultValue: 'Токенов пока нет.' })}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60">
                  <tr>
                    <th className={headCls}>{t('agentAdmin.user', { defaultValue: 'Пользователь' })}</th>
                    <th className={headCls}>{t('agentTokens.name', { defaultValue: 'Где будет использоваться' })}</th>
                    <th className={headCls}>{t('agentAdmin.created', { defaultValue: 'Выпущен' })}</th>
                    <th className={headCls}>{t('agentAdmin.used', { defaultValue: 'Использован' })}</th>
                    <th className={headCls}>{t('agentAdmin.state', { defaultValue: 'Состояние' })}</th>
                    <th className={headCls} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {(tokens ?? []).map((tok) => (
                    <tr key={tok.id}>
                      <td className={cellCls}>{tok.user_email}</td>
                      <td className={cellCls}>
                        {tok.name} <span className="text-slate-500 dark:text-slate-400">…{tok.token_hint}</span>
                      </td>
                      <td className={cellCls}>{tok.created_at.slice(0, 10)}</td>
                      <td className={cellCls}>{tok.last_used_at ? tok.last_used_at.slice(0, 16).replace('T', ' ') : '—'}</td>
                      <td className={cellCls}>
                        {tok.revoked_at
                          ? t('agentAdmin.revokedState', { defaultValue: 'отозван' })
                          : t('agentAdmin.liveState', { defaultValue: 'действует' })}
                      </td>
                      <td className={cellCls}>
                        {!tok.revoked_at && (
                          <Button size="sm" variant="ghost" onClick={() => revoke(tok.id, tok.name)}>
                            {t('agentTokens.revoke', { defaultValue: 'Отозвать' })}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('agentAdmin.log', { defaultValue: 'Последние обращения помощников' })}
          </p>
          {(log ?? []).length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('agentAdmin.logEmpty', { defaultValue: 'Обращений пока не было.' })}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60">
                  <tr>
                    <th className={headCls}>{t('agentAdmin.at', { defaultValue: 'Когда' })}</th>
                    <th className={headCls}>{t('agentAdmin.user', { defaultValue: 'Пользователь' })}</th>
                    <th className={headCls}>{t('agentAdmin.tool', { defaultValue: 'Действие' })}</th>
                    <th className={headCls}>{t('agentAdmin.detail', { defaultValue: 'Подробности' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {(log ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className={cellCls}>{row.at.slice(0, 16).replace('T', ' ')}</td>
                      <td className={cellCls}>{row.user_email}</td>
                      <td className={`${cellCls} whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-1.5">
                          {row.ok ? (
                            <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />
                          ) : (
                            <XCircle size={14} className="text-rose-600 dark:text-rose-400" />
                          )}
                          {row.tool}
                        </span>
                      </td>
                      <td className={cellCls}>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
