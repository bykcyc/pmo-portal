import DateInput from '@/components/ui/DateInput'
import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Copy, FileStack, FileUp, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { addSubproject, cloneProject, createProject, getProjects, getTemplates } from '@/api/projects'
import { getAdminUsers } from '@/api/users'
import { canBeProjectManager, isPortfolioManager } from '@/lib/roles'
import { bulkCreateTasks } from '@/api/tasks'
import PassportForm, { type PassportFormValues } from '@/components/PassportForm'
import ExcelImportModal from '@/components/ExcelImportModal'
import { parseExcelFile, type ParsedProject } from '@/utils/excelImport'
import { Button } from '@/components/ui/button'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { SectionCard, Surface } from '@/components/ui/surface'
import { buildProjectPayload } from '@/utils/projectPayload'
import { useToastStore } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'
import type { ReactNode } from 'react'

type CreatePath = 'wizard' | 'copy' | 'excel'
type WizardStep = 1 | 2 | 3

const inp = 'w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500'
const lbl = 'block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1'

const extractDetail = (error: unknown): string | undefined =>
  (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

// ── Path tiles ───────────────────────────────────────────────────────────────

function PathTile({ icon, title, desc, active, onClick }: {
  icon: ReactNode; title: string; desc: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40'
          : 'border-slate-200 bg-white hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-800'
      }`}
    >
      <span className={`inline-flex items-center gap-2 text-sm font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'}`}>
        {icon}
        {title}
      </span>
      <span className="text-xs text-slate-600 dark:text-slate-400">{desc}</span>
    </button>
  )
}

// ── Wizard progress (1 — 2 — 3) ──────────────────────────────────────────────

