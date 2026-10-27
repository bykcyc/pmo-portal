import type { TFunction } from 'i18next'
import type { BudgetKind } from '@/types/budget'

/**
 * Универсальные категории бюджета — отдельно для расходов и доходов.
 * Списки собраны по практике CBS/PMBOK, ПБУ 9/99 и Business Model Canvas
 * (см. budget-category-research). Взаимоисключающие, «Прочее» — последним.
 *
 * ВАЖНО: доходная категория не должна попадать в расходы и наоборот — раньше
 * в расходах предлагался «revenue». Разделение обеспечивается двумя списками.
 */
export const EXPENSE_CATEGORY_KEYS = [
  'labor',            // Оплата труда (ФОТ)
  'contractors',      // Подрядчики и консультанты
  'materials',        // Материалы и комплектующие
  'equipment',        // Оборудование и техника
  'software',         // ПО и лицензии
  'travel',           // Командировки и транспорт
  'facilities',       // Аренда и содержание помещений
  'overhead',         // Накладные расходы
  'marketing',        // Маркетинг и продвижение
  'training',         // Обучение персонала
  'legal_compliance', // Юридические услуги, разрешения, страхование
  'contingency',      // Резерв на непредвиденные расходы
  'other',            // Прочие расходы
] as const

export const INCOME_CATEGORY_KEYS = [
  'services',
  'product_sales',
  'subscriptions',
  'investment_funding',
  'grants_subsidies',
  'licensing_royalties',
  'commissions_partnerships',
  'rental_leasing',
  'advertising_sponsorship',
  'interest_income',
  'other_income',
] as const

/** Легаси-значения из первых версий модуля — показываем, но не предлагаем при заведении. */
const LEGACY_KEYS = ['implementation', 'operational', 'revenue']

const group = (kind: BudgetKind) => (kind === 'income' ? 'incomeCategories' : 'expenseCategories')

export function categoryOptions(kind: BudgetKind, t: TFunction): { value: string; label: string }[] {
  const keys = kind === 'income' ? INCOME_CATEGORY_KEYS : EXPENSE_CATEGORY_KEYS
  return keys.map((k) => ({ value: k, label: t(`budget.${group(kind)}.${k}`) }))
}

/** Подпись категории: новый список → легаси-список → сырое значение. */
export function categoryLabel(kind: BudgetKind, value: string | null | undefined, t: TFunction): string {
  if (!value) return '—'
  const keys: readonly string[] = kind === 'income' ? INCOME_CATEGORY_KEYS : EXPENSE_CATEGORY_KEYS
  if (keys.includes(value)) return t(`budget.${group(kind)}.${value}`)
  if (LEGACY_KEYS.includes(value)) return t(`budget.categories.${value}`)
  return value
}
