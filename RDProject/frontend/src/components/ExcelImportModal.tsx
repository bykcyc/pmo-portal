import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, CheckSquare, Square, Loader2, CheckCircle } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import type { ParsedProject } from '@/utils/excelImport'
import { createProject, getProjects } from '@/api/projects'
import { createTeamMember, createStakeholder, createAssumption } from '@/api/team'
import { createRisk } from '@/api/risks'
import { createKPI, createCommPlanItem } from '@/api/kpi'
import { createBacklogItem, createMeeting } from '@/api/meetings'
import { createBudgetItem } from '@/api/budget'
import { createTask } from '@/api/tasks'
import { useNavigate } from 'react-router-dom'
import { buildProjectPayload } from '@/utils/projectPayload'
import { setSuppressCreateToasts } from '@/api/client'
import { useConfirmStore } from '@/store/confirmStore'

interface Props {
  data: ParsedProject
  onClose: () => void
  /**
   * Привязать созданный проект к зонтику (страница создания знает про `?parent=`).
   *
   * Модалка создаёт проект СВОИМ вызовом `createProject` и сама уводит в паспорт, поэтому
   * без этого хука путь «Импорт из Excel» молча терял привязку: баннер над плитками обещал
   * «новый проект станет подпроектом», а проект получался самостоятельным.
   */
  onCreated?: (projectId: string) => Promise<void>
}

type Section = 'passport' | 'team' | 'stakeholders' | 'assumptions' | 'commPlan' | 'wbs' | 'risks' | 'kpis' | 'backlog' | 'budget' | 'meetings' | 'followups'

const totalTasks = (g: ParsedProject['groups']) => g.reduce((s, g) => s + g.tasks.length, 0)

/** Section id -> project.sections.* label key (followups рендерится отдельным лейблом) */
const SECTION_LABEL: Record<Section, string> = {
  passport: 'passport', team: 'team', stakeholders: 'stakeholders', assumptions: 'assumptions',
  commPlan: 'comm-plan', wbs: 'wbs', risks: 'risks', kpis: 'kpis', backlog: 'backlog',
  budget: 'budget', meetings: 'meetings', followups: 'backlog',
}

