// Shared status/priority color maps live in statusColors.ts (single source of
// truth, also consumed by the StatusBadge/PriorityBadge components). Re-exported
// here for backward compatibility with existing importers.
export { STATUS_COLORS, PRIORITY_COLORS } from './statusColors'

export const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
export const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))

export const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'RUB', 'KZT']

/** Вид проекта (паспорт). Значения enum бэкенда; подписи — i18n project.kind.* */
export const PROJECT_KIND_OPTIONS = ['strategic', 'operational', 'pilot'] as const
