/**
 * Портфель проектов — экран руководителя портфеля.
 *
 * Порядок экрана отвечает порядку вопросов: сначала СПИСОК проектов (что у нас есть и где
 * красное), потом срез цифрами (как поделено), потом динамика и загрузка людей.
 *
 * Решения, которые легко «починить» назад по незнанию:
 *  • вид только табличный. Карточки показывали шесть проектов на экран вместо тридцати,
 *    а руководителю нужен обзор, а не витрина;
 *  • клик по строке РАСКРЫВАЕТ разбор «что с проектом не так» прямо в списке; переход в проект —
 *    отдельной кнопкой. Раньше любопытство стоило ухода со страницы и возврата назад;
 *  • «Фокус руководства» и «Требует внимания» больше не отдельные простыни сверху: их содержимое
 *    живёт в раскрытой строке того проекта, к которому относится. Общий счётчик красных остался
 *    в «бубликах».
 */
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Archive, ChevronDown, Download, FileDown } from 'lucide-react'
import { getPortfolioDashboard, type PortfolioProject } from '@/api/portfolio'
import { getAttention } from '@/api/attention'
import ProjectInsights, { groupAttentionByProject } from '@/components/portfolio/ProjectInsights'
import { getUsers } from '@/api/users'
import { getRegistry } from '@/api/registry'
import { PROJECT_KIND_OPTIONS } from '@/constants/project'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { FilterBar, PageHeader, PageShell } from '@/components/ui/layout'
import { Pill } from '@/components/ui/badges'
import { Surface } from '@/components/ui/surface'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import PortfolioAnalytics from '@/components/PortfolioAnalytics'
import PortfolioDonuts from '@/components/portfolio/PortfolioDonuts'
import PortfolioMoreMenu from '@/components/portfolio/PortfolioMoreMenu'
import PortfolioDeadlines from '@/components/portfolio/PortfolioDeadlines'
import PortfolioManagers from '@/components/portfolio/PortfolioManagers'
import PortfolioWorkload from '@/components/portfolio/PortfolioWorkload'
import MetricHelp from '@/components/portfolio/MetricHelp'
import SavedViews from '@/components/SavedViews'
import { ProjectTable, type PortfolioRow } from '@/components/portfolio/PortfolioCards'
import { getRagLabel } from '@/components/portfolio/portfolioHelpers'
import { useAuthStore } from '@/store/authStore'
import { isPortfolioManager } from '@/lib/roles'
import { exportRowsToXlsx } from '@/utils/exportXlsx'
import { exportElementToPdf } from '@/utils/exportPdf'
import { formatDate } from '@/utils/date'

const selectCls = 'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 shadow-sm outline-none transition-colors focus:border-slate-500'

type RagFilter = '' | 'red' | 'amber' | 'green'

/** Группы «Требует внимания», которые показываем внутри строки проекта. */

/** Список ведётся по видам проектов — как его читает руководство. Порядок фиксированный. */
const KIND_ORDER = ['strategic', 'operational', 'pilot', ''] as const

/** Реестр владелец заполняет словами — переводим их в ключи портала. */
const KIND_BY_WORD: Record<string, string> = {
  'стратегический': 'strategic', 'операционный': 'operational', 'пилотный': 'pilot',
  strategic: 'strategic', operational: 'operational', pilot: 'pilot',
}
const RAG_BY_WORD: Record<string, string> = {
  'красный': 'red', 'жёлтый': 'amber', 'желтый': 'amber', 'зелёный': 'green', 'зеленый': 'green',
  red: 'red', amber: 'amber', yellow: 'amber', green: 'green',
}

