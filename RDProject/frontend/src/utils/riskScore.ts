/**
 * Оценка риска: вероятность × воздействие → балл, цвет и рекомендуемое действие.
 *
 * Живёт отдельно от таблицы и карточки: обе показывают риску одну и ту же оценку, и разъехаться
 * им нельзя. Балл, который приходит с сервера (`risk.score`), считается по этой же формуле —
 * здесь он нужен, чтобы показать результат ДО сохранения, пока человек крутит селекты в карточке.
 */
export const HIL = ['high', 'medium', 'low'] as const
export const HIL_NUM: Record<string, number> = { high: 3, medium: 2, low: 1 }

export const SCORE_COLOR = (s: number | null) => {
  if (!s) return 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200'
  if (s >= 7) return 'bg-red-100 text-red-700 dark:bg-rose-950/40 dark:text-rose-300 font-bold'
  if (s >= 4) return 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300 font-semibold'
  return 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300'
}

export const ACTION_COLORS: Record<string, string> = {
  avoid: 'bg-red-100 text-red-700 dark:bg-rose-950/40 dark:text-rose-300',
  mitigate: 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300',
  accept: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}

export function riskScore(probability: string | null | undefined, impact: string | null | undefined): number | null {
  const p = HIL_NUM[probability ?? ''] ?? 0
  const i = HIL_NUM[impact ?? ''] ?? 0
  return p && i ? p * i : null
}

export function getRiskAction(probability: string | null | undefined, impact: string | null | undefined): string | null {
  const score = riskScore(probability, impact)
  if (!score) return null
  if (score >= 6) return 'avoid'
  if (score >= 3) return 'mitigate'
  return 'accept'
}
