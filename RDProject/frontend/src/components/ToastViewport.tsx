import { X } from 'lucide-react'
import { useToastStore } from '@/store/toastStore'

// Фон ДОЛЖЕН быть непрозрачным: раньше в тёмной теме был `.../40` (40% альфа) — тост стоял
// поверх кнопок (z-100), но сквозь него просвечивала кнопка «Импорт», из-за чего казалось,
// что уведомление «за кнопкой». Сплошной фон убирает просвечивание.
const TOAST_VARIANTS = {
  success: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300',
  error: 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950 text-rose-800 dark:text-rose-300',
  info: 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-300',
} as const

export default function ToastViewport() {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)

  if (items.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg ${TOAST_VARIANTS[item.variant]}`}
        >
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-sm leading-5">{item.message}</p>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  void item.action?.onClick()
                  dismiss(item.id)
                }}
                className="shrink-0 rounded-lg border border-current/30 px-2 py-0.5 text-xs font-medium hover:bg-white/40 dark:hover:bg-white/10"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="rounded-full p-1 text-current/70 transition-colors hover:bg-white/60 hover:text-current"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
