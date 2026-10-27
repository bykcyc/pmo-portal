import apiClient from './client'
import type { Task } from '@/types/task'

export interface MyTask extends Task {
  project_code: string
  project_name: string
}

export async function getMyTasks(): Promise<MyTask[]> {
  const { data } = await apiClient.get<{ data: MyTask[] }>('/me/tasks')
  return data.data
}

export type MyItemType =
  | 'task' | 'backlog' | 'risk' | 'decision'
  | 'assumption' | 'comm' | 'kpi' | 'team' | 'stakeholder' | 'meeting'

export interface MyItem {
  type: MyItemType
  id: string
  title: string | null
  subtitle: string | null
  status: string | null
  section: string
  /** Завершён/неактуален (задача completed, риск closed, совещание в прошлом и т.п.). */
  closed: boolean
}

export interface MyProjectItems {
  project_id: string
  project_code: string
  project_name: string
  project_status: string | null
  /** Проект в работе (не завершён/отменён/архив) — для фильтра «активные/все». */
  project_active: boolean
  /** Можно ли зайти внутрь проекта: я владелец портфеля / РП / со-РП. Участник — false. */
  can_open: boolean
  /** Руководитель проекта — у кого просить доступ, когда can_open=false. */
  pm_name: string
  items: MyItem[]
}

export async function getMyItems(): Promise<MyProjectItems[]> {
  const { data } = await apiClient.get<{ data: MyProjectItems[] }>('/me/items')
  return data.data
}

export interface MyCalendarItem {
  type: 'task' | 'backlog'
  section: string
  id: string
  title: string | null
  project_id: string
  project_code: string
  project_name: string
  start: string | null
  end: string | null
  status: string | null
}

export async function getMyCalendar(): Promise<MyCalendarItem[]> {
  const { data } = await apiClient.get<{ data: MyCalendarItem[] }>('/me/calendar')
  return data.data
}
