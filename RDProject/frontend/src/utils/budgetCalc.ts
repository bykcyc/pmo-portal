import type { BudgetItem, BudgetKind } from '@/types/budget'

// Чистые вычисления бюджета — общие для таблицы, помесячного грида и экспорта в Excel.

export const numOf = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const monthlySum = (i: BudgetItem, field: 'planned' | 'actual'): number =>
  (i.monthly || []).reduce((s, e) => s + (numOf(e[field]) ?? 0), 0)

/**
 * План статьи: amount → forecast → planned_amount → разбивка → сумма помесячного плана.
 *
 * Зеркало `domain._budget_planned`. Порядок и состав источников обязаны совпадать: иначе у
 * старого проекта таблица на экране и сводка с сервера показывают разные деньги, и спорить
 * с ними невозможно — обе «свои». Расхождение одно и намеренное: здесь «ничего нет» это
 * `null` (рисуем «—»), на сервере 0.0 — там это слагаемое суммы.
 */
export const plannedOf = (i: BudgetItem): number | null => {
  const a = numOf(i.amount); if (a != null) return a
  const f = numOf(i.forecast_total); if (f != null) return f
  const pa = numOf(i.planned_amount); if (pa != null) return pa
  const parts = [i.equipment_amount, i.labour_amount, i.materials_amount, i.contractors_amount]
    .map(numOf).filter((x): x is number => x != null)
  if (parts.length) return parts.reduce((s, x) => s + x, 0)
  const ms = monthlySum(i, 'planned'); return ms || null
}

/**
 * Факт статьи: ОСНОВНОЙ источник — сумма помесячного факта; actual_total/actual_amount —
 * легаси, только когда помесячного факта ещё нет. Зеркало `domain._budget_actual`.
 */
export const actualOf = (i: BudgetItem): number | null => {
  const ms = monthlySum(i, 'actual'); if (ms) return ms
  const a = numOf(i.actual_total); if (a != null) return a
  return numOf(i.actual_amount)
}

/**
 * Бюджет статьи целиком — та же лестница источников, что у `plannedOf`, но БЕЗ подстановки
 * помесячного плана (иначе «Свободно» = план − план = 0 всегда).
 *
 * Лестница обязана совпадать с `plannedOf` до последнего шага. Когда `planned_amount` добавили
 * только туда, у старой импортированной статьи колонка «План» показывала 640, а «Бюджет» и
 * «Свободно» на том же экране — «—»: экран спорил сам с собой.
 */
export const budgetOf = (i: BudgetItem): number | null => {
  const a = numOf(i.amount); if (a != null) return a
  const f = numOf(i.forecast_total); if (f != null) return f
  const pa = numOf(i.planned_amount); if (pa != null) return pa
  const parts = [i.equipment_amount, i.labour_amount, i.materials_amount, i.contractors_amount]
    .map(numOf).filter((x): x is number => x != null)
  return parts.length ? parts.reduce((s, x) => s + x, 0) : null
}

/** Свободно = бюджет статьи − распределённый помесячный план (по ВСЕМ годам). */
export const freeOf = (i: BudgetItem): number | null => {
  const b = budgetOf(i)
  return b == null ? null : b - monthlySum(i, 'planned')
}

export const kindOf = (i: BudgetItem): BudgetKind => i.kind ?? (i.category === 'revenue' ? 'income' : 'expense')
