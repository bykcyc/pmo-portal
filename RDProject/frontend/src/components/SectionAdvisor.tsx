import { planMilestones } from '@/utils/milestones'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { SectionCard } from '@/components/ui/surface'
import { getTasks } from '@/api/tasks'
import { getGanttData, type GanttData } from '@/api/gantt'
import { getRisks } from '@/api/risks'
import { getStakeholders, getAssumptions } from '@/api/team'
import { getCommPlan, getKPIs } from '@/api/kpi'
import { getDecisions } from '@/api/decisions'
import { getBudgetItems, getBudgetSummary } from '@/api/budget'
import { getBacklog, getMeetings } from '@/api/meetings'
import { getReports } from '@/api/reports'
import { getBaselines } from '@/api/baselines'
import { hasProjectListContent } from '@/utils/projectPayload'
import { freeOf, kindOf } from '@/utils/budgetCalc'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'
import type { Risk } from '@/types/risk'
import type { TeamMember, Stakeholder, Assumption } from '@/types/team'
import type { CommPlanItem, KPI } from '@/types/kpi'
import type { Decision } from '@/types/decision'
import type { BudgetItem, BudgetSummary } from '@/types/budget'
import type { BacklogItem, Meeting } from '@/types/meeting'
import type { StatusReport } from '@/types/report'
import type { Baseline } from '@/types/baseline'

/** Контекстные подсказки правой панели: диагностика ТЕКУЩЕЙ секции —
 *  что не так и что сделать дальше, либо «всё в порядке».
 *  Данные читаются из того же react-query кэша, что и вкладки (ключи совпадают),
 *  поэтому лишних запросов почти нет — вкладка уже загрузила их. */

interface Diag { id: string; text: string }

const isPast = (d?: string | null): boolean => {
  if (!d) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(d) < today
}
const daysAgo = (d?: string | null): number => {
  if (!d) return 0
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}
const openTask = (t: Task) => t.status !== 'completed' && t.status !== 'cancelled'

// ── конфигурация данных секции: те же queryKey/fn, что у вкладок ──
function primaryCfg(section: string, pid: string): { key: (string | object)[]; fn: () => Promise<unknown> } | null {
  switch (section) {
    // Паспорту нужны задачи: «основные этапы» — это фазы Плана работ, а не поле паспорта.
    case 'passport': return { key: ['tasks', pid], fn: () => getTasks(pid) }
    case 'stakeholders': return { key: ['stakeholders', pid], fn: () => getStakeholders(pid) }
    case 'assumptions': return { key: ['assumptions', pid], fn: () => getAssumptions(pid) }
    case 'comm-plan': return { key: ['comm_plan', pid], fn: () => getCommPlan(pid) }
    case 'kpis': return { key: ['kpis', pid], fn: () => getKPIs(pid) }
    case 'wbs': case 'gantt': case 'kanban': return { key: ['tasks', pid], fn: () => getTasks(pid) }
    case 'baseline': return { key: ['baselines', pid], fn: () => getBaselines(pid) }
    case 'risks': return { key: ['risks', pid], fn: () => getRisks(pid) }
    case 'decisions': return { key: ['decisions', pid], fn: () => getDecisions(pid, {}) }
    case 'budget': return { key: ['budget', pid], fn: () => getBudgetItems(pid) }
    case 'backlog': return { key: ['backlog', pid], fn: () => getBacklog(pid) }
    case 'meetings': return { key: ['meetings', pid], fn: () => getMeetings(pid) }
    case 'reports': return { key: ['reports', pid], fn: () => getReports(pid) }
    default: return null // passport/team — данные уже загружены страницей
  }
}
function secondaryCfg(section: string, pid: string): { key: (string | object)[]; fn: () => Promise<unknown> } | null {
  switch (section) {
    case 'gantt': return { key: ['gantt', pid], fn: () => getGanttData(pid) }
    case 'baseline': return { key: ['tasks', pid], fn: () => getTasks(pid) }
    case 'budget': return { key: ['budget_summary', pid], fn: () => getBudgetSummary(pid) }
    case 'reports': return { key: ['risks', pid], fn: () => getRisks(pid) }
    default: return null
  }
}

