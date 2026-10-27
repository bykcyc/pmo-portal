export interface EntityNote {
  id: string
  project_id: string
  entity_type: string
  entity_id: string
  content: string
  author_id: string | null
  created_at: string
}
