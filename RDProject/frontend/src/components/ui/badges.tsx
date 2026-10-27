import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'
import { PRIORITY_COLORS, STATUS_COLORS } from '@/constants/statusColors'

const SOFT_BADGE = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium'

export function StatusBadge({ className, children, status }: { className?: string; children?: ReactNode; status: string }) {
  return (
    <span className={cn(SOFT_BADGE, STATUS_COLORS[status] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200', className)}>
      {children ?? status}
    </span>
  )
}

export function PriorityBadge({ className, children, priority }: { className?: string; children?: ReactNode; priority: string }) {
  return (
    <span className={cn(SOFT_BADGE, PRIORITY_COLORS[priority] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200', className)}>
      {children ?? priority}
    </span>
  )
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn(SOFT_BADGE, 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200', className)}>{children}</span>
}

/** Полоса прогресса с подписью. Переехала сюда из страницы списка, когда её понадобилось
 *  показать ещё и в сводке подпроектов: третья копия одной полоски рано или поздно
 *  разошлась бы с первыми двумя по высоте и цвету. */
export function ProgressBar({ value }: { value: number }) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
        <span>{t('portfolio.progress', { defaultValue: 'Прогресс' })}</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">{value}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}
