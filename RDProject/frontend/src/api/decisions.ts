import apiClient from './client'
import type { Decision } from '@/types/decision'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export interface DecisionFilters {
  status?: string
  date_from?: string
  date_to?: string
  search?: string
}

export async function getDecisions(projectId: string, filters: DecisionFilters = {}): Promise<Decision[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.search) params.set('search', filters.search)
  const { data } = await apiClient.get<ListResponse<Decision>>(`/projects/${projectId}/decisions?${params}`)
  return data.data
}

export async function createDecision(projectId: string, payload: Partial<Decision>): Promise<Decision> {
  const { data } = await apiClient.post<SingleResponse<Decision>>(`/projects/${projectId}/decisions`, payload)
  return data.data
}

export async function updateDecision(projectId: string, did: string, payload: Partial<Decision>): Promise<Decision> {
  const { data } = await apiClient.put<SingleResponse<Decision>>(`/projects/${projectId}/decisions/${did}`, payload)
  return data.data
}

export async function deleteDecision(projectId: string, did: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/decisions/${did}`)
}
