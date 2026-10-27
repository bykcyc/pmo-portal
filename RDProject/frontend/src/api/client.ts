import axios from 'axios'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'
import { queryClient } from '@/lib/queryClient'
import i18n from '@/i18n'

// Любая мутация внутри проекта пишет запись в журнал действий на бэкенде —
// вытаскиваем pid из URL, чтобы обновить панель журнала без ручного F5 (жалоба владельца).
const PROJECT_ID_RE = /\/projects\/([^/]+)/

const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Режим публичного просмотра (страница /public/:token): все запросы идут с ?share=<token>
// БЕЗ Bearer, а 401 не разлогинивает (у зрителя нет сессии). Ставится PublicProjectPage на маунте.
let publicShareToken: string | null = null
export function setPublicShare(token: string | null) { publicShareToken = token }

apiClient.interceptors.request.use((config) => {
  if (publicShareToken) {
    config.params = { ...(config.params || {}), share: publicShareToken }
    return config
  }
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Пути, которым не нужен success-toast (фоновое/шумное/частое).
// finalize/distribute/suggest-slots: у этих операций есть СВОЙ осмысленный тост
// («решений в журнал: 3», «протокол отправлен: 5»). Общий тост интерсептора дублировал его.
// bitrix24/sync: авто-синк при ОТКРЫТИИ проекта (фон) сыпал «Добавлено» (в dev — дважды из-за
// StrictMode), а у кнопки ручного синка есть свой тост «обновлено N» — общий его дублировал.
const SILENT_TOAST = /\/auth\/|\/reorder$|\/tasks\/bulk$|\/clone$|\/snapshot|\/digest|\/webhooks\/|\/test-connection$|\/task-dependencies|\/finalize$|\/distribute$|\/suggest-slots$|\/test-email$|\/bitrix24\/sync|\/drafts\/|\/oauth\//

// Пути со СВОИМ показом ошибки (баннер логина, локализованные тосты 2FA-компонентов) — общий
// error-тост интерсептора их дублировал бы, причём сырым backend-detail (по-русски даже в EN/LV).
// bitrix24/sync: авто-синк при открытии проекта глотает ошибку молча (Bitrix может быть не
// настроен), а у кнопки ручного синка свой локализованный тост «Bitrix недоступен или не настроен».
const SILENT_ERROR_TOAST = /\/auth\/|\/me\/2fa\/|\/bitrix24\/sync/

// Глобальное подавление success-toast на время массовых операций (напр. Excel-импорт создаёт
// десятки сущностей — не сыпать «Добавлено» на каждую). Ставится/снимается вызывающим.
let suppressCreateToasts = false
export function setSuppressCreateToasts(v: boolean) { suppressCreateToasts = v }

apiClient.interceptors.response.use(
  (response) => {
    // Позитивный фидбэк только на create/delete (POST/DELETE). PUT/PATCH (инлайн-правки,
    // драг Ганта) видны на экране сразу — toast там был бы шумом.
    const method = (response.config?.method ?? '').toUpperCase()
    const url = response.config?.url ?? ''
    // Мутация проекта → обновить журнал действий (ключ ['action_log', pid] с подчёркиванием).
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && response.status < 300) {
      const m = PROJECT_ID_RE.exec(url)
      if (m) queryClient.invalidateQueries({ queryKey: ['action_log', m[1]] })
    }
    // Точечный опт-аут: запросы с заголовком X-No-Toast не показывают success-toast
    // (например, удаление с собственным undo-тостом). Axios может хранить заголовки
    // как plain object или AxiosHeaders — проверяем оба варианта.
    const headers = response.config?.headers
    const noToast = Boolean(headers && (headers['X-No-Toast'] ?? headers.get?.('X-No-Toast')))
    if (!noToast && !suppressCreateToasts && (method === 'POST' || method === 'DELETE') && response.status < 300 && !SILENT_TOAST.test(url)) {
      const msg = method === 'DELETE'
        ? i18n.t('common.deleted', { defaultValue: 'Удалено' })
        : i18n.t('common.created', { defaultValue: 'Добавлено' })
      useToastStore.getState().show(msg, 'success')
    }
    return response
  },
  (error) => {
    const status = error.response?.status as number | undefined
    if (status === 401) {
      // В публичном режиме сессии нет — не разлогиниваем (иначе редирект на /login).
      if (!publicShareToken) useAuthStore.getState().logout()
      return Promise.reject(error)
    }
    // Surface errors from user actions (mutations) as a toast. Background GETs
    // are handled by react-query / per-view error states, so we don't toast them
    // (avoids noise from polling: attention, search, etc.).
    const method = (error.config?.method ?? '').toUpperCase()
    const errUrl = error.config?.url ?? ''
    if (!axios.isCancel(error) && method && method !== 'GET' && !SILENT_ERROR_TOAST.test(errUrl)) {
      const detail = error.response?.data?.detail
      const msg =
        (typeof detail === 'string' && detail) ||
        (status === 403
          ? i18n.t('errors.forbidden', { defaultValue: 'Недостаточно прав для этого действия' })
          : status
            ? i18n.t('errors.generic', { defaultValue: 'Не удалось выполнить запрос' })
            : i18n.t('errors.network', { defaultValue: 'Нет связи с сервером' }))
      useToastStore.getState().show(msg, 'error')
    }
    return Promise.reject(error)
  }
)

export default apiClient
