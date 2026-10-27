import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'
import { getPublicProject } from '@/api/public'
import { setPublicShare } from '@/api/client'
import { getProjectSections, type ProjectSectionCategory } from '@/constants/projectSections'
import { ProjectPermissionProvider } from '@/contexts/ProjectPermission'
import { Surface, SectionCard } from '@/components/ui/surface'
import { StatusBadge, PriorityBadge, Pill } from '@/components/ui/badges'
import PassportForm from '@/components/PassportForm'
import PassportReadOnlySections from '@/components/PassportReadOnlySections'
import type { Project } from '@/types/project'

// Те же самые вкладки, что и в обычном виде проекта — публичная страница показывает их
// «как в обычном виде», но в режиме read-only (ProjectPermissionProvider canWrite=false).
const TeamTab = lazy(() => import('@/components/tabs/TeamTab'))
const StakeholdersTab = lazy(() => import('@/components/tabs/StakeholdersTab'))
const AssumptionsTab = lazy(() => import('@/components/tabs/AssumptionsTab'))
const CommPlanTab = lazy(() => import('@/components/tabs/CommPlanTab'))
const KPIsTab = lazy(() => import('@/components/tabs/KPIsTab'))
const WBSTab = lazy(() => import('@/components/tabs/WBSTab'))
const GanttTab = lazy(() => import('@/components/tabs/GanttTab'))
const KanbanTab = lazy(() => import('@/components/tabs/KanbanTab'))
const BaselineTab = lazy(() => import('@/components/tabs/BaselineTab'))
const RisksTab = lazy(() => import('@/components/tabs/RisksTab'))
const DecisionsTab = lazy(() => import('@/components/tabs/DecisionsTab'))
const BudgetTab = lazy(() => import('@/components/tabs/BudgetTab'))
const BacklogTab = lazy(() => import('@/components/tabs/BacklogTab'))
const MeetingsTab = lazy(() => import('@/components/tabs/MeetingsTab'))
const ReportsTab = lazy(() => import('@/components/tabs/ReportsTab'))

const CATEGORY_ORDER = ['foundation', 'planning', 'control', 'reports'] as const

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <Surface className="max-w-md p-8 text-center text-sm text-slate-600 dark:text-slate-300">{children}</Surface>
    </div>
  )
}

