/**
 * Компактные «бублики» портфеля — вместо простыни из пятнадцати чисел.
 *
 * Каждая долька читается за секунду: цвет говорит, что это, дырка в середине — итог. Числа
 * остались рядом подписями, поэтому точность не потеряна, а «сколько всего и как поделено»
 * теперь видно глазом, а не сложением в уме.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter, SlidersHorizontal, X } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { PortfolioProject } from '@/api/portfolio'
import { getUserPrefs, putUserPrefs } from '@/api/prefs'
import { useToastStore } from '@/store/toastStore'
import { Surface } from '@/components/ui/surface'

interface Slice { key: string; label: string; value: number; color: string }

/** Порядок и состав диаграмм. Ключи попадают в настройки пользователя — не переименовывать:
 *  переименование ключа читается как «диаграмма исчезла» у всех, кто её уже настроил. */
const DONUT_KEYS = ['status', 'rag', 'kind', 'priority', 'tasks', 'risks', 'budget', 'health'] as const
type DonutKey = (typeof DONUT_KEYS)[number]
const PREFS_KEY = 'portfolioDonuts'          // какие диаграммы скрыты целиком
const SLICES_PREFS_KEY = 'portfolioDonutSlices'  // какие дольки скрыты внутри каждой диаграммы

/** Число с разделителями тысяч: «123456» в подписи читается хуже, чем «123 456». */
const nfmt = (v: number, lang: string) => v.toLocaleString(lang || 'ru')

/** Короткая запись для дырки бублика: там всего ~52px, и «987 654» туда не влезает.
 *  Точная сумма никуда не девается — она в подписи-тултипе и в легенде. */
function short(v: number, lang: string, t: (k: string, o: { defaultValue: string }) => string) {
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    return `${nfmt(Number(m.toFixed(m < 10 ? 1 : 0)), lang)} ${t('portfolio.donut.million', { defaultValue: 'млн' })}`
  }
  if (v >= 10_000) return `${nfmt(Math.round(v / 1000), lang)} ${t('portfolio.donut.thousand', { defaultValue: 'тыс.' })}`
  return nfmt(Math.round(v), lang)
}

/** Кегль по длине строки. Дырка бублика — 52px, поэтому лесенка мелкая: одна-две цифры
 *  должны читаться крупно, а «988 тыс.» — не упираться в кольцо. */
const centerSize = (s: string) =>
  s.length <= 3 ? 'text-base' : s.length <= 5 ? 'text-sm' : s.length <= 6 ? 'text-xs' : 'text-[10px]'

const C = {
  slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#10b981',
  rose: '#f43f5e', orange: '#f97316', violet: '#8b5cf6', sky: '#0ea5e9',
}

/**
 * Одна диаграмма со своим фильтром.
 *
 * Фильтр именно ПОДОЛЬКОВЫЙ: руководителю нужно не «спрятать диаграмму», а посмотреть срез —
 * например, только «Активные» и «Приостановленные» в статусах. Снятые дольки не рисуются,
 * не попадают в подписи и не считаются в центре (если центр — сумма долек).
 *
 * `totalMode`: 'sum' — центр пересчитывается по видимым долькам (там, где он и есть их сумма);
 * 'fixed' — центр самостоятелен (бюджет, среднее здоровье, число красных) и фильтром не двигается.
 */
