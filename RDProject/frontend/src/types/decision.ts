export interface Decision {
  id: string
  project_id: string
  code: string | null
  date: string | null
  title: string
  description: string | null
  rationale: string | null
  alternatives: string | null
  impact: string | null
  decided_by: string | null
  related_task_id: string | null
  status: 'active' | 'superseded' | 'revoked'
  created_at: string
}
