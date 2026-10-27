import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type UiSurfaceVariant = 'default' | 'muted' | 'accent'

const SURFACE_CLASS: Record<UiSurfaceVariant, string> = {
  default: 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm',
  muted: 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60',
  accent: 'border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/40',
}

interface SurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: UiSurfaceVariant
  children?: ReactNode
}

export function Surface({ className, variant = 'default', ...props }: SurfaceProps) {
  return <div className={cn('rounded-2xl', SURFACE_CLASS[variant], className)} {...props} />
}

interface SectionCardProps extends SurfaceProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  variant = 'default',
  ...props
}: SectionCardProps) {
  return (
    <Surface className={cn('p-6', className)} variant={variant} {...props}>
      {(title || description || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Surface>
  )
}
