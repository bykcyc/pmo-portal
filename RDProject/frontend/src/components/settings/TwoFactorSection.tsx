import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { SectionCard } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'
import { getMe, disableTotp } from '@/api/auth'
import TwoFactorEnroll from '@/components/TwoFactorEnroll'

/** Секция профиля «Двухфакторная аутентификация»: включить (QR+код) или отключить (по паролю). */
export default function TwoFactorSection() {
  const { t } = useTranslation()
  const { user, setUser } = useAuthStore()
  const toast = useToastStore((s) => s.show)
  const [pw, setPw] = useState('')
  const [disabling, setDisabling] = useState(false)

  const refresh = async () => setUser(await getMe())

  const disable = async () => {
    if (!pw) return
    setDisabling(true)
    try {
      await disableTotp(pw)
      setPw('')
      toast(t('twofa.disabled', { defaultValue: 'Двухфакторная аутентификация отключена' }), 'success')
      await refresh()
    } catch {
      toast(t('twofa.wrongPassword', { defaultValue: 'Пароль неверный' }), 'error')
    } finally {
      setDisabling(false)
    }
  }

  return (
    <SectionCard title={t('twofa.title', { defaultValue: 'Двухфакторная аутентификация' })}>
      {user?.twofa_enabled ? (
        <div className="flex max-w-md flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
            <ShieldCheck size={16} /> {t('twofa.on', { defaultValue: 'Включена' })}
          </p>
          {/* Кнопка называется «Перенастроить», а не «Отключить», потому что отключить насовсем
              нельзя: двухфакторка обязательна, и портал закроется на следующем же запросе.
              Прежняя подпись обещала то, чего не бывает. */}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('twofa.disableHint', {
              defaultValue: 'Двухфакторка обязательна: после отключения портал сразу попросит настроить её заново и до этого ничего не покажет. Пользуйтесь этим при смене телефона. Подтвердите текущий пароль.',
            })}
          </p>
          <input
            type="password"
            autoComplete="current-password"
            placeholder={t('profile.currentPassword', { defaultValue: 'Текущий пароль' })}
            className="w-full max-w-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 outline-none focus:border-slate-500"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <div>
            <Button variant="secondary" icon={<ShieldOff size={14} />} onClick={disable} disabled={disabling || !pw}>
              {t('twofa.disable', { defaultValue: 'Перенастроить' })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex max-w-md flex-col gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('twofa.offHint', { defaultValue: 'Защитите вход одноразовым кодом из приложения-аутентификатора. Это обязательно.' })}
          </p>
          <TwoFactorEnroll onDone={refresh} />
        </div>
      )}
    </SectionCard>
  )
}
