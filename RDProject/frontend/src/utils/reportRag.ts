import type { Task } from '@/types/task'
import type { BudgetSummary } from '@/types/budget'

/**
 * Предложение цветов светофора для нового статус-отчёта.
 *
 * Это именно ПРЕДЛОЖЕНИЕ: портал ставит цвет за руководителя проекта, чтобы отчёт не начинался
 * с трёх зелёных «по умолчанию», а тот поправляет его под то, что знает сам. Правила намеренно
 * простые и объяснимые — руководитель должен понимать, откуда взялся цвет, и уметь поспорить.
 */
export type Rag = 'green' | 'amber' | 'red'

const RANK: Record<Rag, number> = { green: 0, amber: 1, red: 2 }

/** Худший из цветов: общий статус не может быть лучше самой больной своей части. */
export function worstRag(...values: Rag[]): Rag {
  return values.reduce((acc, v) => (RANK[v] > RANK[acc] ? v : acc), 'green' as Rag)
}

const OPEN = (status?: string | null) => status !== 'completed' && status !== 'cancelled'

/**
 * Сроки. Красный — есть просроченное: плановый конец раньше даты отчёта, а задача не закрыта.
 * Жёлтый — просрочки нет, но что-то должно закончиться в ближайшую неделю и ещё не начато.
 * Фазы не считаем: у них срок производный от вложенных задач.
 */
export function suggestTimelineRag(tasks: Task[], asOf: string): Rag {
  const soon = new Date(`${asOf}T00:00:00`)
  soon.setDate(soon.getDate() + 7)
  const soonKey = soon.toISOString().slice(0, 10)
  let amber = false
  for (const t of tasks) {
    if (t.task_type === 'phase' || !OPEN(t.status)) continue
    const end = (t.planned_end ?? '').slice(0, 10)
    if (!end) continue
    if (end < asOf) return 'red'
    if (end <= soonKey && t.status === 'not_started') amber = true
  }
  return amber ? 'amber' : 'green'
}

/**
 * Деньги. Красный — факт уже перевалил за план: перерасход виден, а не предполагается.
 * Жёлтый — израсходовано 90% и больше. Бюджета нет — зелёный: нечему быть красным.
 */
export function suggestBudgetRag(summary?: BudgetSummary | null): Rag {
  const plan = Number(summary?.total_planned ?? 0)
  const actual = Number(summary?.total_actual ?? 0)
  if (!plan) return 'green'
  if (actual > plan) return 'red'
  return actual >= plan * 0.9 ? 'amber' : 'green'
}
