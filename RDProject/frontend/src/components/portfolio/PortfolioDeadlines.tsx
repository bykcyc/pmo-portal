/**
 * «Сроки завершения проектов» — что заканчивается в ближайший год, по кварталам.
 *
 * График, который на разборе у руководства всегда вызывает разговор: он показывает, где скучилось.
 * Кварталы, а не месяцы: на год вперёд двенадцать столбиков читаются как шум, а «во втором квартале
 * сдаём семь проектов» — это уже решение о ресурсах.
 *
 * Одних цифр мало: «7 проектов в Q2» ничего не говорит, пока не видно КАКИХ. Поэтому столбик
 * кликабельный, а под графиком — список проектов выбранного периода с кодом, руководителем,
 * датой и цветом RAG.
 *
 * Считаются незакрытые проекты с плановой датой: у закрытых дата уже ничего не обещает, а строки
 * реестра сюда не попадают — у них дат нет.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PortfolioProject } from '@/api/portfolio'
import { SectionCard } from '@/components/ui/surface'
import MetricHelp from '@/components/portfolio/MetricHelp'
import { formatDate } from '@/utils/date'

const QUARTERS_AHEAD = 4          // текущий + три следующих = год вперёд

const RAG_DOT: Record<string, string> = {
  red: 'bg-rose-500', amber: 'bg-amber-500', green: 'bg-emerald-500',
}

interface Bucket {
  key: string
  label: string
  tone: 'overdue' | 'plan' | 'later'
  items: PortfolioProject[]
}

export default function PortfolioDeadlines({ projects }: { projects: PortfolioProject[] }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)

  const buckets = useMemo<Bucket[]>(() => {
    const now = new Date()
    const qOf = (d: Date) => Math.floor(d.getMonth() / 3) + 1
    const qKey = (y: number, q: number) => `${y}-Q${q}`
    const qLabel = (y: number, q: number) => `Q${q} ${y}`

    const plan = new Map<string, Bucket>()
    for (let i = 0; i < QUARTERS_AHEAD; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i * 3, 1)
      const k = qKey(d.getFullYear(), qOf(d))
      if (!plan.has(k)) plan.set(k, { key: k, label: qLabel(d.getFullYear(), qOf(d)), tone: 'plan', items: [] })
    }
    const overdue: Bucket = { key: 'overdue', label: t('portfolio.deadlines.overdue', { defaultValue: 'Просрочено' }), tone: 'overdue', items: [] }
    const later: Bucket = { key: 'later', label: t('portfolio.deadlines.later', { defaultValue: 'Позже' }), tone: 'later', items: [] }

    const todayIso = now.toISOString().slice(0, 10)
    for (const p of projects) {
      if (p.status === 'completed' || p.status === 'cancelled' || !p.planned_end) continue
      const end = String(p.planned_end).slice(0, 10)
      if (end < todayIso) { overdue.items.push(p); continue }
      const d = new Date(`${end}T00:00:00`)
      const k = qKey(d.getFullYear(), qOf(d))
      const target = plan.get(k)
      if (target) target.items.push(p)
      else later.items.push(p)
    }

    const sortByDate = (b: Bucket) => {
      b.items.sort((a, c) => String(a.planned_end).localeCompare(String(c.planned_end)))
      return b
    }
    return [
      ...(overdue.items.length ? [sortByDate(overdue)] : []),
      ...[...plan.values()].map(sortByDate),
      ...(later.items.length ? [sortByDate(later)] : []),
    ]
  }, [projects, t])

  const data = buckets.map((b) => ({ ...b, count: b.items.length }))
  const total = data.reduce((s, r) => s + r.count, 0)

  // По умолчанию раскрыт первый непустой период: пустой список под графиком выглядел бы поломкой.
  useEffect(() => {
    if (selected && data.some((b) => b.key === selected)) return
    setSelected(data.find((b) => b.count > 0)?.key ?? null)
  }, [data, selected])

  const shown = data.find((b) => b.key === selected)

  return (
    <SectionCard
      title={t('portfolio.deadlines.title', { defaultValue: 'Сроки завершения проектов' })}
      actions={<MetricHelp anchor="charts" />}
      description={t('portfolio.deadlines.desc', {
        defaultValue: 'По кварталам на год вперёд. Нажмите на столбик — увидите, какие именно проекты заканчиваются.',
      })}
    >
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">
          {t('portfolio.deadlines.empty', { defaultValue: 'Ни у одного открытого проекта не проставлена плановая дата завершения.' })}
        </p>
      ) : (
        <>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }}
                  formatter={(v: number) => [v, t('portfolio.deadlines.projects', { defaultValue: 'проектов' })]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} onClick={(d: { key?: string }) => d.key && setSelected(d.key)}>
                  {data.map((r) => (
                    // Просроченные — красным: это уже случилось, а не план. Выбранный период ярче.
                    <Cell
                      key={r.key}
                      cursor="pointer"
                      fillOpacity={r.key === selected ? 1 : 0.55}
                      fill={r.tone === 'overdue' ? '#f43f5e' : r.tone === 'later' ? '#94a3b8' : 'var(--chart-accent)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Периоды кнопками — на случай, если по узкому столбику не попасть мышью. */}
          <div className="mt-3 flex flex-wrap gap-1">
            {data.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelected(b.key)}
                aria-current={b.key === selected ? 'true' : undefined}
                className={`rounded-lg px-2.5 py-1 text-xs ${
                  b.key === selected
                    ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60'
                }`}
              >
                {b.label} · {b.count}
              </button>
            ))}
          </div>

          {shown && (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {shown.items.length === 0 ? (
                <li className="py-3 text-xs text-slate-600 dark:text-slate-400">
                  {t('portfolio.deadlines.emptyPeriod', { defaultValue: 'В этом периоде ничего не заканчивается.' })}
                </li>
              ) : shown.items.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${RAG_DOT[p.rag_status ?? ''] ?? 'bg-slate-300 dark:bg-slate-600'}`}
                  />
                  <span className="w-20 shrink-0 truncate font-mono text-[10px] uppercase text-slate-600 dark:text-slate-400">{p.code}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200" title={p.name}>{p.name}</span>
                  <span className="w-40 shrink-0 truncate text-slate-600 dark:text-slate-400" title={p.pm_name ?? ''}>{p.pm_name ?? '—'}</span>
                  <span className="w-24 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-400">
                    {p.planned_end ? formatDate(p.planned_end) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  )
}
