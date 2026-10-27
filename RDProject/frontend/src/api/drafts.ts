import apiClient from './client'

/** Что предлагает помощник по одному элементу. */
export type DraftOp = 'add' | 'edit' | 'delete' | 'skip' | 'clash'

export interface DraftItem {
  id: string
  section: string
  op: DraftOp
  selected: boolean
  data: Record<string, unknown>
  /** id существующего элемента — для изменения и удаления */
  target_id?: string
  /** название изменяемого элемента — подставляет сервер, чтобы не показывать «#551» */
  target_title?: string
  /** прежнее значение, чтобы показать «было → стало» */
  was?: Record<string, unknown>
  /** почему пропущено или в чём противоречие */
  note?: string
}

export interface DraftCounts {
  add: number
  edit: number
  delete: number
  skip: number
  clash: number
  /** сколько реально применится при приёме */
  selected: number
}

export interface DraftSummary {
  id: string
  project_id: string | null
  author: string
  source: string
  title: string
  status: 'open' | 'accepted' | 'rejected'
  created_at: string
  counts: DraftCounts
}

export interface Draft extends DraftSummary {
  items: DraftItem[]
  /** Кто и когда закрыл черновик — только у принятого/отклонённого, у открытого пусто. */
  decided_by: string | null
  decided_at: string | null
  /** Отчёт о применении — только у принятого автоматически или кнопкой; у отклонённого нет. */
  result: AcceptReport | null
}

export interface AcceptReport {
  created: Array<{ section?: string; id?: string; title?: string | null }>
  updated: Array<{ section?: string; id?: string; title?: string | null }>
  deleted: Array<{ section?: string; id?: string; title?: string | null }>
  failed: Array<{ item?: string | null; section?: string; title?: string | null; why?: string }>
  /** Задачи, которые сдвинул каскад авто-планирования: черновик их не называл, но даты у них
   *  изменились. Приходит только когда что-то действительно поехало. */
  cascaded?: Array<{ id: string; title?: string | null; planned_start?: string; planned_end?: string }>
}

export async function getDrafts(): Promise<DraftSummary[]> {
  const { data } = await apiClient.get<{ data: DraftSummary[] }>('/drafts')
  return data.data
}

export async function getDraft(id: string): Promise<Draft> {
  const { data } = await apiClient.get<{ data: Draft }>(`/drafts/${id}`)
  return data.data
}

/** Правка перед приёмом: галочки и значения. В проекте до «Принять» не меняется ничего. */
export async function patchDraft(
  id: string,
  items: Array<{ id: string; selected?: boolean; data?: Record<string, unknown> }>,
): Promise<{ id: string; counts: DraftCounts }> {
  const { data } = await apiClient.patch<{ data: { id: string; counts: DraftCounts } }>(
    `/drafts/${id}`,
    { items },
  )
  return data.data
}

export async function acceptDraft(id: string): Promise<{ status: string; report: AcceptReport }> {
  const { data } = await apiClient.post<{ data: { status: string; report: AcceptReport } }>(
    `/drafts/${id}/accept`,
  )
  return data.data
}

export async function rejectDraft(id: string): Promise<void> {
  await apiClient.post(`/drafts/${id}/reject`)
}
