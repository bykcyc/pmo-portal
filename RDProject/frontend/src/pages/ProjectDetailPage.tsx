import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, FileDown, History, Lock, Maximize2, Minimize2, RefreshCw, Share2, X } from 'lucide-react'
import { getProject, getProjectEditors, getProjectSummary, updateProject, syncBitrix, closeProjectVersion } from '@/api/projects'
import { showsSubprojectsTab } from '@/lib/projectRole'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'
import { formatDateTime } from '@/utils/date'
import { getTeam, getStakeholders } from '@/api/team'
import { getKPIs } from '@/api/kpi'
import { getBudgetSummary } from '@/api/budget'
import PassportForm, { type PassportFormValues, type PassportFormHandle } from '@/components/PassportForm'
import PassportReadOnlySections from '@/components/PassportReadOnlySections'
import ActionLogPanel from '@/components/ActionLogPanel'
import SectionAdvisor from '@/components/SectionAdvisor'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideDefinition, GuideStep } from '@/components/ProcessGuide'
import { getProjectSections, type ProjectSectionCategory } from '@/constants/projectSections'
import { Button } from '@/components/ui/button'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { Pill, PriorityBadge, StatusBadge } from '@/components/ui/badges'
import { SectionCard, Surface } from '@/components/ui/surface'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProjectFieldChange } from '@/types/project'
import { buildProjectPayload, hasProjectListContent } from '@/utils/projectPayload'
import { pushRecentProject } from '@/utils/recentProjects'
import { useExportStore } from '@/store/exportStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'
import { ProjectPermissionProvider, computeCanWrite } from '@/contexts/ProjectPermission'
import ShareDialog from '@/components/ShareDialog'
import { CoEditorsDialog, ProjectActionsMenu, TransferDialog } from '@/components/project/ProjectHeaderDialogs'
import { SubprojectsDialog } from '@/components/project/SubprojectsDialog'
import { canCreateProject } from '@/lib/roles'

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
const SubprojectsTab = lazy(() => import('@/components/tabs/SubprojectsTab'))

function SectionFallback() {
  const { t } = useTranslation()
  return (
    <Surface className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-sm text-slate-600 dark:text-slate-400">
      <Skeleton className="h-8 w-8 rounded-full" />
      <span>{t('common.loading')}</span>
    </Surface>
  )
}

