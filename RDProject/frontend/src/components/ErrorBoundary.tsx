import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '@/i18n'
import { useAuthStore } from '@/store/authStore'

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Catches render-time exceptions so a single bad component can't blank the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  // Восстановление через повторный вход: чистим токен и уходим на /login
  // (для случая, когда причина — протухшая сессия / сбой авторизации).
  handleRelogin = () => {
    useAuthStore.getState().logout()
    window.location.assign('/login')
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--app-bg)] dark:bg-slate-950 px-6 text-center">
          <div className="max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {i18n.t('errors.boundaryTitle', { defaultValue: 'Что-то пошло не так' })}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {i18n.t('errors.boundaryBody', {
                defaultValue: 'Произошла непредвиденная ошибка в интерфейсе. Перезагрузите страницу.',
              })}
            </p>
            <pre className="mt-3 max-h-32 overflow-auto rounded bg-slate-50 dark:bg-slate-800/60 p-2 text-left text-[11px] text-slate-600 dark:text-slate-400">
              {this.state.error.message}
            </pre>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={this.handleReload}
                className="rounded-lg bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary-fg shadow-sm hover:bg-btn-primary-hover"
              >
                {i18n.t('errors.boundaryReload', { defaultValue: 'Перезагрузить' })}
              </button>
              <button
                onClick={this.handleRelogin}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {i18n.t('errors.boundaryRelogin', { defaultValue: 'Войти заново' })}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