export default function PublicProjectPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()

  // Включаем публичный режим клиента СРАЗУ (до фетчей вложенных вкладок), снимаем на размонтировании.
  if (token) setPublicShare(token)
  useEffect(() => {
    if (token) setPublicShare(token)
    return () => setPublicShare(null)
  }, [token])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public', token],
    queryFn: () => getPublicProject(token!),
    enabled: !!token,
    retry: false,
  })

  const allSections = useMemo(() => getProjectSections(t), [t])
  const publishedIds = useMemo(() => data?.sections ?? [], [data])
  const published = useMemo(
    () => allSections.filter((s) => publishedIds.includes(s.id)),
    [allSections, publishedIds],
  )
  const availableCategories = useMemo(
    () => CATEGORY_ORDER.filter((c) => published.some((s) => s.category === c)),
    [published],
  )

  const [active, setActive] = useState<string | null>(null)
  const [catState, setCatState] = useState<ProjectSectionCategory | null>(null)

  const activeId = active && published.some((s) => s.id === active) ? active : (published[0]?.id ?? null)
  const currentMeta = published.find((s) => s.id === activeId) ?? null
  const activeCategory: ProjectSectionCategory =
    catState && availableCategories.includes(catState)
      ? catState
      : (currentMeta?.category ?? availableCategories[0] ?? 'foundation')

  // Переход в раздел: и вкладка, и её категория (как при клике по табу в обычном виде).
  const goTo = (id: string) => {
    setActive(id)
    const meta = allSections.find((s) => s.id === id)
    if (meta) setCatState(meta.category)
  }

  if (isLoading) return <Centered>{t('common.loading')}</Centered>
  if (isError || !data) {
    // UX-09: полноценный public error state — заголовок, причина, действие.
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Eye size={22} className="text-slate-400 dark:text-slate-500" />
          </div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('share.linkUnavailableTitle', { defaultValue: 'Ссылка недоступна' })}
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            {t('share.linkUnavailableBody', {
              defaultValue: 'Публичный доступ по этой ссылке отключён или срок её действия истёк. Запросите новую ссылку у руководителя проекта.',
            })}
          </p>
          <a
            href="/login"
            className="mt-1 inline-flex items-center justify-center rounded-lg bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary-fg shadow-sm transition-colors hover:bg-btn-primary-hover"
          >
            {t('share.linkUnavailableCta', { defaultValue: 'Войти в портал' })}
          </a>
        </div>
      </Centered>
    )
  }

  const project = data.project
  const pid = String(project.id)

  const renderSection = (id: string) => {
    switch (id) {
      // Паспорт — тот же PassportForm, что и в обычном виде (полная «видимость» полей),
      // но не редактируемый: submit скрыт, ref не передаём, ввод отключён.
      case 'passport': return (
        <div>
          {/* pointer-events-none — гасит клики (в т.ч. по строкам списков ListItemEditor);
              fieldset disabled — блокирует ввод с клавиатуры;
              [&_button]:hidden — убирает инертные «+ Добавить»/корзину/«?», чтобы зритель
              не видел affordance редактирования. Поля при этом те же, что в обычном виде. */}
          <div className="pointer-events-none [&_button]:hidden">
            <fieldset disabled className="min-w-0">
              <PassportForm initialData={project as unknown as Project} hideSubmitButton readOnly onSubmit={async () => {}} />
            </fieldset>
          </div>
          <PassportReadOnlySections projectId={pid} only={publishedIds} onOpenSection={goTo} />
        </div>
      )
      case 'team': return <TeamTab projectId={pid} />
      case 'stakeholders': return <StakeholdersTab projectId={pid} />
      case 'assumptions': return <AssumptionsTab projectId={pid} />
      case 'comm-plan': return <CommPlanTab projectId={pid} />
      case 'kpis': return <KPIsTab projectId={pid} />
      case 'wbs': return <WBSTab projectId={pid} />
      case 'gantt': return <GanttTab key={pid} projectId={pid} />
      case 'kanban': return <KanbanTab projectId={pid} />
      case 'baseline': return <BaselineTab projectId={pid} />
      case 'risks': return <RisksTab projectId={pid} />
      case 'decisions': return <DecisionsTab projectId={pid} />
      case 'budget': return <BudgetTab projectId={pid} />
      case 'backlog': return <BacklogTab projectId={pid} />
      case 'meetings': return <MeetingsTab projectId={pid} />
      case 'reports': return <ReportsTab projectId={pid} />
      default: return null
    }
  }

  const status = String(project.status ?? '')
  const priority = String(project.priority ?? '')

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Верхняя панель: бренд + пометка «только просмотр» */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex w-full items-center justify-between gap-3 px-5 py-2.5">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">PM Tool</span>
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400">
            <Eye size={13} /> {t('share.readOnlyNote', { defaultValue: 'Только просмотр · публичная ссылка' })}
          </span>
        </div>
      </div>

      <div className="w-full min-w-0 px-5 py-6">
        {/* Заголовок проекта */}
        <div className="mb-4">
          {project.code ? <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{String(project.code)}</p> : null}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{String(project.name ?? '')}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {status && <StatusBadge status={status}>{t(`project.status.${status}`, { defaultValue: status })}</StatusBadge>}
            {priority && <PriorityBadge priority={priority}>{t(`project.priority.${priority}`, { defaultValue: priority })}</PriorityBadge>}
            {project.pm_name ? <Pill>{t('project.fields.pm', { defaultValue: 'РП' })}: {String(project.pm_name)}</Pill> : null}
            {project.client ? <Pill>{String(project.client)}</Pill> : null}
          </div>
        </div>

        {/* Навигация как в обычном виде: категории-сегменты + лента табов (только опубликованные) */}
        {published.length > 0 && (
          <div className="mb-4 flex items-center gap-2 min-w-0">
            <div className="flex shrink-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
              {availableCategories.map((group) => (
                <button
                  key={group}
                  onClick={() => setCatState(group)}
                  className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    activeCategory === group ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {t(`project.categories.${group}`, {
                    defaultValue: group === 'foundation' ? 'Foundation'
                      : group === 'planning' ? 'Planning'
                      : group === 'control' ? 'Control' : 'Reports',
                  })}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1 py-0.5">
              {published
                .filter((s) => s.category === activeCategory)
                .map((s) => {
                  const Icon = s.icon
                  const isActive = s.id === activeId
                  return (
                    <button
                      key={s.id}
                      onClick={() => goTo(s.id)}
                      title={s.displayName}
                      className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon size={12} className={isActive ? 'text-blue-600' : 'text-slate-600 dark:text-slate-400'} />
                      <span className="whitespace-nowrap">{s.displayName}</span>
                    </button>
                  )
                })}
            </div>
          </div>
        )}

        {/* Активный раздел — тот же компонент, что и в обычном виде, но read-only */}
        <SectionCard variant="default" className="min-w-0 overflow-hidden">
          <Suspense fallback={<div className="py-10 text-center text-sm text-slate-600 dark:text-slate-400">{t('common.loading')}</div>}>
            <ProjectPermissionProvider canWrite={false}>
              {activeId ? renderSection(activeId) : <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">—</p>}
            </ProjectPermissionProvider>
          </Suspense>
        </SectionCard>
      </div>
    </div>
  )
}
