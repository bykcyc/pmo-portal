import apiClient from './client'
import type { Baseline } from '@/types/baseline'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export async function getBaselines(projectId: string): Promise<Baseline[]> {
  const { data } = await apiClient.get<ListResponse<Baseline>>(`/projects/${projectId}/baselines`)
  return data.data
}

export async function createBaseline(projectId: string, name: string, description?: string): Promise<Baseline> {
  const { data } = await apiClient.post<SingleResponse<Baseline>>(`/projects/${projectId}/baselines`, { name, description })
  return data.data
}

export async function deleteBaseline(projectId: string, bid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/baselines/${bid}`)
}
