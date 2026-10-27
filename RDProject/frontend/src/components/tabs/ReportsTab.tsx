import { useState, useRef, useMemo, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, X, FileText, FileDown } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getReports, createReport, updateReport, deleteReport, getRisksSummary } from '@/api/reports'
import { getTasks } from '@/api/tasks'
import { getBudgetSummary } from '@/api/budget'
import { suggestTimelineRag, suggestBudgetRag, worstRag } from '@/utils/reportRag'
import { getProject } from '@/api/projects'
import { formatDate, localIsoDate } from '@/utils/date'
import type { StatusReport, ReportMilestone } from '@/types/report'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import { useConfirmStore } from '@/store/confirmStore'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import { useSectionExport } from '@/hooks/useSectionExport'

const RAG_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}
const RAG_TEXT: Record<string, string> = {
  green: 'text-green-700',
  amber: 'text-amber-600',
  red: 'text-red-700',
}
const MILESTONE_STATUS_COLORS: Record<string, string> = {
  done: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  on_track: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
  delayed: 'bg-red-100 text-red-600 dark:bg-rose-950/40 dark:text-rose-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200',
}

// Статус задачи WBS → статус ключевой задачи в отчёте (для автопредзаполнения по периоду).
const TASK_TO_MILESTONE: Record<string, string> = {
  completed: 'done', in_progress: 'in_progress', not_started: 'on_track',
  on_hold: 'delayed', cancelled: 'cancelled',
}

type View = 'list' | 'form' | 'detail'

interface ReportFormData {
  report_date: string
  period: string
  status_overall: string
  status_budget: string
  status_timeline: string
  summary: string
  next_steps: string
  conclusions: string
  budget_plan: string
  budget_actual: string
  budget_forecast: string
  milestones: Array<{ name: string; planned_date: string; actual_date: string; status: string }>
}

const emptyForm = (): ReportFormData => ({
  report_date: localIsoDate(),   // ISO — под нативный date-picker
  period: '', status_overall: 'green', status_budget: 'green', status_timeline: 'green',
  summary: '', next_steps: '', conclusions: '',
  budget_plan: '', budget_actual: '', budget_forecast: '',
  milestones: [],
})

const reportToForm = (r: StatusReport): ReportFormData => ({
  report_date: (r.report_date ?? '').slice(0, 10),
  period: r.period ?? '',
  status_overall: r.status_overall ?? 'green',
  status_budget: r.status_budget ?? 'green',
  status_timeline: r.status_timeline ?? 'green',
  summary: r.summary ?? '',
  next_steps: r.next_steps ?? '',
  conclusions: r.conclusions ?? '',
  budget_plan: r.budget_plan?.toString() ?? '',
  budget_actual: r.budget_actual?.toString() ?? '',
  budget_forecast: r.budget_forecast?.toString() ?? '',
  // Даты вех/ключевых задач держим в ISO (YYYY-MM-DD) — под нативный date-picker (календарь).
  // `?? []` не косметика: отчёт мог быть создан помощником, без поля вех вовсе.
  milestones: (r.milestones ?? []).map(m => ({
    name: m.name, planned_date: (m.planned_date ?? '').slice(0, 10), actual_date: (m.actual_date ?? '').slice(0, 10), status: m.status ?? '',
  })),
})

