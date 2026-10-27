import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import ProtectedRoute from '@/components/ProtectedRoute'
import ConfirmDialog from '@/components/ConfirmDialog'
import ToastViewport from '@/components/ToastViewport'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useUIStore } from '@/store/uiStore'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const PublicProjectPage = lazy(() => import('@/pages/PublicProjectPage'))
const ProjectsListPage = lazy(() => import('@/pages/ProjectsListPage'))
const ProjectCreatePage = lazy(() => import('@/pages/ProjectCreatePage'))
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage'))
const PortfolioDashboard = lazy(() => import('@/pages/PortfolioDashboard'))
const MyWorkPage = lazy(() => import('@/pages/MyWorkPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const HowToPage = lazy(() => import('@/pages/HowToPage'))
// lazy: контент справки — отдельный чанк, он не грузится тем, кто её не открывал.
const WikiPage = lazy(() => import('@/pages/WikiPage'))
// lazy: контент новостей — отдельный чанк, как и справка.
const NewsPage = lazy(() => import('@/pages/NewsPage'))
// lazy: экран согласования нужен не каждому и не каждый день.
const DraftsPage = lazy(() => import('@/pages/DraftsPage'))
const ConsentPage = lazy(() => import('@/pages/ConsentPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
// lazy: реестр переходного периода нужен одному человеку и исчезнет, когда перенос закончится.
const RegistryPage = lazy(() => import('@/pages/RegistryPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] dark:bg-slate-950 text-sm text-slate-600 dark:text-slate-400">
      Loading...
    </div>
  )
}

export default function App() {
  const theme = useUIStore((s) => s.theme)
  const skin = useUIStore((s) => s.skin)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('theme-classic', skin === 'classic')
  }, [theme, skin])

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ConfirmDialog />
      <ToastViewport />
      <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/public/:token" element={<PublicProjectPage />} />
          {/* Согласие на подключение помощника. ВНЕ Layout: сюда приходят снаружи, из ChatGPT
              или Claude, и сайдбар со всем порталом тут только мешал бы решению. Защита
              обычная — не вошёл, отправят на вход и вернут сюда же. */}
          <Route
            path="/connect"
            element={(
              <ProtectedRoute>
                <ConsentPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/"
            element={(
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            )}
          >
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectsListPage />} />
            <Route
              path="projects/new"
              element={(
                <ProtectedRoute allowedRoles={['pm', 'owner']}>
                  <ProjectCreatePage />
                </ProtectedRoute>
              )}
            />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="projects/:id/:section" element={<ProjectDetailPage />} />
            {/* Портфель открыт всем, кто ведёт проекты. Содержимое режет сервер:
                РП видит только свои проекты, те, где он со-РП, и те, где он наблюдатель.
                Список ролей — зеркало canSeePortfolio и серверного require_portfolio_view. */}
            <Route
              path="portfolio"
              element={(
                <ProtectedRoute allowedRoles={['owner', 'exec', 'pm']}>
                  <PortfolioDashboard />
                </ProtectedRoute>
              )}
            />
            <Route path="my-work" element={<MyWorkPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="how-to" element={<HowToPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="wiki" element={<WikiPage />} />
            <Route path="wiki/:slug" element={<WikiPage />} />
            <Route path="drafts" element={<DraftsPage />} />
            <Route path="drafts/:id" element={<DraftsPage />} />
            <Route path="portfolio/registry" element={<RegistryPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route
              path="settings"
              element={(
                <ProtectedRoute allowedRoles={['owner']}>
                  <SettingsPage />
                </ProtectedRoute>
              )}
            />
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
