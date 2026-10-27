import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface PageShellProps {
  children: ReactNode
  className?: string
}

export function PageShell({ children, className }: PageShellProps) {
  return <div className={cn('flex w-full min-w-0 flex-col gap-6', className)}>{children}</div>
}

export interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white/94 dark:bg-slate-900 px-4 py-3 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.3)] backdrop-blur-sm', className)}>
      {children}
    </div>
  )
}
