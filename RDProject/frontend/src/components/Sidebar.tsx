import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ICON_SM } from '@/constants/ui'
import { NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  FolderOpen, LayoutDashboard, Settings, LogOut, Bell, ListChecks,
  ChevronLeft, ChevronRight, CheckCheck, UserCircle, CalendarDays, Sun, Moon,
  X, BookOpen, Megaphone,
  FileCheck, ClipboardList,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { getDrafts } from '@/api/drafts'
import { getRegistry } from '@/api/registry'
import { hasUnreadNews } from '@/content/news'
import { getAttention, type AttentionGroupKey, type AttentionItem } from '@/api/attention'
import AccessDecisionDialog from './access/AccessDecisionDialog'
import { logoutSession } from '@/api/auth'
import ProjectNavSection from './ProjectNavSection'
import GlobalSearch from './GlobalSearch'
import ReportProblemWidget from './ReportProblemWidget'
import { canSeePortfolio, isPortfolioManager } from '@/lib/roles'

const NOTIF_SEEN_KEY = 'pm-notif-seen'
// Запросы доступа — первыми: это единственная группа, где от руководителя ждут ОТВЕТА,
// а не осведомлённости, и человек на той стороне ждёт его прямо сейчас.
const NOTIF_GROUPS: AttentionGroupKey[] = ['access', 'access_decided', 'problem_resolved',
  'overdue', 'due_soon', 'stalled', 'actions', 'meetings']

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIF_SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

const LANGUAGES = ['EN', 'RU', 'LV'] as const
type Lang = (typeof LANGUAGES)[number]

interface NavItemProps {
  to: string
  icon: ReactNode
  label: string
  collapsed: boolean
  end?: boolean
  /** Текст-пояснение к точке «здесь новое». Пустое значение — точки нет.
   *  Строкой, а не флагом: точка обязана иметь подпись для чтения с экрана. */
  dot?: string
}

function NavItem({ to, icon, label, collapsed, end, dot }: NavItemProps) {
  const navigate = useNavigate()
  return (
    <NavLink
      to={to}
      end={end}
      // Уход из меню — самый частый способ потерять несохранённое: NavLink переходит сам,
      // и страница о нём не знает. Перехватываем: есть грязь — гасим переход и спрашиваем,
      // а дальше уводит уже сам диалог.
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          collapsed ? 'justify-center' : ''
        } ${
          isActive
            ? 'bg-white text-slate-950 shadow-[0_10px_30px_-18px_rgba(255,255,255,0.7)]'
            : 'text-slate-200 hover:bg-white/12 hover:text-white'
        }`
      }
    >
      <span className="relative flex shrink-0 items-center">
        {icon}
        {/* Свёрнутое меню: точка садится на угол иконки — подписи рядом нет. */}
        {dot && collapsed && (
          <span aria-hidden className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-sky-400" />
        )}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {dot && !collapsed && (
        <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-sky-400" />
      )}
      {dot && <span className="sr-only">{dot}</span>}
    </NavLink>
  )
}

/** «Новости»: точка горит, пока человек не открыл страницу. Отметка прочитанного лежит
 *  в localStorage (см. content/news) — сервер об этом не знает и знать не должен. */
function NewsNavItem({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const location = useLocation()
  // Пересчёт на смену адреса: ушёл со страницы новостей — точка погасла без перезагрузки.
  const unread = useMemo(() => hasUnreadNews(), [location.pathname])
  return (
    <NavItem
      to="/news"
      icon={<Megaphone size={18} />}
      label={t('nav.news', { defaultValue: 'Новости' })}
      collapsed={collapsed}
      dot={unread ? t('news.unread', { defaultValue: 'есть непрочитанное' }) : undefined}
    />
  )
}

/**
 * Пункт «Черновики» со счётчиком незакрытых предложений помощника.
 *
 * Пункт показывается ВСЕГДА, даже когда черновиков нет: иначе человек, которому помощник сказал
 * «откройте портал», не найдёт, куда идти. Счётчик появляется только при непустом списке.
 */
/** Реестр переходного периода. Пункт живёт, только пока реестр не пуст, и только у РПП. */
function RegistryNavItem({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const owner = isPortfolioManager(user)
  const { data } = useQuery({
    queryKey: ['registry'],
    queryFn: getRegistry,
    staleTime: 60_000,
    enabled: owner,   // РП сервер отдаст 403 — не спрашиваем вовсе
  })
  const n = data?.length || 0
  if (!owner || n === 0) return null
  const label = t('nav.registry', { defaultValue: 'Реестр проектов' })
  return (
    <NavItem
      to="/portfolio/registry"
      icon={<ClipboardList size={18} />}
      label={label}
      collapsed={collapsed}
      end
    />
  )
}

function DraftsNavItem({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  // Черновик создаёт ВНЕШНИЙ помощник — событие приходит на сервер мимо браузера, и открытая
  // вкладка узнать о нём ничем не может. Сайдбар при этом не размонтируется никогда (он вне
  // Outlet), поэтому запрос уходил РОВНО ОДИН РАЗ за сеанс: бейдж загорался только по F5 или
  // при заходе на саму страницу черновиков. Отсюда опрос — тем же приёмом, что у «Сообщить
  // о проблеме» и журнала синхронизации. В фоне react-query опрос не ведёт, то есть свёрнутая
  // вкладка сервер не дёргает; refetchOnWindowFocus здесь перебивает общее «выключено»
  // (оно стоит против шторма в портфеле, а тут один короткий запрос).
  const { data } = useQuery({
    queryKey: ['drafts'],
    queryFn: getDrafts,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const n = data?.length || 0
  const label = t('nav.drafts', { defaultValue: 'Черновики' })
  return (
    <NavLink
      to="/drafts"
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
        } ${collapsed ? 'justify-center' : ''}`
      }
    >
      <span className="relative shrink-0">
        <FileCheck size={18} />
        {n > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-900">
            {n > 99 ? '99+' : n}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
    </NavLink>
  )
}

