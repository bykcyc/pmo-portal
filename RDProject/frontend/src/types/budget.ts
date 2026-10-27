export interface BudgetMonthlyEntry {
  id: string
  budget_item_id: string
  year: number
  month: number
  planned: number | null
  actual: number | null
  /** Факт часами: подрядчик отчитывается часами по блокам, деньги считает сервер по ставке. */
  actual_hours?: number | null
}

export type BudgetKind = 'expense' | 'income'

export interface BudgetItem {
  id: string
  project_id: string
  name: string
  kind?: BudgetKind
  category: 'implementation' | 'operational' | 'revenue'
  wbs_task_id: string | null
  equipment_units: number | null
  equipment_amount: number | null
  labour_hours: number | null
  labour_amount: number | null
  materials_units: number | null
  materials_amount: number | null
  contractors_units: number | null
  contractors_amount: number | null
  amount: number | null
  forecast_total: number | null
  actual_total: number | null
  /** Легаси-поля старых импортов. Сервер их читает (domain._budget_planned/_budget_actual),
   *  поэтому читает и фронт — иначе у старого проекта таблица и сводка расходятся. */
  planned_amount?: number | null
  actual_amount?: number | null
  comments: string | null
  sort_order: number
  monthly?: BudgetMonthlyEntry[]
  /** План часами. Сумму из них считает СЕРВЕР при записи — ставка не переписывает прошлое. */
  planned_hours?: number | null
  /** Блок бюджета зонтика, к которому отнесена статья. Ставит только сервер (свой маршрут). */
  parent_item_id?: string | null
}

export interface BudgetCategoryRow {
  category: string
  planned: number
  actual: number
}

export interface BudgetMonthlyPoint {
  month: string
  planned: number
  actual: number
  cum_planned: number
  cum_actual: number
}

export interface BudgetSummary {
  total_planned: number
  total_actual: number
  total_variance: number
  expense_planned?: number
  expense_actual?: number
  income_planned?: number
  income_actual?: number
  profit_planned?: number
  profit_actual?: number
  target?: number | null
  income_target?: number | null
  years?: number[]
  currency?: string
  items_count?: number
  by_category?: BudgetCategoryRow[]
  monthly?: BudgetMonthlyPoint[]
  /** Ставка часа: своя или унаследованная от зонтика (rate_inherited говорит какая). */
  rate?: number | null
  rate_inherited?: boolean
  parent_project_id?: string | null
  subprojects_count?: number
}

/** Блок бюджета зонтика в сводке по дереву. */
export interface ConsolidatedBlock {
  item_id: string
  name: string
  category: string
  planned: number
  planned_hours?: number | null
  own_actual: number
  by_child: { project_id: string; project_code: string; project_name: string; currency: string; item_name: string; planned: number; actual: number }[]
  consumed_by_children: number
  consumed: number
  remaining: number
}

/** Блок глазами подпроекта: остаток по всему дереву и МОЯ доля. Соседей по именам не называем. */
export interface ConsolidatedShare {
  item_id: string
  name: string
  category: string
  planned: number
  consumed: number
  remaining: number
  my_actual: number
}

export interface ConsolidatedBudget {
  view: 'umbrella' | 'subproject' | 'none'
  project_id?: string
  currency?: string
  currencies?: string[]
  rate?: number | null
  blocks?: ConsolidatedBlock[] | ConsolidatedShare[]
  orphans?: { project_id: string; project_code: string; project_name: string; item_name: string; parent_item_id: string; planned: number; actual: number }[]
  unattributed?: { project_id: string; project_code: string; project_name: string; planned: number; actual: number }[]
  /** Подпроекты в ДРУГОЙ валюте: в суммы блоков не входят (пересчёта в портале нет), но названы. */
  foreign_currency?: { project_id: string; project_code: string; project_name: string; currency: string; actual: number }[]
  totals?: { planned: number; own_actual: number; consumed_by_children: number; consumed: number; remaining: number; orphan_actual: number; unattributed_actual: number }
  parent_project_id?: string
  parent_code?: string | null
  parent_name?: string | null
}
