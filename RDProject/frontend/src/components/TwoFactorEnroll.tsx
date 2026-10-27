import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToastStore } from '@/store/toastStore'
import { startTotpSetup, enableTotp } from '@/api/auth'
import type { TotpSetup } from '@/api/authTypes'

/**
 * Общий флоу привязки 2FA: запросить QR+секрет (setup) → ввести код из приложения → включить (enable).
 * Переиспользуется в профиле и в модалке-гейте. `onDone` вызывается после успешного включения
 * (вызывающий обычно перечитывает /me, чтобы обновить twofa_enabled в сторе).
 */
export default function TwoFactorEnroll({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const toast = useToastStore((s) => s.show)
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [starting, setStarting] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [enabling, setEnabling] = useState(false)

  const start = async () => {
    setStarting(true)
    try {
      setSetup(await startTotpSetup())
    } catch {
      toast(t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setStarting(false)
    }
  }

  const enable = async () => {
    if (enabling) return  // guard: Enter в обход disabled-кнопки не должен слать дважды
    const c = code.trim()
    if (c.length < 6 || !password) return
    setEnabling(true)
    try {
      await enableTotp(c, password)  // пароль — re-auth: чужая сессия не привяжет свой аутентификатор
      toast(t('twofa.enabled', { defaultValue: 'Двухфакторная аутентификация включена' }), 'success')
      setSetup(null)
      setCode('')
      setPassword('')
      await onDone()
    } catch {
      toast(t('twofa.wrongCode', { defaultValue: 'Неверный код' }), 'error')
    } finally {
      setEnabling(false)
    }
  }

  if (!setup) {
    return (
      <Button icon={<ShieldCheck size={14} />} onClick={start} disabled={starting}>
        {t('twofa.setUp', { defaultValue: 'Настроить 2FA' })}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('twofa.scanHint', { defaultValue: 'Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator и т.п.).' })}
      </p>
      <img
        src={setup.qr_data_uri}
        alt=""
        width={180}
        height={180}
        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-2"
      />
      <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
        {t('twofa.orEnterSecret', { defaultValue: 'Или введите ключ вручную:' })}{' '}
        <code className="font-mono text-slate-700 dark:text-slate-200">{setup.secret}</code>
      </p>
      <label className="text-sm text-slate-600 dark:text-slate-300">
        {t('twofa.enterCode', { defaultValue: 'Код из приложения' })}
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="mt-1 block w-40 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm tracking-[0.3em] text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="text-sm text-slate-600 dark:text-slate-300">
        {t('twofa.confirmPassword', { defaultValue: 'Подтвердите паролем' })}
        <input
          type="password"
          autoComplete="current-password"
          className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') enable() }}
        />
      </label>
      <div>
        <Button onClick={enable} disabled={enabling || code.trim().length < 6 || !password}>
          {t('twofa.enable', { defaultValue: 'Включить' })}
        </Button>
      </div>
    </div>
  )
}
