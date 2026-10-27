import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { login, getMe, verifyLoginTotp } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const navigate = useNavigate()
  // Адрес, с которого человека завернули на вход (см. ProtectedRoute). Пусто — обычный вход.
  const backTo = (useLocation().state as { from?: string } | null)?.from
  // Экран входа — ДО выбора языка пользователем, поэтому всегда на английском (нейтральный
  // дефолт). getFixedT('en') берёт те же ключи из en.json, строки не хардкодим.
  const { i18n } = useTranslation()
  const t = i18n.getFixedT('en')
  const { setToken, setUser } = useAuthStore()
  const [serverError, setServerError] = useState<string | null>(null)
  // Второй шаг 2FA. challenge держим ЛОКАЛЬНО, НЕ в сторе: иначе интерсептор подставит его как
  // Bearer, а 401 на неверный код разлогинит вместо показа «неверный код».
  const [step, setStep] = useState<'creds' | 'totp'>('creds')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const finish = async (accessToken: string) => {
    setToken(accessToken)
    const me = await getMe()
    setUser(me)
    navigate(backTo || '/projects')
  }

  const onSubmit = async (data: LoginForm) => {
    setServerError(null)
    try {
      const res = await login(data)
      if (res.twofa_required && res.challenge) {
        setChallenge(res.challenge)
        setStep('totp')
        setCode('')
        return
      }
      if (res.access_token) await finish(res.access_token)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 429) setServerError(t('auth.tooManyAttempts', { defaultValue: 'Слишком много попыток, подождите минуту' }))
      else if (status === 401) setServerError(t('auth.invalidCredentials'))
      else setServerError(t('auth.loginError'))
    }
  }

  const onVerify = async () => {
    if (verifying) return  // guard: Enter в обход disabled-кнопки не должен слать дважды
    const c = code.trim()
    if (c.length < 6) return
    setServerError(null)
    setVerifying(true)
    try {
      const res = await verifyLoginTotp(challenge, c)
      await finish(res.access_token)
    } catch (err: unknown) {
      const resp = (err as { response?: { status?: number; data?: { detail?: string } } })?.response
      const status = resp?.status
      const detail = resp?.data?.detail
      if (status === 401 && typeof detail === 'string' && /истек|expired/i.test(detail)) {
        // challenge протух (5 мин) — вернуть на шаг пароля, а не твердить «неверный код»
        setStep('creds')
        setChallenge('')
        setCode('')
        setServerError(t('twofa.sessionExpired', { defaultValue: 'Сессия входа истекла, войдите заново' }))
      } else if (status === 429) {
        setServerError(t('auth.tooManyAttempts', { defaultValue: 'Слишком много попыток, подождите минуту' }))
      } else {
        setServerError(t('twofa.wrongCode', { defaultValue: 'Неверный код' }))
      }
    } finally {
      setVerifying(false)
    }
  }

  const backToCreds = () => {
    setStep('creds')
    setChallenge('')
    setCode('')
    setServerError(null)
  }

  const errorBanner = serverError && (
    <div
      className="rounded-md bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-900 px-4 py-3"
      role="alert"
      aria-live="polite"
    >
      <p className="text-sm text-red-700 dark:text-rose-300">{serverError}</p>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-800/60">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{t('appName')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{t('auth.signInToAccount')}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-8">
          {step === 'creds' ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t('auth.email')}
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('auth.emailPlaceholder')}
                  aria-invalid={errors.email ? 'true' : 'false'}
                  aria-describedby={errors.email ? 'login-email-error' : undefined}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  {...register('email')}
                />
                {errors.email && (
                  <p id="login-email-error" className="mt-1 text-xs text-red-600 dark:text-rose-300">
                    {t('auth.emailRequired')}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t('auth.password')}
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('auth.passwordPlaceholder')}
                  aria-invalid={errors.password ? 'true' : 'false'}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  {...register('password')}
                />
                {errors.password && (
                  <p id="login-password-error" className="mt-1 text-xs text-red-600 dark:text-rose-300">
                    {t('auth.passwordRequired')}
                  </p>
                )}
              </div>

              {errorBanner}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-btn-primary hover:bg-btn-primary-hover disabled:opacity-50 text-btn-primary-fg text-sm font-semibold rounded-md transition-colors"
              >
                {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <label htmlFor="login-totp" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t('twofa.loginTitle', { defaultValue: 'Код подтверждения' })}
                </label>
                <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                  {t('twofa.loginPrompt', { defaultValue: 'Введите 6-значный код из приложения-аутентификатора.' })}
                </p>
                <input
                  id="login-totp"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  aria-label={t('twofa.loginTitle', { defaultValue: 'Код подтверждения' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') onVerify() }}
                />
              </div>

              {errorBanner}

              <button
                type="button"
                onClick={onVerify}
                disabled={verifying || code.trim().length < 6}
                className="w-full py-2.5 px-4 bg-btn-primary hover:bg-btn-primary-hover disabled:opacity-50 text-btn-primary-fg text-sm font-semibold rounded-md transition-colors"
              >
                {verifying ? t('auth.signingIn') : t('twofa.verify', { defaultValue: 'Подтвердить' })}
              </button>
              <button
                type="button"
                onClick={backToCreds}
                className="w-full text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              >
                {t('common.back', { defaultValue: 'Назад' })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
