import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BitrixSettings } from '@/api/settings'

interface BitrixSettingsSectionProps {
  t: TFunction
  handleTestConn: () => void
  testing: boolean
  connResult: { connected: boolean; url?: string; error?: string } | null
  bitrixLoading: boolean
  bitrixError: boolean
  bitrixSettings: BitrixSettings | undefined
  webhookInput: string
  setWebhookInput: Dispatch<SetStateAction<string>>
  handleSaveWebhook: () => void
  webhookSaving: boolean
  handleClearWebhook: () => void
}

export default function BitrixSettingsSection({
  t,
  handleTestConn,
  testing,
  connResult,
  bitrixLoading,
  bitrixError,
  bitrixSettings,
  webhookInput,
  setWebhookInput,
  handleSaveWebhook,
  webhookSaving,
  handleClearWebhook,
}: BitrixSettingsSectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1">{t('settings.bitrix24.title')}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{t('settings.bitrix24.helpPrefix')} <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-gray-700 dark:text-slate-300">deploy/.env</code>.</p>
          <div className="flex gap-2 mb-4">
            <button onClick={handleTestConn} disabled={testing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">
              <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />
              {t('settings.testConnectionBtn')}
            </button>
          </div>
          {connResult && (
            <div className={`mb-4 flex items-center gap-2 text-sm ${connResult.connected ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-rose-300'}`}>
              {connResult.connected ? <CheckCircle size={15} /> : <XCircle size={15} />}
              {connResult.connected ? t('settings.bitrix24.connectedTo', { url: connResult.url }) : t('settings.bitrix24.notConnectedTo', { error: connResult.error })}
            </div>
          )}

          {/* Webhook Bitrix24 */}
          <div className="mb-4 border-t border-gray-100 dark:border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-2">{t('settings.bitrix.webhookTitle', { defaultValue: 'Вебхук Bitrix24' })}</h3>
            {bitrixLoading ? (
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">{t('common.loading')}</p>
            ) : bitrixError ? (
              <p className="text-xs text-red-600 dark:text-rose-300 mb-3 flex items-center gap-1"><XCircle size={13} />{t('errors.generic', { defaultValue: 'Не удалось выполнить запрос' })}</p>
            ) : (
              <p className="text-xs mb-3 flex items-center gap-1.5">
                {bitrixSettings?.configured ? (
                  <>
                    <CheckCircle size={13} className="text-green-700 dark:text-green-300 shrink-0" />
                    <span className="text-gray-600 dark:text-slate-300">
                      {t('settings.bitrix.configured', { defaultValue: 'Настроен: {{host}}', host: bitrixSettings.host })}
                      {' '}
                      <span className="text-gray-500 dark:text-slate-400">
                        ({bitrixSettings.source === 'env'
                          ? t('settings.bitrix.sourceEnv', { defaultValue: 'источник: переменная окружения' })
                          : t('settings.bitrix.sourceSettings', { defaultValue: 'источник: настройки' })})
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle size={13} className="text-gray-500 dark:text-slate-400 shrink-0" />
                    <span className="text-gray-500 dark:text-slate-400">{t('settings.bitrix.notConfigured', { defaultValue: 'Не настроен' })}</span>
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[16rem] max-w-md">
                <label htmlFor="bitrix-webhook" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.bitrix.newWebhook', { defaultValue: 'Новый вебхук' })}</label>
                <input
                  id="bitrix-webhook"
                  type="password"
                  autoComplete="off"
                  aria-label={t('settings.bitrix.newWebhook', { defaultValue: 'Новый вебхук' })}
                  value={webhookInput}
                  onChange={e => setWebhookInput(e.target.value)}
                  placeholder="https://<домен>/rest/<id>/<токен>/"
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <Button onClick={handleSaveWebhook} disabled={webhookSaving || !webhookInput.trim()}>
                {webhookSaving ? t('common.saving', { defaultValue: 'Сохранение…' }) : t('settings.bitrix.save', { defaultValue: 'Сохранить' })}
              </Button>
              <button
                type="button"
                onClick={handleClearWebhook}
                disabled={webhookSaving || !bitrixSettings?.configured || bitrixSettings?.source !== 'settings'}
                className="px-4 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {t('settings.bitrix.clear', { defaultValue: 'Очистить' })}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              {t('settings.bitrix.hint', { defaultValue: 'Вебхук хранится в зашифрованном виде. Токен не отображается. Формат: Разработчикам → Входящий вебхук в Bitrix.' })}
            </p>
          </div>

          <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3 text-xs text-gray-600 dark:text-slate-300">
            <p className="font-medium mb-1">{t('settings.requiredEnvVars')}</p>
            <code className="block text-gray-700 dark:text-slate-200">BITRIX24_WEBHOOK_URL=https://your-domain.bitrix24.ru/rest/1/token/<br/>BITRIX24_DEFAULT_RESPONSIBLE_ID=1</code>
          </div>
          <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">
            <p><strong>{t('settings.howItWorks')}</strong> {t('settings.bitrix24.howItWorksBody')} <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-gray-700 dark:text-slate-300">[PROJECT_CODE] {t('taskDrawer.title')}</code></p>
          </div>
        </section>
  )
}
