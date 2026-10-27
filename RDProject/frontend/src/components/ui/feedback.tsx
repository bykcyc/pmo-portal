import type { ReactNode } from 'react'
import { Info, FolderOpen } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Surface } from './surface'

export interface EmptyStateConfig {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyStateConfig) {
  return (
    <Surface className="flex flex-col items-center justify-center px-6 py-14 text-center" variant="muted">
      <div className="mb-4 rounded-2xl bg-slate-200/70 dark:bg-slate-700 p-4 text-slate-600 dark:text-slate-400">
        {icon ?? <FolderOpen size={28} />}
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Surface>
  )
}

export function InfoCallout({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-4 text-sm text-slate-600 dark:text-slate-300', className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-white dark:bg-slate-900 p-1 text-slate-600 dark:text-slate-400 shadow-sm">
          <Info size={14} />
        </div>
        <div className="min-w-0">
          {title && <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>}
          <div className={cn(title && 'mt-1')}>{children}</div>
        </div>
      </div>
    </div>
  )
}
