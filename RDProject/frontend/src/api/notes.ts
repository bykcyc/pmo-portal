import apiClient from './client'
import type { EntityNote } from '@/types/note'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export async function getEntityNotes(
  projectId: string,
  entityType: string,
  entityId: string,
): Promise<EntityNote[]> {
  const { data } = await apiClient.get<ListResponse<EntityNote>>(
    `/projects/${projectId}/notes/${entityType}/${entityId}`
  )
  return data.data
}

export async function addEntityNote(
  projectId: string,
  entityType: string,
  entityId: string,
  content: string,
): Promise<EntityNote> {
  const { data } = await apiClient.post<SingleResponse<EntityNote>>(
    `/projects/${projectId}/notes/${entityType}/${entityId}`,
    { content }
  )
  return data.data
}

export async function deleteEntityNote(projectId: string, noteId: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/notes/${noteId}`)
}
