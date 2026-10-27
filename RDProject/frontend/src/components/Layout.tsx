import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import TwoFactorGate from './TwoFactorGate'
import { useUIStore } from '@/store/uiStore'

export default function Layout() {
  const { t } = useTranslation()
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav)

  return (
    <div className="flex min-h-screen">
      {/* Гейт «настройте 2FA» — только для залогиненных (Layout за ProtectedRoute). */}
      <TwoFactorGate />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* UX-01: мобильная верхняя панель с гамбургером (только < lg). */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
          <button
            onClick={toggleMobileNav}
            aria-label={t('sidebar.openMenu', { defaultValue: 'Открыть меню' })}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu size={22} />
          </button>
          <span className="truncate text-base font-bold tracking-[0.06em] text-slate-900 dark:text-slate-100">
            {t('appName')}
          </span>
        </header>
        <main className="min-w-0 flex-1 overflow-auto px-3 py-4 md:px-4 md:py-5 lg:px-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
