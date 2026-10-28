import api from './client'
import type { BacklogItem, Meeting } from '@/types/meeting'

// ── Backlog ────────────────────────────────────────────────────────────────

export async function getBacklog(projectId: string): Promise<BacklogItem[]> {
  const r = await api.get(`/projects/${projectId}/backlog`)
  return r.data.data
}

export async function createBacklogItem(projectId: string, payload: Record<string, unknown>): Promise<BacklogItem> {
  const r = await api.post(`/projects/${projectId}/backlog`, payload)
  return r.data.data
}

export async function updateBacklogItem(projectId: string, id: string, payload: Record<string, unknown>): Promise<BacklogItem> {
  const r = await api.put(`/projects/${projectId}/backlog/${id}`, payload)
  return r.data.data
}

export async function deleteBacklogItem(projectId: string, id: string): Promise<void> {
  await api.delete(`/projects/${projectId}/backlog/${id}`)
}

export async function promoteBacklogItem(projectId: string, id: string): Promise<{ task_id: string; backlog_id: string }> {
  const r = await api.post(`/projects/${projectId}/backlog/${id}/promote`)
  return r.data.data
}

export interface Bitrix24TaskPayload {
  title: string
  description?: string | null
  responsible_id?: number | null
  // Постановщика (created_by_id) не шлём: сервер берёт его сам — РП проекта или того, кто создаёт.
  deadline?: string | null
}

export async function createBacklogBitrix24Task(projectId: string, backlogId: string, payload: Bitrix24TaskPayload): Promise<{ bitrix24_task_id: number }> {
  const r = await api.post(`/projects/${projectId}/backlog/${backlogId}/bitrix24-task`, payload)
  return r.data.data
}

export async function deleteBacklogBitrix24Task(projectId: string, backlogId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/backlog/${backlogId}/bitrix24-task`)
}

// ── Meetings ───────────────────────────────────────────────────────────────

export async function getMeetings(projectId: string): Promise<Meeting[]> {
  const r = await api.get(`/projects/${projectId}/meetings`)
  // Гарантируем, что массивы всегда есть — иначе рендер падал на m.actions.length
  // (напр. у экземпляров, созданных «Повторить», раньше не было поля actions).
  return (r.data.data as Meeting[]).map((m) => ({
    ...m,
    agenda_items: m.agenda_items ?? [],
    attendees: m.attendees ?? [],
    actions: m.actions ?? [],
    decisions: m.decisions ?? [],
  }))
}

export async function createMeeting(projectId: string, payload: Record<string, unknown>): Promise<Meeting> {
  const r = await api.post(`/projects/${projectId}/meetings`, payload)
  return r.data.data
}

export async function updateMeeting(projectId: string, id: string, payload: Record<string, unknown>): Promise<Meeting> {
  const r = await api.put(`/projects/${projectId}/meetings/${id}`, payload)
  return r.data.data
}

export async function deleteMeeting(projectId: string, id: string): Promise<void> {
  await api.delete(`/projects/${projectId}/meetings/${id}`)
}

export async function recurMeeting(projectId: string, id: string, count = 1, recurrence: 'weekly' | 'biweekly' | 'monthly' = 'weekly'): Promise<{ created: string[]; count: number }> {
  const r = await api.post(`/projects/${projectId}/meetings/${id}/recur`, null, { params: { count, recurrence } })
  return r.data.data
}

export async function finalizeMeeting(projectId: string, id: string): Promise<{ id: string; status: string; decisions_added: number; actions_added: number }> {
  const r = await api.post(`/projects/${projectId}/meetings/${id}/finalize`)
  return r.data.data
}

/** Снять финализацию — status обратно в draft (перезавершение не плодит дубли). */
export async function unfinalizeMeeting(projectId: string, id: string): Promise<{ id: string; status: string }> {
  const r = await api.post(`/projects/${projectId}/meetings/${id}/unfinalize`)
  return r.data.data
}

/** Создать событие совещания в календаре Bitrix (отдельно от рассылки). description — правка описания
 *  на форме создания (по умолчанию берётся протокол). excludeBitrixIds — кого НЕ приглашать (занятые). */
export async function createMeetingBitrixEvent(projectId: string, id: string, description?: string, excludeBitrixIds?: number[]): Promise<{ bitrix_event_id: number }> {
  const body: Record<string, unknown> = {}
  if (description !== undefined) body.description = description
  if (excludeBitrixIds && excludeBitrixIds.length) body.exclude_bitrix_ids = excludeBitrixIds
  const r = await api.post(`/projects/${projectId}/meetings/${id}/bitrix-event`, body)
  return r.data.data
}

/** Удалить событие совещания в Bitrix и снять отметку.
 *  force — снять отметку в портале, даже если Bitrix недоступен: иначе совещание, чьё событие
 *  удалили на той стороне, застревает с неснимаемой отметкой (и кнопка создания под ней спрятана). */
export async function deleteMeetingBitrixEvent(projectId: string, id: string, force = false): Promise<void> {
  await api.delete(`/projects/${projectId}/meetings/${id}/bitrix-event${force ? '?force=true' : ''}`)
}
