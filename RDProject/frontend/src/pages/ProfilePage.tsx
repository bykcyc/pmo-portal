import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, KeyRound } from 'lucide-react'
import { getMe, updateMe, changeMyPassword } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'
import { Button } from '@/components/ui/button'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { SectionCard } from '@/components/ui/surface'
import TwoFactorSection from '@/components/settings/TwoFactorSection'
import AppearanceSection from '@/components/settings/AppearanceSection'
import AgentTokensSection from '@/components/settings/AgentTokensSection'

const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 shadow-sm outline-none transition-colors focus:border-slate-500'

export default function ProfilePage() {
  const { t } = useTranslation()
  const { user, setUser } = useAuthStore()
  const toast = useToastStore((s) => s.show)
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const saveName = async () => {
    const fn = fullName.trim()
    if (!fn) return
    setSavingName(true)
    try {
      await updateMe({ full_name: fn })
      const fresh = await getMe()
      setUser(fresh)
      toast(t('profile.saved', { defaultValue: 'Профиль обновлён' }), 'success')
    } catch {
      toast(t('errors.generic', { defaultValue: 'Не удалось сохранить' }), 'error')
    } finally {
      setSavingName(false)
    }
  }

  const savePw = async () => {
    if (newPw.trim().length < 4) {
      toast(t('profile.pwTooShort', { defaultValue: 'Пароль минимум 4 символа' }), 'error')
      return
    }
    setSavingPw(true)
    try {
      await changeMyPassword(curPw, newPw.trim())
      setCurPw('')
      setNewPw('')
      toast(t('profile.pwChanged', { defaultValue: 'Пароль изменён' }), 'success')
    } catch {
      toast(t('profile.pwError', { defaultValue: 'Текущий пароль неверный' }), 'error')
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('nav.profile', { defaultValue: 'Профиль' })}
        title={t('profile.title', { defaultValue: 'Мой профиль' })}
        description={t('profile.subtitle', { defaultValue: 'Изменить отображаемое имя и пароль.' })}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title={t('profile.account', { defaultValue: 'Учётная запись' })}>
          <div className="flex max-w-md flex-col gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('profile.email', { defaultValue: 'Email' })}
              <input className={`${inputCls} bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400`} value={user?.email ?? ''} disabled />
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('profile.role', { defaultValue: 'Роль' })}
              <input className={`${inputCls} bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400`} value={user?.role ?? ''} disabled />
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('profile.fullName', { defaultValue: 'Полное имя' })}
              <input className={inputCls} value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <div>
              <Button icon={<Save size={14} />} onClick={saveName} disabled={savingName || !fullName.trim()}>
                {t('profile.save', { defaultValue: 'Сохранить' })}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title={t('profile.changePassword', { defaultValue: 'Смена пароля' })}>
          <div className="flex max-w-md flex-col gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('profile.currentPassword', { defaultValue: 'Текущий пароль' })}
              <input type="password" autoComplete="current-password" className={inputCls} value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('profile.newPassword', { defaultValue: 'Новый пароль' })}
              <input type="password" autoComplete="new-password" className={inputCls} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </label>
            <div>
              <Button icon={<KeyRound size={14} />} onClick={savePw} disabled={savingPw || !curPw || !newPw}>
                {t('profile.changePassword', { defaultValue: 'Сменить пароль' })}
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-5">
        <AppearanceSection />
      </div>

      <div className="mt-5">
        <TwoFactorSection />
      </div>

      <div className="mt-5">
        <AgentTokensSection />
      </div>
    </PageShell>
  )
}
