export interface BacklogItem {
  id: string
  project_id: string
  code?: string | null
  title: string
  description?: string | null
  priority: string
  status: string
  estimated_days?: number | null
  requested_by?: string | null
  /** Ответственный за задачу (исполнитель). person_id — стабильная идентичность, name — для показа. */
  assignee_person_id?: string | null
  assignee_name?: string | null
  planned_start?: string | null
  planned_end?: string | null
  promoted_to_task_id?: string | null
  bitrix24_task_id?: number | null
  created_at: string
}

export interface AgendaItem {
  id: string
  item: string
  presenter?: string | null
  time_allocated?: string | null
  sort_order: number
}

export interface Attendee {
  id: string
  name: string
  role_dept?: string | null
  present: boolean
  comments?: string | null
  /** Идентичность участника — без неё нельзя ни разослать протокол, ни позвать в календарь Bitrix. */
  person_id?: string | null
  email?: string | null
  bitrix24_id?: number | null
}

export interface ActionItem {
  id: string
  action_text: string
  assignee_name?: string | null
  assignee_email?: string | null
  due_date?: string | null
  status: string
  notes?: string | null
}

export interface MeetingDecision {
  id: string
  decision_text: string
  rationale?: string | null
  decided_by?: string | null
}

export interface MeetingDistributionInfo {
  at: string
  by: string | null
  recipients: { name: string; email: string | null; sent: boolean }[]
  sent: number
  email_live: boolean
  calendar_status: string
}

export interface Meeting {
  id: string
  project_id: string
  title: string
  meeting_type?: string | null
  meeting_date: string
  meeting_time?: string | null
  /** Длительность нужна и для подбора общего слота, и для события в календаре Bitrix. */
  duration_minutes?: number | null
  location?: string | null
  minutes_content?: string | null
  status: string
  next_meeting_date?: string | null
  next_meeting_type?: string | null
  next_meeting_participants?: string | null
  created_at: string
  agenda_items: AgendaItem[]
  attendees: Attendee[]
  actions: ActionItem[]
  decisions?: MeetingDecision[]
  _distribution?: MeetingDistributionInfo
  /** id события в календаре Bitrix — есть = «создано в Bitrix» (см. кнопку/колонку). */
  bitrix_event_id?: number | null
  /** В ЧЬЁМ календаре Bitrix лежит событие. Событие живёт у создателя, а удалять его раньше
   *  пытались от имени нажавшего — со-РП бил в свой календарь и получал отказ. */
  bitrix_event_owner?: number | null
}