export default function PortfolioDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ status: '', priority: '', pm_id: '', kind: '' })
  const [search, setSearch] = useState('')
  // Клиентские фильтры: RAG и «только с просрочкой» (сервер о них не знает).
  const [ragFilter, setRagFilter] = useState<RagFilter>('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Раскрытые группы видов. Пусто по умолчанию — при открытии портфеля список свёрнут:
  // сначала общая картина бубликами, потом человек сам разворачивает нужный вид.
  const [openKinds, setOpenKinds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const analyticsRef = useRef<HTMLDivElement>(null)
  const user = useAuthStore((s) => s.user)
  const uid = user?.id

  const applyView = (v: Record<string, unknown>) => {
    setFilters({
      status: typeof v.status === 'string' ? v.status : '',
      priority: typeof v.priority === 'string' ? v.priority : '',
      pm_id: typeof v.pm_id === 'string' ? v.pm_id : '',
      kind: typeof v.kind === 'string' ? v.kind : '',
    })
  }

  const handleExportPdf = async () => {
    if (!analyticsRef.current) return
    setExporting(true)
    try {
      await exportElementToPdf(analyticsRef.current, 'portfolio')
    } finally {
      setExporting(false)
    }
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portfolio', filters, showArchived],
    queryFn: () => getPortfolioDashboard({
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      pm_id: filters.pm_id || undefined,
      kind: filters.kind || undefined,
    }, showArchived),
  })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  // «Требует внимания» грузим один раз на страницу и раскладываем по проектам: раскрытая строка
  // показывает только своё, а не общий список, в котором надо искать глазами.
  const { data: attention } = useQuery({ queryKey: ['attention', 7], queryFn: () => getAttention(7) })

  const attentionByProject = useMemo(() => groupAttentionByProject(attention), [attention])

  // Проекты из реестра переходного периода — те, что ДОЛЖНЫ вестись, но ещё не заведены.
  // Без них список показывает половину картины, и «всего проектов» вводит в заблуждение.
  const { data: registry = [] } = useQuery({
    queryKey: ['registry'],
    queryFn: getRegistry,
    enabled: isPortfolioManager(user),   // реестр личный: РП и руководству сервер отдаст 403
    staleTime: 60_000,
  })
  const stubs: PortfolioRow[] = useMemo(() => registry
    .filter((r) => !r.project_id)
    .map((r) => ({
      id: `stub-${r.id}`, code: '', name: r.name, status: 'planning', priority: 'medium',
      client: r.customer, program: null, project_kind: KIND_BY_WORD[(r.kind || '').toLowerCase()] ?? null,
      pm_name: r.pm_name, planned_end: null, progress: 0, total_tasks: 0, tasks_completed: 0,
      overdue_tasks_count: 0, open_risks_high_count: 0, open_risks_medium_count: 0,
      baseline_deviation_days: null, budget_plan: null, budget_actual: null, budget_currency: null,
      archived: false, rag_status: RAG_BY_WORD[(r.rag || '').toLowerCase()] ?? null,
      attention_required: false, health: null,
      stub: true, stubPhase: r.phase,
    } as unknown as PortfolioRow)), [registry])

  const projects = data?.data ?? []
  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter((p) => {
      if (q && !(
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.pm_name ?? '').toLowerCase().includes(q)
      )) return false
      if (ragFilter && p.rag_status !== ragFilter) return false
      if (overdueOnly && !(p.overdue_tasks_count > 0)) return false
      return true
    })
  }, [projects, search, ragFilter, overdueOnly])

  // Настоящие проекты + болванки реестра в одном списке, разложенные по видам.
  const rows: PortfolioRow[] = useMemo(() => [...visibleProjects, ...stubs], [visibleProjects, stubs])
  const byKind = useMemo(() => {
    // Подпроект идёт в группу СВОЕЙ программы, а не своего вида. Вид у модулей часто не
    // проставлен вовсе (быстрый мастер его не спрашивает), и по «родному» виду все
    // модули уезжали в «Без вида», отдельно от зонтика: дерево рассыпалось ровно там, где
    // его собирали. Группа — свойство программы, а модуль — её часть.
    const kindOfId = new Map(rows.map((p) => [String(p.id), (p.project_kind as string) || '']))
    const map = new Map<string, PortfolioRow[]>()
    for (const p of rows) {
      const parent = p.parent_id == null ? '' : String(p.parent_id)
      const key = (parent && kindOfId.has(parent) ? kindOfId.get(parent) : (p.project_kind as string) || '') || ''
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return map
  }, [rows])

  // Сколько подпроектов зонтика в красной зоне — по ВСЕМ проектам, до фильтров и до разбивки
  // по видам. Счётчик, посчитанный по видимой выборке, врал бы тише всего: поставил фильтр
  // «мой РП» — красные модули чужих РП выпали, и у программы загорелся ноль.
  const redChildren = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of projects) {
      if (p.parent_id && p.rag_status === 'red') {
        m.set(String(p.parent_id), (m.get(String(p.parent_id)) ?? 0) + 1)
      }
    }
    return m
  }, [projects])

  if (isLoading) {
    return (
      <PageShell>
        <Surface className="p-6">
          <SkeletonRows rows={8} rowClassName="h-10" />
        </Surface>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </PageShell>
    )
  }

  if (isError) {
    return (
      <PageShell>
        <PageHeader eyebrow={t('nav.portfolio')} title={t('portfolio.title')} description={t('portfolio.overview')} />
        <EmptyState
          icon={<AlertTriangle size={28} className="text-rose-500" />}
          title={t('fix.loadErrorPortfolio', { defaultValue: 'Не удалось загрузить портфель. Проверьте соединение и обновите страницу.' })}
          action={<Button variant="secondary" onClick={() => void refetch()}>{t('fix.retry', { defaultValue: 'Обновить' })}</Button>}
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader eyebrow={t('nav.portfolio')} title={t('portfolio.title')} description={t('portfolio.overview')} actions={<MetricHelp anchor="basis" />} />


      {/* Срез цифрами — вверху: он отвечает на первый вопрос руководителя «как в целом». */}
      {/* Болванки реестра идут отдельным списком: пончики сами решают, где их считать,
          а где данных у них нет (см. комментарий в PortfolioDonuts). */}
      <PortfolioDonuts projects={visibleProjects} stubs={stubs} />

      <FilterBar>
        <select aria-label={t('common.status', { defaultValue: 'Status' })} value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))} className={selectCls}>
          <option value="">{t('portfolio.allStatuses')}</option>
          {['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((status) => (
            <option key={status} value={status}>{t(`project.status.${status}`)}</option>
          ))}
        </select>
        <select aria-label={t('project.fields.priority', { defaultValue: 'Priority' })} value={filters.priority} onChange={(event) => setFilters((value) => ({ ...value, priority: event.target.value }))} className={selectCls}>
          <option value="">{t('portfolio.allPriorities')}</option>
          {['critical', 'high', 'medium', 'low'].map((priority) => (
            <option key={priority} value={priority}>{t(`project.priority.${priority}`)}</option>
          ))}
        </select>
        <select aria-label={t('portfolio.pmPrefix', { defaultValue: 'PM' })} value={filters.pm_id} onChange={(event) => setFilters((value) => ({ ...value, pm_id: event.target.value }))} className={selectCls}>
          <option value="">{t('portfolio.allPMs')}</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
        </select>
        <select aria-label={t('project.fields.kind', { defaultValue: 'Вид проекта' })} value={filters.kind} onChange={(event) => setFilters((value) => ({ ...value, kind: event.target.value }))} className={selectCls}>
          <option value="">{t('portfolio.allKinds', { defaultValue: 'Все виды' })}</option>
          {PROJECT_KIND_OPTIONS.map((kind) => (
            <option key={kind} value={kind}>{t(`project.kind.${kind}`, { defaultValue: kind })}</option>
          ))}
        </select>
        <select aria-label={t('portfolio.ragFilterAria', { defaultValue: 'Фильтр по RAG' })} value={ragFilter} onChange={(event) => setRagFilter(event.target.value as RagFilter)} className={selectCls}>
          <option value="">{t('portfolio.allRag', { defaultValue: 'Все RAG' })}</option>
          {(['red', 'amber', 'green'] as const).map((rag) => (
            <option key={rag} value={rag}>{getRagLabel(rag, t)}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t('portfolio.searchPlaceholder', { defaultValue: 'Поиск: название, код, РП' })}
          placeholder={t('portfolio.searchPlaceholder', { defaultValue: 'Поиск: название, код, РП' })}
          className={`${selectCls} w-56`}
        />
        <Button
          variant={overdueOnly ? 'primary' : 'secondary'}
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
        >
          {t('portfolio.withOverdue', { defaultValue: 'С просрочкой' })}
        </Button>
        {uid && <SavedViews storageKey={`portfolio:${uid}`} current={filters} onApply={applyView} />}
        {/* Архив и оба экспорта — в «Ещё»: на обычном экране они переносились на вторую
            строку и ломали панель фильтров. Часто нужны фильтры, а не выгрузка. */}
        <div className="ml-auto">
          <PortfolioMoreMenu
            t={t}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onExportXlsx={() => void exportRowsToXlsx('portfolio.xlsx', visibleProjects.map((p) => ({
              Code: p.code, Name: p.name, Status: p.status, Priority: p.priority,
              Kind: p.project_kind ?? '', Client: p.client ?? '', Program: p.program ?? '', PM: p.pm_name ?? '',
              'End date': p.planned_end ?? '', 'Progress %': p.progress, Tasks: p.total_tasks,
              Overdue: p.overdue_tasks_count, 'High risks': p.open_risks_high_count,
              'Medium risks': p.open_risks_medium_count, Budget: p.budget_plan ?? '',
              'Budget (факт)': p.budget_actual ?? '', Currency: p.budget_currency ?? '',
              RAG: p.rag_status ?? '', Health: typeof p.health === 'number' ? p.health : '',
            })))}
            onExportPdf={handleExportPdf}
            exporting={exporting}
          />
        </div>
      </FilterBar>

      {/* Список по видам проектов: стратегические отдельно от операционных, иначе руководство
          читает одну кучу. Проекты из реестра идут в тех же группах с пометкой «не заведён».
          Группы сворачиваются — на сорока строках нужный вид иначе не найти. */}
      {rows.length === 0 ? (
        <EmptyState title={t('portfolio.noProjectsFound')} description={t('portfolio.overview')} />
      ) : (
        <div className="flex flex-col gap-5">
          {KIND_ORDER.filter((k) => byKind.get(k)?.length).map((kind) => {
            const list = byKind.get(kind) ?? []
            const stubCount = list.filter((p) => p.stub).length
            const collapsed = !openKinds.has(kind)
            return (
              <Surface key={kind || 'none'} className="p-0">
                <button
                  type="button"
                  onClick={() => setOpenKinds((cur) => {
                    const next = new Set(cur)
                    if (next.has(kind)) next.delete(kind)
                    else next.add(kind)
                    return next
                  })}
                  aria-expanded={!collapsed}
                  className="flex w-full items-center gap-2 px-5 py-4 text-left"
                >
                  <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {kind ? t(`project.kind.${kind}`, { defaultValue: kind }) : t('portfolio.noKind', { defaultValue: 'Без вида' })}
                    </span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      {t('portfolio.clientProjectCount', { defaultValue: '{{count}} проектов', count: list.length })}
                      {stubCount ? ` · ${t('portfolio.notCreatedCount', { defaultValue: 'ещё не заведены: {{count}}', count: stubCount })}` : ''}
                    </span>
                  </span>
                </button>
                {!collapsed && (
                  <ProjectTable
                    projects={list}
                    redChildren={redChildren}
                    onOpen={(projectId) => navigate(`/projects/${projectId}/passport`)}
                    expandedId={expandedId}
                    onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                    renderExpanded={(p) => (
                      <ProjectInsights project={p} attention={attentionByProject.get(String(p.id))} />
                    )}
                  />
                )}
              </Surface>
            )
          })}
        </div>
      )}

      <div ref={analyticsRef} className="flex flex-col gap-6">
        {/* «Когда всё заканчивается» — рядом с трендами: оба про время, а не про людей. */}
        <PortfolioDeadlines projects={visibleProjects} />
        <PortfolioAnalytics />
        {/* Два разных вопроса — два графика рядом: «кто завален задачами» и «кто сколько ведёт».
            Стоят в самом низу: это разговор про людей, а не про состояние портфеля. */}
        <div className="grid gap-4 xl:grid-cols-2">
          <PortfolioWorkload />
          <PortfolioManagers projects={visibleProjects} stubs={stubs} />
        </div>
      </div>
    </PageShell>
  )
}