function Donut({ title, slices, total, totalLabel, totalTitle, totalMode = 'fixed', hidden, onToggle, onReset }: {
  title: string; slices: Slice[]; total: number | string; totalLabel?: string; totalTitle?: string
  totalMode?: 'sum' | 'fixed'
  hidden?: Set<string>
  onToggle?: (sliceKey: string) => void
  onReset?: () => void
}) {
  const { t, i18n } = useTranslation()
  const [filterOpen, setFilterOpen] = useState(false)
  const shownSlices = slices.filter((s) => !hidden?.has(s.key))
  const data = shownSlices.filter((s) => s.value > 0)
  const filtered = (hidden?.size ?? 0) > 0
  const shownTotal = totalMode === 'sum' && filtered
    ? shownSlices.reduce((sum, s) => sum + s.value, 0)
    : total
  const totalStr = String(shownTotal)
  return (
    <Surface className="p-3">
      <div className="mb-1 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600 dark:text-slate-300" title={title}>{title}</p>
        {onToggle && (
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            title={t('portfolio.donut.filter', { defaultValue: 'Фильтр диаграммы' })}
            aria-label={t('portfolio.donut.filter', { defaultValue: 'Фильтр диаграммы' })}
            className={`shrink-0 rounded p-0.5 ${filtered
              ? 'text-blue-700 dark:text-blue-300'
              : 'text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300'}`}
          >
            <Filter size={13} aria-hidden />
          </button>
        )}
      </div>

      {filterOpen && onToggle && (
        <div className="mb-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <ul className="space-y-0.5">
            {slices.map((s) => (
              <li key={s.key}>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={!hidden?.has(s.key)}
                    onChange={() => onToggle(s.key)}
                  />
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate" title={s.label}>{s.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {filtered && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="mt-1 text-[11px] text-blue-700 hover:underline dark:text-blue-300"
            >
              {t('portfolio.donut.filterReset', { defaultValue: 'Показать все' })}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="relative h-[86px] w-[86px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.length ? data : [{ key: 'empty', label: '', value: 1, color: '#e2e8f0' }]}
                dataKey="value" nameKey="label" innerRadius={26} outerRadius={40} paddingAngle={data.length > 1 ? 2 : 0}
                stroke="none" isAnimationActive={false}>
                {(data.length ? data : [{ key: 'empty', color: '#e2e8f0' } as Slice]).map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              {data.length > 0 && <Tooltip formatter={(v: number, n: string) => [v, n]} />}
            </PieChart>
          </ResponsiveContainer>
          {/* Итог — в дырке: главное число не должно искаться глазами по подписям. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span
              title={totalTitle ?? totalStr}
              className={`whitespace-nowrap font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-100 ${centerSize(totalStr)}`}
            >
              {shownTotal}
            </span>
            {totalLabel && <span className="text-[9px] text-slate-500 dark:text-slate-400">{totalLabel}</span>}
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-0.5">
          {shownSlices.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[11px] leading-tight">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400" title={s.label}>{s.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-slate-800 dark:text-slate-200">{nfmt(s.value, i18n.language)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Surface>
  )
}

/**
 * `stubs` — строки реестра переходного периода: проекты, которые ДОЛЖНЫ быть, но ещё не заведены.
 *
 * Считаем их там, где данные реально есть (вид проекта, RAG-оценка владельца, руководитель),
 * и НЕ считаем там, где их нет: статус и приоритет у болванки проставлены «для вида», чтобы
 * строка отрисовалась в таблице, — гнать их в статистику значило бы выдумывать цифры. Поэтому
 * в этих двух пончиках у болванок своя долька «ещё не заведены».
 *
 * Задачи, риски и бюджет у болванок нулевые — на суммы они не влияют, и это честно: работа
 * по ним ещё не начата. Среднее здоровье тоже считается только по заведённым: у болванки
 * здоровья нет, а ноль занизил бы портфель без причины.
 */
export default function PortfolioDonuts({ projects, stubs = [] }: { projects: PortfolioProject[]; stubs?: PortfolioProject[] }) {
  const { t, i18n } = useTranslation()

  const d = useMemo(() => {
    const count = (fn: (p: PortfolioProject) => boolean) => projects.filter(fn).length
    // По виду и по RAG данные у болванок настоящие — считаем вместе с заведёнными.
    const countAll = (fn: (p: PortfolioProject) => boolean) => [...projects, ...stubs].filter(fn).length
    const planned = stubs.length
    let tasks = 0, done = 0, overdue = 0, high = 0, medium = 0, plan = 0, actual = 0, health = 0, healthN = 0
    for (const p of projects) {
      tasks += p.total_tasks || 0
      done += p.tasks_completed || 0
      overdue += p.overdue_tasks_count || 0
      high += p.open_risks_high_count || 0
      medium += p.open_risks_medium_count || 0
      plan += p.budget_plan || 0
      actual += p.budget_actual || 0
      if (typeof p.health === 'number' && p.status !== 'completed' && p.status !== 'cancelled') {
        health += p.health; healthN += 1
      }
    }
    const rest = Math.max(0, tasks - done - overdue)
    const avgHealth = healthN ? Math.round(health / healthN) : null
    return { count, countAll, planned, tasks, done, overdue, rest, high, medium, plan, actual, avgHealth }
  }, [projects, stubs])

  const money = (v: number) => nfmt(Math.round(v), i18n.language)

  // Настройки едут за человеком: сервер, а не localStorage (см. api/prefs.ts).
  const qc = useQueryClient()
  const [setupOpen, setSetupOpen] = useState(false)
  const { data: prefs } = useQuery({ queryKey: ['me-prefs'], queryFn: getUserPrefs, staleTime: 300_000 })
  const hidden = useMemo(() => {
    const raw = prefs?.[PREFS_KEY]
    return new Set(Array.isArray(raw) ? raw.map(String) : [])
  }, [prefs])
  const vis = (k: DonutKey) => !hidden.has(k)

  // Подольковые фильтры: у каждой диаграммы свой набор скрытых ключей.
  const hiddenSlices = useMemo(() => {
    const raw = prefs?.[SLICES_PREFS_KEY]
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const out: Partial<Record<DonutKey, Set<string>>> = {}
    for (const k of DONUT_KEYS) {
      const list = src[k]
      out[k] = new Set(Array.isArray(list) ? list.map(String) : [])
    }
    return out as Record<DonutKey, Set<string>>
  }, [prefs])

  /** Общая запись настроек: оптимистично в кэш, потом на сервер, при ошибке — откат. */
  const savePrefs = async (patch: Record<string, unknown>) => {
    const before = prefs
    qc.setQueryData(['me-prefs'], { ...(prefs ?? {}), ...patch })
    try {
      const saved = await putUserPrefs(patch)
      qc.setQueryData(['me-prefs'], saved)
    } catch {
      qc.setQueryData(['me-prefs'], before)
      useToastStore.getState().show(t('common.error', { defaultValue: 'Ошибка' }), 'error')
    }
  }

  const toggleSlice = (donut: DonutKey) => (sliceKey: string) => {
    const next = new Set(hiddenSlices[donut])
    if (next.has(sliceKey)) next.delete(sliceKey)
    else next.add(sliceKey)
    const all: Record<string, string[]> = {}
    for (const k of DONUT_KEYS) all[k] = [...(k === donut ? next : hiddenSlices[k])]
    void savePrefs({ [SLICES_PREFS_KEY]: all })
  }

  const resetSlices = (donut: DonutKey) => () => {
    const all: Record<string, string[]> = {}
    for (const k of DONUT_KEYS) all[k] = k === donut ? [] : [...hiddenSlices[k]]
    void savePrefs({ [SLICES_PREFS_KEY]: all })
  }

  /** Пропсы фильтра — одинаковые у всех диаграмм, отличается только ключ. */
  const filterProps = (k: DonutKey) => ({
    hidden: hiddenSlices[k],
    onToggle: toggleSlice(k),
    onReset: resetSlices(k),
  })

  const toggle = async (k: DonutKey) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    // Галочка переключается СРАЗУ, не дожидаясь сети: иначе на щелчок нет отклика и человек
    // жмёт второй раз. При ошибке возвращаем как было и говорим об этом.
    // Сохраняем СКРЫТЫЕ, а не показанные: новая диаграмма тогда появится у всех сама,
    // а не останется невидимой у тех, кто настраивал вид раньше.
    await savePrefs({ [PREFS_KEY]: [...next] })
  }

  const title = (k: DonutKey) => ({
    status: t('portfolio.donut.status', { defaultValue: 'По статусу' }),
    rag: t('portfolio.donut.rag', { defaultValue: 'По RAG-статусу' }),
    kind: t('portfolio.donut.kind', { defaultValue: 'По виду проекта' }),
    priority: t('portfolio.donut.priority', { defaultValue: 'По приоритету' }),
    tasks: t('portfolio.donut.tasks', { defaultValue: 'Задачи портфеля' }),
    risks: t('portfolio.donut.risks', { defaultValue: 'Открытые риски' }),
    budget: t('portfolio.donut.budget', { defaultValue: 'Бюджет портфеля' }),
    health: t('portfolio.donut.health', { defaultValue: 'Общий статус' }),
  }[k])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          aria-expanded={setupOpen}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
        >
          <SlidersHorizontal size={14} aria-hidden />
          {t('portfolio.donut.setup', { defaultValue: 'Настроить диаграммы' })}
        </button>
      </div>

      {setupOpen && (
        <Surface className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
              {t('portfolio.donut.setupHint', { defaultValue: 'Отметьте, какие диаграммы показывать. Настройка сохраняется за вами.' })}
            </p>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              aria-label={t('common.close', { defaultValue: 'Закрыть' })}
              className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {DONUT_KEYS.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={vis(k)} onChange={() => void toggle(k)} className="h-3.5 w-3.5" />
                <span className="truncate" title={title(k)}>{title(k)}</span>
              </label>
            ))}
          </div>
        </Surface>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {vis('status') && (
        <Donut
          title={t('portfolio.donut.status', { defaultValue: 'По статусу' })}
          total={projects.length + d.planned}
          totalLabel={t('portfolio.donut.projects', { defaultValue: 'проектов' })}
          slices={[
            { key: 'planning', label: t('project.status.planning'), value: d.count((p) => p.status === 'planning'), color: C.slate },
            { key: 'active', label: t('project.status.active'), value: d.count((p) => p.status === 'active'), color: C.blue },
            { key: 'on_hold', label: t('project.status.on_hold'), value: d.count((p) => p.status === 'on_hold'), color: C.amber },
            { key: 'completed', label: t('project.status.completed'), value: d.count((p) => p.status === 'completed'), color: C.emerald },
            { key: 'cancelled', label: t('project.status.cancelled'), value: d.count((p) => p.status === 'cancelled'), color: '#cbd5e1' },
            { key: 'planned', label: t('portfolio.donut.notCreated', { defaultValue: 'Ещё не заведены' }), value: d.planned, color: C.slate },
          ]}
          {...filterProps('status')}
          totalMode="sum"
        />
      )}
      {vis('rag') && (
        <Donut
          title={t('portfolio.donut.rag', { defaultValue: 'По RAG-статусу' })}
          total={d.countAll((p) => p.rag_status === 'red')}
          totalLabel={t('portfolio.ragRed', { defaultValue: 'красных' })}
          slices={[
            { key: 'red', label: t('portfolio.ragRed', { defaultValue: 'Красный' }), value: d.countAll((p) => p.rag_status === 'red'), color: C.rose },
            { key: 'amber', label: t('portfolio.ragAmber', { defaultValue: 'Жёлтый' }), value: d.countAll((p) => p.rag_status === 'amber'), color: C.amber },
            { key: 'green', label: t('portfolio.ragGreen', { defaultValue: 'Зелёный' }), value: d.countAll((p) => p.rag_status === 'green'), color: C.emerald },
          ]}
          {...filterProps('rag')}
        />
      )}
      {vis('kind') && (
        <Donut
          title={t('portfolio.donut.kind', { defaultValue: 'По виду проекта' })}
          total={projects.length + d.planned}
          slices={[
            { key: 'strategic', label: t('project.kind.strategic', { defaultValue: 'Стратегический' }), value: d.countAll((p) => p.project_kind === 'strategic'), color: C.violet },
            { key: 'operational', label: t('project.kind.operational', { defaultValue: 'Операционный' }), value: d.countAll((p) => p.project_kind === 'operational'), color: C.sky },
            { key: 'pilot', label: t('project.kind.pilot', { defaultValue: 'Пилотный' }), value: d.countAll((p) => p.project_kind === 'pilot'), color: C.amber },
            { key: 'none', label: t('portfolio.noKind', { defaultValue: 'Без вида' }), value: d.countAll((p) => !p.project_kind), color: C.slate },
          ]}
          {...filterProps('kind')}
          totalMode="sum"
        />
      )}
      {vis('priority') && (
        <Donut
          title={t('portfolio.donut.priority', { defaultValue: 'По приоритету' })}
          total={projects.length + d.planned}
          slices={[
            { key: 'critical', label: t('project.priority.critical'), value: d.count((p) => p.priority === 'critical'), color: C.rose },
            { key: 'high', label: t('project.priority.high'), value: d.count((p) => p.priority === 'high'), color: C.orange },
            { key: 'medium', label: t('project.priority.medium'), value: d.count((p) => p.priority === 'medium'), color: C.blue },
            { key: 'low', label: t('project.priority.low'), value: d.count((p) => p.priority === 'low'), color: C.slate },
            { key: 'planned', label: t('portfolio.donut.notCreated', { defaultValue: 'Ещё не заведены' }), value: d.planned, color: C.slate },
          ]}
          {...filterProps('priority')}
          totalMode="sum"
        />
      )}
      {vis('tasks') && (
        <Donut
          title={t('portfolio.donut.tasks', { defaultValue: 'Задачи портфеля' })}
          total={d.tasks}
          totalLabel={t('portfolio.donut.tasksTotal', { defaultValue: 'всего' })}
          slices={[
            { key: 'done', label: t('portfolio.donut.done', { defaultValue: 'Выполнено' }), value: d.done, color: C.emerald },
            { key: 'overdue', label: t('portfolio.overdue', { defaultValue: 'Просрочено' }), value: d.overdue, color: C.rose },
            { key: 'rest', label: t('portfolio.donut.inWork', { defaultValue: 'В работе' }), value: d.rest, color: C.blue },
          ]}
          {...filterProps('tasks')}
          totalMode="sum"
        />
      )}
      {vis('risks') && (
        <Donut
          title={t('portfolio.donut.risks', { defaultValue: 'Открытые риски' })}
          total={d.high + d.medium}
          slices={[
            { key: 'high', label: t('portfolio.roll.high', { defaultValue: 'Высокие' }), value: d.high, color: C.rose },
            { key: 'medium', label: t('portfolio.roll.medium', { defaultValue: 'Средние' }), value: d.medium, color: C.amber },
          ]}
          {...filterProps('risks')}
          totalMode="sum"
        />
      )}
      {vis('budget') && (
        <Donut
          title={t('portfolio.donut.budget', { defaultValue: 'Бюджет портфеля' })}
          total={short(d.plan, i18n.language, t)}
          totalTitle={money(d.plan)}
          totalLabel={t('portfolio.donut.plan', { defaultValue: 'план' })}
          slices={[
            { key: 'actual', label: t('portfolio.budgetActualShort', { defaultValue: 'Факт' }), value: Math.round(d.actual), color: d.actual > d.plan ? C.rose : C.blue },
            { key: 'left', label: t('portfolio.donut.left', { defaultValue: 'Остаток' }), value: Math.max(0, Math.round(d.plan - d.actual)), color: C.slate },
          ]}
          {...filterProps('budget')}
        />
      )}
      {vis('health') && (
        <Donut
          title={t('portfolio.donut.health', { defaultValue: 'Общий статус' })}
          total={d.avgHealth ?? '—'}
          totalLabel={t('portfolio.donut.healthOf100', { defaultValue: 'из 100' })}
          slices={[
            { key: 'health', label: t('portfolio.avgHealth', { defaultValue: 'Здоровье портфеля' }), value: d.avgHealth ?? 0,
              color: (d.avgHealth ?? 0) >= 80 ? C.emerald : (d.avgHealth ?? 0) >= 50 ? C.amber : C.rose },
            { key: 'gap', label: t('portfolio.donut.gap', { defaultValue: 'До целевого' }), value: 100 - (d.avgHealth ?? 0), color: '#e2e8f0' },
          ]}
          {...filterProps('health')}
        />
      )}
      </div>
    </div>
  )
}
