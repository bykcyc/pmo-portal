import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type UiButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: UiButtonVariant
  size?: UiButtonSize
  icon?: ReactNode
  children?: ReactNode
}

const VARIANT_CLASS: Record<UiButtonVariant, string> = {
  // primary через семантические токены (--btn-primary-*): Warm — тёплая жёлтая
  // с графитовым текстом (~9:1), Classic — прежняя синяя с белым. Палитровый remap
  // это не покрывает: пара «фон+текст» должна переключаться ВМЕСТЕ (жёлтый+белый — фейл AA).
  primary: 'bg-btn-primary text-btn-primary-fg shadow-sm hover:bg-btn-primary-hover',
  secondary: 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
  danger: 'border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100',
}

const SIZE_CLASS: Record<UiButtonSize, string> = {
  sm: 'gap-1.5 px-2.5 py-1.5 text-xs',
  md: 'gap-2 px-4 py-2 text-sm',
}

export function Button({
  className,
  children,
  icon,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