function LanguageSwitcher({ collapsed }: { collapsed: boolean }) {
  const { i18n } = useTranslation()
  const currentLang = (i18n.language?.slice(0, 2).toUpperCase() ?? 'EN') as Lang

  const switchTo = (lang: Lang) => {
    i18n.changeLanguage(lang.toLowerCase())
  }

  if (collapsed) {
    return (
      <div className="flex justify-center px-3 py-2">
        <button
          onClick={() => {
            const idx = LANGUAGES.indexOf(currentLang)
            switchTo(LANGUAGES[(idx + 1) % LANGUAGES.length])
          }}
          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold tracking-[0.2em] text-slate-100 transition-colors hover:bg-white/10 hover:text-white"
          title={currentLang}
        >
          {currentLang}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          onClick={() => switchTo(lang)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] transition-colors ${
            currentLang === lang
              ? 'bg-white text-slate-950'
              : 'text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {lang}
        </button>
      ))}
    </div>
  )
}

function AttentionNavItem({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Та же болезнь, что у черновиков, и цена ошибки тут выше: запрос доступа ждёт ответа
  // человека, а колокольчик застывал на весь сеанс.
  const { data } = useQuery({
    queryKey: ['attention'],
    queryFn: () => getAttention(7),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen())
  const [deciding, setDeciding] = useState<AttentionItem | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const label = t('notifications.title', { defaultValue: 'Уведомления' })

  const groups = useMemo(
    () =>
      NOTIF_GROUPS.map((key) => ({ key, items: data?.data[key] ?? [] })).filter(
        (g) => g.items.length > 0,
      ),
    [data],
  )
  const allIds = useMemo(
    () => groups.flatMap((g) => g.items.map((it) => `${it.section}:${it.id}`)),
    [groups],
  )
  const unread = useMemo(() => allIds.filter((id) => !seen.has(id)).length, [allIds, seen])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node
      if (btnRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v
      // Портал в body + fixed-позиционирование: выпадашка выходит за пределы сайдбара
      // (у него overflow-y-auto клипал её по ширине) и рисуется поверх контента.
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        setPos({ top: r.bottom + 8, left: r.left })
      }
      return next
    })
  }

  const markAllRead = () => {
    const next = new Set(seen)
    allIds.forEach((id) => next.add(id))
    setSeen(next)
    saveSeen(next)
  }

  const openItem = (it: AttentionItem) => {
    // Открытое уведомление — прочитанное. Раньше бейдж гас только по «прочитать всё»,
    // и разобранные пункты продолжали числиться новыми.
    const next = new Set(seen)
    next.add(`${it.section}:${it.id}`)
    setSeen(next)
    saveSeen(next)
    setOpen(false)
    // Запрос доступа решают на месте: раздела «запросы» в проекте нет, а переход по такому
    // уведомлению увёл бы руководителя в никуда.
    if (it.kind === 'access_request') {
      setDeciding(it)
      return
    }
    // Ответ на свой запрос: подтвердили — ведём в проект, отказали — вести некуда, уведомление
    // просто гаснет прочитанным.
    if (it.kind === 'access_decision') {
      if (it.status === 'approved' && it.project_id) navigate(`/projects/${it.project_id}`)
      return
    }
    // «Проблема решена» — возвращаем человека на ту страницу, о которой он писал.
    if (it.kind === 'problem_resolved') {
      if (it.page_url) {
        try {
          navigate(new URL(it.page_url).pathname)
        } catch {
          /* ссылка из старого репорта может быть не разбираема — тогда просто гасим */
        }
      }
      return
    }
    const go = () => navigate(`/projects/${it.project_id}/${it.section}`)
    go()
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        title={collapsed ? label : undefined}
        className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-white/10 hover:text-white ${collapsed ? 'justify-center' : ''}`}
      >
        <span className="relative shrink-0">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[80] flex max-h-[70vh] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-3 py-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
            {allIds.length > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700"
              >
                <CheckCheck size={ICON_SM} />
                {t('notifications.markAllRead', { defaultValue: 'Прочитать всё' })}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-600 dark:text-slate-400">
                {t('notifications.empty', { defaultValue: 'Нет уведомлений' })}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.key}>
                  <p className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    {t(`attention.${g.key}`, { defaultValue: g.key })} · {g.items.length}
                  </p>
                  {g.items.map((it) => {
                    const id = `${it.section}:${it.id}`
                    const isUnread = !seen.has(id)
                    return (
                      <button
                        key={id}
                        onClick={() => openItem(it)}
                        className="flex w-full items-start gap-2 border-b border-slate-50 dark:border-slate-800 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isUnread ? 'bg-blue-500' : 'bg-transparent'}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-800 dark:text-slate-200">{it.title ?? '—'}</span>
                          <span className="block truncate text-[11px] text-slate-600 dark:text-slate-400">{it.project_code}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}

      {deciding && <AccessDecisionDialog item={deciding} onClose={() => setDeciding(null)} />}
    </>
  )
}

export default function Sidebar() {
  const { t } = useTranslation()
  const { user, logout } = useAuthStore()
  const collapsedPref = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen)
  const isDesktop = useIsDesktop()
  // На мобильном off-canvas drawer всегда развёрнут — collapse это десктоп-фича.
  const collapsed = isDesktop ? collapsedPref : false
  const navigate = useNavigate()
  const location = useLocation()

  // UX-01: закрываем мобильный drawer при переходе на другой маршрут.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])

  const projectSectionMatch = useMatch('/projects/:id/:section')
  const projectIdMatch = useMatch('/projects/:id')
  const currentProjectId =
    projectSectionMatch?.params.id ?? projectIdMatch?.params.id

  return (
    <>
      {/* UX-01: затемнение под мобильным drawer (только < lg). */}
      {mobileNavOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        // Inline transform (не Tailwind translate-utility): значение реально меняется между
        // '-100%' и '0', иначе Chromium не перерисовывает transform при смене только --tw-translate-x.
        style={{ transform: mobileNavOpen || isDesktop ? 'translateX(0)' : 'translateX(-100%)' }}
        className={`flex h-screen shrink-0 flex-col overflow-y-auto scrollbar-hide border-r border-slate-800 bg-slate-900 text-white transition-transform duration-300 lg:transition-all
          fixed inset-y-0 left-0 z-50 w-60
          lg:sticky lg:top-0 lg:z-auto ${collapsed ? 'lg:w-14' : 'lg:w-60'}`}
      >
      {/* Header */}
      <div
        className={`flex h-14 items-center border-b border-white/10 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        {!collapsed && (
          <span className="truncate text-base font-bold tracking-[0.08em] text-white">
            {t('appName')}
          </span>
        )}
        <button
          onClick={() => (isDesktop ? toggleSidebar() : setMobileNavOpen(false))}
          title={
            !isDesktop
              ? t('sidebar.close', { defaultValue: 'Закрыть меню' })
              : collapsed
                ? t('sidebar.expand')
                : t('sidebar.collapse')
          }
          aria-label={
            !isDesktop
              ? t('sidebar.close', { defaultValue: 'Закрыть меню' })
              : collapsed
                ? t('sidebar.expand')
                : t('sidebar.collapse')
          }
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {!isDesktop ? <X size={18} /> : collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Global search */}
      {!collapsed && <GlobalSearch />}

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {/* Уведомления — всегда первым пунктом */}
        <AttentionNavItem collapsed={collapsed} />
        {/* Новости — высоко и намеренно: смысл пункта в том, чтобы в него заходили. */}
        <NewsNavItem collapsed={collapsed} />
        {/* Портфель — только Руководителю портфеля (сервер отдаёт РП 403). */}
        {canSeePortfolio(user) && (
          <NavItem
            to="/portfolio"
            icon={<LayoutDashboard size={18} />}
            label={t('nav.portfolio')}
            collapsed={collapsed}
            end
          />
        )}
        {/* Реестр переходного периода — пункт есть, только пока в нём что-то есть. Когда все
            проекты заведены в портале, владелец чистит реестр, и пункт исчезает сам: отдельный
            выключатель для временного инструмента — лишняя настройка навсегда. */}
        <RegistryNavItem collapsed={collapsed} />
        <NavItem
          to="/projects"
          icon={<FolderOpen size={18} />}
          label={t('nav.projects')}
          collapsed={collapsed}
        />
        {/* Список проектов — под пунктом «Проекты», без под-навигации по секциям */}
        {!collapsed && <ProjectNavSection currentProjectId={currentProjectId} />}
        <NavItem
          to="/my-work"
          icon={<ListChecks size={18} />}
          label={t('nav.myWork', { defaultValue: 'My tasks' })}
          collapsed={collapsed}
        />
        <NavItem
          to="/calendar"
          icon={<CalendarDays size={18} />}
          label={t('nav.calendar', { defaultValue: 'Календарь' })}
          collapsed={collapsed}
        />
        <DraftsNavItem collapsed={collapsed} />
        {/* Справка — для всех ролей: новичку она нужнее всего, а прав на неё не требуется. */}
        <NavItem
          to="/wiki"
          icon={<BookOpen size={18} />}
          label={t('nav.wiki', { defaultValue: 'Справка' })}
          collapsed={collapsed}
        />
        {/* «Как работать» намеренно НЕ в меню: страница ещё не доделана, показывать её всем рано.
            Маршрут /how-to жив — открывается по прямой ссылке, пока раздел не доведён. */}
        {isPortfolioManager(user) && (
          <NavItem
            to="/settings"
            icon={<Settings size={18} />}
            label={t('nav.settings')}
            collapsed={collapsed}
            end
          />
        )}
        <NavItem
          to="/profile"
          icon={<UserCircle size={18} />}
          label={t('nav.profile', { defaultValue: 'Профиль' })}
          collapsed={collapsed}
          end
        />
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 bg-black/10 backdrop-blur-sm">
        {/* «Сообщить о проблеме» — доступно всем ролям на любой странице (F6). */}
        <div className={`px-2 pt-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <ReportProblemWidget collapsed={collapsed} />
        </div>
        <LanguageSwitcher collapsed={collapsed} />

        <div className={`px-2 pb-1 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? t('theme.light', { defaultValue: 'Светлая тема' }) : t('theme.dark', { defaultValue: 'Тёмная тема' })}
            className={`flex items-center gap-3 rounded-xl text-sm text-slate-200 transition-colors hover:bg-white/10 hover:text-white ${
              collapsed ? 'p-2' : 'w-full px-3 py-2'
            }`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {!collapsed && (
              <span>{theme === 'dark' ? t('theme.light', { defaultValue: 'Светлая тема' }) : t('theme.dark', { defaultValue: 'Тёмная тема' })}</span>
            )}
          </button>
        </div>

        <div className={`px-2 py-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={() => {
              const go = () => { void logoutSession().finally(() => { logout(); navigate('/login') }) }
              go()
            }}
            title={collapsed ? t('auth.signOut') : undefined}
            className={`flex items-center gap-3 rounded-xl text-sm text-slate-200 transition-colors hover:bg-white/10 hover:text-white ${
              collapsed ? 'p-2' : 'w-full px-3 py-2'
            }`}
          >
            <LogOut size={18} />
            {!collapsed && <span>{t('auth.signOut')}</span>}
          </button>
        </div>
      </div>
      </aside>
    </>
  )
}
