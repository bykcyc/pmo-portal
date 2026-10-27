import api from './client'

export interface PortfolioProject {
  id: string
  code: string
  name: string
  status: string
  priority: string
  client?: string | null
  program?: string | null
  /** Дерево: зонтик этого проекта и сколько у него самого подпроектов. Группировку строит фронт. */
  parent_id?: string | null
  parent_code?: string | null
  subprojects_count?: number
  pm_name?: string | null
  planned_end?: string | null
  progress: number
  total_tasks: number
  overdue_tasks_count: number
  open_risks_high_count: number
  open_risks_medium_count: number
  baseline_deviation_days?: number | null
  // Сумма плановых расходных статей бюджета проекта (или null, если статей нет).
  budget_plan?: number | null
  /** Израсходовано подпроектами по блокам этого зонтика. Только для показа — ни в один итог
   *  портфеля не входит: иначе деньги модуля посчитались бы и у него, и у программы. */
  budget_consumed?: number | null
  budget_consumed_projects?: number
  budget_actual?: number
  budget_currency?: string
  tasks_completed?: number
  project_kind?: string | null // значения — PROJECT_KIND_OPTIONS (constants/project.ts)
  rag_status?: string | null
  attention_required?: boolean
  health?: number
  archived?: boolean
}

export interface PortfolioStats {
  total: number
  planning: number
  active: number
  on_hold: number
  completed: number
  cancelled: number
  overdue: number
  red: number
  amber: number
  green: number
}

export interface PortfolioDashboardData {
  data: PortfolioProject[]
  stats: PortfolioStats
}

export async function getPortfolioDashboard(
  params?: {
    status?: string
    priority?: string
    pm_id?: string
    kind?: string // серверный фильтр по виду проекта (project_kind)
  },
  includeArchived = false,
): Promise<PortfolioDashboardData> {
  const query = includeArchived ? { ...params, include_archived: true } : params
  const r = await api.get('/portfolio/dashboard', { params: query })
  return r.data
}

// ---------- P3: аналитика портфеля ----------
export interface TrendPoint {
  date: string
  red: number; amber: number; green: number
  risks_high: number; risks_medium: number
  overdue_tasks: number; tasks_total: number
  /** Накопленное число выполненных задач. У старых снимков сервер выводит его из прогресса. */
  tasks_completed?: number
  budget_plan: number; progress_avg: number; projects: number
}
export interface WorkloadRow {
  assignee: string; open_tasks: number; overdue: number; duration_days: number
  estimated_hours?: number; actual_hours?: number
  projects_count?: number; overloaded?: boolean
}
export interface RiskHeatmap { cells: Record<string, number>; total: number }
export interface MilestoneRow {
  project_id: string; project_code: string; id: string
  title: string | null; date: string; status: string | null
}

export async function getPortfolioTrends(days = 90): Promise<TrendPoint[]> {
  const r = await api.get('/portfolio/trends', { params: { days } })
  return r.data.data
}
export async function getPortfolioWorkload(): Promise<WorkloadRow[]> {
  const r = await api.get('/portfolio/workload')
  return r.data.data
}
export async function getPortfolioRiskHeatmap(): Promise<RiskHeatmap> {
  const r = await api.get('/portfolio/risk-heatmap')
  return r.data.data
}
export async function getPortfolioMilestones(): Promise<MilestoneRow[]> {
  const r = await api.get('/portfolio/milestones')
  return r.data.data
}

/** Пороги перегрузки для графиков портфеля (их видит и руководство, не только владелец). */
export interface WorkloadLimits { tasks: number; hours: number; pm_projects: number }
export async function getPortfolioThresholds(): Promise<WorkloadLimits> {
  const r = await api.get('/portfolio/thresholds')
  return r.data.data
}

export interface PortfolioRisk {
  project_id: string; project_code: string; id: string
  title: string | null; probability: string | null; impact: string | null
  score: number | null; status: string | null
}
export async function getPortfolioRisks(probability?: string, impact?: string): Promise<PortfolioRisk[]> {
  const r = await api.get('/portfolio/risks', { params: { probability, impact } })
  return r.data.data
}
