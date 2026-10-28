import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '@/api/client'
import { getRagSettings, putRagSettings, getWorkloadSettings, putWorkloadSettings, getBitrixSettings, setBitrixWebhook, getSmtpSettings, setSmtpSettings, type RagThresholds, type WorkloadThresholds } from '@/api/settings'
import { getPersons, createPerson, updatePerson, deletePerson, importPersonsFromBitrix24 } from '@/api/persons'
import { getUserPrefs, putUserPrefs } from '@/api/prefs'
import GeneratedPasswordDialog, { type GeneratedCreds } from '@/components/settings/GeneratedPasswordDialog'
import { getAdminUsers, createAdminUser, updateAdminUser, changeUserPassword, deleteAdminUser, resetUserTwoFa } from '@/api/users'
import type { AdminUser } from '@/api/users'
import type { Person } from '@/types/person'
import { getMe } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { TABLE_ACTION_GROUP_CLASS, TABLE_ICON_BUTTON_CLASS } from '@/components/tableStyles'
import RagSettingsSection from '@/components/settings/RagSettingsSection'
import WorkloadSettingsSection from '@/components/settings/WorkloadSettingsSection'
import UsersSection from '@/components/settings/UsersSection'
import PeopleDirectorySection from '@/components/settings/PeopleDirectorySection'
import EmailSettingsSection from '@/components/settings/EmailSettingsSection'
import BitrixSettingsSection from '@/components/settings/BitrixSettingsSection'
import SyncLogSection from '@/components/settings/SyncLogSection'
import OutboxSection from '@/components/settings/OutboxSection'
import ProblemsSection from '@/components/settings/ProblemsSection'
import AgentAdminSection from '@/components/settings/AgentAdminSection'
import type { SyncLogEntry } from '@/components/settings/settingsTypes'

async function getSyncLog(): Promise<SyncLogEntry[]> {
  const r = await api.get('/admin/bitrix24/sync-log')
  return r.data.data
}

async function testConnection(): Promise<{ connected: boolean; url?: string; error?: string }> {
  const r = await api.post('/admin/bitrix24/test-connection')
  return r.data.data
}