// ── диагностика по секциям ──
function diagnose(section: string, t: TFunction, ctx: {
  project?: Project; team: TeamMember[]; a: unknown; b: unknown
}): Diag[] {
  const { project, team, a, b } = ctx
  const out: Diag[] = []
  const add = (id: string, key: string, dv: string, count?: number) => {
    if (count !== undefined && count <= 0) return
    out.push({ id, text: t(key, { defaultValue: dv, count }) })
  }

  switch (section) {
    case 'passport': {
      if (!project) return []
      const coreOk = hasProjectListContent(project.goal) && project.planned_end && (project.pm_name || project.pm?.full_name)
      if (!coreOk) add('core', 'advisor.passport.core', 'Заполните цель, РП и плановое завершение — это минимум паспорта.')
      if (project.planned_start && project.planned_end && project.planned_start > project.planned_end)
        add('dates', 'advisor.passport.dates', 'Плановое начало позже завершения — поправьте даты.')
      if (!hasProjectListContent(project.scope))
        add('content', 'advisor.passport.content', 'Опишите объём в блоке «Содержание».')
      // Опорные точки — это План работ: фазы, а если их нет, задачи верхнего уровня. Советник
      // просит заполнить план только когда там пусто совсем. Раньше он требовал именно фаз — и
      // у проекта с пятнадцатью задачами и без фаз краснел вечно, хотя показывать было что.
      if (!planMilestones(((a as Task[] | undefined) ?? [])).length)
        add('phases', 'advisor.passport.phases', 'Отчётные точки берутся из Плана работ — добавьте фазы или задачи.')
      if (project.status === 'active' && !project.actual_start)
        add('actualStart', 'advisor.passport.actualStart', 'Проект активен, а фактическое начало не заполнено.')
      if (project.status === 'completed' && !project.actual_end)
        add('actualEnd', 'advisor.passport.actualEnd', 'Проект завершён, а фактическое завершение не заполнено.')
      break
    }
    case 'team': {
      if (team.length === 0) { add('empty', 'advisor.team.empty', 'Команда пуста — добавьте участников из справочника.'); break }
      add('noRole', 'advisor.team.noRole', 'Без роли в проекте: {{count}} — заполните колонку «Роль в проекте».', team.filter(m => !m.project_role).length)
      add('noEmail', 'advisor.team.noEmail', 'Без email: {{count}} — уведомления до них не дойдут.', team.filter(m => !m.email).length)
      break
    }
    case 'stakeholders': {
      const rows = (a as Stakeholder[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.stakeholders.empty', 'Список пуст — добавьте хотя бы спонсора и заказчика.'); break }
      add('unscored', 'advisor.stakeholders.unscored', 'Без оценок влияния и интереса: {{count}} — они не попадут в матрицу.', rows.filter(s => !s.influence || !s.interest).length)
      add('noStrategy', 'advisor.stakeholders.noStrategy', 'Влиятельных без стратегии вовлечения: {{count}} — запишите, как с ними работать.', rows.filter(s => Number(s.influence) > 5.5 && !s.engagement_strategy).length)
      break
    }
    case 'assumptions': {
      const rows = (a as Assumption[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.assumptions.empty', 'Список пуст — зафиксируйте допущения, ограничения и зависимости.'); break }
      add('noType', 'advisor.assumptions.noType', 'Без типа: {{count}} — классифицируйте пункты.', rows.filter(r => !r.type).length)
      add('noOwner', 'advisor.assumptions.noOwner', 'Без владельца: {{count}} — назначьте ответственного.', rows.filter(r => !r.owner).length)
      add('invalid', 'advisor.assumptions.invalid', 'Опровергнутых: {{count}} — проверьте, учтены ли последствия в плане и рисках.', rows.filter(r => r.status === 'invalid').length)
      break
    }
    case 'comm-plan': {
      const rows = (a as CommPlanItem[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.commPlan.empty', 'План пуст — добавьте 2–3 регулярные коммуникации.'); break }
      add('noResponsible', 'advisor.commPlan.noResponsible', 'Без ответственного: {{count}} — выберите владельца пункта.', rows.filter(r => !r.responsible).length)
      add('noFrequency', 'advisor.commPlan.noFrequency', 'Без частоты: {{count}} — задайте регулярность.', rows.filter(r => !r.frequency).length)
      break
    }
    case 'kpis': {
      const rows = (a as KPI[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.kpis.empty', 'KPI нет — добавьте 3–5 измеримых целей.'); break }
      if (rows.length < 3) add('few', 'advisor.kpis.few', 'KPI меньше трёх — добавьте ещё, чтобы мерить успех с разных сторон.')
      add('offTrack', 'advisor.kpis.offTrack', 'В статусе «Отклонение»: {{count}} — нужен план действий.', rows.filter(r => r.status === 'off_track').length)
      add('noFormula', 'advisor.kpis.noFormula', 'Без формулы: {{count}} — запишите, как считается метрика.', rows.filter(r => !r.formula).length)
      break
    }
    case 'wbs': case 'gantt': case 'kanban': {
      const tasks = ((a as Task[] | undefined) ?? []).filter(tk => tk.task_type !== 'phase')
      if (tasks.length === 0) {
        add('empty', section === 'kanban' ? 'advisor.kanban.empty' : 'advisor.wbs.empty',
          section === 'kanban' ? 'Доска пуста — добавьте задачи в Плане работ (WBS).' : 'План пуст — добавьте фазы и задачи (кнопки «Фаза» и «Массово»).')
        break
      }
      add('noDates', 'advisor.wbs.noDates', 'Задач без плановых дат: {{count}} — заполните сроки.', tasks.filter(tk => !tk.planned_start || !tk.planned_end).length)
      add('overdue', 'advisor.wbs.overdue', 'Просрочено: {{count}} — обновите статус или передвиньте сроки.', tasks.filter(tk => openTask(tk) && isPast(tk.planned_end)).length)
      if (section === 'wbs')
        add('noAssignee', 'advisor.wbs.noAssignee', 'Без исполнителя: {{count}} — назначьте ответственных.', tasks.filter(tk => openTask(tk) && !tk.assignee_name).length)
      if (section === 'gantt') {
        const links = (b as GanttData | undefined)?.links ?? []
        if (tasks.length > 1 && links.length === 0)
          add('noLinks', 'advisor.gantt.noLinks', 'Связей между задачами нет — протяните зависимости мышью, и сроки будут сдвигаться сами.')
      }
      if (section === 'kanban')
        add('onHold', 'advisor.kanban.onHold', 'Приостановленных: {{count}} — разберите блокеры.', tasks.filter(tk => tk.status === 'on_hold').length)
      break
    }
    case 'baseline': {
      const snaps = (a as Baseline[] | undefined) ?? []
      const tasks = ((b as Task[] | undefined) ?? []).filter(tk => tk.task_type !== 'phase')
      if (snaps.length === 0) { add('none', 'advisor.baseline.none', 'Снимков нет — нажмите «Сохранить базовый план», чтобы зафиксировать обещанные сроки.'); break }
      const latest = snaps[snaps.length - 1]
      const snapIds = new Set((latest?.tasks ?? []).map(bt => String(bt.task_id)))
      add('newTasks', 'advisor.baseline.newTasks', 'Новых задач после снимка: {{count}} — сохраните новый снимок при пересогласовании.', tasks.filter(tk => !snapIds.has(String(tk.id))).length)
      add('noDates', 'advisor.baseline.noDates', 'Задач без дат: {{count}} — заполните сроки в WBS, иначе снимок неполный.', tasks.filter(tk => !tk.planned_start || !tk.planned_end).length)
      break
    }
    case 'risks': {
      const rows = (a as Risk[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.risks.empty', 'Реестр пуст — запишите 3–5 главных угроз проекта.'); break }
      const open = rows.filter(r => r.status === 'open')
      add('unscored', 'advisor.risks.unscored', 'Без оценки: {{count}} — выберите вероятность и воздействие.', rows.filter(r => !r.probability || !r.impact).length)
      add('noMitigation', 'advisor.risks.noMitigation', 'Критичных без плана митигации: {{count}} — опишите, как их предотвратить.', open.filter(r => (r.score ?? 0) >= 6 && !r.mitigation_plan).length)
      add('noOwner', 'advisor.risks.noOwner', 'Открытых без владельца: {{count}} — назначьте ответственного.', open.filter(r => !r.owner).length)
      break
    }
    case 'decisions': {
      const rows = (a as Decision[] | undefined) ?? []
      if (rows.length === 0) { add('empty', 'advisor.decisions.empty', 'Журнал пуст — добавьте решение или финализируйте совещание с решениями.'); break }
      add('noRationale', 'advisor.decisions.noRationale', 'Активных без обоснования: {{count}} — впишите, почему решили именно так.', rows.filter(r => r.status === 'active' && !r.rationale).length)
      add('noDate', 'advisor.decisions.noDate', 'Без даты: {{count}} — заполните дату принятия.', rows.filter(r => !r.date).length)
      break
    }
    case 'budget': {
      const items = (a as BudgetItem[] | undefined) ?? []
      const summary = b as BudgetSummary | undefined
      if (items.length === 0) { add('empty', 'advisor.budget.empty', 'Статей нет — добавьте первые расходы, бюджет сложится сам.'); break }
      const ep = summary?.expense_planned ?? 0
      if ((summary?.target ?? 0) > 0 && ep > (summary?.target ?? 0))
        add('overLimit', 'advisor.budget.overLimit', 'План расходов превышает утверждённый лимит — урежьте статьи или обновите лимит.')
      add('unallocated', 'advisor.budget.unallocated', 'Не расписаны по месяцам: {{count}} — распределите остаток в «Помесячном плане».', items.filter(i => (freeOf(i) ?? 0) > 0).length)
      if ((summary?.income_target ?? 0) > 0 && (summary?.income_planned ?? 0) < (summary?.income_target ?? 0))
        add('incomeBelow', 'advisor.budget.incomeBelow', 'Ожидаемый доход ниже цели — добавьте доходные статьи или скорректируйте цель.')
      if (items.some(i => kindOf(i) === 'expense') && (summary?.expense_actual ?? 0) === 0)
        add('noActuals', 'advisor.budget.noActuals', 'Факт ещё не вносился — заполняйте строку «Факт» в помесячном плане.')
      break
    }
    case 'backlog': {
      const rows = (a as BacklogItem[] | undefined) ?? []
      add('approved', 'advisor.backlog.approved', 'Утверждённых ждут переноса в WBS: {{count}} — нажмите стрелку в строке.', rows.filter(r => r.status === 'approved').length)
      add('criticalNew', 'advisor.backlog.criticalNew', 'Критических без разбора: {{count}} — рассмотрите их в первую очередь.', rows.filter(r => r.priority === 'critical' && r.status === 'new').length)
      add('stale', 'advisor.backlog.stale', 'Новых без разбора больше 14 дней: {{count}} — рассмотрите или отклоните.', rows.filter(r => r.status === 'new' && daysAgo(r.created_at) > 14).length)
      break
    }
    case 'meetings': {
      const rows = (a as Meeting[] | undefined) ?? []
      const drafts = rows.filter(m => m.status !== 'final')
      add('pastDrafts', 'advisor.meetings.pastDrafts', 'Прошедших не завершённых: {{count}} — нажмите «Завершить», решения и задачи разойдутся сами.', drafts.filter(m => isPast(m.meeting_date)).length)
      add('actionsIncomplete', 'advisor.meetings.actionsIncomplete', 'Задач встреч без исполнителя или срока: {{count}} — заполните до завершения.',
        drafts.reduce((s, m) => s + (m.actions || []).filter(x => !x.assignee_name || !x.due_date).length, 0))
      if (rows.length > 0 && !rows.some(m => m.meeting_date && !isPast(m.meeting_date)))
        add('noUpcoming', 'advisor.meetings.noUpcoming', 'Нет запланированных встреч — создайте следующую или используйте «Повторить».')
      break
    }
    case 'reports': {
      const rows = (a as StatusReport[] | undefined) ?? []
      if (rows.length === 0) { add('none', 'advisor.reports.none', 'Отчётов нет — «Новый отчёт»: 10 минут, и статус виден без звонков.'); break }
      const latest = [...rows].sort((x, y) => String(x.report_date).localeCompare(String(y.report_date)))[rows.length - 1]
      if (daysAgo(latest?.report_date) > 14) add('stale', 'advisor.reports.stale', 'Последний отчёт старше 14 дней — создайте свежий.')
      const rag = [latest?.status_overall, latest?.status_budget, latest?.status_timeline]
      if (rag.some(s => s === 'amber' || s === 'red' || s === 'yellow') && !latest?.next_steps)
        add('ragNoSteps', 'advisor.reports.ragNoSteps', 'Есть жёлтый/красный статус, но пусто «Следующие шаги» — допишите план действий.')
      const risks = (b as Risk[] | undefined) ?? []
      if (latest?.status_overall === 'green' && risks.some(r => r.status === 'open' && (r.score ?? 0) >= 6))
        add('greenHighRisks', 'advisor.reports.greenHighRisks', 'Высокие риски при зелёном статусе — перепроверьте RAG или опишите риски.')
      break
    }
  }
  return out
}

export default function SectionAdvisor({ section, projectId, project, team }: {
  section: string; projectId: string; project?: Project; team: TeamMember[]
}) {
  const { t } = useTranslation()
  const pCfg = primaryCfg(section, projectId)
  const sCfg = secondaryCfg(section, projectId)

  const { data: a, isLoading: la } = useQuery({
    queryKey: pCfg?.key ?? ['advisor-none', section],
    queryFn: pCfg?.fn ?? (async () => null),
    enabled: !!pCfg,
    staleTime: 15000,
  })
  const { data: b, isLoading: lb } = useQuery({
    queryKey: sCfg?.key ?? ['advisor-none2', section],
    queryFn: sCfg?.fn ?? (async () => null),
    enabled: !!sCfg,
    staleTime: 15000,
  })

  if ((pCfg && la) || (sCfg && lb)) return null
  const diags = diagnose(section, t, { project, team, a, b })

  return (
    <SectionCard title={t('advisor.title', { defaultValue: 'На этой странице' })} className="overflow-hidden">
      {diags.length === 0 ? (
        <p className="flex items-start gap-2 text-xs leading-5 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          {t('advisor.allGood', { defaultValue: 'Всё в порядке — раздел в хорошем состоянии.' })}
        </p>
      ) : (
        <ul className="space-y-2">
          {diags.slice(0, 5).map(d => (
            <li key={d.id} className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span>{d.text}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
