/**
 * Зеркало доменных функций бюджета (`pmo-backend/domain.py`: _budget_planned / _budget_actual).
 *
 * Эти вычисления живут в ДВУХ местах: сервер считает сводку и портфель, браузер рисует таблицу,
 * помесячный грид и выгрузку в Excel. Разойтись им нельзя — у проекта окажутся две суммы, обе
 * «свои», и спорить с ними невозможно. Тест держит порядок источников и их состав.
 *
 * Единственное намеренное расхождение: «ничего нет» здесь `null` (на экране рисуется «—»),
 * на сервере 0.0 — там это слагаемое общей суммы.
 */
import { describe, it, expect } from 'vitest'
import { plannedOf, actualOf, budgetOf, freeOf, monthlySum, numOf, kindOf } from './budgetCalc'
import type { BudgetItem } from '@/types/budget'

/** Месяц сетки: id и ссылка на статью для расчётов не важны, но тип их требует. */
const month = (year: number, mon: number, planned: number | null, actual: number | null) =>
  ({ id: `m${year}-${mon}`, budget_item_id: 'b1', year, month: mon, planned, actual })

const item = (p: Partial<BudgetItem>): BudgetItem => ({
  id: 'b1', name: 'Статья', category: 'implementation', kind: 'expense',
  equipment_units: null, equipment_amount: null,
  labour_units: null, labour_amount: null,
  materials_units: null, materials_amount: null,
  contractors_units: null, contractors_amount: null,
  amount: null, forecast_total: null, actual_total: null,
  comments: null, sort_order: 0, ...p,
} as BudgetItem)

describe('numOf', () => {
  it('пустое — это «не задано», а не ноль', () => {
    expect(numOf('')).toBeNull()
    expect(numOf(null)).toBeNull()
    expect(numOf(undefined)).toBeNull()
  })

  it('ноль — это ЗНАЧЕНИЕ', () => {
    // Через `||` ноль превратился бы в «не задано», и статья «бесплатно» стала бы незаполненной.
    expect(numOf(0)).toBe(0)
    expect(numOf('0')).toBe(0)
  })

  it('мусор не становится нулём молча', () => {
    expect(numOf('abc')).toBeNull()
  })
})

describe('plannedOf — порядок источников тот же, что на сервере', () => {
  it('«Сумма» главнее всего остального', () => {
    expect(plannedOf(item({ amount: 1000, forecast_total: 7, planned_amount: 9 }))).toBe(1000)
  })

  it('нет суммы — берём прогноз', () => {
    expect(plannedOf(item({ forecast_total: 700 }))).toBe(700)
  })

  it('нет прогноза — берём легаси planned_amount', () => {
    // Этого шага на фронте не было: у старого импорта таблица показывала «—», а сводка
    // с сервера — настоящие деньги.
    expect(plannedOf(item({ planned_amount: 640 }))).toBe(640)
  })

  it('нет и его — складываем разбивку', () => {
    expect(plannedOf(item({ equipment_amount: 100, labour_amount: 250 }))).toBe(350)
  })

  it('последний рубеж — сумма помесячного плана', () => {
    expect(plannedOf(item({ monthly: [month(2026, 8, 600, null),
                                       month(2026, 9, 400, null)] }))).toBe(1000)
  })

  it('пусто везде — «—», а не 0', () => {
    expect(plannedOf(item({}))).toBeNull()
  })

  it('сумма 0 остаётся нулём и не проваливается к прогнозу', () => {
    expect(plannedOf(item({ amount: 0, forecast_total: 500 }))).toBe(0)
  })
})

describe('actualOf — помесячный факт главнее легаси', () => {
  it('сумма по месяцам', () => {
    expect(actualOf(item({ monthly: [month(2026, 8, null, 250),
                                     month(2026, 9, null, 100)],
                           actual_total: 9999 }))).toBe(350)
  })

  it('помесячного факта нет — легаси actual_total', () => {
    expect(actualOf(item({ actual_total: 120 }))).toBe(120)
  })

  it('нет и его — легаси actual_amount', () => {
    expect(actualOf(item({ actual_amount: 77 }))).toBe(77)
  })

  it('ничего нет — «—»', () => {
    expect(actualOf(item({}))).toBeNull()
  })
})

describe('budgetOf и freeOf', () => {
  it('бюджет статьи НЕ подставляет помесячный план', () => {
    // Иначе «Свободно» = план − план = 0 всегда, и распределять было бы нечего.
    expect(budgetOf(item({ monthly: [month(2026, 8, 600, null)] }))).toBeNull()
  })

  it('лестница budgetOf совпадает с plannedOf: легаси planned_amount тоже бюджет', () => {
    // Разойдись они — на одном экране «План» показывал бы 640, а «Бюджет» и «Свободно» «—».
    expect(budgetOf(item({ planned_amount: 640 }))).toBe(640)
    expect(freeOf(item({ planned_amount: 640, monthly: [month(2026, 9, 140, null)] }))).toBe(500)
  })

  it('свободно = бюджет − распределённое по месяцам (по всем годам)', () => {
    expect(freeOf(item({ amount: 1000,
                         monthly: [month(2026, 12, 600, null),
                                   month(2027, 1, 150, null)] }))).toBe(250)
  })

  it('бюджет не задан — «свободно» неизвестно, а не всё', () => {
    expect(freeOf(item({}))).toBeNull()
  })
})

describe('monthlySum и kindOf', () => {
  it('пустые месяцы не ломают сумму', () => {
    expect(monthlySum(item({ monthly: [month(2026, 8, null, null)] }), 'planned')).toBe(0)
  })

  it('вид статьи: явный kind главнее категории', () => {
    expect(kindOf(item({ kind: 'income', category: 'implementation' }))).toBe('income')
  })

  it('вида нет — категория revenue значит доход', () => {
    expect(kindOf(item({ kind: undefined, category: 'revenue' }))).toBe('income')
    expect(kindOf(item({ kind: undefined, category: 'implementation' }))).toBe('expense')
  })
})
