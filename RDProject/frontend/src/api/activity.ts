import apiClient from './client'

export interface ActivityEntry {
  id: number
  user: string | null
  comment: string | null
  details: string[]
  created_at: string | null
  version: number | null
}

export async function getActivity(projectId: string, wpId: string): Promise<ActivityEntry[]> {
  const { data } = await apiClient.get<{ data: ActivityEntry[] }>(
    `/projects/${projectId}/work-packages/${wpId}/activity`,
  )
  return data.data
}

export async function addComment(projectId: string, wpId: string, comment: string): Promise<void> {
  await apiClient.post(`/projects/${projectId}/work-packages/${wpId}/activity`, { comment })
}
