import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

interface Props {
  children: ReactNode
  allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const location = useLocation()
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)

  if (!hasHydrated) {
    // Никогда не отдаём пустой экран во время регидратации сессии (иначе — blank #root).
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] dark:bg-slate-950 text-sm text-slate-600 dark:text-slate-400">
        <span className="animate-pulse">Loading…</span>
      </div>
    )
  }

  if (!token) {
    // Куда человек шёл — передаём на вход, чтобы вернуть его сюда же. Без этого внешний
    // сценарий (согласие на подключение помощника) обрывался бы на списке проектов.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (allowedRoles && (!user || !allowedRoles.includes(user.role))) {
    return <Navigate to="/projects" replace />
  }

  return <>{children}</>
}
