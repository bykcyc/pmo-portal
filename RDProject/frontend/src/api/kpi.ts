import apiClient from './client'
import type { CommPlanItem, KPI } from '@/types/kpi'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

// Communication Plan
export async function getCommPlan(projectId: string): Promise<CommPlanItem[]> {
  const { data } = await apiClient.get<ListResponse<CommPlanItem>>(`/projects/${projectId}/communication-plan`)
  return data.data
}
export async function createCommPlanItem(projectId: string, payload: Partial<CommPlanItem>): Promise<CommPlanItem> {
  const { data } = await apiClient.post<SingleResponse<CommPlanItem>>(`/projects/${projectId}/communication-plan`, payload)
  return data.data
}
export async function updateCommPlanItem(projectId: string, cid: string, payload: Partial<CommPlanItem>): Promise<CommPlanItem> {
  const { data } = await apiClient.put<SingleResponse<CommPlanItem>>(`/projects/${projectId}/communication-plan/${cid}`, payload)
  return data.data
}
export async function deleteCommPlanItem(projectId: string, cid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/communication-plan/${cid}`)
}
export async function reorderCommPlanItems(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
  await apiClient.post(`/projects/${projectId}/communication-plan/reorder`, items)
}

// KPIs
export async function getKPIs(projectId: string): Promise<KPI[]> {
  const { data } = await apiClient.get<ListResponse<KPI>>(`/projects/${projectId}/kpis`)
  return data.data
}
export async function createKPI(projectId: string, payload: Partial<KPI>): Promise<KPI> {
  const { data } = await apiClient.post<SingleResponse<KPI>>(`/projects/${projectId}/kpis`, payload)
  return data.data
}
export async function updateKPI(projectId: string, kid: string, payload: Partial<KPI>): Promise<KPI> {
  const { data } = await apiClient.put<SingleResponse<KPI>>(`/projects/${projectId}/kpis/${kid}`, payload)
  return data.data
}
export async function deleteKPI(projectId: string, kid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/kpis/${kid}`)
}
export async function reorderKPIs(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
  await apiClient.post(`/projects/${projectId}/kpis/reorder`, items)
}
