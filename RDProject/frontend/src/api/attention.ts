import apiClient from './client'

export interface AttentionItem {
  project_id: string
  project_code: string
  section: string
  id: string
  title: string | null
  assignee?: string | null
  planned_end?: string | null
  due_date?: string | null
  date?: string | null
  status?: string | null
  priority?: string | null
  overdue?: boolean
  /**
   * `access_request` — по уведомлению не переходят, а решают: форма подтверждения/отказа.
   * `access_decision` — ответ на МОЙ запрос доступа.
   * `problem_resolved` — «проблема, о которой вы сообщили, решена».
   */
  kind?: 'access_request' | 'access_decision' | 'problem_resolved'
  request_id?: string
  report_id?: string
  decided_by?: string | null
  page_url?: string | null
  project_name?: string
  note?: string | null
  created_at?: string
}

export type AttentionGroupKey =
  | 'overdue' | 'due_soon' | 'no_dates' | 'stalled' | 'meetings' | 'actions' | 'access'
  | 'access_decided' | 'problem_resolved'

export interface AttentionResponse {
  data: Record<AttentionGroupKey, AttentionItem[]>
  counts: Record<AttentionGroupKey, number> & { total: number }
}

export async function getAttention(days = 7): Promise<AttentionResponse> {
  const { data } = await apiClient.get<AttentionResponse>(`/attention?days=${days}`)
  return data
}
