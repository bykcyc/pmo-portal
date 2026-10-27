import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from 'recharts'
import {
  getPortfolioTrends, getPortfolioMilestones,
} from '@/api/portfolio'
import { SectionCard } from '@/components/ui/surface'
import { Pill } from '@/components/ui/badges'
import MetricHelp from '@/components/portfolio/MetricHelp'
import { formatDate, localIsoDate } from '@/utils/date'

function PortfolioAnalytics() {
  const { t } = useTranslation()
  const trends = useQuery({ queryKey: ['pf-trends'], queryFn: () => getPortfolioTrends(120) })
  const milestones = useQuery({ queryKey: ['pf-milestones'], queryFn: getPortfolioMilestones })

  const trendData = (trends.data ?? []).map((p) => ({ ...p, label: p.date.slice(5) }))

  // ISO-дата «сегодня» для подсветки просроченных вех (сравнение строк YYYY-MM-DD).
  const todayIso = localIsoDate()

  return (
    <div className="space-y-4">
      {/* Тренды */}
      <SectionCard
        title={t('portfolio.analytics.trends', { defaultValue: 'Тренды портфеля' })}
        description={t('portfolio.analytics.trendsDesc', { defaultValue: 'Динамика по дням (снимки портфеля).' })}
        actions={<MetricHelp anchor="charts" />}
      >
        {trendData.length < 2 ? (
          <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">
            {t('portfolio.analytics.trendsEmpty', { defaultValue: 'Недостаточно снимков для тренда — данные накапливаются ежедневно.' })}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-56">
              <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">{t('portfolio.analytics.ragOverTime', { defaultValue: 'RAG-статусы' })}</p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="red" stackId="rag" fill="#f43f5e" name={t('portfolio.ragRed', { defaultValue: 'Red' })} />
                  <Bar dataKey="amber" stackId="rag" fill="#f59e0b" name={t('portfolio.ragAmber', { defaultValue: 'Amber' })} />
                  <Bar dataKey="green" stackId="rag" fill="#10b981" name={t('portfolio.ragGreen', { defaultValue: 'Green' })} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-56">
              {/* Только просрочка по задачам: линии рисков читались как «что-то растёт», но
                  решения по ним принимают в самом проекте, а не по портфельному тренду. */}
              <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">{t('portfolio.analytics.overdueOverTime', { defaultValue: 'Просрочка по задачам' })}</p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="overdue_tasks" stroke="#f43f5e" strokeWidth={2} dot={false} name={t('portfolio.overdue', { defaultValue: 'Просрочено' })} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </SectionCard>



      {(milestones.data?.length ?? 0) > 0 && (
        <SectionCard title={t('portfolio.analytics.milestones', { defaultValue: 'Вехи портфеля' })}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {milestones.data!.slice(0, 12).map((mi) => {
              // Просроченная веха: дата в прошлом и статус не «Выполнена».
              const isOverdue = !!mi.date && mi.date.slice(0, 10) < todayIso && mi.status !== 'completed'
              return (
                <li key={`${mi.project_id}-${mi.id}`} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[10px] uppercase text-slate-600 dark:text-slate-400">{mi.project_code}</span>
                    <span className={`truncate ${isOverdue ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'}`}>{mi.title}</span>
                    {mi.status && (
                      <Pill className={isOverdue
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}
                      >
                        {t(`wbs.statuses.${mi.status}`, { defaultValue: mi.status })}
                      </Pill>
                    )}
                  </span>
                  <span
                    className={`shrink-0 ${isOverdue ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}
                    title={isOverdue ? t('portfolio.analytics.milestoneOverdue', { defaultValue: 'Веха просрочена' }) : undefined}
                  >
                    {mi.date ? formatDate(mi.date) : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  )
}

export default memo(PortfolioAnalytics)
