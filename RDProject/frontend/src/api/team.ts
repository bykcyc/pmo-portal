import apiClient from './client'
import type { TeamMember, Stakeholder, Assumption } from '@/types/team'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

// Team
export async function getTeam(projectId: string): Promise<TeamMember[]> {
  const { data } = await apiClient.get<ListResponse<TeamMember>>(`/projects/${projectId}/team`)
  return data.data
}
export async function createTeamMember(projectId: string, payload: Partial<TeamMember>): Promise<TeamMember> {
  const { data } = await apiClient.post<SingleResponse<TeamMember>>(`/projects/${projectId}/team`, payload)
  return data.data
}
export async function updateTeamMember(projectId: string, mid: string, payload: Partial<TeamMember>): Promise<TeamMember> {
  const { data } = await apiClient.put<SingleResponse<TeamMember>>(`/projects/${projectId}/team/${mid}`, payload)
  return data.data
}
export async function deleteTeamMember(projectId: string, mid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/team/${mid}`)
}
export async function reorderTeamMembers(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
  await apiClient.post(`/projects/${projectId}/team/reorder`, items)
}

// Stakeholders
export async function getStakeholders(projectId: string): Promise<Stakeholder[]> {
  const { data } = await apiClient.get<ListResponse<Stakeholder>>(`/projects/${projectId}/stakeholders`)
  return data.data
}
export async function createStakeholder(projectId: string, payload: Partial<Stakeholder>): Promise<Stakeholder> {
  const { data } = await apiClient.post<SingleResponse<Stakeholder>>(`/projects/${projectId}/stakeholders`, payload)
  return data.data
}
export async function updateStakeholder(projectId: string, sid: string, payload: Partial<Stakeholder>): Promise<Stakeholder> {
  const { data } = await apiClient.put<SingleResponse<Stakeholder>>(`/projects/${projectId}/stakeholders/${sid}`, payload)
  return data.data
}
export async function deleteStakeholder(projectId: string, sid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/stakeholders/${sid}`)
}
export async function reorderStakeholders(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
  await apiClient.post(`/projects/${projectId}/stakeholders/reorder`, items)
}

// Assumptions
export async function getAssumptions(projectId: string): Promise<Assumption[]> {
  const { data } = await apiClient.get<ListResponse<Assumption>>(`/projects/${projectId}/assumptions`)
  return data.data
}
export async function createAssumption(projectId: string, payload: Partial<Assumption>): Promise<Assumption> {
  const { data } = await apiClient.post<SingleResponse<Assumption>>(`/projects/${projectId}/assumptions`, payload)
  return data.data
}
export async function updateAssumption(projectId: string, aid: string, payload: Partial<Assumption>): Promise<Assumption> {
  const { data } = await apiClient.put<SingleResponse<Assumption>>(`/projects/${projectId}/assumptions/${aid}`, payload)
  return data.data
}
export async function reorderAssumptions(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
  await apiClient.post(`/projects/${projectId}/assumptions/reorder`, items)
}

export async function deleteAssumption(projectId: string, aid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/assumptions/${aid}`)
}