async function testEmail(email: string): Promise<{ sent: boolean; to: string }> {
  const r = await api.post('/admin/test-email', { to_email: email })
  return r.data.data
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [emailResult, setEmailResult] = useState<string | null>(null)
  const [connResult, setConnResult] = useState<{ connected: boolean; url?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const { data: syncLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['sync_log'], queryFn: getSyncLog, refetchInterval: 30000,
  })

  const confirm = useConfirmStore(s => s.show)
  const showToast = useToastStore(s => s.show)
  const currentUser = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)

  /* ── Users state ── */
  // Пароль живёт ТОЛЬКО здесь и только до закрытия диалога: ни в кэше, ни в localStorage.
  const [createdCreds, setCreatedCreds] = useState<GeneratedCreds | null>(null)
  const { data: adminUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['admin_users'], queryFn: getAdminUsers,
  })
  const [addUser, setAddUser] = useState<{ email: string; password: string; full_name: string; role: string; bitrix24_user_id: string } | null>(null)
  const [editUser, setEditUser] = useState<{ id: string; email: string; full_name: string; role: string; bitrix24_user_id: string; is_active: boolean } | null>(null)
  const [pwUser, setPwUser] = useState<{ id: string; name: string; pw: string } | null>(null)

  // WP2: две роли. viewer удалён — отдельная роль «только чтение» оказалась лишней.
  const ROLE_OPTIONS = [
    { value: 'owner', label: t('settings.users.roleOwner') },
    { value: 'pm', label: t('settings.users.rolePm') },
    // Руководство компании: видит все проекты, правит только свои, админки не имеет.
    { value: 'exec', label: t('settings.users.roleExec', { defaultValue: 'Руководство компании' }) },
  ]

  const handleAddUser = async () => {
    if (!addUser || !addUser.email.trim() || !addUser.password.trim() || !addUser.full_name.trim()) return
    try {
      await createAdminUser({
        email: addUser.email.trim(),
        password: addUser.password.trim(),
        full_name: addUser.full_name.trim(),
        role: addUser.role,
        bitrix24_user_id: addUser.bitrix24_user_id ? Number(addUser.bitrix24_user_id) : null,
      })
      setAddUser(null)
      qc.invalidateQueries({ queryKey: ['admin_users'] })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('settings.users.createError'), 'error')
    }
  }

  const handleEditUser = async () => {
    if (!editUser) return
    await updateAdminUser(editUser.id, {
      email: editUser.email.trim(),
      full_name: editUser.full_name.trim(),
      role: editUser.role,
      bitrix24_user_id: editUser.bitrix24_user_id ? Number(editUser.bitrix24_user_id) : null,
      is_active: editUser.is_active,
    })
    // If the edited user is the current user, refresh auth store
    if (currentUser && editUser.id === currentUser.id) {
      const freshUser = await getMe()
      setUser(freshUser)
    }
    setEditUser(null)
    qc.invalidateQueries({ queryKey: ['admin_users'] })
  }

  const handleChangePw = async () => {
    if (!pwUser || !pwUser.pw.trim()) return
    await changeUserPassword(pwUser.id, pwUser.pw.trim())
    setPwUser(null)
  }

  const handleDeleteUser = (u: AdminUser) => {
    confirm(t('settings.users.deleteConfirm'), async () => {
      await deleteAdminUser(u.id)
      qc.invalidateQueries({ queryKey: ['admin_users'] })
    })
  }

  const handleResetTwoFa = (u: AdminUser) => {
    // Для того, у кого 2FA включена, это «сброс» (потерял телефон). Для того, у кого срок
    // вышел, — «продление»: действие то же, но называть его сбросом сбивало бы с толку.
    const msg = u.twofa_enabled ? t('twofa.resetConfirm') : t('twofa.extendConfirm')
    confirm(msg, async () => {
      await resetUserTwoFa(u.id)
      qc.invalidateQueries({ queryKey: ['admin_users'] })
    })
  }

  /* ── People Directory state ── */
  const { data: persons = [], isLoading: personsLoading } = useQuery({
    queryKey: ['persons'], queryFn: () => getPersons(),
  })
  const [addRow, setAddRow] = useState<{ first_name: string; last_name: string; email: string; bitrix24_id: string } | null>(null)
  const [editRow, setEditRow] = useState<{ id: string; first_name: string; last_name: string; email: string; bitrix24_id: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  /* ── RAG thresholds state ── */
  const [rag, setRag] = useState<RagThresholds | null>(null)
  const [ragSaving, setRagSaving] = useState(false)
  const { data: ragSettings } = useQuery({ queryKey: ['rag_settings'], queryFn: getRagSettings })
  useEffect(() => {
    if (ragSettings) setRag(ragSettings)
  }, [ragSettings])

  // Пороги перегрузки: тот же приём, что и у RAG — состояние формы отдельно от загруженного.
  const [workload, setWorkload] = useState<WorkloadThresholds | null>(null)
  const [workloadSaving, setWorkloadSaving] = useState(false)
  const { data: workloadSettings } = useQuery({ queryKey: ['workload_settings'], queryFn: getWorkloadSettings })
  useEffect(() => {
    if (workloadSettings) setWorkload(workloadSettings)
  }, [workloadSettings])

  const handleSaveWorkload = async () => {
    if (!workload) return
    setWorkloadSaving(true)
    try {
      const saved = await putWorkloadSettings(workload)
      setWorkload(saved)
      qc.invalidateQueries({ queryKey: ['workload_settings'] })
      // Графики портфеля читают пороги отдельным запросом — иначе пометки останутся прежними.
      qc.invalidateQueries({ queryKey: ['pf-thresholds'] })
      qc.invalidateQueries({ queryKey: ['pf-workload'] })
      showToast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setWorkloadSaving(false)
    }
  }

  const handleSaveRag = async () => {
    if (!rag) return
    setRagSaving(true)
    try {
      const saved = await putRagSettings(rag)
      setRag(saved)
      qc.invalidateQueries({ queryKey: ['rag_settings'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
      showToast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setRagSaving(false)
    }
  }

  /* ── Bitrix24 webhook state ── */
  const { data: bitrixSettings, isLoading: bitrixLoading, isError: bitrixError } = useQuery({
    queryKey: ['bitrixSettings'], queryFn: getBitrixSettings,
  })
  const [webhookInput, setWebhookInput] = useState('')
  const [webhookSaving, setWebhookSaving] = useState(false)

  const handleSaveWebhook = async () => {
    if (!webhookInput.trim()) return
    setWebhookSaving(true)
    try {
      await setBitrixWebhook(webhookInput.trim())
      qc.invalidateQueries({ queryKey: ['bitrixSettings'] })
      setWebhookInput('')
      showToast(t('settings.bitrix.saved', { defaultValue: 'Вебхук сохранён' }), 'success')
    } catch {
      // 422 / прочие ошибки уже показываются глобальным интерсептором
    } finally {
      setWebhookSaving(false)
    }
  }

  const handleClearWebhook = () => {
    confirm(t('settings.bitrix.clearConfirm', { defaultValue: 'Очистить сохранённый вебхук и вернуться к переменной окружения?' }), async () => {
      setWebhookSaving(true)
      try {
        await setBitrixWebhook('')
        qc.invalidateQueries({ queryKey: ['bitrixSettings'] })
        setWebhookInput('')
        showToast(t('settings.bitrix.saved', { defaultValue: 'Вебхук сохранён' }), 'success')
      } catch {
        // ошибки уже показываются глобальным интерсептором
      } finally {
        setWebhookSaving(false)
      }
    }, { variant: 'primary' })
  }

  /* ── SMTP settings state ── */
  const { data: smtpSettings } = useQuery({ queryKey: ['smtpSettings'], queryFn: getSmtpSettings })
  const [smtp, setSmtp] = useState<{ host: string; port: string; user: string; from: string; starttls: boolean; password: string }>({
    host: '', port: '', user: '', from: '', starttls: true, password: '',
  })
  const [smtpSaving, setSmtpSaving] = useState(false)
  useEffect(() => {
    if (smtpSettings) {
      setSmtp({
        host: smtpSettings.host ?? '',
        port: smtpSettings.port != null ? String(smtpSettings.port) : '',
        user: smtpSettings.user ?? '',
        from: smtpSettings.from ?? '',
        starttls: smtpSettings.starttls,
        password: '',
      })
    }
  }, [smtpSettings])

  const handleSaveSmtp = async () => {
    setSmtpSaving(true)
    try {
      await setSmtpSettings({
        host: smtp.host.trim(),
        port: smtp.port.trim() ? Number(smtp.port) : null,
        user: smtp.user.trim(),
        from: smtp.from.trim(),
        // Пароль шлём только если пользователь его ввёл (иначе не меняем).
        ...(smtp.password ? { password: smtp.password } : {}),
        starttls: smtp.starttls,
      })
      qc.invalidateQueries({ queryKey: ['smtpSettings'] })
      setSmtp((s) => ({ ...s, password: '' }))
      showToast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setSmtpSaving(false)
    }
  }

  const handleClearSmtp = () => {
    confirm(t('settings.smtp.clearConfirm', { defaultValue: 'Очистить настройки SMTP и вернуться к переменным окружения?' }), async () => {
      setSmtpSaving(true)
      try {
        await setSmtpSettings({ host: '', port: null, user: '', from: '', starttls: true })
        qc.invalidateQueries({ queryKey: ['smtpSettings'] })
        showToast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
      } catch (err: unknown) {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
      } finally {
        setSmtpSaving(false)
      }
    }, { variant: 'primary' })
  }

  const handleAddPerson = async () => {
    if (!addRow || !addRow.first_name.trim() || !addRow.last_name.trim()) return
    await createPerson({
      first_name: addRow.first_name.trim(),
      last_name: addRow.last_name.trim(),
      email: addRow.email.trim() || null,
      bitrix24_id: addRow.bitrix24_id ? Number(addRow.bitrix24_id) : null,
    })
    setAddRow(null)
    qc.invalidateQueries({ queryKey: ['persons'] })
  }

  const handleEditPerson = async () => {
    if (!editRow || !editRow.first_name.trim() || !editRow.last_name.trim()) return
    await updatePerson(editRow.id, {
      first_name: editRow.first_name.trim(),
      last_name: editRow.last_name.trim(),
      email: editRow.email.trim() || null,
      bitrix24_id: editRow.bitrix24_id ? Number(editRow.bitrix24_id) : null,
    })
    setEditRow(null)
    qc.invalidateQueries({ queryKey: ['persons'] })
  }

  const handleDeletePerson = (p: Person) => {
    confirm(t('persons.deleteConfirm'), async () => {
      await deletePerson(p.id)
      qc.invalidateQueries({ queryKey: ['persons'] })
    })
  }

  // Учётка есть, если такой пользователь реально существует — сверяемся со СПИСКОМ
  // пользователей и по id, и по email. person.user_id одного не хватает: admin_users_delete
  // его не чистит, и висячая ссылка навсегда заблокировала бы кнопку.
  const hasLogin = (p: Person) => {
    const byId = p.user_id ? adminUsers.some(u => u.id === p.user_id) : false
    const byEmail = p.email ? adminUsers.some(u => u.email.toLowerCase() === p.email!.toLowerCase()) : false
    return byId || byEmail
  }

  const handleCreateLogin = async (p: Person) => {
    if (!p.email) return
    try {
      const { generatedPassword } = await createAdminUser({
        email: p.email.trim(),
        full_name: p.full_name,
        role: 'pm',                 // роль по умолчанию; поменять можно в списке пользователей
        bitrix24_user_id: p.bitrix24_id ?? null,
        person_id: p.id,            // связка обеих сторон сразу — иначе «Мои задачи» будут пусты
        generate_password: true,
      })
      qc.invalidateQueries({ queryKey: ['admin_users'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      if (generatedPassword) setCreatedCreds({ fullName: p.full_name, email: p.email, password: generatedPassword })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('settings.users.createError'), 'error')
    }
  }

  // Галочка «скрыть» переключается сразу, без режима редактирования: это одно поле, и
  // прятать его за карандашом — лишний шаг. false на сервере УДАЛЯЕТ признак (поле разрежённое).
  const handleToggleHidden = async (p: Person) => {
    await updatePerson(p.id, { hidden_from_pickers: !p.hidden_from_pickers })
    qc.invalidateQueries({ queryKey: ['persons'] })
  }

  const handleImport = async () => {
    setImporting(true); setImportMsg(null)
    try {
      const r = await importPersonsFromBitrix24()
      // complete=false → Bitrix ответил не полностью (таймаут/лимит). Синк в этом случае
      // намеренно НИКОГО не деактивирует, и человек должен об этом узнать, а не думать,
      // что справочник актуален.
      // Уволенным синк гасит и вход в портал — об этом владелец должен узнать здесь же, а не
      // случайно в списке пользователей. Отложенные (слишком много за раз) — тоже.
      const logins = [
        r.logins_deactivated ? t('persons.importLoginsOff', { n: r.logins_deactivated }) : '',
        r.logins_held ? t('persons.importLoginsHeld', { n: r.logins_held }) : '',
      ].filter(Boolean).join(' ')
      setImportMsg(r.complete
        ? [t('persons.importSuccess', { imported: r.imported, updated: r.updated,
                                        deactivated: r.deactivated, total_fetched: r.total_fetched }),
           logins].filter(Boolean).join(' ')
        : t('persons.importPartial', { total_fetched: r.total_fetched, error: r.error }))
      qc.invalidateQueries({ queryKey: ['persons'] })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setImportMsg(detail || t('persons.importError'))
    } finally { setImporting(false) }
  }

  const handleTestEmail = async () => {
    if (!testEmailAddr) return
    setTesting(true); setEmailResult(null)
    try {
      const r = await testEmail(testEmailAddr)
      setEmailResult(r.sent ? t('settings.emailSentTo', { email: r.to }) : t('settings.emailSendFailed'))
    } catch {
      setEmailResult(t('settings.emailError'))
    } finally { setTesting(false) }
  }

  const handleTestConn = async () => {
    setTesting(true); setConnResult(null)
    try {
      const r = await testConnection()
      setConnResult(r)
    } catch {
      setConnResult({ connected: false, error: t('settings.requestFailed') })
    } finally { setTesting(false) }
  }

  /**
   * Настройки разрослись до тринадцати блоков, и нужный приходилось искать прокруткой.
   * Теперь слева список разделов, справа — ОДИН выбранный. Родные заголовки блоков остаются
   * на месте: так правка аккуратная и ни один блок не переписан.
   *
   * Выбор храним в учётке (как настройки диаграмм портфеля) — админ заходит и с ноутбука,
   * и с рабочей машины, и попадает туда же, где закончил.
   */
  const SECTIONS: Array<{ id: string; label: string }> = [
    { id: 'alerts', label: t('settings.nav.alerts', { defaultValue: 'Пороги тревоги' }) },
    { id: 'users', label: t('settings.nav.users', { defaultValue: 'Пользователи' }) },
    { id: 'people', label: t('settings.nav.people', { defaultValue: 'Справочник людей' }) },
    { id: 'email', label: t('settings.nav.email', { defaultValue: 'Почта' }) },
    { id: 'bitrix', label: t('settings.nav.bitrix', { defaultValue: 'Bitrix24' }) },
    { id: 'problems', label: t('settings.nav.problems', { defaultValue: 'Сообщения о проблемах' }) },
    { id: 'agent', label: t('settings.nav.agent', { defaultValue: 'Помощник' }) },
  ]
  const { data: prefs } = useQuery({ queryKey: ['me-prefs'], queryFn: getUserPrefs, staleTime: 300_000 })
  const [tab, setTab] = useState<string | null>(null)
  useEffect(() => {
    // Пока настройки не приехали, вкладку не выбираем: иначе первый кадр покажет «Пороги»,
    // а через мгновение переключится на сохранённый раздел — мигание на ровном месте.
    if (tab === null && prefs) {
      const saved = String(prefs.settingsTab ?? '')
      setTab(SECTIONS.some((s) => s.id === saved) ? saved : SECTIONS[0].id)
    }
  }, [prefs, tab])   // eslint-disable-line react-hooks/exhaustive-deps

  const openSection = (id: string) => {
    setTab(id)
    void putUserPrefs({ settingsTab: id }).catch(() => { /* не смогли запомнить — не беда */ })
  }

  const Group = ({ id, children }: { id: string; children: ReactNode }) =>
    tab === id ? <div className="space-y-6">{children}</div> : null

  const actionCellClass = 'py-1.5 w-24'
  const actionWrapClass = TABLE_ACTION_GROUP_CLASS
  const iconButtonClass = TABLE_ICON_BUTTON_CLASS

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('nav.settings')}
        title={t('settings.title')}
        description={t('settings.subtitle')}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Список разделов: колонкой на широком экране, лентой чипов на узком. */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900 lg:sticky lg:top-4 lg:w-56 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSection(s.id)}
              aria-current={tab === s.id ? 'page' : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm lg:whitespace-normal ${
                tab === s.id
                  ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
        <Group id="alerts">
        {/* RAG thresholds */}
        <RagSettingsSection
          t={t}
          rag={rag}
          setRag={setRag}
          handleSaveRag={handleSaveRag}
          ragSaving={ragSaving}
        />

        {/* Пороги перегрузки — рядом с RAG: обе настройки про то, когда портал тревожится. */}
        <WorkloadSettingsSection
          t={t}
          workload={workload}
          setWorkload={setWorkload}
          handleSave={handleSaveWorkload}
          saving={workloadSaving}
        />

        </Group>

        <Group id="users">
        {/* Users */}
        <UsersSection
          t={t}
          addUser={addUser}
          setAddUser={setAddUser}
          editUser={editUser}
          setEditUser={setEditUser}
          pwUser={pwUser}
          setPwUser={setPwUser}
          handleChangePw={handleChangePw}
          handleAddUser={handleAddUser}
          handleEditUser={handleEditUser}
          handleDeleteUser={handleDeleteUser}
          handleResetTwoFa={handleResetTwoFa}
          usersLoading={usersLoading}
          adminUsers={adminUsers}
          ROLE_OPTIONS={ROLE_OPTIONS}
          actionCellClass={actionCellClass}
          actionWrapClass={actionWrapClass}
          iconButtonClass={iconButtonClass}
        />

        </Group>

        <Group id="people">
        {/* People Directory */}
        <PeopleDirectorySection
          t={t}
          confirm={confirm}
          qc={qc}
          persons={persons}
          personsLoading={personsLoading}
          handleImport={handleImport}
          importing={importing}
          addRow={addRow}
          setAddRow={setAddRow}
          importMsg={importMsg}
          handleAddPerson={handleAddPerson}
          editRow={editRow}
          setEditRow={setEditRow}
          handleEditPerson={handleEditPerson}
          handleDeletePerson={handleDeletePerson}
          handleToggleHidden={handleToggleHidden}
          hasLogin={hasLogin}
          handleCreateLogin={handleCreateLogin}
          actionCellClass={actionCellClass}
          actionWrapClass={actionWrapClass}
          iconButtonClass={iconButtonClass}
        />

        </Group>

        <Group id="email">
        {/* Email Settings */}
        <EmailSettingsSection
          t={t}
          testEmailAddr={testEmailAddr}
          setTestEmailAddr={setTestEmailAddr}
          handleTestEmail={handleTestEmail}
          testing={testing}
          emailResult={emailResult}
          smtpSettings={smtpSettings}
          smtp={smtp}
          setSmtp={setSmtp}
          handleSaveSmtp={handleSaveSmtp}
          smtpSaving={smtpSaving}
          handleClearSmtp={handleClearSmtp}
        />

        {/* Журнал писем: если SMTP не настроен, туда падает ВСЁ — это единственное место,
            где видно, какие письма портал шлёт и кому. */}
        <OutboxSection />

        </Group>

        <Group id="bitrix">
        {/* Bitrix24 Settings */}
        <BitrixSettingsSection
          t={t}
          handleTestConn={handleTestConn}
          testing={testing}
          connResult={connResult}
          bitrixLoading={bitrixLoading}
          bitrixError={bitrixError}
          bitrixSettings={bitrixSettings}
          webhookInput={webhookInput}
          setWebhookInput={setWebhookInput}
          handleSaveWebhook={handleSaveWebhook}
          webhookSaving={webhookSaving}
          handleClearWebhook={handleClearWebhook}
        />


        {/* Sync Log */}
        <SyncLogSection
          t={t}
          qc={qc}
          syncLog={syncLog}
          logLoading={logLoading}
        />

        </Group>

        <Group id="problems">
        {/* «Сообщить о проблеме» (F6): баг-репорты пользователей — просмотр скрина + удаление. */}
        <ProblemsSection />

        </Group>

        <Group id="agent">
        {/* Токены помощников и журнал их обращений — единственное место, где видно объём. */}
        <AgentAdminSection />

        </Group>
        </div>
      </div>
      {createdCreds && (
        <GeneratedPasswordDialog creds={createdCreds} onClose={() => setCreatedCreds(null)} />
      )}
    </PageShell>
  )
}
