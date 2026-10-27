import apiClient from './client'
import type { Person, PersonImportResult } from '@/types/person'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export async function getPersons(q?: string): Promise<Person[]> {
  const params = q ? { q } : {}
  const { data } = await apiClient.get<ListResponse<Person>>('/persons', { params })
  return data.data
}

export async function createPerson(payload: {
  first_name: string
  last_name: string
  bitrix24_id?: number | null
  email?: string | null
}): Promise<Person> {
  const { data } = await apiClient.post<SingleResponse<Person>>('/persons', payload)
  return data.data
}

export async function updatePerson(id: string, payload: {
  first_name?: string
  last_name?: string
  bitrix24_id?: number | null
  email?: string | null
  /** false реально УДАЛЯЕТ признак на сервере (поле разрежённое), а не пишет false. */
  hidden_from_pickers?: boolean
}): Promise<Person> {
  const { data } = await apiClient.put<SingleResponse<Person>>(`/persons/${id}`, payload)
  return data.data
}

export async function deletePerson(id: string): Promise<void> {
  await apiClient.delete(`/persons/${id}`)
}

export async function deleteAllPersons(): Promise<void> {
  await apiClient.delete('/persons')
}

export async function importPersonsFromBitrix24(): Promise<PersonImportResult> {
  const { data } = await apiClient.post<SingleResponse<PersonImportResult>>('/persons/import-bitrix24')
  return data.data
}
