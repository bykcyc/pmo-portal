import { addDaysToIsoDate } from '@/utils/date'

/**
 * Словари и арифметика бэклога — в одном месте на таблицу и на карточку.
 *
 * Переехали сюда из BacklogTab не ради красоты: карточка импортирует таб, таб импортирует
 * карточку — кольцо. А главное, `recalcDates` обязана быть ОДНА: разойдись таблица с карточкой
 * на границе (очистка поля, ноль дней, обратный интервал) — и один и тот же ввод давал бы два
 * разных срока в зависимости от того, где его набрали.
 */

// ОДИН список на всё: правку в ячейке, выбор в строке добавления, фильтр и карточку. Раньше их
// было два — полный для ячейки и короткий (пять) для фильтра с добавлением, — и статусы
// «В работе»/«Выполнено» можно было ПОСТАВИТЬ, но нельзя было выбрать при создании и найти
// фильтром. Порядок — жизненный цикл: замысел → рассмотрение → решение → работа → итог.
// `planning`/`in_progress`/`done`/`cancelled` ставит и человек, и синк Bitrix24 по связанной
// задаче (bitrix_routes._BL_STATUS) — словарь общий, поэтому свои и синхронизированные пункты
// читаются одинаково.
export const STATUS_VALUES = ['new', 'in_review', 'approved', 'planning', 'in_progress', 'done', 'promoted', 'rejected', 'cancelled']
export const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical']

export type DateTriple = { planned_start: string | null; planned_end: string | null; estimated_days: number | null }

/**
 * 3-связь начало ↔ кол-во дней ↔ окончание: правка одного пересчитывает зависимый.
 * Дни календарные, включительно (1 день = начало==конец): end = start+(days-1); days = (end-start)+1.
 */
export function recalcDates(cur: DateTriple, changed: keyof DateTriple): DateTriple {
  const { planned_start: s, planned_end: e, estimated_days: d } = cur
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1
  if (changed === 'estimated_days' && s && d && d > 0) return { ...cur, planned_end: addDaysToIsoDate(s, d - 1) }
  if (changed === 'planned_start' && s) {
    if (d && d > 0) return { ...cur, planned_end: addDaysToIsoDate(s, d - 1) }  // двигаем начало — сохраняем длительность
    if (e) return { ...cur, estimated_days: Math.max(1, daysBetween(s, e)) }
  }
  if (changed === 'planned_end' && s && e) return { ...cur, estimated_days: Math.max(1, daysBetween(s, e)) }
  return cur
}
