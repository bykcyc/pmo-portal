export interface BaselineTask {
  id: string
  baseline_id: string
  task_id: string
  task_title?: string | null
  planned_start: string | null
  planned_end: string | null
  duration_days: number | null
  progress: number | null
}

export interface Baseline {
  id: string
  project_id: string
  name: string
  description: string | null
  created_at: string
  tasks: BaselineTask[]
}
