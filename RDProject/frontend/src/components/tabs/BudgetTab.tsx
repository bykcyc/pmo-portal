import { Fragment, useEffect, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { useTranslation } from 'react-i18next'
import {
  getBudgetItems, createBudgetItem, updateBudgetItem, deleteBudgetItem,
  getBudgetSummary, upsertMonthly, updateBudgetSettings, getBudgetConsolidated,
  linkBudgetItem, unlinkBudgetItem } from '@/api/budget'
import type { BudgetItem, BudgetKind, BudgetSummary, ConsolidatedShare } from '@/types/budget'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { useToastStore } from '@/store/toastStore'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { Surface, SectionCard } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import RowForm, { type FieldDef } from '@/components/RowForm'
import { useConfirmStore } from '@/store/confirmStore'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import { useSectionExport } from '@/hooks/useSectionExport'
import { categoryOptions, categoryLabel } from '@/constants/budgetCategories'
import { numOf, monthlySum, plannedOf, actualOf, budgetOf, freeOf, kindOf } from '@/utils/budgetCalc'
import ConsolidatedBudgetView from '@/components/budget/ConsolidatedBudget'
import AttributeItems from '@/components/budget/AttributeItems'
import { exportBudgetXlsx } from '@/utils/exportBudgetXlsx'
import { getProject } from '@/api/projects'
import { Download } from 'lucide-react'

// ── helpers ────────────────────────────────────────────────────────────────
/** Только цифры и один десятичный разделитель (для полей сумм). */
const digitsOnly = (raw: string): string => {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const i = cleaned.indexOf('.')
  return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '')
}
const fmt = (v: number | null | undefined) =>
  v != null ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function BudgetTab({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const [kind, setKind] = useState<BudgetKind>('expense')
  const [view, setView] = useState<'estimates' | 'monthly'>('estimates')
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [extraYears, setExtraYears] = useState<number[]>([])

  const monthShort = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(i18n.language, { month: 'short' })

  // Категории зависят от вида: доходные не предлагаются в расходах и наоборот.
  const CAT_OPTIONS = useMemo(() => categoryOptions(kind, t), [kind, t])

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['budget', projectId], queryFn: () => getBudgetItems(projectId),
  })
  const { data: summary } = useQuery({
    queryKey: ['budget_summary', projectId], queryFn: () => getBudgetSummary(projectId),
  })
  // Сводка по дереву. Отдельный запрос, а не поле в budget-summary: он ходит в ЧУЖИЕ проекты
  // (зонтик и все подпроекты), и мешать его с «моим бюджетом» значило бы удорожить самый
  // частый экран ради самого редкого.
  const { data: tree } = useQuery({
    queryKey: ['budget_consolidated', projectId], queryFn: () => getBudgetConsolidated(projectId),
  })
  // Имя проекта для заголовка/имени файла экспорта (кэш переиспользуется из шапки проекта).
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })

  const rate = summary?.rate ?? 0

  useSectionExport('budget', useMemo(() => items as unknown as Record<string, unknown>[], [items]))

  const monthLabels = useMemo(
    () => MONTHS.map(m => new Date(2000, m - 1, 1).toLocaleDateString(i18n.language, { month: 'short' })),
    [i18n.language],
  )
  const handleExport = () => {
    const projName = project?.name ? String(project.name) : t('project.sections.budget')
    void exportBudgetXlsx(items, summary, {
      fileName: `${t('budget.excelFile', { defaultValue: 'Бюджет' })} — ${projName}.xlsx`.replace(/[\\/:*?"<>|]/g, ' '),
      projectName: projName,
      sheetSummary: t('budget.sheetSummary', { defaultValue: 'Сводка' }),
      sheetExpenses: t('budget.sheetExpenses', { defaultValue: 'Расходы' }),
      sheetIncome: t('budget.sheetIncome', { defaultValue: 'Доходы' }),
      sheetMonthly: t('budget.sheetMonthly', { defaultValue: 'Помесячно' }),
      expenses: t('budget.expenses', { defaultValue: 'Расходы' }),
      income: t('budget.income', { defaultValue: 'Доходы' }),
      profit: t('budget.profit', { defaultValue: 'Прибыль' }),
      plan: t('budget.plan'), actual: t('budget.actual'), variance: t('budget.variance'),
      totalBudget: t('budget.totalBudget', { defaultValue: 'Общий бюджет (расходы)' }),
      approvedLimit: t('budget.approvedLimit', { defaultValue: 'Утверждённый лимит' }),
      incomeExpected: t('budget.incomeExpected', { defaultValue: 'Ожидаемый доход' }),
      incomeTarget: t('budget.incomeTarget', { defaultValue: 'Целевой доход' }),
      total: t('budget.rowTotal', { defaultValue: 'Итого' }),
      name: t('budget.itemName'), category: t('budget.category'),
      itemBudget: t('budget.itemBudget', { defaultValue: 'Бюджет статьи' }),
      free: t('budget.free', { defaultValue: 'Свободно' }),
      notes: t('common.notes'),
      kindCol: t('budget.kindCol', { defaultValue: 'Вид' }),
      yearCol: t('budget.year', { defaultValue: 'Год' }),
      typeCol: t('common.type'),
      plannedHours: t('budget.plannedHours', { defaultValue: 'Часы (план)' }),
      actualHours: t('budget.actualHours', { defaultValue: 'Часы (факт)' }),
      months: monthLabels,
      categoryLabel: (it) => categoryLabel(kindOf(it), it.category, t),
    })
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budget', projectId] })
    qc.invalidateQueries({ queryKey: ['budget_summary', projectId] })
    // Сводка по дереву считается из тех же статей: без неё на ОДНОМ экране стояли бы два
    // несогласованных числа — новый план в таблице и старый остаток в матрице под ней.
    qc.invalidateQueries({ queryKey: ['budget_consolidated', projectId] })
  }

  const kindItems = useMemo(() => items.filter(i => kindOf(i) === kind), [items, kind])

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear(), year, ...(summary?.years ?? []), ...extraYears])
    return [...set].filter(Boolean).sort((a, b) => a - b)
  }, [summary?.years, extraYears, year])

  const handleAdd = async (v: Record<string, string>) => {
    await createBudgetItem(projectId, { ...v, kind } as Partial<BudgetItem>); await invalidate(); setShowAdd(false)
  }
  const handleUpdate = async (id: string, v: Record<string, string>) => {
    await updateBudgetItem(projectId, id, v as Partial<BudgetItem>); await invalidate(); setEditId(null)
  }
  const handleDelete = (id: string) => {
    showConfirm(t('budget.deleteConfirm'), async () => { await deleteBudgetItem(projectId, id); await invalidate() })
  }

  // Сохранение ячейки помесячного плана/факта: апсертим запись (year, month) в monthly статьи.
  //
  // Часы — третье поле той же записи. Деньги из них считает СЕРВЕР и только когда денежная
  // ячейка пуста, поэтому правка часов поверх уже посчитанной суммы иначе бы ничего не
  // изменила. Правило: что правили последним, то и главное — вписали часы, значит деньги
  // пересчитываются; вписали деньги, значит они остаются как есть.
  const saveCell = async (item: BudgetItem, month: number, field: 'planned' | 'actual' | 'actual_hours', raw: string) => {
    const num = raw.trim() === '' ? null : Number(raw)
    if (raw.trim() !== '' && !Number.isFinite(num)) return
    const entries = [...(item.monthly || [])]
    const idx = entries.findIndex(e => Number(e.year) === year && Number(e.month) === month)
    if (idx >= 0) {
      const cur = entries[idx]
      if ((cur[field] ?? null) === num) return  // без изменений — не дёргаем сервер
      entries[idx] = { ...cur, [field]: num, ...(field === 'actual_hours' ? { actual: null } : {}) }
    } else {
      entries.push({
        id: `${item.id}-${year}-${month}`, budget_item_id: item.id, year, month,
        planned: field === 'planned' ? num : null,
        actual: field === 'actual' ? num : null,
        actual_hours: field === 'actual_hours' ? num : null,
      })
    }
    try {
      await upsertMonthly(projectId, item.id, entries)
    } finally {
      invalidate()  // рефетч и при ошибке: значение ячейки приходит к серверной правде, не «висит»
      // (глобальный error-тост на упавшую мутацию уже показывает axios-интерсептор client.ts)
    }
  }

  // У статьи редактируется только ПЛАН. Факт не вводится здесь — он вносится по месяцам
  // и суммируется в статью автоматически (видно в таблице/помесячном гриде).
  const ITEM_FIELDS: FieldDef[] = [
    { key: 'name', label: t('budget.itemName'), required: true },
    { key: 'category', label: t('budget.category'), type: 'select', options: CAT_OPTIONS },
    { key: 'amount', label: t('budget.amountPlan', { defaultValue: 'Сумма (план)' }), type: 'number' },
    // Часы показываем ТОЛЬКО когда есть ставка: без неё поле ничего не считает и лишь путает.
    // Сумму из часов считает СЕРВЕР при записи — и не пересчитывает её потом, когда ставку
    // поменяют. Иначе правка ставки в июле молча удорожала бы январь.
    ...(rate ? [{ key: 'planned_hours',
                  label: t('budget.plannedHours', { defaultValue: 'Часы (план)' }),
                  type: 'number' as const }] : []),
    { key: 'comments', label: t('common.notes'), type: 'textarea' },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('budget.guide.s1'), desc: t('budget.guide.s1d') },
    { title: t('budget.guide.s2'), desc: t('budget.guide.s2d') },
    { title: t('budget.guide.s3'), desc: t('budget.guide.s3d') },
    { title: t('budget.guide.s4'), desc: t('budget.guide.s4d') },
    { title: t('budget.guide.s5'), desc: t('budget.guide.s5d') },
  ]

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div>
      <SummaryBar summary={summary} projectId={projectId} canWrite={canWrite} onSaved={invalidate} />

      {/* Расходы | Доходы */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-md border border-gray-200 dark:border-slate-700 p-0.5">
          {(['expense', 'income'] as const).map(k => (
            <button key={k} onClick={() => { setKind(k); setShowAdd(false); setEditId(null) }}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${kind === k ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
              {k === 'expense' ? t('budget.expenses', { defaultValue: 'Расходы' }) : t('budget.income', { defaultValue: 'Доходы' })}
            </button>
          ))}
        </div>
        <ProcessGuide steps={guideSteps} />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-1 text-xs">
            {(['estimates', 'monthly'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md transition-colors ${view === v ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                {v === 'estimates' ? t('budget.estimates') : t('budget.monthly')}
              </button>
            ))}
          </div>
          <button onClick={handleExport} disabled={items.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">
            <Download size={ICON_SM} /> Excel
          </button>
          {canWrite && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
              <Plus size={ICON_SM} /> {t('budget.add')}
            </button>
          )}
        </div>
      </div>

      {showAdd && canWrite && <RowForm fields={ITEM_FIELDS} title={t('budget.add')} onSave={handleAdd} onCancel={() => setShowAdd(false)} />}

      {view === 'estimates' ? (
        <EstimatesTable
          items={kindItems} canWrite={canWrite} editFields={ITEM_FIELDS}
          editId={editId} setEditId={setEditId} onUpdate={handleUpdate} onDelete={handleDelete} onAdd={() => setShowAdd(true)} kind={kind}
        />
      ) : (
        <MonthlyGrid
          items={kindItems} canWrite={canWrite} year={year} years={years} kind={kind} rate={rate}
          onYear={setYear} onAddYear={(y) => { setExtraYears(p => [...p, y]); setYear(y) }}
          monthShort={monthShort} onSaveCell={saveCell}
        />
      )}

      {tree && tree.view !== 'none' && (
        <div className="mt-6 space-y-4">
          <ConsolidatedBudgetView data={tree} />
          {tree.view === 'subproject' && (
            <AttributeItems projectId={projectId} items={items} canWrite={canWrite}
              blocks={(tree.blocks ?? []) as ConsolidatedShare[]} parentName={tree.parent_name} />
          )}
        </div>
      )}

      {summary?.monthly && summary.monthly.length > 0 && (
        <div className="mt-6">
          <SectionCard title={t('budget.burndown', { defaultValue: 'Бюджет: накопительно по месяцам' })}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={summary.monthly} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="cum_planned" stroke="var(--chart-accent)" strokeWidth={2} dot={false} name={t('budget.cumPlanned', { defaultValue: 'План (накопительно)' })} />
                <Line type="monotone" dataKey="cum_actual" stroke="#059669" strokeWidth={2} dot={false} name={t('budget.cumActual', { defaultValue: 'Факт (накопительно)' })} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      )}
    </div>
  )
}

// ── сводка + общий бюджет/целевой доход ──────────────────────────────────────
function SummaryBar({ summary, projectId, canWrite, onSaved }: {
  summary?: BudgetSummary; projectId: string; canWrite: boolean; onSaved: () => void
}) {
  const { t } = useTranslation()
  const ep = summary?.expense_planned ?? 0, ea = summary?.expense_actual ?? 0
  const ip = summary?.income_planned ?? 0, ia = summary?.income_actual ?? 0
  const profP = summary?.profit_planned ?? (ip - ep), profA = summary?.profit_actual ?? (ia - ea)

  return (
    <div className="mb-5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TargetCard label={t('budget.totalBudget', { defaultValue: 'Общий бюджет (расходы)' })}
          limitLabel={t('budget.approvedLimit', { defaultValue: 'Утверждённый лимит' })}
          value={summary?.target ?? null} planned={ep} projectId={projectId} field="budget_target"
          kind="expense" canWrite={canWrite} onSaved={onSaved} />
        <TargetCard label={t('budget.incomeExpected', { defaultValue: 'Ожидаемый доход' })}
          limitLabel={t('budget.incomeTarget', { defaultValue: 'Целевой доход' })}
          value={summary?.income_target ?? null} planned={ip} projectId={projectId} field="income_target"
          kind="income" canWrite={canWrite} onSaved={onSaved} />
      </div>
      <RateCard summary={summary} projectId={projectId} canWrite={canWrite} onSaved={onSaved} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard title={t('budget.expenses', { defaultValue: 'Расходы' })} plan={ep} actual={ea} />
        <StatCard title={t('budget.income', { defaultValue: 'Доходы' })} plan={ip} actual={ia} />
        <StatCard title={t('budget.profit', { defaultValue: 'Прибыль' })} plan={profP} actual={profA} signed />
      </div>
    </div>
  )
}

/** Карточка «Расходы/Доходы/Прибыль»: заголовок + явные строки План и Факт. */
function StatCard({ title, plan, actual, signed }: { title: string; plan: number; actual: number; signed?: boolean }) {
  const { t } = useTranslation()
  const cls = (v: number) => (signed ? (v >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-800 dark:text-slate-100')
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4">
      <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">{title}</p>
      <dl>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-gray-500 dark:text-slate-400">{t('budget.plan')}</dt>
          <dd className={`text-lg font-bold tabular-nums ${cls(plan)}`}>{fmt(plan)}</dd>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-gray-200 dark:border-slate-700 pt-1.5">
          <dt className="text-xs text-gray-500 dark:text-slate-400">{t('budget.actual')}</dt>
          <dd className={`text-sm font-semibold tabular-nums ${cls(actual)}`}>{fmt(actual)}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Общий бюджет (расходы) / Ожидаемый доход = СУММА СТАТЕЙ (снизу вверх), показывается
 *  крупно и только для чтения. Ручное поле — необязательный «Утверждённый лимит» /
 *  «Целевой доход» для сверки; правится только через карандаш с явным подтверждением. */
/**
 * Ставка часа проекта. У подпроекта — только показ: ставка живёт у общего проекта.
 *
 * Ставка — единственное поле бюджета, которое проверяется на сервере и приводится к числу.
 * Причина в последствиях: сумма с опечаткой врёт про одну статью, а ставка множит собой все
 * часовые статьи проекта И всех его подпроектов.
 */
function RateCard({ summary, projectId, canWrite, onSaved }: {
  summary?: BudgetSummary; projectId: string; canWrite: boolean; onSaved: () => void
}) {
  const { t } = useTranslation()
  const showToast = useToastStore(st => st.show)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const rate = summary?.rate ?? null
  const inherited = Boolean(summary?.rate_inherited)
  useEffect(() => { if (!editing) setDraft(rate != null ? String(rate) : '') }, [rate, editing])

  // Карточку прячем у проектов вне дерева И без своей ставки: почасовой учёт нужен не всем,
  // а пустое поле «Ставка часа» на каждом экране бюджета — шум.
  const inTree = Boolean(summary?.parent_project_id) || Boolean(summary?.subprojects_count)
  if (!inTree && rate == null) return null

  const save = async () => {
    setSaving(true)
    try {
      await updateBudgetSettings(projectId, { budget_rate: draft.trim() === '' ? null : draft.trim() })
      setEditing(false)
      onSaved()
    } catch (err) {
      // Текст сервера здесь осмысленный («Ставка часа: ожидается число, получено «50 EUR»») —
      // общее «ошибка» не объяснило бы, что именно не так.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-600 dark:text-slate-300">
          {t('budget.hourRate', { defaultValue: 'Ставка часа' })}
        </span>
        {editing ? (
          <>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              aria-label={t('budget.hourRate', { defaultValue: 'Ставка часа' })}
              onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }}
              className="w-28 rounded border border-blue-400 px-2 py-0.5 text-sm outline-none dark:bg-slate-800 dark:text-slate-100" />
            <button onClick={() => void save()} disabled={saving}
              className="rounded bg-btn-primary px-2 py-0.5 text-xs text-btn-primary-fg disabled:opacity-50">
              {t('common.save')}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-500 dark:text-slate-400">
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-slate-100">
              {rate != null ? `${rate} ${summary?.currency ?? 'EUR'}/${t('budget.hoursShort', { defaultValue: 'ч' })}` : '—'}
            </span>
            {inherited && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {t('budget.rateInherited', { defaultValue: 'из общего проекта' })}
              </span>
            )}
            {canWrite && !inherited && (
              <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                {rate != null ? t('common.edit') : t('budget.setRate', { defaultValue: 'Задать' })}
              </button>
            )}
          </>
        )}
        <span className="ml-auto text-[11px] text-gray-500 dark:text-slate-400">
          {t('budget.rateHint', { defaultValue: 'Часы превращаются в деньги в момент ввода — смена ставки не пересчитывает прошлые месяцы.' })}
        </span>
      </div>
    </div>
  )
}

function TargetCard({ label, limitLabel, value, planned, projectId, field, kind, canWrite, onSaved }: {
  label: string; limitLabel: string; value: number | null; planned: number; projectId: string
  field: 'budget_target' | 'income_target'; kind: BudgetKind; canWrite: boolean; onSaved: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  useEffect(() => { if (!editing) setDraft(value != null ? String(value) : '') }, [value, editing])

  const limit = value != null && value > 0 ? value : null   // 0/пусто = лимит/цель не заданы
  const save = async () => {
    setSaving(true)
    try { await updateBudgetSettings(projectId, { [field]: draft }); onSaved(); setEditing(false) }
    finally { setSaving(false) }
  }

  // Сверка суммы статей с лимитом/целью. Расходы: «хорошо» — уложиться в лимит; доходы — превысить цель.
  let delta: { text: string; cls: string } | null = null
  if (limit != null) {
    if (kind === 'expense') {
      const remain = limit - planned
      delta = remain >= 0
        ? { text: `${t('budget.remainingLabel', { defaultValue: 'Остаток' })}: ${fmt(remain)}`, cls: 'text-slate-600 dark:text-slate-400' }
        : { text: `${t('budget.overrunLabel', { defaultValue: 'Перерасход' })}: ${fmt(-remain)}`, cls: 'text-red-600' }
    } else {
      const diff = planned - limit
      delta = diff >= 0
        ? { text: `${t('budget.goalExceeded', { defaultValue: 'Цель перекрыта' })}: ${fmt(diff)}`, cls: 'text-green-600' }
        : { text: `${t('budget.goalRemaining', { defaultValue: 'Осталось запланировать' })}: ${fmt(-diff)}`, cls: 'text-amber-600' }
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
        {canWrite && !editing && (
          <button onClick={() => setEditing(true)} aria-label={t('common.edit')}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 dark:text-slate-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-slate-800"><Pencil size={ICON_SM} /></button>
        )}
      </div>

      {/* Заголовок = сумма статей (снизу вверх), только для чтения */}
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{fmt(planned)}</p>
      <p className="text-xs text-gray-500 dark:text-slate-400">{t('budget.fromItems', { defaultValue: 'Сумма статей' })}</p>

      {/* Необязательный лимит (расходы) / целевой доход */}
      <div className="mt-2 space-y-0.5 text-xs">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 dark:text-slate-400">{limitLabel}:</span>
            <input autoFocus inputMode="decimal" value={draft} placeholder="0"
              onChange={e => setDraft(digitsOnly(e.target.value))}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              className="w-32 rounded border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-right text-sm" />
            <button onClick={save} disabled={saving} aria-label={t('common.save', { defaultValue: 'Сохранить' })}
              className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 disabled:opacity-50"><Check size={ICON_SM} /></button>
            <button onClick={() => setEditing(false)} aria-label={t('common.cancel')}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"><X size={ICON_SM} /></button>
          </div>
        ) : limit != null ? (
          <p className="text-gray-500 dark:text-slate-400">
            {limitLabel}:{' '}
            <span className="font-medium tabular-nums text-gray-700 dark:text-slate-200">{fmt(limit)}</span>
          </p>
        ) : (
          <p className="text-gray-500 dark:text-slate-400">
            {kind === 'expense'
              ? t('budget.limitNotSet', { defaultValue: 'Лимит не задан' })
              : t('budget.goalNotSet', { defaultValue: 'Цель не задана' })}
          </p>
        )}
        {delta && <p className={delta.cls}>{delta.text}</p>}
      </div>
    </div>
  )
}

// ── таблица статей ───────────────────────────────────────────────────────────
function EstimatesTable({ items, canWrite, editFields, editId, setEditId, onUpdate, onDelete, onAdd, kind }: {
  items: BudgetItem[]; canWrite: boolean
  editFields: FieldDef[]; editId: string | null; setEditId: (id: string | null) => void
  onUpdate: (id: string, v: Record<string, string>) => Promise<void>; onDelete: (id: string) => void; onAdd: () => void; kind: BudgetKind
}) {
  const { t } = useTranslation()
  // planned_hours обязано быть здесь: RowForm инициализирует КАЖДОЕ своё поле как
  // initialValues[key] ?? '' и отправляет весь набор целиком. Без этой строки правка названия
  // отправляла бы planned_hours пустым — часы молча стирались бы при любой правке статьи.
  const toValues = (i: BudgetItem): Record<string, string> => ({
    name: i.name, category: i.category,
    amount: plannedOf(i)?.toString() ?? '', actual_total: actualOf(i)?.toString() ?? '',
    planned_hours: i.planned_hours != null ? String(i.planned_hours) : '',
    comments: i.comments ?? '',
  })
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="border-b border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400">
          <th className="text-left py-2 pr-3">{t('budget.itemName')}</th>
          <th className="text-left py-2 pr-3">{t('budget.category')}</th>
          <th className="text-right py-2 pr-3">{t('budget.amountPlan', { defaultValue: 'Сумма (план)' })}</th>
          <th className="text-right py-2 pr-3">{t('budget.amountActual', { defaultValue: 'Сумма (факт)' })}</th>
          <th className="text-right py-2 pr-3">{t('budget.variance')}</th>
          <th className="w-16" />
        </tr></thead>
        <tbody>
          {items.map(item => {
            const p = plannedOf(item) ?? 0, a = actualOf(item) ?? 0
            const variance = p - a
            // Для доходов «хорошо» = факт ≥ план (обратная логика отклонения).
            const good = kind === 'income' ? a >= p : variance >= 0
            return (
              <Fragment key={item.id}>
                <tr className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="py-2 pr-3 font-medium text-gray-800 dark:text-slate-200">{item.name}</td>
                  <td className="py-2 pr-3 text-gray-500 dark:text-slate-300">{categoryLabel(kind, item.category, t)}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{fmt(plannedOf(item))}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{fmt(actualOf(item))}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${good ? 'text-green-600' : 'text-red-600'}`}>{fmt(variance)}</td>
                  <td className="py-2">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditId(item.id)} aria-label={t('common.edit')} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 dark:text-slate-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-slate-800"><Pencil size={ICON_SM} /></button>
                        <button onClick={() => onDelete(item.id)} aria-label={t('common.delete')} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 dark:text-slate-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-800"><Trash2 size={ICON_SM} /></button>
                      </div>
                    )}
                  </td>
                </tr>
                {editId === item.id && canWrite && (
                  <tr><td colSpan={6} className="py-2">
                    <RowForm fields={editFields} initialValues={toValues(item)} title={t('common.edit')}
                      onSave={(v) => onUpdate(item.id, v)} onCancel={() => setEditId(null)} />
                  </td></tr>
                )}
              </Fragment>
            )
          })}
          {items.length === 0 && (
            <tr><td colSpan={6}>
              <EmptyValueState
                inline
                message={kind === 'income'
                  ? t('budget.emptyIncome', { defaultValue: 'Занесите статьи доходов и планируйте поступления по месяцам.' })
                  : t('adopt.empty.budget', { defaultValue: 'Занесите статьи расходов — и план, факт и отклонение будут видны без сводных таблиц в Excel.' })}
                actionLabel={canWrite ? t('budget.add') : undefined} onAction={canWrite ? onAdd : undefined}
              />
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── помесячный редактируемый грид (план/факт) + выбор года ───────────────────
type CellField = 'planned' | 'actual' | 'actual_hours'

function MonthlyGrid({ items, canWrite, year, years, kind, rate, onYear, onAddYear, monthShort, onSaveCell }: {
  items: BudgetItem[]; canWrite: boolean; year: number; years: number[]; kind: BudgetKind
  rate: number
  onYear: (y: number) => void; onAddYear: (y: number) => void
  monthShort: (m: number) => string
  onSaveCell: (item: BudgetItem, month: number, field: CellField, raw: string) => void
}) {
  const { t } = useTranslation()
  const rowsPerItem = rate > 0 ? 3 : 2
  const freeCls = (v: number | null) =>
    v == null ? 'text-gray-500 dark:text-slate-400'
      : v < 0 ? 'text-red-600' : v === 0 ? 'text-gray-500 dark:text-slate-400' : 'text-green-600'
  const cellVal = (i: BudgetItem, m: number, f: CellField): string => {
    const e = (i.monthly || []).find(x => Number(x.year) === year && Number(x.month) === m)
    const v = e ? e[f] : null
    return v == null ? '' : String(v)
  }
  const colTotal = (m: number, f: CellField) =>
    items.reduce((s, i) => s + (numOf(cellVal(i, m, f)) ?? 0), 0)
  const rowTotal = (i: BudgetItem, f: CellField) =>
    MONTHS.reduce((s, m) => s + (numOf(cellVal(i, m, f)) ?? 0), 0)

  /** Сколько ДАЛИ БЫ введённые часы: подсказка в пустой денежной ячейке, пока сумму не ввели. */
  const hintFromHours = (i: BudgetItem, m: number, f: CellField): string => {
    if (f !== 'actual' || rate <= 0 || cellVal(i, m, 'actual') !== '') return ''
    const h = numOf(cellVal(i, m, 'actual_hours'))
    return h ? String(Math.round(h * rate * 100) / 100) : ''
  }

  const input = (i: BudgetItem, m: number, f: CellField) => {
    const hint = hintFromHours(i, m, f)
    return (
      <input
        key={`${i.id}-${year}-${m}-${f}`}
        defaultValue={cellVal(i, m, f)}
        disabled={!canWrite}
        placeholder={hint}
        title={hint ? t('budget.fromHoursHint', { defaultValue: 'Посчитано из часов по ставке — впишите сумму, чтобы задать её вручную' }) : undefined}
        onBlur={(e) => onSaveCell(i, m, f, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-16 text-right text-xs border border-transparent hover:border-gray-300 focus:border-primary-500 dark:hover:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-1 py-0.5 disabled:opacity-60 placeholder:text-gray-400 dark:placeholder:text-slate-500"
      />
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-slate-400">{t('budget.year', { defaultValue: 'Год' })}:</label>
        <select value={year} onChange={e => onYear(Number(e.target.value))}
          className="text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {canWrite && (
          <button onClick={() => onAddYear((years[years.length - 1] || new Date().getFullYear()) + 1)}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
            + {t('budget.addYear', { defaultValue: 'Добавить год' })}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">{t('budget.noData')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400">
                <th className="text-left py-2 pr-3 sticky left-0 bg-white dark:bg-slate-900 min-w-[180px]">{t('budget.itemName')}</th>
                <th className="text-left py-2 pr-3 min-w-[140px]">{t('budget.category')}</th>
                <th className="text-right py-2 pr-3 whitespace-nowrap">{t('budget.itemBudget', { defaultValue: 'Бюджет статьи' })}</th>
                <th className="text-right py-2 pr-3 whitespace-nowrap"
                  title={t('budget.freeHint', { defaultValue: 'Бюджет статьи минус распределённый помесячный план (за все годы)' })}>
                  {t('budget.free', { defaultValue: 'Свободно' })}
                </th>
                <th className="text-left py-2 pr-2">{t('common.type')}</th>
                {MONTHS.map(m => <th key={m} className="text-center px-1 py-2 capitalize">{monthShort(m)}</th>)}
                <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">{t('budget.yearTotal', { defaultValue: 'Итого за год' })}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <Fragment key={item.id}>
                  <tr className="border-b border-gray-50 dark:border-slate-800">
                    <td className="py-1 pr-3 font-medium text-gray-800 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900" rowSpan={rowsPerItem}>{item.name}</td>
                    <td className="py-1 pr-3 text-gray-500 dark:text-slate-300" rowSpan={rowsPerItem}>{categoryLabel(kind, item.category, t)}</td>
                    <td className="py-1 pr-3 text-right font-semibold tabular-nums text-gray-700 dark:text-slate-200" rowSpan={rowsPerItem}>{fmt(budgetOf(item))}</td>
                    <td className={`py-1 pr-3 text-right font-semibold tabular-nums ${freeCls(freeOf(item))}`} rowSpan={rowsPerItem}>{fmt(freeOf(item))}</td>
                    <td className="py-1 pr-2 text-blue-600">{t('budget.plan')}</td>
                    {MONTHS.map(m => <td key={m} className="px-1 py-0.5 text-right">{input(item, m, 'planned')}</td>)}
                    <td className="px-2 text-right font-semibold text-gray-700 dark:text-slate-200">{fmt(rowTotal(item, 'planned'))}</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1 pr-2 text-green-600">{t('budget.actual')}</td>
                    {MONTHS.map(m => <td key={m} className="px-1 py-0.5 text-right">{input(item, m, 'actual')}</td>)}
                    <td className="px-2 text-right font-semibold text-gray-700 dark:text-slate-200">{fmt(rowTotal(item, 'actual'))}</td>
                  </tr>
                  {/* Часы показываем только при заданной ставке: без неё их не во что превратить. */}
                  {rate > 0 && (
                    <tr className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-1 pr-2 whitespace-nowrap text-amber-600 dark:text-amber-400">
                        {t('budget.actualHours', { defaultValue: 'Часы (факт)' })}
                      </td>
                      {MONTHS.map(m => <td key={m} className="px-1 py-0.5 text-right">{input(item, m, 'actual_hours')}</td>)}
                      <td className="px-2 text-right font-semibold text-gray-700 dark:text-slate-200">{fmt(rowTotal(item, 'actual_hours'))}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="border-t-2 border-gray-300 dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">
                <td className="py-1.5 pr-3 sticky left-0 bg-white dark:bg-slate-900" rowSpan={2}>{t('budget.rowTotal', { defaultValue: 'Итого' })}</td>
                <td className="py-1.5 pr-3" rowSpan={2} />
                <td className="py-1.5 pr-3 text-right tabular-nums" rowSpan={2}>
                  {fmt(items.reduce((s, i) => s + (budgetOf(i) ?? 0), 0))}
                </td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${freeCls(items.reduce((s, i) => s + (freeOf(i) ?? 0), 0))}`} rowSpan={2}>
                  {fmt(items.reduce((s, i) => s + (freeOf(i) ?? 0), 0))}
                </td>
                <td className="py-1.5 pr-2 text-blue-600">{t('budget.plan')}</td>
                {MONTHS.map(m => <td key={m} className="px-1 text-right">{fmt(colTotal(m, 'planned'))}</td>)}
                <td className="px-2 text-right">{fmt(MONTHS.reduce((s, m) => s + colTotal(m, 'planned'), 0))}</td>
              </tr>
              <tr className="font-semibold text-gray-700 dark:text-slate-200">
                <td className="py-1.5 pr-2 text-green-600">{t('budget.actual')}</td>
                {MONTHS.map(m => <td key={m} className="px-1 text-right">{fmt(colTotal(m, 'actual'))}</td>)}
                <td className="px-2 text-right">{fmt(MONTHS.reduce((s, m) => s + colTotal(m, 'actual'), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">{t('budget.monthlyHint', { defaultValue: 'Впишите план и факт по месяцам — сохраняется автоматически. Для многолетних проектов переключайте год.' })}</p>
    </div>
  )
}
