import apiClient from './client'
import type { Task } from '@/types/task'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export interface ReorderItem {
  id: string
  parent_id: string | null
  sort_order: number
  level: number
  wbs_code: string
}

export async function getTasks(projectId: string): Promise<Task[]> {
  const { data } = await apiClient.get<ListResponse<Task>>(`/projects/${projectId}/tasks`)
  return data.data
}

export async function createTask(projectId: string, payload: Partial<Task>): Promise<Task> {
  const { data } = await apiClient.post<SingleResponse<Task>>(`/projects/${projectId}/tasks`, payload)
  return data.data
}

export async function bulkCreateTasks(projectId: string, titles: string[]): Promise<{ created: string[]; count: number }> {
  const { data } = await apiClient.post<{ data: { created: string[]; count: number } }>(
    `/projects/${projectId}/tasks/bulk`, { titles },
  )
  return data.data
}

export async function updateTask(projectId: string, tid: string, payload: Partial<Task>): Promise<Task> {
  const { data } = await apiClient.put<SingleResponse<Task>>(`/projects/${projectId}/tasks/${tid}`, payload)
  return data.data
}

export async function deleteTask(projectId: string, tid: string, opts?: { silentToast?: boolean }): Promise<void> {
  await apiClient.delete(
    `/projects/${projectId}/tasks/${tid}`,
    opts?.silentToast ? { headers: { 'X-No-Toast': '1' } } : undefined,
  )
}

export async function reorderTasks(projectId: string, items: ReorderItem[]): Promise<void> {
  await apiClient.post(`/projects/${projectId}/tasks/reorder`, items)
}

export interface Bitrix24TaskPayload {
  title: string
  description?: string | null
  responsible_id?: number | null
  created_by_id?: number | null
  deadline?: string | null
}

export async function createBitrix24Task(projectId: string, taskId: string, payload: Bitrix24TaskPayload): Promise<{ bitrix24_task_id: number }> {
  const { data } = await apiClient.post(`/projects/${projectId}/tasks/${taskId}/bitrix24-task`, payload)
  return data.data
}

export async function deleteBitrix24Task(projectId: string, taskId: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/tasks/${taskId}/bitrix24-task`)
}