function WizardProgress({ step }: { step: WizardStep }) {
  const { t } = useTranslation()
  const labels = [
    t('wizard.step1', { defaultValue: 'Проект' }),
    t('wizard.step2', { defaultValue: 'Первые задачи' }),
    t('wizard.step3', { defaultValue: 'Готово' }),
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as WizardStep
        const done = n < step
        const active = n === step
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className={`h-px w-6 sm:w-10 ${n <= step ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`} />}
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-blue-600 text-white'
                  : active
                    ? 'border-2 border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border border-slate-300 text-slate-600 dark:text-slate-400 dark:border-slate-600'
              }`}
            >
              {done ? <Check size={12} /> : n}
            </span>
            <span className={`text-xs font-medium ${active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: minimal passport ─────────────────────────────────────────────────

function StepProject({ onCreated, onFullPassport }: {
  onCreated: (id: string) => void | Promise<void>; onFullPassport: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [pmId, setPmId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // WP2: Руководитель портфеля вправе сразу назначить РП. Список — только ему (/admin/users
  // и так закрыт для РП), выбор опционален: пусто → РП становится он сам (гард в project_create).
  const isRpp = isPortfolioManager(user)
  const { data: adminUsers = [] } = useQuery({
    queryKey: ['admin_users'], queryFn: getAdminUsers, enabled: isRpp,
  })
  const pmOptions = adminUsers.filter(canBeProjectManager)

  const submit = async () => {
    if (!name.trim() || busy) return
    // Валидация порядка дат до отправки: обе даты заданы и начало позже завершения.
    if (start && end && start > end) {
      setError(t('fix.dateOrder', { defaultValue: 'Начало не может быть позже завершения' }))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // РП = выбранный (только РПП) либо текущий пользователь; статус planning — скрытые
      // дефолты «паспорта-минимум». Финальное слово всё равно за сервером.
      const chosen = pmOptions.find((u) => u.id === pmId)
      const project = await createProject({
        name: name.trim(),
        status: 'planning',
        priority: 'medium',
        ...(chosen ? { pm_id: chosen.id } : {}),
        pm_name: chosen?.full_name ?? user?.full_name ?? null,
        planned_start: start || null,
        planned_end: end || null,
      })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await onCreated(project.id)
    } catch (err) {
      setError(extractDetail(err) || t('project.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Инлайн-подсказка о порядке дат — показывается сразу, как только даты заданы неверно.
  const dateOrderInvalid = Boolean(start && end && start > end)
  const shownError = error ?? (dateOrderInvalid
    ? t('fix.dateOrder', { defaultValue: 'Начало не может быть позже завершения' })
    : null)

  return (
    <div className="space-y-4">
      {shownError && (
        <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {shownError}
        </Surface>
      )}
      <div>
        <label className={lbl}>{t('wizard.nameLabel', { defaultValue: 'Название' }) + ' *'}</label>
        <input autoFocus maxLength={255} className={inp} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>{t('wizard.startLabel', { defaultValue: 'Плановое начало' })}</label>
          <DateInput className={inp} value={start} onChange={setStart}
                ariaLabel={t('project.fields.plannedStart', { defaultValue: 'Плановое начало' })} />
        </div>
        <div>
          <label className={lbl}>{t('wizard.endLabel', { defaultValue: 'Плановое завершение' })}</label>
          <DateInput className={inp} value={end} onChange={setEnd}
                ariaLabel={t('project.fields.plannedEnd', { defaultValue: 'Плановое завершение' })} />
        </div>
      </div>
      {isRpp && (
        <div>
          <label className={lbl} htmlFor="wizard-pm">{t('wizard.pmLabel')}</label>
          <select id="wizard-pm" className={inp} value={pmId} onChange={(e) => setPmId(e.target.value)}>
            <option value="">{t('wizard.pmSelf')}</option>
            {pmOptions.filter((u) => u.id !== user?.id).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {isRpp
          ? t('wizard.autoNoteRpp')
          : t('wizard.autoNote', { defaultValue: 'РП — вы, статус — «планирование». Всё можно уточнить позже в паспорте.' })}
      </p>
      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="button" onClick={onFullPassport} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          {t('wizard.fullPassportLink', { defaultValue: 'Нужен полный паспорт?' })}
        </button>
        <Button onClick={() => void submit()} disabled={!name.trim() || busy || dateOrderInvalid}>
          {busy ? t('wizard.creating', { defaultValue: 'Создаём…' }) : t('wizard.next', { defaultValue: 'Дальше' })}
        </Button>
      </div>
    </div>
  )
}

// ── Step 2: first tasks ──────────────────────────────────────────────────────

function StepTasks({ projectId, onDone }: { projectId: string; onDone: (count: number) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titles = text.split('\n').map((s) => s.trim()).filter(Boolean)

  const submit = async () => {
    if (titles.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await bulkCreateTasks(projectId, titles)
      await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      onDone(res.count)
    } catch (err) {
      setError(extractDetail(err) || t('project.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </Surface>
      )}
      <div>
        <label className={lbl}>{t('wizard.tasksLabel', { defaultValue: 'Перечислите 3–7 ключевых задач — по одной в строке' })}</label>
        <textarea
          autoFocus
          rows={7}
          className={inp}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('wizard.tasksPlaceholder', { defaultValue: 'Согласовать цели\nСобрать команду\nПодготовить план' })}
        />
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="button" onClick={() => onDone(0)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          {t('wizard.skip', { defaultValue: 'Пропустить' })}
        </button>
        <Button onClick={() => void submit()} disabled={titles.length === 0 || busy}>
          {busy ? t('common.saving') : t('wizard.addAndContinue', { defaultValue: 'Добавить и продолжить' })}
        </Button>
      </div>
    </div>
  )
}

// ── Step 3: done ─────────────────────────────────────────────────────────────

function StepDone({ projectId, taskCount }: { projectId: string; taskCount: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="space-y-5 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
        <Check size={24} />
      </span>
      <p className="mx-auto max-w-lg text-sm text-slate-700 dark:text-slate-200">
        {taskCount > 0
          ? t('wizard.doneSummary', {
              defaultValue: 'Проект создан: паспорт-минимум + {{count}} задач. Гант, календарь и отчёт уже собираются из них.',
              count: taskCount,
            })
          : t('wizard.doneSummaryNoTasks', {
              defaultValue: 'Проект создан: паспорт-минимум готов. Добавьте задачи в плане работ — Гант, календарь и отчёт соберутся из них.',
            })}
      </p>
      {/* Первая кнопка ведёт в САМ ПРОЕКТ (паспорт): дальше человек дозаполняет цель, сроки
          и команду, а план работ и Гант — уже следующие шаги, не первые. */}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => navigate(`/projects/${projectId}`)}>
          {t('wizard.openProject', { defaultValue: 'Открыть проект' })}
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/projects/${projectId}/wbs`)}>
          {t('wizard.openWbs', { defaultValue: 'Открыть план работ' })}
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/projects/${projectId}/gantt`)}>
          {t('wizard.openGantt', { defaultValue: 'Открыть Гант' })}
        </Button>
      </div>
    </div>
  )
}

/**
 * `?parent=<pid>` — новый проект сразу становится подпроектом этого зонтика.
 *
 * Так работает «Создать подпроект» из вкладки зонтика: иначе человек создаёт проект, уходит
 * в другой раздел, ищет «Подпроекты» в меню «Ещё» и привязывает руками — три шага там, где
 * он уже сказал, чего хочет. Привязка идёт ПОСЛЕ создания отдельным запросом: право на неё
 * проверяет сервер, и у него свои правила (owner или основной РП зонтика, ведущий ребёнка).
 *
 * Не привязалось — проект всё равно создан. Говорим об этом вслух и не откатываем: потерять
 * заведённый проект из-за неудавшейся связи было бы куда хуже.
 */
function useParentAttach() {
  const [params] = useSearchParams()
  const parentId = params.get('parent')
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const { t } = useTranslation()
  const attach = async (childId: string) => {
    if (!parentId) return
    try {
      await addSubproject(parentId, childId)
      await queryClient.invalidateQueries({ queryKey: ['subprojects', parentId] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch {
      showToast(t('project.subprojectAttachFailed', {
        defaultValue: 'Проект создан, но привязать его к зонтику не удалось — сделайте это через меню «Ещё» → «Подпроекты».',
      }), 'error', { duration: 9000 })
    }
  }
  return { parentId, attach }
}

// ── Copy an existing project ─────────────────────────────────────────────────

function CopyCard({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['projects', { page: 1, per_page: 200 }],
    queryFn: () => getProjects({ per_page: 200 }),
  })
  const projects = data?.data ?? []

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: getTemplates,
  })

  // Клон шаблона даёт обычный проект — бэкенд флаг is_template не наследует.
  const cloneFrom = async (sourceId: string) => {
    if (!sourceId || busy) return
    setBusy(true)
    setError(null)
    try {
      const project = await cloneProject(sourceId)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await onCreated(String(project.id))
      showToast(t('wizard.copySuccess', { defaultValue: 'Проект скопирован — проверьте паспорт и план' }), 'success')
      navigate(`/projects/${project.id}`)
    } catch (err) {
      setError(extractDetail(err) || t('project.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard variant="accent">
      <div className="space-y-4">
        {error && (
          <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </Surface>
        )}
        {templates.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-slate-200">
              <FileStack size={14} className="text-slate-600 dark:text-slate-400" />
              {t('wizard.templatesTitle', { defaultValue: 'Шаблоны' })}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void cloneFrom(tpl.id)}
                  title={t('wizard.templatePick', { defaultValue: 'Создать проект из шаблона' })}
                  className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-800"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <FileStack size={14} className="shrink-0 text-blue-500" />
                    <span className="min-w-0 truncate">{tpl.code ? `${tpl.code} — ${tpl.name}` : tpl.name}</span>
                  </span>
                  {tpl.pm_name && <span className="text-xs text-slate-600 dark:text-slate-400">{tpl.pm_name}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={lbl}>{t('wizard.copyLabel', { defaultValue: 'Какой проект скопировать?' })}</label>
          <select className={inp} value={selected} onChange={(e) => setSelected(e.target.value)} disabled={isLoading}>
            <option value="">{t('wizard.selectPlaceholder', { defaultValue: '— выберите проект —' })}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <Button icon={<Copy size={16} />} onClick={() => void cloneFrom(selected)} disabled={!selected || busy}>
            {busy ? t('wizard.copying', { defaultValue: 'Копируем…' }) : t('wizard.copyAction', { defaultValue: 'Скопировать' })}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Import from Excel ────────────────────────────────────────────────────────

function ExcelCard({ onParsed }: { onParsed: (data: ParsedProject) => void }) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        onParsed(await parseExcelFile(ev.target!.result as ArrayBuffer, file.name))
      } catch {
        setError(t('import.parseError'))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <SectionCard variant="accent">
      <div className="space-y-4">
        {error && (
          <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </Surface>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('wizard.excelHint', { defaultValue: 'Выберите файл .xlsx — покажем, что нашли, и создадим проект.' })}
        </p>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        <Button icon={<FileUp size={16} />} onClick={() => fileInputRef.current?.click()}>
          {t('wizard.excelButton', { defaultValue: 'Выбрать файл Excel' })}
        </Button>
      </div>
    </SectionCard>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const showToast = useToastStore((s) => s.show)
  const [path, setPath] = useState<CreatePath>('wizard')
  const [fullPassport, setFullPassport] = useState(false)
  const [step, setStep] = useState<WizardStep>(1)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [taskCount, setTaskCount] = useState(0)
  const [importData, setImportData] = useState<ParsedProject | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { parentId, attach } = useParentAttach()
  const { data: parentProject } = useQuery({
    queryKey: ['project-parent-hint', parentId],
    queryFn: () => getProjects({ per_page: 200 }).then((r) => r.data.find((p) => String(p.id) === String(parentId)) ?? null),
    enabled: Boolean(parentId),
  })

  // Fallback-режим «полный паспорт»: прежний путь создания через PassportForm.
  const handleFullSubmit = async (values: PassportFormValues) => {
    setSubmitError(null)
    try {
      const project = await createProject(buildProjectPayload(values))
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await attach(String(project.id))
      showToast(
        t('project.createdNext', { defaultValue: 'Паспорт готов. Добавьте 3–5 первых задач — Гант, календарь и отчёт соберутся из них сами.' }),
        'success',
        { duration: 8000 }
      )
      navigate(`/projects/${project.id}`)
    } catch (error) {
      setSubmitError(extractDetail(error) || t('project.saveFailed'))
    }
  }

  return (
    <PageShell className="max-w-4xl mx-auto gap-4">
      <PageHeader
        eyebrow={t('nav.projects')}
        title={t('project.list.newProject')}
        description={t('wizard.pageDescription', {
          defaultValue: 'Выберите путь: быстрый визард, копия существующего проекта или импорт из Excel.',
        })}
        actions={
          <Button icon={<ArrowLeft size={16} />} variant="secondary" onClick={() => navigate('/projects')}>
            {t('common.goBack')}
          </Button>
        }
      />

      {/* Человек пришёл сюда «создать подпроект» — и должен видеть, куда попадёт новый проект,
          ДО того как заполнит форму. Без этой строки привязка была бы невидимым сюрпризом. */}
      {parentId && (
        <Surface variant="muted" className="px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200">
          {t('project.createAsSubproject', {
            defaultValue: 'Новый проект станет подпроектом: {{parent}}',
            parent: parentProject ? `${parentProject.code} ${parentProject.name}` : parentId,
          })}
        </Surface>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <PathTile
          icon={<Sparkles size={16} />}
          title={t('wizard.pathScratch', { defaultValue: 'С нуля за 2 минуты' })}
          desc={t('wizard.pathScratchDesc', { defaultValue: 'Название и сроки — остальное подставим сами' })}
          active={path === 'wizard'}
          onClick={() => setPath('wizard')}
        />
        <PathTile
          icon={<Copy size={16} />}
          title={t('wizard.pathCopy', { defaultValue: 'Скопировать существующий проект' })}
          desc={t('wizard.pathCopyDesc', { defaultValue: 'Новый проект на основе структуры и плана существующего' })}
          active={path === 'copy'}
          onClick={() => setPath('copy')}
        />
        <PathTile
          icon={<FileUp size={16} />}
          title={t('wizard.pathExcel', { defaultValue: 'Импортировать из Excel' })}
          desc={t('wizard.pathExcelDesc', { defaultValue: 'Паспорт, план и риски из привычного файла' })}
          active={path === 'excel'}
          onClick={() => setPath('excel')}
        />
      </div>

      {path === 'wizard' && !fullPassport && (
        <SectionCard variant="accent">
          <div className="mb-6">
            <WizardProgress step={step} />
          </div>
          {step === 1 && (
            <StepProject
              onCreated={async (id) => { await attach(id); setProjectId(id); setStep(2) }}
              onFullPassport={() => setFullPassport(true)}
            />
          )}
          {step === 2 && projectId && (
            <StepTasks projectId={projectId} onDone={(count) => { setTaskCount(count); setStep(3) }} />
          )}
          {step === 3 && projectId && <StepDone projectId={projectId} taskCount={taskCount} />}
        </SectionCard>
      )}

      {path === 'wizard' && fullPassport && (
        <>
          {submitError && (
            <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {submitError}
            </Surface>
          )}
          <SectionCard variant="accent" className="overflow-hidden">
            <button
              type="button"
              onClick={() => setFullPassport(false)}
              className="mb-4 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('wizard.backToQuick', { defaultValue: '← Вернуться к быстрому созданию' })}
            </button>
            <PassportForm
              onSubmit={handleFullSubmit}
              submitLabel={t('project.createSubmit', { defaultValue: 'Создать проект' })}
            />
          </SectionCard>
        </>
      )}

      {path === 'copy' && <CopyCard onCreated={attach} />}

      {path === 'excel' && <ExcelCard onParsed={setImportData} />}
      {importData && <ExcelImportModal data={importData} onClose={() => setImportData(null)} onCreated={attach} />}
    </PageShell>
  )
}
