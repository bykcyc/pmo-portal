export interface CommPlanItem {
  id: string
  project_id: string
  goal: string
  channel: string | null
  audience: string | null
  frequency: string | null
  responsible: string | null
  sort_order: number
}

export interface KPI {
  id: string
  project_id: string
  name: string
  target: string | null
  description: string | null
  formula: string | null
  current_value: string | null
  unit: string | null
  status: 'on_track' | 'at_risk' | 'off_track'
  sort_order: number
}
