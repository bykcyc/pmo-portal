/** Соисполнитель задачи. `person_id` пуст, если имя не нашлось в справочнике людей —
 *  тогда портал не сможет показать такому человеку задачу в «Моих задачах». */
export interface CoAssignee {
  person_id: string | null
  name: string
  email: string | null
}

export type TaskType = 'phase' | 'task' | 'milestone'
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled' | 'on_hold'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

export interface Task {
  id: string
  project_id: string
  parent_id: string | null
  wbs_code: string | null
  title: string
  description: string | null
  task_type: TaskType
  status: TaskStatus
  priority: TaskPriority
  planned_start: string | null
  planned_end: string | null
  actual_start: string | null
  actual_end: string | null
  duration_days: number | null
  estimated_hours: number | null
  actual_hours: number | null
  progress: number
  assignee_name: string | null
  assignee_email: string | null
  /** Стабильная идентичность исполнителя (persons.id). name/email сервер держит согласованно с ней.
   *  null — свободный текст (роли из импорта: «IT lead», «Отдел контента»). */
  assignee_person_id?: string | null
  /** Соисполнители: участвуют в работе, но отвечает за задачу по-прежнему один человек. */
  co_assignees?: CoAssignee[]
  bar_color: string | null
  bitrix24_task_id: number | null
  sort_order: number
  level: number
  created_at: string
}

export interface TaskNode extends Task {
  children: TaskNode[]
}
