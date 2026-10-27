export const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200',
  final: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}

export interface MeetingFormData {
  title: string
  meeting_type: string
  meeting_date: string
  meeting_time: string
  duration_minutes: number
  location: string
  minutes_content: string
  next_meeting_date: string
  next_meeting_type: string
  next_meeting_participants: string
  agenda_items: Array<{ item: string; presenter: string; time_allocated: string }>
  // person_id/email/bitrix24_id пишет PersonPicker. Без них участник — просто строка:
  // ему нельзя ни разослать протокол, ни посмотреть занятость в календаре Bitrix.
  attendees: Array<{
    name: string; role_dept: string; present: boolean; comments: string
    person_id?: string | null; email?: string | null; bitrix24_id?: number | null
  }>
  // id необязателен: у новой строки его нет, у пришедшей с сервера — есть, и он обязан
  // пережить сохранение. По нему финализация понимает, что поручение/решение уже перенесены.
  actions: Array<{ id?: string; action_text: string; assignee_name: string; assignee_email: string; due_date: string; status: string; notes: string }>
  decisions: Array<{ id?: string; decision_text: string; rationale: string; decided_by: string }>
}
