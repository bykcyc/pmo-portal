import apiClient from './client'

export interface ShareConfig {
  enabled: boolean
  token: string
  sections: string[]
}

export async function getShare(projectId: string): Promise<ShareConfig> {
  const { data } = await apiClient.get<{ data: ShareConfig }>(`/projects/${projectId}/share`)
  return data.data
}

export async function setShare(
  projectId: string,
  payload: { enabled: boolean; sections: string[] },
): Promise<ShareConfig> {
  const { data } = await apiClient.post<{ data: ShareConfig }>(`/projects/${projectId}/share`, payload)
  return data.data
}
