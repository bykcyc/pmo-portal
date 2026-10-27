import api from './client'

export interface BitrixCalendarEvent {
  ID: string
  NAME: string
  DATE_FROM: string
  DATE_TO: string
  DESCRIPTION?: string
  LOCATION?: string
  ATTENDEES_LIST?: Array<{ id: number; status: string }>
}

export async function getCalendarEvents(
  userId: number, fromDate: string, toDate: string,
): Promise<BitrixCalendarEvent[]> {
  const r = await api.get('/admin/bitrix24/calendar/events', {
    params: { user_id: userId, from_date: fromDate, to_date: toDate },
  })
  return r.data.data ?? []
}

export async function getCalendarAccessibility(
  userIds: number[], fromDate: string, toDate: string,
): Promise<Record<string, Array<{ from: string; to: string }>>> {
  const r = await api.get('/admin/bitrix24/calendar/accessibility', {
    params: { user_ids: userIds.join(','), from_date: fromDate, to_date: toDate },
  })
  return r.data.data ?? {}
}

export async function createCalendarEvent(payload: {
  owner_id: number
  name: string
  from: string
  to: string
  description?: string
  attendees?: number[]
  location?: string
}): Promise<unknown> {
  const r = await api.post('/admin/bitrix24/calendar/event', payload)
  return r.data.data
}

/** Скачивает iCal (.ics) с дедлайнами задач текущего пользователя (для импорта/подписки в календарь). */
export async function downloadCalendarIcs(): Promise<void> {
  const r = await api.get('/me/calendar.ics', { responseType: 'blob' })
  const url = URL.createObjectURL(r.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pmtool.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Подбор общего слота (WP6) ───────────────────────────────────────────────
// Главный вызов продукта: «когда все свободны». Участники идут ИЗ ФОРМЫ — время подбирают,
// пока совещание ещё создаётся, а не после сохранения.

export interface SlotSuggestion {
  from: string
  to: string
  conflicts: number
  busy_user_ids: number[]
  free_count: number
  total_count: number
}

export interface SlotResponse {
  slots: SlotSuggestion[]
  /** false = полностью свободного окна нет, слоты ниже — лучшие компромиссы */
  conflict_free: boolean
  /** участники без bitrix24_id: календаря у них нет, «свободными» мы их НЕ считаем */
  unresolved: string[]
  resolved: Array<{ bitrix24_id: number; name: string }>
}

export async function suggestMeetingSlots(
  projectId: string,
  attendees: Array<{ person_id?: string | null; email?: string | null; name?: string | null }>,
  durationMinutes: number,
  days = 30,
  fromDate?: string,
): Promise<SlotResponse> {
  const r = await api.post(`/projects/${projectId}/meetings/suggest-slots`, {
    attendees, duration_minutes: durationMinutes, days, from_date: fromDate || undefined,
  })
  return r.data.data
}