export default function ExcelImportModal({ data, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sectionLabel = (s: Section): string =>
    s === 'followups' ? t('meetings.actions', { defaultValue: 'Поручения' }) : t(`project.sections.${SECTION_LABEL[s]}`)
  const [enabled, setEnabled] = useState<Record<Section, boolean>>({
    passport: true, team: true, stakeholders: true, assumptions: true,
    commPlan: true, wbs: true, risks: true, kpis: true, backlog: true,
    budget: true, meetings: true, followups: true,
  })
  const [importing, setImporting] = useState(false)
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [newProjectId, setNewProjectId] = useState<string | null>(null)
  const showConfirm = useConfirmStore((s) => s.show)

  const toggle = (s: Section) => setEnabled(e => ({ ...e, [s]: !e[s] }))

  // Дедуп: если проект с таким же именем (без учёта регистра/пробелов) уже есть — мягко
  // предупреждаем стилизованным диалогом (можно создать копию), но не блокируем импорт.
  const handleImport = async () => {
    const targetName = (data.passport.name || t('import.unnamedProject')).trim().toLowerCase()
    let dup = false
    try {
      const existing = await getProjects({ per_page: 200 })
      dup = existing.data.some((proj) => (proj.name ?? '').trim().toLowerCase() === targetName)
    } catch {
      // Не удалось проверить дубликаты (сеть) — не блокируем импорт, продолжаем как раньше.
    }
    if (dup) {
      showConfirm(t('fix.importDup', { defaultValue: 'Проект с таким названием уже существует. Всё равно создать копию?' }), runImport, { variant: 'primary' })
      return
    }
    void runImport()
  }

  const runImport = async () => {
    const p = data.passport
    setImporting(true); setError(null)
    setSuppressCreateToasts(true)  // не сыпать «Добавлено» на каждую созданную сущность — итог покажем сводкой
    try {
      // 1. Create project (passport always runs)
      setStep(t('import.stepPassport'))
      const project = await createProject(buildProjectPayload({
        name: p.name || t('import.unnamedProject'),
        status: 'planning',
        priority: 'medium',
        client: p.client || null,
        pm_name: p.pm_name || null,
        planned_start: p.planned_start || null,
        planned_end: p.planned_end || null,
        actual_start: '',
        actual_end: '',
        goal: p.goal,
        scope: p.scope,
        project_result: p.project_result,
        key_milestones: p.key_milestones,
        success_criteria: '',
        description: '',
        budget: '',
        budget_currency: 'EUR',
      }))
      const pid = project.id
      setNewProjectId(pid)
      // Привязка к зонтику — сразу после создания и ДО наполнения разделов: если импорт
      // упадёт на середине, проект всё равно окажется там, где его ждут.
      if (onCreated) await onCreated(String(pid))

      // 2. Team
      if (enabled.team) {
        setStep(t('import.stepTeam'))
        for (const m of data.team)
          await createTeamMember(pid, { full_name: m.full_name, position: m.position || null, project_role: m.project_role || null })
      }

      // 3. Stakeholders
      if (enabled.stakeholders) {
        setStep(t('import.stepStakeholders'))
        for (const s of data.stakeholders)
          await createStakeholder(pid, { name: s.name, role: s.role || null, type: s.type })
      }

      // 4. Assumptions
      if (enabled.assumptions) {
        setStep(t('import.stepAssumptions'))
        for (const a of data.assumptions)
          await createAssumption(pid, { description: a.description, type: a.type, status: 'active' })
      }

      // 5. Communication plan
      if (enabled.commPlan) {
        setStep(t('import.stepCommPlan'))
        for (const c of data.commPlan)
          await createCommPlanItem(pid, { goal: c.goal, channel: c.channel || null, audience: c.audience || null, frequency: c.frequency || null, responsible: c.responsible || null })
      }

      // 6. WBS — create phase tasks, then child tasks
      if (enabled.wbs) {
        setStep(t('import.stepWbs'))
        for (const group of data.groups) {
          const phase = await createTask(pid, {
            title: group.title, task_type: 'phase', status: 'not_started', priority: 'medium', progress: 0, parent_id: null,
          })
          for (const task of group.tasks) {
            await createTask(pid, {
              title: task.title, task_type: 'task',
              status: task.status as never, priority: task.priority as never,
              planned_start: task.planned_start || null, planned_end: task.planned_end || null,
              duration_days: task.duration_days, assignee_name: task.assignee_name || null,
              progress: 0, parent_id: phase.id,
            })
          }
        }
      }

      // 7. Risks
      if (enabled.risks) {
        setStep(t('import.stepRisks'))
        for (const r of data.risks)
          await createRisk(pid, { title: r.title, impact: r.impact as never, probability: r.probability as never, mitigation_plan: r.mitigation_plan || null, status: 'open' })
      }

      // 8. KPIs
      if (enabled.kpis) {
        setStep(t('import.stepKpis'))
        for (const k of data.kpis)
          await createKPI(pid, { name: k.name, target: k.target || null, description: k.description || null, formula: k.formula || null, status: 'on_track' })
      }

      // 9. Backlog
      if (enabled.backlog) {
        setStep(t('import.stepBacklog'))
        for (const b of data.backlog)
          await createBacklogItem(pid, { title: b.title, priority: b.priority, status: 'new', requested_by: b.requested_by || null })
      }

      // 10. Budget (Финансы)
      if (enabled.budget) {
        setStep(t('project.sections.budget'))
        for (const bi of data.budget)
          await createBudgetItem(pid, { name: bi.name, category: 'implementation', amount: bi.amount, comments: null })
      }

      // 11. Meetings (Minutes)
      if (enabled.meetings) {
        setStep(t('project.sections.meetings'))
        for (const mt of data.meetings)
          await createMeeting(pid, {
            title: mt.title, meeting_type: mt.meeting_type || null,
            meeting_date: mt.meeting_date || null, meeting_time: mt.meeting_time || null,
            status: 'draft',
            attendees: mt.attendees.map(a => ({ name: a.name, present: a.present, role_dept: null, comments: null })),
            agenda_items: [], actions: [], decisions: [],
          })
      }

      // 12. Followups (журнал поручений) → в бэклог действий
      if (enabled.followups) {
        setStep(t('meetings.actions', { defaultValue: 'Поручения' }))
        for (const fu of data.followups)
          await createBacklogItem(pid, { title: fu.title, priority: 'medium', status: 'open', requested_by: fu.requested_by || null })
      }

      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('import.importFailed'))
    } finally {
      setImporting(false)
      setSuppressCreateToasts(false)
    }
  }

  const sectionCount = (s: Section): number => {
    switch (s) {
      case 'passport': return 1
      case 'team': return data.team.length
      case 'stakeholders': return data.stakeholders.length
      case 'assumptions': return data.assumptions.length
      case 'commPlan': return data.commPlan.length
      case 'wbs': return totalTasks(data.groups)
      case 'risks': return data.risks.length
      case 'kpis': return data.kpis.length
      case 'backlog': return data.backlog.length
      case 'budget': return data.budget.length
      case 'meetings': return data.meetings.length
      case 'followups': return data.followups.length
    }
  }

  // Сводка результата: счётчики по каждому импортированному разделу.
  const importedSummary = (Object.keys(enabled) as Section[])
    .filter(s => enabled[s])
    .map(s => ({ id: s, count: sectionCount(s) }))
    .filter(x => x.count > 0)

  const openProject = () => {
    navigate(`/projects/${newProjectId}/passport`)
  }

  const SectionToggle = ({ id, label, count }: { id: Section; label: string; count: number }) => (
    <button onClick={() => !importing && toggle(id)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors w-full text-left ${enabled[id] ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-100' : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400'}`}>
      {enabled[id] ? <CheckSquare size={14} className="text-primary-600 shrink-0" /> : <Square size={14} className="shrink-0" />}
      <span className="flex-1 font-medium">{label}</span>
      <span className="text-xs text-gray-500 dark:text-slate-400">{count}</span>
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{t('import.title')}</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate max-w-xs">{data.passport.name || t('import.unnamedProject')}</p>
          </div>
          <button onClick={onClose} disabled={importing} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded-md"><X size={16} /></button>
        </div>

        {done ? (
          <div className="px-5 py-6 text-center overflow-y-auto">
            <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-800 dark:text-slate-200 mb-3">{t('import.done')}</p>
            <div className="mb-3 rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-left">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                {t('adopt.importSummary', { defaultValue: 'Что импортировано' })}
              </p>
              <ul className="space-y-0.5">
                {importedSummary.map(({ id, count }) => (
                  <li key={id} className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-300">
                    <span>{sectionLabel(id)}</span>
                    <span className="font-mono text-gray-500 dark:text-slate-400">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
            {data.sheets.missing.length > 0 && (
              <div className="mb-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-left text-xs text-amber-800 dark:text-amber-300">
                {t('adopt.sheetsMissing', {
                  defaultValue: 'Листы не распознаны: {{sheets}} — эти разделы добавите вручную.',
                  sheets: data.sheets.missing.join(', '),
                })}
              </div>
            )}
            {data.sheets.extra.length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-left text-xs text-gray-500 dark:text-slate-400">
                {t('import.sheetsExtra', {
                  defaultValue: 'Не импортированы листы: {{sheets}}.',
                  sheets: data.sheets.extra.join(', '),
                })}
              </div>
            )}
            <button onClick={openProject}
              className="px-5 py-2 bg-btn-primary text-btn-primary-fg text-sm font-medium rounded-lg hover:bg-btn-primary-hover">
              {t('wizard.openPassport', { defaultValue: 'Открыть паспорт проекта' })}
            </button>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-2 overflow-y-auto">
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">{t('import.selectSections')}</p>
              <SectionToggle id="passport" label={t('project.sections.passport')} count={1} />
              <SectionToggle id="team" label={t('project.sections.team')} count={data.team.length} />
              <SectionToggle id="stakeholders" label={t('project.sections.stakeholders')} count={data.stakeholders.length} />
              <SectionToggle id="assumptions" label={t('project.sections.assumptions')} count={data.assumptions.length} />
              <SectionToggle id="commPlan" label={t('project.sections.comm-plan')} count={data.commPlan.length} />
              <SectionToggle id="wbs" label={t('project.sections.wbs')} count={totalTasks(data.groups)} />
              <SectionToggle id="risks" label={t('project.sections.risks')} count={data.risks.length} />
              <SectionToggle id="kpis" label={t('project.sections.kpis')} count={data.kpis.length} />
              <SectionToggle id="backlog" label={t('project.sections.backlog')} count={data.backlog.length} />
              <SectionToggle id="budget" label={t('project.sections.budget')} count={data.budget.length} />
              <SectionToggle id="meetings" label={t('project.sections.meetings')} count={data.meetings.length} />
              <SectionToggle id="followups" label={sectionLabel('followups')} count={data.followups.length} />
            </div>

            {error && (
              <div className="mx-5 mb-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300 shrink-0">
                <p>{error}</p>
                {newProjectId && (
                  <button onClick={() => navigate(`/projects/${newProjectId}/passport`)}
                    className="mt-1.5 font-medium text-red-800 dark:text-red-200 underline hover:no-underline">
                    {t('adopt.openCreatedProject', { defaultValue: 'Открыть созданный проект' })}
                  </button>
                )}
              </div>
            )}
            {importing && step && (
              <div className="mx-5 mb-3 flex items-center gap-2 text-xs text-primary-600 shrink-0">
                <Loader2 size={ICON_SM} className="animate-spin" />{step}
              </div>
            )}

            <div className="flex gap-2 justify-end px-5 py-4 border-t border-gray-100 dark:border-slate-800 shrink-0">
              <button onClick={onClose} disabled={importing}
                className="px-4 py-2 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50">
                {t('common.cancel')}
              </button>
              <button onClick={handleImport} disabled={importing}
                className="px-4 py-2 text-sm bg-btn-primary text-btn-primary-fg font-medium rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 flex items-center gap-2">
                {importing && <Loader2 size={ICON_SM} className="animate-spin" />}
                {importing ? t('import.importing') : t('import.import')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
