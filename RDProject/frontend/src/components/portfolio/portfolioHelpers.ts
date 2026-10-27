import type { TFunction } from 'i18next'

export const RAG_COLORS: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-rose-500',
}

export function getRagLabel(ragStatus: string, t: TFunction) {
  return t(`portfolio.ragStatus.${ragStatus}`, {
    defaultValue: ragStatus[0].toUpperCase() + ragStatus.slice(1),
  })
}

// Индекс здоровья 0–100: ≥80 emerald, 50–79 amber, <50 rose.
export function healthClasses(health: number): string {
  if (health >= 80) return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
  if (health >= 50) return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
  return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
}
