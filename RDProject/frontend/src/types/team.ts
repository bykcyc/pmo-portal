export interface TeamMember {
  id: string
  project_id: string
  full_name: string
  position: string | null
  project_role: string | null
  email: string | null
  phone: string | null
  user_id: string | null
  sort_order: number
}

export interface Stakeholder {
  id: string
  project_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  type: 'internal' | 'external'
  influence: string | null
  interest: string | null
  engagement_strategy: string | null
  notes: string | null
  sort_order: number
}

export interface Assumption {
  id: string
  project_id: string
  type: 'assumption' | 'constraint' | 'dependency' | null
  description: string
  owner: string | null
  status: 'active' | 'confirmed' | 'invalid'
  created_at: string
  sort_order?: number
}
