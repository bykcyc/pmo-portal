import apiClient from './client'

/**
 * Запрос доступа наблюдателем. Маршруты НЕ проектные (`/access-requests`, а не
 * `/projects/{pid}/…`): автор запроса по определению не имеет доступа к проекту, и обычный
 * проектный гард отказал бы ему раньше, чем он успел бы попросить.
 */
export interface AccessRequest {
  id: string
  project_id: string
  requester_id: string
  requester_name: string | null
  requester_email: string | null
  note: string | null
  status: 'open' | 'approved' | 'rejected'
  created_at: string
  decided_at: string | null
  decided_by: string | null
  /** Подписи проекта: по одному коду ни проситель, ни решающий не поймут, о чём речь. */
  project_code: string | null
  project_name: string | null
  pm_name: string | null
}

export interface AccessRequests {
  /** Что решать мне (я основной РП проекта или владелец портфеля). */
  incoming: AccessRequest[]
  /** Что я сам отправил — вместе с решёнными, чтобы человек видел ответ. */
  outgoing: AccessRequest[]
}

export async function getAccessRequests(): Promise<AccessRequests> {
  const { data } = await apiClient.get<{ data: AccessRequests }>('/access-requests')
  return data.data
}

export async function requestAccess(projectId: string, note: string): Promise<AccessRequest> {
  const { data } = await apiClient.post<{ data: AccessRequest }>('/access-requests', {
    project_id: projectId,
    note,
  })
  return data.data
}

export async function decideAccessRequest(id: string, decision: 'approve' | 'reject'): Promise<void> {
  await apiClient.post(`/access-requests/${id}/${decision}`)
}
