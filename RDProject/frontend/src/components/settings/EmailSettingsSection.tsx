import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SmtpSettings } from '@/api/settings'

type SmtpForm = { host: string; port: string; user: string; from: string; starttls: boolean; password: string }

interface EmailSettingsSectionProps {
  t: TFunction
  testEmailAddr: string
  setTestEmailAddr: Dispatch<SetStateAction<string>>
  handleTestEmail: () => void
  testing: boolean
  emailResult: string | null
  smtpSettings: SmtpSettings | undefined
  smtp: SmtpForm
  setSmtp: Dispatch<SetStateAction<SmtpForm>>
  handleSaveSmtp: () => void
  smtpSaving: boolean
  handleClearSmtp: () => void
}

export default function EmailSettingsSection({
  t,
  testEmailAddr,
  setTestEmailAddr,
  handleTestEmail,
  testing,
  emailResult,
  smtpSettings,
  smtp,
  setSmtp,
  handleSaveSmtp,
  smtpSaving,
  handleClearSmtp,
}: EmailSettingsSectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1">{t('settings.emailNotifications')}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{t('settings.smtpConfigHelp')} <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-gray-700 dark:text-slate-300">.env</code> {t('settings.smtpConfigHelpSuffix')}</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1 max-w-xs">
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.sendTestTo')}</label>
              <input value={testEmailAddr} onChange={e => setTestEmailAddr(e.target.value)}
                placeholder={t('settings.testEmailPlaceholder')} type="email"
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" />
            </div>
            <button onClick={handleTestEmail} disabled={testing || !testEmailAddr}
              className="px-4 py-1.5 text-sm bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
              {testing ? t('settings.smtp.testing') : t('settings.sendTest')}
            </button>
          </div>
          {emailResult && (
            <p className={`mt-2 text-xs flex items-center gap-1 ${emailResult === t('settings.emailSendFailed') || emailResult === t('settings.emailError') ? 'text-red-600 dark:text-rose-300' : 'text-green-700 dark:text-green-300'}`}>
              {emailResult === t('settings.emailSendFailed') || emailResult === t('settings.emailError') ? <XCircle size={13} /> : <CheckCircle size={13} />}
              {emailResult}
            </p>
          )}

          {/* SMTP configuration form */}
          <div className="mt-4 border-t border-gray-100 dark:border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-2">{t('settings.smtp.title', { defaultValue: 'Эл. почта (SMTP)' })}</h3>
            <p className="text-xs mb-3 flex items-center gap-1.5">
              {smtpSettings?.configured ? (
                <>
                  <CheckCircle size={13} className="text-green-700 dark:text-green-300 shrink-0" />
                  <span className="text-gray-600 dark:text-slate-300">
                    {t('settings.smtp.configured', { defaultValue: 'Настроен: {{host}}', host: smtpSettings.host })}
                    {' '}
                    <span className="text-gray-500 dark:text-slate-400">
                      ({smtpSettings.source === 'env'
                        ? t('settings.smtp.sourceEnv', { defaultValue: 'источник: переменные окружения' })
                        : t('settings.smtp.sourceSettings', { defaultValue: 'источник: настройки' })})
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={13} className="text-gray-500 dark:text-slate-400 shrink-0" />
                  <span className="text-gray-500 dark:text-slate-400">{t('settings.smtp.notConfigured', { defaultValue: 'Не настроен' })}</span>
                </>
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
              <div className="sm:col-span-2">
                <label htmlFor="smtp-host" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.smtp.host', { defaultValue: 'Сервер (host)' })}</label>
                <input id="smtp-host" type="text" value={smtp.host} onChange={e => setSmtp({ ...smtp, host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label htmlFor="smtp-port" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.smtp.port', { defaultValue: 'Порт' })}</label>
                <input id="smtp-port" type="number" min={0} value={smtp.port} onChange={e => setSmtp({ ...smtp, port: e.target.value.replace(/\D/g, '') })}
                  placeholder="587"
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label htmlFor="smtp-user" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.smtp.user', { defaultValue: 'Пользователь' })}</label>
                <input id="smtp-user" type="text" autoComplete="off" value={smtp.user} onChange={e => setSmtp({ ...smtp, user: e.target.value })}
                  placeholder="you@gmail.com"
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label htmlFor="smtp-from" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.smtp.from', { defaultValue: 'Отправитель (from)' })}</label>
                <input id="smtp-from" type="text" value={smtp.from} onChange={e => setSmtp({ ...smtp, from: e.target.value })}
                  placeholder="noreply@company.com"
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label htmlFor="smtp-password" className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('settings.smtp.password', { defaultValue: 'Пароль' })}</label>
                <input id="smtp-password" type="password" autoComplete="new-password" value={smtp.password} onChange={e => setSmtp({ ...smtp, password: e.target.value })}
                  placeholder={t('settings.smtp.passwordPlaceholder', { defaultValue: 'оставьте пустым, чтобы не менять' })}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-200">
                  <input type="checkbox" checked={smtp.starttls} onChange={e => setSmtp({ ...smtp, starttls: e.target.checked })} />
                  {t('settings.smtp.starttls', { defaultValue: 'Использовать STARTTLS' })}
                </label>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <Button onClick={handleSaveSmtp} disabled={smtpSaving}>
                {smtpSaving ? t('common.saving', { defaultValue: 'Сохранение…' }) : t('settings.smtp.save', { defaultValue: 'Сохранить' })}
              </Button>
              <button
                type="button"
                onClick={handleClearSmtp}
                disabled={smtpSaving || smtpSettings?.source !== 'settings'}
                className="px-4 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {t('settings.smtp.clear', { defaultValue: 'Очистить' })}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              {t('settings.smtp.passwordHint', { defaultValue: 'Пароль хранится в зашифрованном виде и не отображается.' })}
            </p>
          </div>

          <div className="mt-4 bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3 text-xs text-gray-600 dark:text-slate-300">
            <p className="font-medium mb-1">{t('settings.requiredEnvVars')}</p>
            <code className="block text-gray-700 dark:text-slate-200">SMTP_HOST=smtp.gmail.com<br/>SMTP_PORT=587<br/>SMTP_USER=you@gmail.com<br/>SMTP_PASSWORD=your-app-password<br/>SMTP_FROM=noreply@company.com</code>
          </div>
        </section>
  )
}
