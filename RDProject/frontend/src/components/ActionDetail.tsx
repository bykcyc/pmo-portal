/**
 * Человеческий вид строки изменений «поле: было→стало».
 *
 * Сервер пишет в журнал технические имена полей и сырые значения (`status: in_progress→completed`):
 * он не знает языка читателя, а перевод, осевший в базе, было бы уже не поменять. Поэтому подписи
 * подставляет интерфейс — и делает это на языке пользователя, для всех трёх языков сразу.
 *
 * Компонент используют И журнал действий проекта, И история изменений задачи: формат строки один,
 * значит и разбор должен быть один, иначе они разъедутся при первой же правке.
 */
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/utils/date'

/** Техническое имя поля → ключ локали с человеческой подписью. */
const FIELD_KEYS: Record<string, string> = {
  title: 'project.fields.name',
  name: 'project.fields.name',
  subject: 'project.fields.name',
  status: 'common.status',
  priority: 'project.fields.priority',
  progress: 'portfolio.progress',
  planned_start: 'project.fields.plannedStart',
  planned_end: 'project.fields.plannedEnd',
  actual_start: 'project.fields.actualStart',
  actual_end: 'project.fields.actualEnd',
  duration_days: 'taskDrawer.durationDays',
  estimated_hours: 'taskDrawer.estimatedHours',
  actual_hours: 'taskDrawer.actualHours',
  assignee_name: 'wbs.assignee',
  assignee_email: 'team.email',
  description: 'common.description',
  goal: 'project.fields.goal',
  scope: 'project.fields.scope',
  client: 'project.fields.client',
  pm_name: 'portfolio.pmPrefix',
  project_kind: 'project.fields.kind',
  budget: 'portfolio.budget',
  budget_currency: 'project.fields.currency',
  probability: 'risks.probability',
  impact: 'risks.impact',
  owner: 'risks.owner',
  mitigation_plan: 'risks.mitigation',
  category: 'budget.category',
  role: 'team.projectRole',
  email: 'team.email',
  phone: 'team.phone',
  task_type: 'wbs.type',
}

/** Значения-перечисления, которые в базе лежат кодом: переводим по словарям интерфейса. */
const VALUE_KEYS: Record<string, string[]> = {
  status: ['wbs.statuses.', 'project.status.', 'meetings.statuses.'],
  priority: ['project.priority.', 'wbs.priorities.'],
  task_type: ['wbs.types.'],
  probability: ['risks.levels.'],
  impact: ['risks.levels.'],
}

/** Старые записи хранят статус английским заголовком (наследие первой версии портала):
 *  в журнале это выглядело как «Статус: New → В работе». Приводим к нашим кодам. */
const LEGACY_STATUS: Record<string, string> = {
  New: 'not_started',
  'In progress': 'in_progress',
  Closed: 'completed',
  Rejected: 'cancelled',
  'On hold': 'on_hold',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export function useDetailFormatter() {
  const { t } = useTranslation()

  const fieldLabel = (field: string) => {
    const key = FIELD_KEYS[field]
    const translated = key ? t(key, { defaultValue: '' }) : ''
    // Нет подписи — показываем техническое имя: честнее пустоты и сразу видно, что дописать.
    return translated || field
  }

  const valueLabel = (field: string, value: string) => {
    const raw0 = value.trim()
    if (!raw0 || raw0 === '—') return '—'
    if (ISO_DATE.test(raw0)) return formatDate(raw0)
    const raw = field === 'status' ? (LEGACY_STATUS[raw0] ?? raw0) : raw0
    for (const prefix of VALUE_KEYS[field] ?? []) {
      const translated = t(`${prefix}${raw}`, { defaultValue: '' })
      if (translated) return translated
    }
    return raw0
  }

  /** «status: in_progress→completed» → «Статус: В работе → Выполнена». */
  return (part: string): string => {
    const sep = part.indexOf(': ')
    if (sep < 0) return part
    const field = part.slice(0, sep).trim()
    const rest = part.slice(sep + 2)
    const arrow = rest.indexOf('→')
    if (arrow < 0) return `${fieldLabel(field)}: ${rest}`
    const before = valueLabel(field, rest.slice(0, arrow))
    const after = valueLabel(field, rest.slice(arrow + 1))
    return `${fieldLabel(field)}: ${before} → ${after}`
  }
}

/** Строка журнала целиком: части разделены «; », каждая переводится отдельно. */
export default function ActionDetail({ detail }: { detail: string }) {
  const format = useDetailFormatter()
  // Кавычки-«ёлочки» в начале — это название сущности («Задача»: поле…), его не трогаем.
  // Закрывающей кавычки может и не быть (обрезка на сервере) — тогда строку не режем вовсе.
  const close = detail.indexOf('»: ')
  const head = detail.startsWith('«') && close > 0 ? detail.slice(0, close + 2) : ''
  const body = head ? detail.slice(head.length + 1) : detail
  const parts = body.split('; ').map(format).join('; ')
  return <>{head ? `${head} ${parts}` : parts}</>
}
