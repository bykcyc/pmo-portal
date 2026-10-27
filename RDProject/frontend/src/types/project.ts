export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
export type ProjectPriority = 'critical' | 'high' | 'medium' | 'low'

export interface PMInfo {
  id: string
  full_name: string
  email: string
}

export interface ProjectFieldChange {
  field: string
  old_value: unknown
  new_value: unknown
}

export interface Project {
  id: string
  code: string
  name: string
  status: ProjectStatus
  priority: ProjectPriority
  project_kind?: string | null
  pm_id: string | null
  pm: PMInfo | null
  client: string | null
  pm_name: string | null
  version: string | null
  version_date: string | null
  goal: string[] | null
  scope: string[] | null
  project_result: string[] | null
  success_criteria: string | null
  key_milestones: string[] | null
  description: string | null
  budget: number | null
  budget_currency: string | null
  planned_start: string | null
  planned_end: string | null
  actual_start: string | null
  actual_end: string | null
  /** PULL-синк задач из Bitrix: ISO-дата последней синхронизации (или null, если ни разу). */
  bitrix_last_sync?: string | null
  editors?: string[]
  /** Наблюдатели: видят проект целиком, править не могут. Разделение обеспечивает сервер. */
  observers?: string[]
  /** Зонтик, частью которого является проект (null — проект сам по себе). */
  parent_id?: string | null
  parent_code?: string | null
  parent_name?: string | null
  /** Сколько подпроектов у этого проекта. >0 — значит он зонтик. */
  subprojects_count?: number
  /**
   * Права, полученные ПО ДЕРЕВУ, а не назначенные в этом проекте: РП и со-РП зонтика правят
   * подпроект; участники подпроектов и наблюдатели зонтика читают дерево. Считает сервер
   * (db._TREE_CTE) — здесь они только для того, чтобы интерфейс знал, что покажется живым,
   * и чтобы подписать роль в списке.
   */
  inherited_editors?: string[]
  inherited_observers?: string[]
  archived?: boolean
  is_template?: boolean
  created_at: string
  updated_at: string
}

export interface ProjectListItem {
  id: string
  code: string
  name: string
  status: ProjectStatus
  priority: ProjectPriority
  project_kind?: string | null
  pm_id: string | null
  pm_name: string | null
  planned_start: string | null
  planned_end: string | null
  editors?: string[]
  /** Наблюдатели: видят проект целиком, править не могут. Разделение обеспечивает сервер. */
  observers?: string[]
  /** Зонтик, частью которого является проект (null — проект сам по себе). */
  parent_id?: string | null
  parent_code?: string | null
  parent_name?: string | null
  /** Сколько подпроектов у этого проекта. >0 — значит он зонтик. */
  subprojects_count?: number
  /**
   * Права, полученные ПО ДЕРЕВУ, а не назначенные в этом проекте: РП и со-РП зонтика правят
   * подпроект; участники подпроектов и наблюдатели зонтика читают дерево. Считает сервер
   * (db._TREE_CTE) — здесь они только для того, чтобы интерфейс знал, что покажется живым,
   * и чтобы подписать роль в списке.
   */
  inherited_editors?: string[]
  inherited_observers?: string[]
  archived?: boolean
  is_template?: boolean
  progress?: number
  tasks_total?: number
  tasks_completed?: number
  created_at: string
}

export interface ProjectSummary {
  project_id: string
  tasks_total: number
  tasks_completed: number
  risks_open: number
  decisions_total: number
  open_actions: number
}

export interface ProjectVersionLogEntry {
  id: string
  version: string
  changed_fields: ProjectFieldChange[] | null
  author_name: string | null
  created_at: string
}
