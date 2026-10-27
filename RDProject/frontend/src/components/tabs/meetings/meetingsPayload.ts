import { formatDate, parseDateStrict } from '@/utils/date'
import type { Meeting } from '@/types/meeting'
import type { MeetingFormData } from './meetingsConstants'

/**
 * Совещание ↔ форма: два конца одного круговорота, вынесены сюда, чтобы их можно было накрыть
 * тестом (в самой вкладке они жили внутри компонента).
 *
 * Главное здесь — стабильные id у решений и поручений. Раньше форма при КАЖДОМ сохранении
 * выдавала строкам новые id вида `d0-<время>`, а финализация опознаёт уже перенесённое именно
 * по ним. Сценарий «завершил → отменил завершение → поправил протокол → завершил снова» клал
 * в Журнал решений вторую копию тех же решений.
 */

/** Идентификатор строке дают ОДИН раз; при следующих сохранениях он переносится как есть. */
export function withRowId<T extends { id?: string }>(row: T, prefix: string, i: number, now: number): T & { id: string } {
  const { id, ...rest } = row
  return { id: id || `${prefix}${i}-${now}`, ...(rest as Omit<T, 'id'>) } as T & { id: string }
}

export const meetingToForm = (m: Meeting): MeetingFormData => ({
  title: m.title, meeting_type: m.meeting_type ?? '',
  meeting_date: formatDate(m.meeting_date, ''), meeting_time: m.meeting_time ?? '',
  duration_minutes: m.duration_minutes ?? 60,
  location: m.location ?? '', minutes_content: m.minutes_content ?? '',
  next_meeting_date: formatDate(m.next_meeting_date, ''),
  next_meeting_type: m.next_meeting_type ?? '',
  next_meeting_participants: m.next_meeting_participants ?? '',
  agenda_items: m.agenda_items.map(a => ({ item: a.item, presenter: a.presenter ?? '', time_allocated: a.time_allocated ?? '' })),
  // person_id/email/bitrix24_id ОБЯЗАТЕЛЬНО переносим: без них правка совещания стирала бы
  // идентичность участников (её ставит PersonPicker), и после сохранения ломались бы и
  // рассылка протокола, и подбор общего слота — они опознают человека именно по этим полям.
  attendees: m.attendees.map(a => ({
    name: a.name, role_dept: a.role_dept ?? '', present: a.present, comments: a.comments ?? '',
    person_id: a.person_id ?? null, email: a.email ?? null, bitrix24_id: a.bitrix24_id ?? null,
  })),
  // id строк переносим — см. шапку файла: на них держится дедуп финализации.
  actions: m.actions.map(a => ({
    id: a.id, action_text: a.action_text, assignee_name: a.assignee_name ?? '',
    assignee_email: a.assignee_email ?? '', due_date: formatDate(a.due_date, ''),
    status: a.status, notes: a.notes ?? '',
  })),
  decisions: (m.decisions ?? []).map(d => ({
    id: d.id, decision_text: d.decision_text, rationale: d.rationale ?? '', decided_by: d.decided_by ?? '',
  })),
})

export function buildMeetingPayload(form: MeetingFormData, opts: { status: string; now?: number }): Record<string, unknown> {
  const now = opts.now ?? Date.now()
  return {
    title: form.title, meeting_type: form.meeting_type || null,
    meeting_date: parseDateStrict(form.meeting_date) ?? form.meeting_date, meeting_time: form.meeting_time || null,
    duration_minutes: form.duration_minutes || 60,
    location: form.location || null, minutes_content: form.minutes_content || null,
    status: opts.status,
    next_meeting_date: parseDateStrict(form.next_meeting_date) || null,
    next_meeting_type: form.next_meeting_type || null,
    next_meeting_participants: form.next_meeting_participants || null,
    agenda_items: form.agenda_items.filter(a => a.item.trim()),
    attendees: form.attendees.filter(a => a.name.trim()),
    actions: form.actions.filter(a => a.action_text.trim())
      .map((a, i) => ({ ...withRowId(a, 'a', i, now), due_date: parseDateStrict(a.due_date) ?? a.due_date })),
    decisions: form.decisions.filter(d => d.decision_text.trim()).map((d, i) => withRowId(d, 'd', i, now)),
  }
}
