import apiClient from './client'

export interface SearchHit {
  project_id: string
  project_code: string
  id: string
  title: string | null
  section: string
}

export interface SearchResults {
  projects: SearchHit[]
  tasks: SearchHit[]
  risks: SearchHit[]
  decisions: SearchHit[]
}

export async function search(q: string): Promise<SearchResults> {
  const { data } = await apiClient.get<{ data: SearchResults }>(`/search?q=${encodeURIComponent(q)}`)
  return data.data
}
