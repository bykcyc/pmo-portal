/**
 * Загрузка по исполнителям: открытые задачи на человека по всем доступным проектам.
 *
 * Вынесено из общей аналитики отдельным блоком, чтобы стоять в паре с «Загрузкой руководителей
 * проектов»: это два ответа на разные вопросы — «кто завален задачами» и «кто сколько ведёт», —
 * и смотрят на них рядом.
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getPortfolioWorkload } from '@/api/portfolio'
import { SectionCard } from '@/components/ui/surface'
import { Pill } from '@/components/ui/badges'
import MetricHelp from '@/components/portfolio/MetricHelp'

export default function PortfolioWorkload() {
  const { t } = useTranslation()
  const workload = useQuery({ queryKey: ['pf-workload'], queryFn: getPortfolioWorkload })
  const wl = (workload.data ?? []).slice(0, 12)
  const maxOpen = Math.max(1, ...wl.map((w) => w.open_tasks))

  return (
    <SectionCard
      title={t('portfolio.analytics.workload', { defaultValue: 'Загрузка по исполнителям' })}
      description={t('portfolio.analytics.workloadDesc', { defaultValue: 'Открытые задачи на человека (по всем доступным проектам).' })}
      actions={<MetricHelp anchor="overload" />}
    >
      {wl.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">{t('common.noResults', { defaultValue: 'Нет данных' })}</p>
      ) : (
        <div className="space-y-1.5">
          {wl.map((w) => (
            <div
              key={w.assignee}
              className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${w.overloaded ? 'bg-rose-50 dark:bg-rose-950/40' : ''}`}
            >
              {/* Имя, пометка и числа — в колонках фиксированной ширины: иначе у одних полоса
                  начинается раньше, у других позже, и график читается как кривой. */}
              <span className="w-44 shrink-0 truncate text-slate-700 dark:text-slate-200" title={w.assignee}>{w.assignee}</span>
              <span className="w-24 shrink-0">
                {w.overloaded && (
                  <Pill className="bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{t('portfolio.overloaded', { defaultValue: 'Перегружен' })}</Pill>
                )}
              </span>
              <div className="flex h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className="h-full bg-rose-500/80" style={{ width: `${(Math.min(w.overdue, w.open_tasks) / maxOpen) * 100}%` }} />
                <div className="h-full bg-blue-500/80" style={{ width: `${(Math.max(0, w.open_tasks - w.overdue) / maxOpen) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300">{w.open_tasks}</span>
              <span className="w-8 shrink-0 text-right tabular-nums text-rose-700 dark:text-rose-300">
                {w.overdue > 0 ? `−${w.overdue}` : ''}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-400" title={t('taskDrawer.estimatedHours', { defaultValue: 'Оценка, ч' })}>
                {(w.estimated_hours ?? 0) > 0 ? `${w.estimated_hours}${t('portfolio.analytics.hoursShort', { defaultValue: 'ч' })}` : ''}
              </span>
            </div>
          ))}
          <p className="pt-1 text-[10px] text-slate-600 dark:text-slate-400">
            {t('portfolio.analytics.workloadLegend', { defaultValue: 'красная часть полосы — просроченные задачи, остальная — открытые' })}
          </p>
        </div>
      )}
    </SectionCard>
  )
}