export default function ReportsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const RAG_LABELS: Record<string, string> = {
    green: t('reports.rag.green'),
    amber: t('reports.rag.amber'),
    red: t('reports.rag.red'),
  }
  const MILESTONE_STATUS_OPT = [
    { value: 'done', label: t('reports.milestoneStatuses.done') },
    { value: 'in_progress', label: t('reports.milestoneStatuses.in_progress') },
    { value: 'on_track', label: t('reports.milestoneStatuses.on_track') },
    { value: 'delayed', label: t('reports.milestoneStatuses.delayed') },
    { value: 'cancelled', label: t('reports.milestoneStatuses.cancelled') },
  ]
  const [view, setView] = useState<View>('list')
  const [selectedReport, setSelectedReport] = useState<StatusReport | null>(null)
  const [editingReport, setEditingReport] = useState<StatusReport | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: reports = [], isLoading, isError } = useQuery({
    queryKey: ['reports', projectId],
    queryFn: () => getReports(projectId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reports', projectId] })

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => reports.map((r) => ({
    period: r.period, report_date: r.report_date,
    status_overall: r.status_overall, status_budget: r.status_budget, status_timeline: r.status_timeline,
    summary: r.summary,
  })), [reports])
  useSectionExport('reports', exportRows)

  const handleDelete = (id: string) => {
    showConfirm(t('reports.deleteConfirm'), async () => {
      await deleteReport(projectId, id); await invalidate()
      if (view !== 'list') setView('list')
    })
  }

  const handleSave = async (form: ReportFormData) => {
    setSaving(true)
    try {
      const payload = {
        report_date: form.report_date, period: form.period || null,   // ISO из date-picker
        status_overall: form.status_overall || null, status_budget: form.status_budget || null,
        status_timeline: form.status_timeline || null,
        summary: form.summary || null, next_steps: form.next_steps || null,
        conclusions: form.conclusions || null,
        budget_plan: form.budget_plan ? parseFloat(form.budget_plan) : null,
        budget_actual: form.budget_actual ? parseFloat(form.budget_actual) : null,
        budget_forecast: form.budget_forecast ? parseFloat(form.budget_forecast) : null,
        milestones: form.milestones.filter(m => m.name.trim()).map(m => ({
          name: m.name, planned_date: m.planned_date || null,   // уже ISO из date-picker
          actual_date: m.actual_date || null, status: m.status || null,
        })),
      }
      if (editingReport) {
        const updated = await updateReport(projectId, editingReport.id, payload)
        await invalidate(); setSelectedReport(updated); setView('detail')
      } else {
        await createReport(projectId, payload); await invalidate(); setView('list')
      }
    } finally { setSaving(false) }
  }

  const guideSteps: GuideStep[] = [
    { title: t('reports.guide.s1'), desc: t('reports.guide.s1d') },
    { title: t('reports.guide.s2'), desc: t('reports.guide.s2d') },
    { title: t('reports.guide.s3'), desc: t('reports.guide.s3d') },
    { title: t('reports.guide.s4'), desc: t('reports.guide.s4d') },
    { title: t('reports.guide.s5'), desc: t('reports.guide.s5d') },
  ]

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  if (view === 'form') {
    return <ReportForm initialData={editingReport ? reportToForm(editingReport) : emptyForm()}
      isEdit={!!editingReport} saving={saving} projectId={projectId}
      onSave={handleSave} onCancel={() => setView(editingReport ? 'detail' : 'list')} />
  }

  if (view === 'detail' && selectedReport) {
    return <ReportDetail report={selectedReport} projectId={projectId}
      onEdit={() => { setEditingReport(selectedReport); setView('form') }}
      onDelete={() => handleDelete(selectedReport.id)}
      onBack={() => setView('list')} canWrite={canWrite} />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('reports.title')} ({reports.length})</h3>
          <ProcessGuide steps={guideSteps} />
        </div>
        {canWrite && (
          <button onClick={() => { setEditingReport(null); setView('form') }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
            <Plus size={ICON_SM} /> {t('reports.add')}
          </button>
        )}
      </div>

      {reports.length === 0 ? (
        <EmptyValueState
          message={t('adopt.empty.reports', { defaultValue: 'Первый отчёт — 10 минут: риски и цифры подтянутся из ваших данных, а правление увидит статус без звонков вам.' })}
          actionLabel={canWrite ? t('reports.add') : undefined}
          onAction={canWrite ? () => { setEditingReport(null); setView('form') } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {reports.map(r => (
            <div key={r.id} onClick={() => { setSelectedReport(r); setView('detail') }}
              className="flex items-center justify-between p-4 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              <div className="flex items-center gap-4">
                <FileText size={16} className="text-gray-500 dark:text-slate-400 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{r.period || formatDate(r.report_date)}</span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">{formatDate(r.report_date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-gray-500 dark:text-slate-300">{t('reports.overall')}:</span>
                    <RagDot status={r.status_overall} />
                    <span className="text-xs text-gray-500 dark:text-slate-300 ml-1">{t('budget.title')}:</span>
                    <RagDot status={r.status_budget} />
                    <span className="text-xs text-gray-500 dark:text-slate-300 ml-1">{t('reports.timeline')}:</span>
                    <RagDot status={r.status_timeline} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-slate-400">{t('reports.milestonesCount', { count: r.milestones?.length ?? 0 })}</span>
                {canWrite && (
                  <button onClick={e => { e.stopPropagation(); handleDelete(r.id) }}
                    aria-label={t('common.delete')}
                    className="p-1 text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RagDot({ status }: { status?: string | null }) {
  const color = status ? RAG_COLORS[status] : 'bg-gray-300 dark:bg-slate-700'
  return <span className={`inline-block w-3 h-3 rounded-full ${color}`} />
}

// ── Report Detail ──────────────────────────────────────────────────────────

function ReportDetail({ report, projectId, onEdit, onDelete, onBack, canWrite }: {
  report: StatusReport; projectId: string
  onEdit: () => void; onDelete: () => void; onBack: () => void; canWrite: boolean
}) {
  const { t } = useTranslation()
  const printRef = useRef<HTMLDivElement>(null)
  const ragLabels: Record<string, string> = {
    green: t('reports.rag.green'),
    amber: t('reports.rag.amber'),
    red: t('reports.rag.red'),
  }
  const { data: risksSummary } = useQuery({
    queryKey: ['risks_summary', projectId],
    queryFn: () => getRisksSummary(projectId),
  })

  const handlePrint = () => window.print()

  const fmt = (v: number | null | undefined) =>
    v != null ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  return (
    <div>
      <div className="flex items-center justify-between mb-4 print:hidden">
        <button onClick={onBack} className="text-xs text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-100">{t('common.backToList')}</button>
        <div className="flex gap-2">
          <button onClick={handlePrint}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
            <FileDown size={12} /> PDF
          </button>
          {canWrite && (
            <>
              <button onClick={onEdit} className="px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
                {t('common.edit')}
              </button>
              <button onClick={onDelete} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md">{t('common.delete')}</button>
            </>
          )}
        </div>
      </div>

      <div ref={printRef} data-print-root className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-1">
            {t('reports.statusReportTitle')} {report.period ? `— ${report.period}` : ''}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-300">{t('reports.reportDatePrefix')} {formatDate(report.report_date)}</p>
        </div>

        {/* RAG status */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('reports.overall'), key: 'status_overall' as const },
            { label: t('budget.title'), key: 'status_budget' as const },
            { label: t('reports.timeline'), key: 'status_timeline' as const },
          ].map(({ label, key }) => {
            const s = report[key]
            return (
              <div key={key} className="p-4 border border-gray-200 dark:border-slate-700 rounded-lg text-center">
                <p className="text-xs text-gray-500 dark:text-slate-300 mb-2">{label}</p>
                <div className={`w-10 h-10 rounded-full mx-auto mb-1 ${s ? RAG_COLORS[s] : 'bg-gray-200 dark:bg-slate-700'}`} />
                <p className={`text-sm font-semibold ${s ? RAG_TEXT[s] : 'text-gray-500 dark:text-slate-400'}`}>
                  {s ? ragLabels[s] : '—'}
                </p>
              </div>
            )
          })}
        </div>

        {/* Summary */}
        {report.summary && (
          <Section title={t('reports.summary')}>
            <p className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{report.summary}</p>
          </Section>
        )}

        {/* Key milestones */}
        {(report.milestones?.length ?? 0) > 0 && (
          <Section title={t('reports.milestonesTitle')}>
            <table className="min-w-full text-xs">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">
                {[t('reports.mTaskCol', { defaultValue: 'Задача' }), t('reports.mStartCol', { defaultValue: 'Дата начала' }),
                  t('reports.mEndCol', { defaultValue: 'Дата конца' }), t('common.status')].map((h, i) => (
                  <th key={i} className="text-left font-medium text-gray-500 dark:text-slate-400 py-1.5 pr-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(report.milestones ?? []).map(m => (
                  <tr key={m.id} className="border-b border-gray-50 dark:border-slate-800">
                    <td className="py-1.5 pr-4 text-gray-800 dark:text-slate-200">{m.name}</td>
                    <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">{m.planned_date ?? '—'}</td>
                    <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">{m.actual_date ?? '—'}</td>
                    <td className="py-1.5 pr-4">
                      {m.status && (
                        <span className={`px-1.5 py-0.5 rounded text-xs ${MILESTONE_STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                          {m.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Budget */}
        {(report.budget_plan != null || report.budget_actual != null) && (
          <Section title={t('reports.budgetSnapshot')}>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: t('budget.plan'), value: fmt(report.budget_plan) },
                { label: t('budget.actual'), value: fmt(report.budget_actual) },
                { label: t('budget.forecast'), value: fmt(report.budget_forecast) },
              ].map(c => (
                <div key={c.label} className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                  <p className="text-xs text-gray-500 dark:text-slate-300">{c.label}</p>
                  <p className="text-base font-bold text-gray-800 dark:text-slate-200">{c.value}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Risks summary */}
        {risksSummary && (risksSummary.high.length > 0 || risksSummary.medium.length > 0) && (
          <Section title={t('reports.activeRisks')}>
            {risksSummary.high.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-red-600 dark:text-rose-300 mb-1">{t('reports.highPriority')} ({risksSummary.high.length})</p>
                <div className="space-y-1">
                  {risksSummary.high.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-gray-500 dark:text-slate-400">{r.code}</span>
                      <span className="text-gray-800 dark:text-slate-200">{r.title}</span>
                      {r.owner && <span className="text-gray-500 dark:text-slate-300">— {r.owner}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {risksSummary.medium.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-300 mb-1">{t('reports.mediumPriority')} ({risksSummary.medium.length})</p>
                <div className="space-y-1">
                  {risksSummary.medium.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-gray-500 dark:text-slate-400">{r.code}</span>
                      <span className="text-gray-800 dark:text-slate-200">{r.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Next steps */}
        {report.next_steps && (
          <Section title={t('reports.nextSteps')}>
            <p className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{report.next_steps}</p>
          </Section>
        )}

        {/* Conclusions */}
        {report.conclusions && (
          <Section title={t('reports.conclusions')}>
            <p className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{report.conclusions}</p>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 border-b border-gray-200 dark:border-slate-700 pb-2 mb-3">{title}</h3>
      {children}
    </div>
  )
}

// ── Report Form ────────────────────────────────────────────────────────────

function ReportForm({ initialData, isEdit, saving, projectId, onSave, onCancel }: {
  initialData: ReportFormData; isEdit: boolean; projectId: string
  saving: boolean; onSave: (f: ReportFormData) => void; onCancel: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ReportFormData>(initialData)
  // «Ключевые задачи» — выбор из задач WBS проекта (фазы исключаем).
  const { data: wbsTasks = [], isFetched: tasksFetched } = useQuery({ queryKey: ['tasks', projectId], queryFn: () => getTasks(projectId) })
  const { data: budgetSummary, isFetched: budgetFetched } = useQuery({ queryKey: ['budget_summary', projectId], queryFn: () => getBudgetSummary(projectId) })
  const { data: reportsList = [], isFetched: reportsFetched } = useQuery({ queryKey: ['reports', projectId], queryFn: () => getReports(projectId) })
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const taskTitles = useMemo(
    () => Array.from(new Set(wbsTasks.filter(x => x.task_type !== 'phase').map(x => x.title).filter(Boolean))),
    [wbsTasks],
  )

  // Автопредзаполнение НОВОГО отчёта: снимок бюджета из текущего бюджета проекта + ключевые задачи,
  // пришедшиеся на период (от прошлого отчёта до сегодня; для первого — от старта проекта). Всё можно
  // потом отредактировать/убрать. Не трогаем уже заполненное и не срабатываем при редактировании.
  // Пересчитываем при СМЕНЕ даты отчёта (её можно поставить задним числом): период = от прошлого
  // отчёта до выбранной даты (для первого — от старта проекта). Снимок бюджета и ключевые задачи
  // заводятся заново (перетирают прежние авто-значения) — по требованию владельца.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null)
  useEffect(() => {
    if (isEdit) return
    const end = form.report_date || localIsoDate()
    if (prefilledFor === end) return
    // Ждём ВСЕ источники. Раньше здесь стояло «бюджет ИЛИ задачи»: бюджет приезжает первым,
    // эффект отмечал период как заполненный, и ключевые задачи не подставлялись уже никогда —
    // отчёт открывался со снимком бюджета и пустым списком задач.
    if (!tasksFetched || !budgetFetched || !reportsFetched) return
    const prevDates = reportsList.map(r => (r.report_date ?? '').slice(0, 10)).filter(d => d && d < end).sort()
    const periodStart = prevDates.length ? prevDates[prevDates.length - 1]
      : ((project?.planned_start ?? '').slice(0, 10) || '0000-01-01')
    const keyTasks = wbsTasks
      .filter(x => x.task_type !== 'phase' && x.title)
      .filter(x => {
        const s = (x.planned_start ?? '').slice(0, 10); const e = (x.planned_end ?? '').slice(0, 10)
        if (!s && !e) return false
        return (s || e) <= end && (e || s) >= periodStart   // задача активна в периоде (пересечение)
      })
      .map(x => ({
        name: x.title,
        planned_date: (x.planned_start ?? '').slice(0, 10),
        actual_date: (x.planned_end ?? '').slice(0, 10),
        status: TASK_TO_MILESTONE[x.status] ?? 'on_track',
      }))
    // Светофор портал предлагает сам — по просрочке и по расходу бюджета. Руководитель
    // проекта поправит: он знает то, чего нет в цифрах. Пустой отчёт с тремя зелёными
    // «по умолчанию» — худший вариант из возможных.
    const timelineRag = suggestTimelineRag(wbsTasks, end)
    const budgetRag = suggestBudgetRag(budgetSummary)
    setForm(f => ({
      ...f,
      budget_plan: budgetSummary ? String(budgetSummary.total_planned) : f.budget_plan,
      budget_actual: budgetSummary ? String(budgetSummary.total_actual) : f.budget_actual,
      budget_forecast: budgetSummary ? String(budgetSummary.total_planned) : f.budget_forecast,
      status_timeline: timelineRag,
      status_budget: budgetRag,
      status_overall: worstRag(timelineRag, budgetRag),
      milestones: keyTasks,
    }))
    setPrefilledFor(end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.report_date, budgetSummary, wbsTasks, reportsList, project, isEdit, prefilledFor, tasksFetched, budgetFetched, reportsFetched])
  const milestoneStatusOptions = [
    { value: 'done', label: t('reports.milestoneStatuses.done') },
    { value: 'in_progress', label: t('reports.milestoneStatuses.in_progress') },
    { value: 'on_track', label: t('reports.milestoneStatuses.on_track') },
    { value: 'delayed', label: t('reports.milestoneStatuses.delayed') },
    { value: 'cancelled', label: t('reports.milestoneStatuses.cancelled') },
  ]
  const set = (k: keyof ReportFormData, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const addMilestone = () => set('milestones', [...form.milestones, { name: '', planned_date: '', actual_date: '', status: '' }])
  const removeMilestone = (i: number) => set('milestones', form.milestones.filter((_, idx) => idx !== i))
  const updateMilestone = (i: number, k: string, v: string) =>
    set('milestones', form.milestones.map((m, idx) => idx === i ? { ...m, [k]: v } : m))

  // Ширину держим ради читаемости формы, но центрируем: прижатая к левому краю колонка
  // на широком экране выглядит как сбой вёрстки, а не как выбор.
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200">
          {isEdit ? `${t('common.edit')} ${t('reports.title')}` : t('reports.add')}
        </h3>
        <button onClick={onCancel} className="text-xs text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-100">{t('common.cancel')}</button>
      </div>

      {/* Дата отчёта — выбирается календарём (можно поставить задним числом за нужный день).
          Поле «Период» убрано; при смене даты снимок бюджета и ключевые задачи пересчитываются заново. */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('reports.reportDateLabel') + ' *'}</label>
        <input type="date" value={form.report_date} onChange={e => set('report_date', e.target.value)}
          className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2.5 py-1.5" />
        {!isEdit && (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            {t('reports.reportDateHint', { defaultValue: 'Смена даты пересчитает бюджет и ключевые задачи за новый период.' })}
          </p>
        )}
      </div>

      {/* RAG status */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-2">{t('reports.ragStatus')}</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t('reports.overall'), key: 'status_overall' as const },
            { label: t('budget.title'), key: 'status_budget' as const },
            { label: t('reports.timeline'), key: 'status_timeline' as const },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">{label}</label>
              <div className="flex gap-1">
                {(['green', 'amber', 'red'] as const).map(s => (
                  <button key={s} onClick={() => set(key, s)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                      form[key] === s ? `${RAG_COLORS[s]} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}>
                    {s[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('reports.summary')}</label>
        <textarea value={form.summary} onChange={e => set('summary', e.target.value)}
          rows={4} className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5"
          placeholder="Overall project status summary…" />
      </div>

      {/* Key milestones = ключевые задачи (предзаполняются по периоду, можно править/убрать) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-200">{t('reports.milestonesTitle')}</label>
          <button onClick={addMilestone} className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:underline">
            <Plus size={11} /> {t('common.add')}
          </button>
        </div>
        {/* Заголовки и строки — ОДНА grid-раскладка, чтобы колонки совпадали; minmax(0,1fr) не даёт
            строке «вылезать», а w-full на полях держит нативные date-инпуты внутри своих колонок. */}
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {form.milestones.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_9rem_9rem_7rem_1.5rem] gap-2 mb-1 px-0.5 text-[11px] font-medium text-gray-500 dark:text-slate-400">
                <span>{t('reports.mTaskCol', { defaultValue: 'Задача' })}</span>
                <span>{t('reports.mStartCol', { defaultValue: 'Дата начала' })}</span>
                <span>{t('reports.mEndCol', { defaultValue: 'Дата конца' })}</span>
                <span>{t('common.status')}</span>
                <span />
              </div>
            )}
            <div className="space-y-1">
              {form.milestones.map((m, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_9rem_9rem_7rem_1.5rem] gap-2 items-center">
                  <select value={m.name} onChange={e => updateMilestone(i, 'name', e.target.value)}
                    className="w-full min-w-0 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5">
                    <option value="">{t('reports.milestoneName')}</option>
                    {taskTitles.map(tt => <option key={String(tt)} value={String(tt)}>{String(tt)}</option>)}
                    {m.name && !taskTitles.includes(m.name) && <option value={m.name}>{m.name}</option>}
                  </select>
                  <input type="date" value={m.planned_date} onChange={e => updateMilestone(i, 'planned_date', e.target.value)}
                    className="w-full min-w-0 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5" title={t('reports.mStartCol', { defaultValue: 'Дата начала' })} />
                  <input type="date" value={m.actual_date} onChange={e => updateMilestone(i, 'actual_date', e.target.value)}
                    className="w-full min-w-0 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5" title={t('reports.mEndCol', { defaultValue: 'Дата конца' })} />
                  <select value={m.status} onChange={e => updateMilestone(i, 'status', e.target.value)}
                    className="w-full min-w-0 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5">
                    <option value="">{t('common.status')}</option>
                    {milestoneStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button onClick={() => removeMilestone(i)} aria-label={t('common.delete')} className="flex items-center justify-center text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Budget snapshot */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-2">{t('reports.budgetSnapshot')}</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t('reports.budgetPlan'), key: 'budget_plan' as const },
            { label: t('reports.budgetActualLabel'), key: 'budget_actual' as const },
            { label: t('reports.budgetForecastLabel'), key: 'budget_forecast' as const },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">{label}</label>
              <input type="number" value={form[key]} onChange={e => set(key, e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" placeholder="0.00" />
            </div>
          ))}
        </div>
      </div>

      {/* Next steps */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('reports.nextSteps')}</label>
        <textarea value={form.next_steps} onChange={e => set('next_steps', e.target.value)}
          rows={3} className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5"
          placeholder={t('reports.nextStepsPlaceholder')} />
      </div>

      {/* Conclusions */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('reports.conclusions')}</label>
        <textarea value={form.conclusions} onChange={e => set('conclusions', e.target.value)}
          rows={3} className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5"
          placeholder={t('reports.conclusionsPlaceholder')} />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.report_date}
          className="px-4 py-2 text-sm font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
          {saving ? t('common.saving') : isEdit ? t('reports.saveChanges') : t('reports.createReport')}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
