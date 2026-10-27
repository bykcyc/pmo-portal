import apiClient from './client'
import type { Risk } from '@/types/risk'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export async function getRisks(projectId: string): Promise<Risk[]> {
  const { data } = await apiClient.get<ListResponse<Risk>>(`/projects/${projectId}/risks`)
  return data.data
}
export async function createRisk(projectId: string, payload: Partial<Risk>): Promise<Risk> {
  const { data } = await apiClient.post<SingleResponse<Risk>>(`/projects/${projectId}/risks`, payload)
  return data.data
}
export async function updateRisk(projectId: string, rid: string, payload: Partial<Risk>): Promise<Risk> {
  const { data } = await apiClient.put<SingleResponse<Risk>>(`/projects/${projectId}/risks/${rid}`, payload)
  return data.data
}
export async function deleteRisk(projectId: string, rid: string, opts?: { silentToast?: boolean }): Promise<void> {
  await apiClient.delete(
    `/projects/${projectId}/risks/${rid}`,
    opts?.silentToast ? { headers: { 'X-No-Toast': '1' } } : undefined,
  )
}
export async function addRiskUpdate(projectId: string, rid: string, text: string): Promise<void> {
  await apiClient.post(`/projects/${projectId}/risks/${rid}/updates`, { update_text: text })
}
export async function deleteRiskUpdate(projectId: string, rid: string, uid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/risks/${rid}/updates/${uid}`)
}
