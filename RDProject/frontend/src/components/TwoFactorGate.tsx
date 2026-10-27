import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, X } from 'lucide-react'
import { Surface } from '@/components/ui/surface'
import { useAuthStore } from '@/store/authStore'
import { getMe } from '@/api/auth'
import TwoFactorEnroll from '@/components/TwoFactorEnroll'

/**
 * Модалка-гейт «настройте 2FA» на уровне оболочки (Layout — только для залогиненных).
 * В пределах грейса закрываемая (напоминание после входа); после истечения грейса — блокирующая
 * (без крестика), и сервер параллельно 403-ит всё, кроме страницы настройки. Портал в body, чтобы
 * центрироваться по экрану (у сайдбара transform/backdrop-filter — свой containing-block для fixed).
 */
export default function TwoFactorGate() {
  const { t } = useTranslation()
  const { user, setUser } = useAuthStore()
  const [dismissed, setDismissed] = useState(false)

  if (!user || !user.twofa_required || user.twofa_enabled) return null

  const graceMs = user.twofa_grace_until ? new Date(user.twofa_grace_until).getTime() : null
  const expired = graceMs !== null && Date.now() > graceMs
  const daysLeft = graceMs !== null ? Math.max(0, Math.ceil((graceMs - Date.now()) / 86_400_000)) : null

  if (dismissed && !expired) return null

  const refresh = async () => setUser(await getMe()) // после включения twofa_enabled=true → гейт исчезнет
  const close = () => { if (!expired) setDismissed(true) }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <Surface className="flex w-full max-w-md flex-col gap-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} className="text-amber-500" />
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t('twofa.gateTitle', { defaultValue: 'Настройте двухфакторную аутентификацию' })}
            </h2>
          </div>
          {!expired && (
            <button
              onClick={close}
              aria-label={t('common.close', { defaultValue: 'Закрыть' })}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {expired
            ? t('twofa.gateBlocked', { defaultValue: 'Доступ к порталу заблокирован до настройки двухфакторной аутентификации.' })
            : t('twofa.gateReminder', { defaultValue: 'Это обязательно. Осталось дней: {{n}}.', n: daysLeft ?? 7 })}
        </p>
        <TwoFactorEnroll onDone={refresh} />
      </Surface>
    </div>,
    document.body,
  )
}