function PassportSection({
  id,
  project,
  onOpenSection,
  canWrite,
}: {
  id: string
  project: Awaited<ReturnType<typeof getProject>>
  onOpenSection: (key: string) => void
  /** Автосохранение включаем только тому, кто вправе писать: у читателя запрос вернул бы 403. */
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [saveError, setSaveError] = useState<string | null>(null)
  const passportRef = useRef<PassportFormHandle>(null)
  const [fixing, setFixing] = useState(false)
  const showToast = useToastStore((st) => st.show)

  const handleFixVersion = async () => {
    setFixing(true)
    try {
      const r = await closeProjectVersion(id)
      await queryClient.invalidateQueries({ queryKey: ['project', id] })
      showToast(t('project.versionFixed', { defaultValue: 'Версия {{v}} зафиксирована', v: r.version || '—' }), 'success')
    } catch {
      showToast(t('common.error', { defaultValue: 'Что-то пошло не так' }), 'error')
    } finally {
      setFixing(false)
    }
  }
  const pdfRef = useRef<HTMLDivElement>(null)
  const guideSteps: GuideStep[] = [
    { title: t('project.passportGuide.s1'), desc: t('project.passportGuide.s1d') },
    { title: t('project.passportGuide.s2'), desc: t('project.passportGuide.s2d') },
    { title: t('project.passportGuide.s3'), desc: t('project.passportGuide.s3d') },
    { title: t('project.passportGuide.s4'), desc: t('project.passportGuide.s4d') },
    { title: t('project.passportGuide.s5'), desc: t('project.passportGuide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('project.passportDefinitions.status'), desc: t('project.passportDefinitions.statusDesc') },
    { term: t('project.passportDefinitions.priority'), desc: t('project.passportDefinitions.priorityDesc') },
    { term: t('project.passportDefinitions.client'), desc: t('project.passportDefinitions.clientDesc') },
    { term: t('project.passportDefinitions.pm'), desc: t('project.passportDefinitions.pmDesc') },
  ]

  const handleSubmit = async (values: PassportFormValues, changed?: ProjectFieldChange[]) => {
    setSaveError(null)
    const payload: Record<string, unknown> = buildProjectPayload(values)
    if (changed && changed.length > 0) {
      payload.bump_version = true
      payload.changed_fields = changed
    }
    try {
      await updateProject(id, payload)
      await queryClient.invalidateQueries({ queryKey: ['project', id] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch (err) {
      setSaveError(t('project.saveFailed'))
      // Ошибку ОБЯЗАТЕЛЬНО пробрасываем. Раньше её глотали, и PassportForm.saveInternal видел
      // успешный промис: снимал флаг «есть изменения» и показывал «сохранено», хотя запрос упал.
      // Правки при этом жили только в форме и терялись при первом же уходе со страницы —
      // молча, без единого признака. А «Сохранить и уйти» на этом уводило бы со страницы,
      // выбрасывая данные.
      throw err
    }
  }

  return (
    <div className="flex gap-6">
      <div ref={pdfRef} data-print-root className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print-hide">
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <div className="flex flex-wrap justify-end gap-2 ml-auto">
          {/* Кнопки «Сохранить паспорт» больше нет: паспорт сохраняется сам, а состояние
              «изменено, но не сохранено» вместе с ней исчезло — с ним ушли и вопросы при уходе,
              и девять дефектов потери данных, которые из них росли. Что происходит с записью,
              показывает индикатор внутри формы.
              Здесь — другое действие: зафиксировать версию. Номер перестаёт меняться, следующая
              правка уйдёт в новый. Без этого напечатанный 1.0003 продолжал бы впитывать правки,
              и через час это был бы другой документ под тем же номером. */}
          {canWrite && (
            <Button size="sm" variant="secondary" icon={<Lock size={14} />} disabled={fixing} onClick={handleFixVersion}>
              {t('project.fixVersion', { defaultValue: 'Зафиксировать версию' })}
            </Button>
          )}
          <Button
            size="sm"
            icon={<FileDown size={14} />}
            variant="secondary"
            /* Печать паспорта: нативный print → «Сохранить как PDF». Векторно, поля не режутся
               по границе страницы (в отличие от html2canvas-картинки, которая рвала окна и весила
               десятки МБ). @media print изолирует паспорт и раскрывает свёрнутые списки. */
            onClick={() => window.print()}
          >
            PDF
          </Button>
          </div>
        </div>
        {saveError && (
          <Surface className="mb-4 border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            {saveError}
          </Surface>
        )}
        <PassportForm
          ref={passportRef}
          initialData={project}
          onSubmit={handleSubmit}
          hideSubmitButton
          autoSave={canWrite}
          readOnly={!canWrite}
        />
        {/* onOpenSection обязателен: без него «Открыть →» внутри паспорта звал navigate()
            напрямую, мимо проверки несохранённого — самый частый способ потерять правки. */}
        <PassportReadOnlySections projectId={id} onOpenSection={onOpenSection} />
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { id, section } = useParams<{ id: string; section?: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const sections = getProjectSections(t)
  const validSections = sections.map((sectionMeta) => sectionMeta.id)
  const currentSectionMeta = sections.find((sectionMeta) => sectionMeta.id === section) ?? sections[0]

  const [activeCategory, setActiveCategory] = useState(currentSectionMeta.category)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showCoEditors, setShowCoEditors] = useState(false)
  const [showObservers, setShowObservers] = useState(false)
  const [showSubprojects, setShowSubprojects] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showActionLog, setShowActionLog] = useState(false)
  const [bitrixSyncing, setBitrixSyncing] = useState(false)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)

  const { rightPanelCollapsed, focusMode, toggleFocusMode, setSidebarCollapsed } = useUIStore()
  const currentUser = useAuthStore((s) => s.user)
  // ВАЖНО: подписка на store — ДО ранних return'ов (isLoading/redirect), иначе
  // «Rendered more hooks than during the previous render».
  const hasSectionExport = useExportStore((s) => !!s.current)
  const rightHidden = rightPanelCollapsed || focusMode
  useEffect(() => {
    if (focusMode) setSidebarCollapsed(true)
  }, [focusMode, setSidebarCollapsed])

  // UX-04: запоминаем посещённый проект для «недавних» в сайдбаре.
  useEffect(() => {
    if (id && currentUser?.id) pushRecentProject(currentUser.id, id)
  }, [id, currentUser?.id])

  const { data: project, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id!),
    enabled: !!id,
  })
  const { data: summary } = useQuery({
    queryKey: ['project', id, 'summary'],
    queryFn: () => getProjectSummary(id!),
    enabled: !!id,
  })
  const { data: team = [] } = useQuery({
    queryKey: ['team', id],
    queryFn: () => getTeam(id!),
    enabled: !!id,
  })
  // Для чеклиста «Прогресс подготовки» (те же ключи, что у вкладок — кэш общий).
  const { data: stakeholders = [] } = useQuery({ queryKey: ['stakeholders', id], queryFn: () => getStakeholders(id!), enabled: !!id })
  const { data: kpis = [] } = useQuery({ queryKey: ['kpis', id], queryFn: () => getKPIs(id!), enabled: !!id })
  const { data: budgetSummary } = useQuery({ queryKey: ['budget_summary', id], queryFn: () => getBudgetSummary(id!), enabled: !!id })

  // Зеркало серверного `_owns_item`: править проект может только его РП (и со-РП).
  // Считаем ЗДЕСЬ, до эффектов ниже: фоновой записи нельзя случиться у того, кто читает.
  const canWrite = computeCanWrite(currentUser, project)

  // F5.2: PULL-синк статусов задач из Bitrix при ОТКРЫТИИ проекта. Сервер троттлит до раза в 15 мин,
  // поэтому дёргаем без force на каждом заходе — лишнего не сделает. Тихо глотаем ошибку: Bitrix
  // может быть не настроен/недоступен — это фоновая любезность, а не действие пользователя.
  //
  // Только тем, кто может писать. Синк — ЗАПИСЬ, и у читателя (наблюдатель, руководство) он
  // отвечал 403, а интерсептор показывал красный тост «PM может изменять только свои проекты» —
  // дважды на каждый заход в раздел. Человек ничего не делал, а портал ругался.
  useEffect(() => {
    if (!id || !canWrite) return
    syncBitrix(id, false).then((r) => {
      if (r.updated > 0) {
        void invalidateProjectTasks(queryClient, id)
        queryClient.invalidateQueries({ queryKey: ['gantt', id] })
        queryClient.invalidateQueries({ queryKey: ['project', id] })
      }
      // Совещание могли отвязать здесь же — список протоколов обязан это показать.
      if ((r.meetings_unlinked ?? 0) > 0) queryClient.invalidateQueries({ queryKey: ['meetings', id] })
    }).catch(() => { /* Bitrix не настроен/недоступен — молча */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canWrite])

  const handleBitrixSync = async () => {
    if (!id) return
    setBitrixSyncing(true)
    try {
      const r = await syncBitrix(id, true)   // кнопка — в обход троттла
      // Синхронизация теперь сверяет и совещания: событие, удалённое в Bitrix, отвязывается.
      // Про это надо сказать вслух — иначе отметка «✓ Bitrix» исчезает молча и выглядит сбоем.
      const gone = r.meetings_unlinked ?? 0
      showToast(t('bitrixSync.done', { defaultValue: 'Синхронизация с Bitrix: обновлено {{n}}', n: r.updated })
        + (gone > 0 ? '. ' + t('bitrixSync.meetingsUnlinked', { defaultValue: 'Совещаний отвязано: {{n}} (события удалены в Bitrix)', n: gone }) : ''), 'success')
      if (r.updated > 0) {
        await invalidateProjectTasks(queryClient, id)
        queryClient.invalidateQueries({ queryKey: ['gantt', id] })
      }
      if (gone > 0) queryClient.invalidateQueries({ queryKey: ['meetings', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })   // обновить дату последней синхронизации
    } catch {
      showToast(t('bitrixSync.error', { defaultValue: 'Bitrix недоступен или не настроен' }), 'error')
    } finally {
      setBitrixSyncing(false)
    }
  }
  // Со-руководители проекта: показываем их имена в шапке всем (read-only бейджи).
  const hasEditors = !!project?.editors && project.editors.length > 0
  const { data: coEditors = [] } = useQuery({
    queryKey: ['project-editors', id],
    queryFn: () => getProjectEditors(id!),
    enabled: !!id && hasEditors,
  })

  useEffect(() => {
    setActiveCategory(currentSectionMeta.category)
  }, [currentSectionMeta.category])

  if (!section) {
    return <Navigate to={`/projects/${id}/passport`} replace />
  }

  if (isLoading) {
    return (
      <PageShell>
        <Surface className="flex min-h-48 items-center justify-center p-8 text-sm text-slate-600 dark:text-slate-400">
          {t('project.loadingProject')}
        </Surface>
      </PageShell>
    )
  }

  if (isError || !project) {
    // UX-07: различаем 403 (чужой проект / нет прав), 404 (не существует) и сбой загрузки.
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    const isForbidden = status === 403
    const isMissing = status === 404
    const isLoadError = !isForbidden && !isMissing
    const message = isForbidden
      ? t('project.forbidden', { defaultValue: 'У вас нет доступа к этому проекту. Он принадлежит другому руководителю.' })
      : isMissing
        ? t('project.missing', { defaultValue: 'Проект не найден — возможно, он был удалён.' })
        : t('project.loadError', { defaultValue: 'Не удалось загрузить проект. Проверьте связь и повторите.' })
    return (
      <PageShell>
        <Surface className="flex flex-col items-start gap-3 border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-6 text-sm text-rose-700 dark:text-rose-300">
          <p>{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/projects')}>
              {t('common.toProjects', { defaultValue: 'К проектам' })}
            </Button>
            {isLoadError && (
              <Button variant="ghost" onClick={() => refetch()}>
                {t('common.retry', { defaultValue: 'Повторить' })}
              </Button>
            )}
          </div>
        </Surface>
      </PageShell>
    )
  }

  const navigateToSection = (targetSection: string) => {
    // Спрашивать перед уходом больше нечего: паспорт сохраняется сам.
    navigate(`/projects/${project.id}/${targetSection}`)
  }

  /** Разделы категории — ровно те, что человек увидит в ленте. Один список на ленту и на
   *  переход по клику: иначе категория могла бы открыть раздел, которого в ленте нет. */
  const sectionsOf = (category: ProjectSectionCategory) => sections
    .filter((sectionMeta) => sectionMeta.category === category)
    // Прямая ссылка при этом работает — открывается пустое состояние с объяснением.
    .filter((sectionMeta) => sectionMeta.id !== 'subprojects'
      || showsSubprojectsTab(project, canManageCoEditors))

  /**
   * Клик по категории открывает её первый раздел.
   *
   * Раньше он только менял ленту, и человек оставался на прежней странице: нажал «Контроль»,
   * а на экране по-прежнему паспорт — выглядело так, будто кнопка не сработала. Если человек
   * уже внутри этой категории, никуда не уводим: он там работает.
   */
  const openCategory = (category: ProjectSectionCategory) => {
    setActiveCategory(category)
    if (currentSectionMeta.category === category) return
    const first = sectionsOf(category)[0]
    if (first) navigateToSection(first.id)
  }

  // Чеклист по методологии: «Паспорт + WBS = достаточно для старта; Команда + Риски — вторым шагом».
  const setupGroups = [
    {
      title: t('project.setup.startGroup', { defaultValue: 'Для старта' }),
      pendingLabel: t('project.setup.nextStep', { defaultValue: 'Следующий шаг' }),
      pendingClass: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
      items: [
        {
          section: 'passport',
          label: t('project.setup.passport', { defaultValue: 'Passport captured' }),
          done: Boolean(hasProjectListContent(project.goal) && project.planned_end && (project.pm_name || project.pm?.full_name)),
          note: t('project.setup.passportNote', { defaultValue: 'Goal, owner, and target end date are defined.' }),
        },
        {
          section: 'wbs',
          label: t('project.setup.plan', { defaultValue: 'Work plan added' }),
          done: (summary?.tasks_total ?? 0) > 0,
          note: t('project.setup.planNote', { defaultValue: '{{count}} tasks are currently in the work breakdown.', count: summary?.tasks_total ?? 0 }),
        },
      ],
    },
    {
      title: t('project.setup.laterGroup', { defaultValue: 'Дальше' }),
      pendingLabel: t('project.setup.later', { defaultValue: 'позже' }),
      pendingClass: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
      items: [
        {
          section: 'team',
          label: t('project.setup.team', { defaultValue: 'Команда' }),
          done: team.length > 0,
          note: t('project.setup.teamNote', { defaultValue: '{{count}} человек в команде.', count: team.length }),
        },
        {
          section: 'stakeholders',
          label: t('project.setup.stakeholders', { defaultValue: 'Стейкхолдеры' }),
          done: stakeholders.length > 0,
          note: t('project.setup.stakeholdersNote', { defaultValue: '{{count}} в списке стейкхолдеров.', count: stakeholders.length }),
        },
        {
          section: 'risks',
          label: t('project.setup.risks', { defaultValue: 'Risk register started' }),
          done: (summary?.risks_open ?? 0) > 0,
          note: t('project.setup.risksNote', { defaultValue: '{{count}} open risks are tracked right now.', count: summary?.risks_open ?? 0 }),
        },
        {
          section: 'kpis',
          label: t('project.setup.kpis', { defaultValue: 'KPI' }),
          done: kpis.length > 0,
          note: t('project.setup.kpisNote', { defaultValue: '{{count}} KPI заданы.', count: kpis.length }),
        },
        {
          section: 'budget',
          label: t('project.setup.budget', { defaultValue: 'Бюджет' }),
          done: (budgetSummary?.total_planned ?? 0) > 0,
          note: t('project.setup.budgetNote', { defaultValue: 'Бюджет проекта заложен.' }),
        },
      ],
    },
  ]

  const renderSection = () => {
    if (!validSections.includes(section as typeof validSections[number])) {
      return <Navigate to={`/projects/${id}/passport`} replace />
    }

    switch (section) {
      case 'passport': return <PassportSection id={id!} project={project} onOpenSection={navigateToSection} canWrite={canWrite} />
      case 'team': return <TeamTab projectId={id!} />
      case 'stakeholders': return <StakeholdersTab projectId={id!} />
      case 'assumptions': return <AssumptionsTab projectId={id!} />
      case 'comm-plan': return <CommPlanTab projectId={id!} />
      case 'kpis': return <KPIsTab projectId={id!} />
      case 'wbs': return <WBSTab projectId={id!} />
      case 'gantt': return <GanttTab key={id} projectId={id!} />
      case 'kanban': return <KanbanTab projectId={id!} />
      case 'baseline': return <BaselineTab projectId={id!} />
      case 'risks': return <RisksTab projectId={id!} />
      case 'decisions': return <DecisionsTab projectId={id!} />
      case 'budget': return <BudgetTab projectId={id!} />
      case 'backlog': return <BacklogTab projectId={id!} />
      case 'meetings': return <MeetingsTab projectId={id!} />
      case 'reports': return <ReportsTab projectId={id!} />
      case 'subprojects': return <SubprojectsTab projectId={id!} canManage={canManageCoEditors && !project.parent_id} />
      default: return <Navigate to={`/projects/${id}/passport`} replace />
    }
  }

  const isOwner = currentUser?.role === 'owner'
  // Управлять со-РП может owner или основной РП этого проекта. Роль основного РП — не только
  // `pm`: сервер (`_is_primary_pm_or_owner`) пускает любого из WRITE_ROLES, чей id стоит в
  // pm_id, то есть и руководство компании (exec). Здесь стояло строгое `=== 'pm'`, и у exec
  // собственный проект оставался без управления со-РП, наблюдателями и подпроектами.
  const canManageCoEditors = isOwner
    || ((currentUser?.role === 'pm' || currentUser?.role === 'exec') && project.pm_id === currentUser.id)
  // Отдать проект может владелец портфеля или ОСНОВНОЙ РП этого проекта — ровно то же условие,
  // что на сервере (projects_routes._may_transfer). Со-РП сюда не входит намеренно: он назначил
  // бы основным РП себя и запер прежнего.
  const isPrimaryPm = !!project.pm_id && project.pm_id === currentUser?.id
  const canTransfer = isOwner || isPrimaryPm
  const canClone = canCreateProject(currentUser)  // WP2: viewer удалён; клонируют оба руководителя
  const canArchive = isOwner || canWrite

  return (
    <PageShell className="max-w-none gap-4">
      {/* Хлебные крошки: Портфель / {код} / {секция} */}
      <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 print-hide">
        <Link to="/portfolio" className="hover:text-slate-600 dark:hover:text-slate-300 hover:underline">
          {t('project.breadcrumbPortfolio', { defaultValue: 'Портфель' })}
        </Link>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <Link to={`/projects/${project.id}`} className="font-mono hover:text-slate-600 dark:hover:text-slate-300 hover:underline">
          {project.code}
        </Link>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="text-slate-600 dark:text-slate-400">{currentSectionMeta.displayName}</span>
      </nav>

      <PageHeader
        eyebrow={project.code}
        title={project.name}
        description={(
          <div className="mt-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={project.status}>{t(`project.status.${project.status}`)}</StatusBadge>
              <PriorityBadge priority={project.priority}>{t(`project.priority.${project.priority}`)}</PriorityBadge>
              {(project.pm_name || project.pm) && <Pill>{t('project.fields.pm')}: {project.pm_name || project.pm?.full_name}</Pill>}
              {/* Подпроект обязан говорить, чей он: иначе человек, попавший сюда по ссылке от
                  соседа, не поймёт, почему видит проект, к которому его не назначали. */}
              {project.parent_id && (
                <Link to={`/projects/${project.parent_id}/subprojects`}>
                  <Pill className="bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:underline">
                    {t('project.partOf', { defaultValue: 'Часть проекта' })}: {project.parent_code} {project.parent_name}
                  </Pill>
                </Link>
              )}
              {(project.subprojects_count ?? 0) > 0 && (
                <Link to={`/projects/${project.id}/subprojects`}>
                  <Pill className="bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:underline">
                    {t('project.umbrellaPill', { defaultValue: 'Зонтик · {{n}}', n: project.subprojects_count })}
                  </Pill>
                </Link>
              )}
              {hasEditors && coEditors.length > 0 && (
                <>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">
                    {t('project.coEditors', { defaultValue: 'Со-РП' })}:
                  </span>
                  {coEditors.map((editor) => (
                    <Pill key={editor.id} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">{editor.full_name}</Pill>
                  ))}
                </>
              )}
            </div>
            {!focusMode && (
              <div className="max-w-4xl rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5">
                <p className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
                  <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-slate-300 dark:bg-slate-700" />
                  <span className="min-w-0">{currentSectionMeta.helpText}</span>
                </p>
              </div>
            )}
          </div>
        )}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2 print-hide">
            {(isOwner || canWrite) && (
              <Button
                size="sm"
                variant={showActionLog ? 'primary' : 'secondary'}
                icon={<History size={14} />}
                onClick={() => setShowActionLog((value) => !value)}
              >
                {t('actionLog.nav', { defaultValue: 'Журнал действий' })}
              </Button>
            )}
            {canTransfer && (
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowRightLeft size={14} />}
                onClick={() => setShowTransfer(true)}
              >
                {t('project.transfer', { defaultValue: 'Передать РП' })}
              </Button>
            )}
            {canManageCoEditors && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Share2 size={14} />}
                onClick={() => setShowShare(true)}
              >
                {t('share.button', { defaultValue: 'Поделиться' })}
              </Button>
            )}
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={14} className={bitrixSyncing ? 'animate-spin' : ''} />}
                onClick={handleBitrixSync}
                disabled={bitrixSyncing}
                title={project?.bitrix_last_sync
                  ? t('bitrixSync.last', { defaultValue: 'Последняя синхронизация: {{d}}', d: formatDateTime(project.bitrix_last_sync) })
                  : t('bitrixSync.never', { defaultValue: 'Ещё не синхронизировано с Bitrix' })}
              >
                {t('bitrixSync.button', { defaultValue: 'Синхр. с Bitrix' })}
              </Button>
            )}
            {(canArchive || canClone || canManageCoEditors || hasSectionExport) && (
              <ProjectActionsMenu
                project={project}
                canArchive={canArchive}
                canClone={canClone}
                canManageCoEditors={canManageCoEditors}
                onCoEditors={() => setShowCoEditors(true)}
                onObservers={() => setShowObservers(true)}
                onSubprojects={() => setShowSubprojects(true)}
                isSubproject={Boolean(project.parent_id)}
              />
            )}
            <Button
              size="sm"
              variant={focusMode ? 'primary' : 'secondary'}
              icon={focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={toggleFocusMode}
            >
              {focusMode ? t('common.exitFocus', { defaultValue: 'Exit focus' }) : t('common.focus', { defaultValue: 'Focus' })}
            </Button>
          </div>
        )}
      />

      {/* Навигация секций: категории-сегменты + горизонтальная лента табов.
          Кнопки действий (Журнал/Поделиться/Ещё/Фокус) вынесены в шапку (PageHeader actions) — в самый верх справа. */}
      <div className="flex items-center gap-2 min-w-0 print-hide">
        <div className="flex shrink-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
            {(['foundation', 'planning', 'control', 'reports'] as const).map((group) => (
              <button
                key={group}
                onClick={() => openCategory(group)}
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
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-hide py-0.5">
            {sectionsOf(activeCategory)
              .map((sectionMeta, i) => {
                const Icon = sectionMeta.icon
                const isActive = currentSectionMeta.id === sectionMeta.id
                return (
                  <button
                    // Ключ с категорией: при смене категории React пересоздаёт кнопки, и
                    // анимация въезда проигрывается заново. Без этого одинаковые по id пункты
                    // остались бы на месте и смена набора снова прошла бы незаметно.
                    key={`${activeCategory}:${sectionMeta.id}`}
                    style={{ animationDelay: `${i * 25}ms` }}
                    onClick={() => navigateToSection(sectionMeta.id)}
                    title={sectionMeta.displayName}
                    className={`section-pill-in flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      isActive
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon size={12} className={isActive ? 'text-blue-600' : 'text-slate-600 dark:text-slate-400'} />
                    <span className="whitespace-nowrap">{sectionMeta.displayName}</span>
                  </button>
                )
              })}
          </div>
        </div>

      <div className={`grid gap-4 ${rightHidden ? '' : 'xl:grid-cols-[minmax(0,1fr)_280px]'}`}>
        <div className="min-w-0 space-y-4">
          {/* UX-07: понятный role banner — почему проект открыт только на чтение. */}
          {!canWrite && (
            <Surface variant="muted" className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
              {isOwner
                ? t('project.readOnlyOwner', { defaultValue: 'Вы просматриваете как наблюдатель (owner). Редактирование доступно ведущему PM этого проекта.' })
                : t('project.readOnlyHint', { defaultValue: 'Просмотр: редактирование доступно ведущему PM этого проекта.' })}
            </Surface>
          )}
          <div className="flex gap-4">
            <SectionCard variant="default" className="min-w-0 flex-1 overflow-hidden">
              <Suspense fallback={<SectionFallback />}>
                <ProjectPermissionProvider canWrite={canWrite}>
                  {renderSection()}
                </ProjectPermissionProvider>
              </Suspense>
            </SectionCard>
            {showActionLog && (isOwner || canWrite) && (
              <ActionLogPanel projectId={id!} section={currentSectionMeta.id} onClose={() => setShowActionLog(false)} />
            )}
          </div>
        </div>

        {!rightHidden && (
          <div className="space-y-4">
            <SectionAdvisor section={section} projectId={id!} project={project} team={team} />
            <SectionCard
              title={t('project.setupTitle', { defaultValue: 'Project setup progress' })}
              description={t('project.startHint', { defaultValue: 'Для старта достаточно Паспорта и Плана работ. Остальное добавите позже.' })}
              className="overflow-hidden"
            >
              <div className="space-y-4">
                {setupGroups.map((group) => (
                  <div key={group.title}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">{group.title}</p>
                    <div className="space-y-2">
                      {group.items.map((item) => (
                        <button
                          key={item.section}
                          type="button"
                          onClick={() => navigateToSection(item.section)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-blue-300 dark:hover:border-blue-700 hover:bg-white dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            item.section === section
                              ? 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-950/30'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.label}</p>
                            <Pill className={item.done ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : group.pendingClass}>
                              {item.done ? t('project.setup.done', { defaultValue: 'Done' }) : group.pendingLabel}
                            </Pill>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{item.note}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      {showTransfer && canTransfer && (
        <TransferDialog projectId={project.id} staysCoPm={isPrimaryPm && !isOwner}
          onClose={() => setShowTransfer(false)} />
      )}

      {showObservers && canManageCoEditors && (
        <CoEditorsDialog projectId={project.id} pmId={project.pm_id} kind="observer" onClose={() => setShowObservers(false)} />
      )}
      {showSubprojects && canManageCoEditors && (
        <SubprojectsDialog projectId={project.id} onClose={() => setShowSubprojects(false)} />
      )}
      {showCoEditors && canManageCoEditors && (
        <CoEditorsDialog projectId={project.id} pmId={project.pm_id} onClose={() => setShowCoEditors(false)} />
      )}

      {showShare && canManageCoEditors && (
        <ShareDialog projectId={project.id} onClose={() => setShowShare(false)} />
      )}

    </PageShell>
  )
}
