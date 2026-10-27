import type { HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

/** A simple pulsing placeholder block used while content is loading. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-slate-200 dark:bg-slate-700', className)}
      {...props}
    />
  )
}

interface SkeletonRowsProps {
  rows?: number
  className?: string
  rowClassName?: string
}

/** Renders a small vertical stack of skeleton rows. */
export function SkeletonRows({ rows = 3, className, rowClassName }: SkeletonRowsProps) {
  return (
    <div role="status" aria-busy="true" className={cn('space-y-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-10 w-full', rowClassName)} />
      ))}
    </div>
  )
}
