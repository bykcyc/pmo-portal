import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { SectionCard } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useToastStore } from '@/store/toastStore'
import { useConfirmStore } from '@/store/confirmStore'
import { copyToClipboard } from '@/utils/clipboard'
import { getMyTokens, createToken, revokeToken, type IssuedToken } from '@/api/agent'

/**
 * Секция профиля «Подключение помощника».
 *
 * Порядок на экране повторяет порядок в жизни: сначала адрес, который вставляют в клиент,
 * потом список того, что уже подключено. Выпуск токена руками спрятан под раскрывашку
 * НАМЕРЕННО: с появлением OAuth это редкий запасной путь для клиентов, которые иначе
 * не умеют, а не основной способ. Пока он стоял первым, человек делал лишнюю работу
 * и держал в руках секрет, которого мог не касаться вовсе.
 */
export default function AgentTokensSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToastStore((s) => s.show)
  const confirm = useConfirmStore((s) => s.show)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)
  const [issued, setIssued] = useState<IssuedToken | null>(null)

  const { data: tokens, isLoading } = useQuery({ queryKey: ['agent-tokens'], queryFn: getMyTokens })
  const live = (tokens ?? []).filter((x) => !x.revoked_at)

  // Адрес точки помощника берём от текущего портала — так он верен и на проде, и где угодно ещё.
  const mcpUrl = `${window.location.origin}/mcp`

  const copyText = async (value: string, okKey: string, okDefault: string) => {
    if (await copyToClipboard(value)) toast(t(okKey, { defaultValue: okDefault }), 'success')
    else toast(t('common.error', { defaultValue: 'Ошибка' }), 'error')
  }

  const issue = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      setIssued(await createToken(n))
      setName('')
      await qc.invalidateQueries({ queryKey: ['agent-tokens'] })
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast(detail || t('errors.generic', { defaultValue: 'Не удалось сохранить' }), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, label: string) => {
    confirm(
      t('agentTokens.revokeAsk', {
        defaultValue: 'Отключить «{{name}}»? Помощник сразу потеряет доступ к вашим проектам.',
        name: label,
      }),
      async () => {
        try {
          await revokeToken(id)
          await qc.invalidateQueries({ queryKey: ['agent-tokens'] })
          toast(t('agentTokens.revoked', { defaultValue: 'Подключение отключено' }), 'success')
        } catch {
          toast(t('errors.generic', { defaultValue: 'Не удалось сохранить' }), 'error')
        }
      },
    )
  }

  const inputCls = 'mt-1 w-full max-w-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 outline-none focus:border-slate-500'

  return (
    <SectionCard title={t('agentTokens.title', { defaultValue: 'Подключение помощника' })}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            {t('agentTokens.intro', {
              defaultValue: 'Добавьте в своём Claude или ChatGPT коннектор с этим адресом. Портал откроет страницу подтверждения — больше ничего вводить не нужно.',
            })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100">
              {mcpUrl}
            </code>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy size={14} />}
              onClick={() => { void copyText(mcpUrl, 'agentTokens.addressCopied', 'Адрес скопирован') }}
            >
              {t('share.copy', { defaultValue: 'Копировать' })}
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('agentTokens.connections', { defaultValue: 'Подключено' })}
          </p>
          {isLoading ? (
            <SkeletonRows rows={2} />
          ) : live.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('agentTokens.empty', { defaultValue: 'Пока ничего не подключено.' })}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700">
              {live.map((tok) => (
                <li key={tok.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{tok.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {tok.last_used_at
                      ? t('agentTokens.lastUsed', { defaultValue: 'Использован {{at}}', at: tok.last_used_at.slice(0, 10) })
                      : t('agentTokens.neverUsed', { defaultValue: 'Ещё не использован' })}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('agentTokens.expires', { defaultValue: 'Действует до {{at}}', at: tok.expires_at.slice(0, 10) })}
                  </span>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => remove(tok.id, tok.name)}>
                    {t('agentTokens.revoke', { defaultValue: 'Отключить' })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Запасной путь. Свёрнут, пока не понадобится: секрет, который человек держит в руках,
            может уехать в переписку — а при обычном подключении его не существует вовсе. */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
          <button
            type="button"
            onClick={() => setManual((v) => !v)}
            aria-expanded={manual}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {manual ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t('agentTokens.manualToggle', { defaultValue: 'Клиент просит вписать токен вручную' })}
          </button>

          {manual && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="max-w-2xl text-xs text-slate-600 dark:text-slate-400">
                {t('agentTokens.manualHint', {
                  defaultValue: 'Нужно только тем клиентам, которые не умеют подтверждение в браузере. Токен передаётся заголовком Authorization: Bearer. Показывается один раз — на сервере хранится только отпечаток.',
                })}
              </p>

              {issued && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {t('agentTokens.onceTitle', { defaultValue: 'Скопируйте токен — он показывается один раз' })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100">
                      {issued.token}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Copy size={14} />}
                      onClick={() => { void copyText(issued.token, 'agentTokens.copied', 'Токен скопирован') }}
                    >
                      {t('share.copy', { defaultValue: 'Копировать' })}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                      {t('agentTokens.hide', { defaultValue: 'Я скопировал' })}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-300">
                  {t('agentTokens.name', { defaultValue: 'Где будет использоваться' })}
                  <input
                    className={inputCls}
                    placeholder={t('agentTokens.namePlaceholder', { defaultValue: 'Claude на рабочем ноутбуке' })}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <Button icon={<Plus size={14} />} onClick={issue} disabled={busy || !name.trim()}>
                  {t('agentTokens.issue', { defaultValue: 'Выпустить токен' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
