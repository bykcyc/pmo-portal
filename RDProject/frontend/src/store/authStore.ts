import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { UserResponse } from '@/api/authTypes'
import { queryClient } from '@/lib/queryClient'

const AUTH_STORAGE_KEY = 'auth-storage'

/**
 * Сессия живёт в localStorage, а не в памяти вкладки.
 *
 * sessionStorage у каждой вкладки свой, поэтому ссылка из чата Bitrix, закладка, Ctrl+N и
 * восстановленная после перезапуска вкладка открывались с пустым хранилищем — человека
 * выбрасывало на вход. Хуже всего это било по двухфакторке: каждая «новая» вкладка просила
 * пароль И код, а несколько попыток подряд упирались в ограничитель «Слишком много попыток»,
 * и портал выглядел сломанным.
 *
 * Чем платим: сессия переживает закрытие браузера, и на незаблокированном общем компьютере
 * следующий человек попадёт в чужую. Плата меньше, чем кажется: токен и раньше жил на сервере
 * 8 часов (`TOKEN_TTL`) и закрытием вкладки НЕ отзывался — прежняя схема лишь заставляла этот
 * же браузер о нём забыть. От кражи через XSS не защищало ни то, ни другое: обе области
 * читаются из JS одинаково. Решение записано в pmo-backend/SECURITY.md.
 */

/** Срок действия из полезной нагрузки токена. Подпись здесь не проверяется — это делает
 *  сервер; нам нужно лишь не показывать полсекунды интерфейс просроченной сессии. */
function tokenExpired(token: string | null): boolean {
  if (!token) return true
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' && exp * 1000 <= Date.now()
  } catch {
    return false   // не разобрали — пусть решает сервер, а не мы
  }
}

interface AuthState {
  token: string | null
  user: UserResponse | null
  hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
  setToken: (token: string) => void
  setUser: (user: UserResponse) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
      // При выходе чистим react-query кэш: иначе следующий пользователь видит проекты/данные
      // предыдущего до ручного Refresh (кэш общий, staleTime 30с, refetchOnWindowFocus выкл).
      logout: () => { queryClient.clear(); set({ token: null, user: null }) },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        // Протухшую сессию не поднимаем: иначе человек увидит интерфейс и тут же вылетит
        // на /login по 401 из перехватчика — это читается как поломка, а не как «срок вышел».
        if (state && tokenExpired(state.token)) {
          state.token = null
          state.user = null
        }
        state?.setHasHydrated(true)
      },
    }
  )
)

/**
 * Выход в одной вкладке — выход во всех.
 *
 * Пока сессия жила в памяти вкладки, это было не нужно. Теперь хранилище общее: без этой
 * подписки человек нажал бы «Выход» в одной вкладке, а в соседней продолжил работать до
 * перезагрузки — на общем компьютере это ровно тот случай, ради которого выход и нажимают.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== AUTH_STORAGE_KEY) return
    let token: string | null = null
    try {
      token = e.newValue ? (JSON.parse(e.newValue)?.state?.token ?? null) : null
    } catch { /* чужая запись в тот же ключ — считаем выходом */ }
    if (!token && useAuthStore.getState().token) {
      queryClient.clear()
      useAuthStore.setState({ token: null, user: null })
    }
  })
}
