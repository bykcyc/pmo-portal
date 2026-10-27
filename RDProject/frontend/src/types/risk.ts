export interface RiskUpdate {
  id: string
  risk_id: string
  update_text: string
  author_id: string | null
  created_at: string
}

export interface Risk {
  id: string
  project_id: string
  code: string | null
  title: string
  description: string | null
  category: string | null
  probability: 'low' | 'medium' | 'high' | null
  impact: 'low' | 'medium' | 'high' | null
  score: number | null
  status: 'open' | 'mitigated' | 'accepted' | 'closed' | 'occurred'
  owner: string | null
  mitigation_plan: string | null
  contingency_plan: string | null
  related_task_id: string | null
  created_at: string
  updates: RiskUpdate[]
}
