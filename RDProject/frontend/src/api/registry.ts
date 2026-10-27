import apiClient from './client'

/** Живые данные привязанного проекта — те же, что в дашборде портфеля. */
export interface RegistryLive {
  id: string
  code: string | null
  name: string | null
  status: string | null
  rag: string | null
  progress: number | null
  pm_name: string | null
  planned_end: string | null
  overdue_tasks_count: number | null
}

export interface RegistryRow {
  id: string
  pm_name: string | null
  name: string
  kind: string | null
  rag: string | null
  customer: string | null
  phase: string | null
  note: string | null
  project_id: string | null
  sort_order: number
  /** Заполнено, когда строка привязана к заведённому проекту. */
  live: RegistryLive | null
  /** Ссылка есть, а проекта нет (удалён) — строку надо перепривязать. */
  link_broken: boolean
}

export type RegistryPatch = Partial<Omit<RegistryRow, 'id' | 'live' | 'link_broken'>>

export async function getRegistry(): Promise<RegistryRow[]> {
  const { data } = await apiClient.get<{ data: RegistryRow[] }>('/portfolio/registry')
  return data.data
}

export async function createRegistryRow(patch: RegistryPatch): Promise<RegistryRow> {
  const { data } = await apiClient.post<{ data: RegistryRow }>('/portfolio/registry', patch)
  return data.data
}

export async function updateRegistryRow(id: string, patch: RegistryPatch): Promise<RegistryRow> {
  const { data } = await apiClient.put<{ data: RegistryRow }>(`/portfolio/registry/${id}`, patch)
  return data.data
}

export async function deleteRegistryRow(id: string): Promise<void> {
  await apiClient.delete(`/portfolio/registry/${id}`)
}
