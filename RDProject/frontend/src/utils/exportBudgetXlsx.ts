import type { BudgetItem, BudgetSummary } from '@/types/budget'
import { plannedOf, actualOf, budgetOf, freeOf, kindOf, monthlySum, numOf } from '@/utils/budgetCalc'

type XLSXModule = typeof import('xlsx')
type WorkBook = import('xlsx').WorkBook

type Row = (string | number | null)[]

/** Локализованные подписи — передаёт BudgetTab, чтобы утилита не тянула i18n. */
export interface BudgetXlsxLabels {
  fileName: string
  projectName: string
  sheetSummary: string; sheetExpenses: string; sheetIncome: string; sheetMonthly: string
  expenses: string; income: string; profit: string; plan: string; actual: string; variance: string
  totalBudget: string; approvedLimit: string; incomeExpected: string; incomeTarget: string; total: string
  name: string; category: string; itemBudget: string; free: string; notes: string
  kindCol: string; yearCol: string; typeCol: string
  /** Подписи часов — нужны только при заданной ставке (см. withHours). */
  plannedHours: string; actualHours: string
  months: string[]
  categoryLabel: (item: BudgetItem) => string
}

const round2 = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 100) / 100

function autoWidth(rows: Row[]): { wch: number }[] {
  const widths: number[] = []
  for (const r of rows) r.forEach((c, i) => {
    const len = c == null ? 0 : String(c).length
    widths[i] = Math.max(widths[i] ?? 10, Math.min(len + 2, 48))
  })
  return widths.map((wch) => ({ wch }))
}

function sheet(XLSX: XLSXModule, wb: WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = autoWidth(rows)
  // Excel обрезает имя листа до 31 символа и запрещает : \ / ? * [ ]
  const safe = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, safe)
}

export async function exportBudgetXlsx(
  items: BudgetItem[], summary: BudgetSummary | undefined, L: BudgetXlsxLabels,
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const expenses = items.filter((i) => kindOf(i) === 'expense')
  const income = items.filter((i) => kindOf(i) === 'income')

  // ── Сводка ──
  const ep = summary?.expense_planned ?? 0, ea = summary?.expense_actual ?? 0
  const ip = summary?.income_planned ?? 0, ia = summary?.income_actual ?? 0
  const summaryRows: Row[] = [
    [L.projectName],
    [],
    ['', L.plan, L.actual, L.variance],
    [L.expenses, round2(ep), round2(ea), round2(ep - ea)],
    [L.income, round2(ip), round2(ia), round2(ip - ia)],
    [L.profit, round2(ip - ep), round2(ia - ea), null],
    [],
    // Бюджет/доход собираются снизу вверх (сумма статей); лимит/цель — необязательные ориентиры.
    [L.totalBudget, round2(ep)],
    [L.approvedLimit, round2(summary?.target ?? null)],
    [L.incomeExpected, round2(ip)],
    [L.incomeTarget, round2(summary?.income_target ?? null)],
  ]
  sheet(XLSX, wb, L.sheetSummary, summaryRows)

  // ── Статьи (расходы / доходы) ──
  // Часы попадают в выгрузку ТОЛЬКО при заданной ставке: без неё колонка пуста у всех строк и
  // лишь мешает. С ней видно, из чего сложилась сумма, — ради этого выгрузку и открывают,
  // когда сверяются с актом подрядчика.
  const withHours = (summary?.rate ?? 0) > 0
  const itemsSheet = (title: string, list: BudgetItem[]) => {
    const head: Row = [L.name, L.category, L.plan, L.actual, L.variance, L.notes]
    if (withHours) head.splice(2, 0, L.plannedHours)
    const rows: Row[] = [head]
    let sp = 0, sa = 0, sh = 0
    for (const it of list) {
      const p = plannedOf(it) ?? 0, a = actualOf(it) ?? 0
      sp += p; sa += a; sh += numOf(it.planned_hours) ?? 0
      const row: Row = [it.name, L.categoryLabel(it), round2(p), round2(a), round2(p - a), it.comments ?? '']
      if (withHours) row.splice(2, 0, round2(numOf(it.planned_hours)))
      rows.push(row)
    }
    const total: Row = [L.total, '', round2(sp), round2(sa), round2(sp - sa), '']
    if (withHours) total.splice(2, 0, round2(sh || null))
    rows.push(total)
    sheet(XLSX, wb, title, rows)
  }
  itemsSheet(L.sheetExpenses, expenses)
  itemsSheet(L.sheetIncome, income)

  // ── Помесячно: вид · статья · категория · год · план/факт · 12 месяцев · итого · бюджет · свободно ──
  const monthly: Row[] = [[
    L.kindCol, L.name, L.category, L.yearCol, L.typeCol, ...L.months, L.total, L.itemBudget, L.free,
  ]]
  const years = summary?.years?.length ? summary.years : []
  const allYears = years.length ? years : [new Date().getFullYear()]
  for (const [kindLabel, list] of [[L.expenses, expenses], [L.income, income]] as const) {
    for (const it of list) {
      const itemYears = Array.from(new Set([
        ...allYears,
        ...(it.monthly || []).map((e) => Number(e.year)).filter((y) => Number.isFinite(y)),
      ])).sort((a, b) => a - b)
      for (const y of itemYears) {
        const cell = (m: number, f: 'planned' | 'actual' | 'actual_hours') => {
          const e = (it.monthly || []).find((x) => Number(x.year) === y && Number(x.month) === m)
          return e ? round2(numOf(e[f])) : null
        }
        const rowFor = (f: 'planned' | 'actual' | 'actual_hours', typeLabel: string): Row => {
          const cells = Array.from({ length: 12 }, (_, i) => cell(i + 1, f))
          const tot = cells.reduce((s: number, c) => s + (c ?? 0), 0)
          return [kindLabel, it.name, L.categoryLabel(it), y, typeLabel, ...cells, round2(tot),
            round2(budgetOf(it)), round2(freeOf(it))]
        }
        monthly.push(rowFor('planned', L.plan))
        monthly.push(rowFor('actual', L.actual))
        if (withHours) monthly.push(rowFor('actual_hours', L.actualHours))
      }
    }
  }
  // помесячные итоги по видам
  const totalsRow = (kindLabel: string, list: BudgetItem[], f: 'planned' | 'actual'): Row => {
    const cells = Array.from({ length: 12 }, (_, i) =>
      round2(list.reduce((s, it) => s + ((it.monthly || [])
        .filter((e) => Number(e.month) === i + 1)
        .reduce((ss, e) => ss + (numOf(e[f]) ?? 0), 0)), 0)))
    const tot = round2(list.reduce((s, it) => s + monthlySum(it, f), 0))
    return [kindLabel, L.total, '', '', f === 'planned' ? L.plan : L.actual, ...cells, tot, null, null]
  }
  if (expenses.length) { monthly.push(totalsRow(L.expenses, expenses, 'planned')); monthly.push(totalsRow(L.expenses, expenses, 'actual')) }
  if (income.length) { monthly.push(totalsRow(L.income, income, 'planned')); monthly.push(totalsRow(L.income, income, 'actual')) }
  sheet(XLSX, wb, L.sheetMonthly, monthly)

  XLSX.writeFile(wb, L.fileName)
}
