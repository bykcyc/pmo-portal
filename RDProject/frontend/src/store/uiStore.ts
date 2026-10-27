import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'
/** Семейство оформления: 'rd' — тёплый Warm (по умолчанию), 'classic' — исходный вид.
 *  Ортогонально light/dark: обе темы существуют в светлом и тёмном вариантах. */
type Skin = 'rd' | 'classic'

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }
}

/** Warm = ОТСУТСТВИЕ класса (значения :root) — у новых пользователей нет FOUC по построению;
 *  Classic включается классом theme-classic (переопределяет палитровые переменные на сток). */
function applySkin(skin: Skin) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('theme-classic', skin === 'classic')
  }
}

interface UIState {
  sidebarCollapsed: boolean
  /** Показывать ли в календаре события из Bitrix. Личное предпочтение: у кого-то там
   *  весь рабочий день, и проектные задачи в этом тонут. */
  calendarShowBitrix: boolean
  toggleCalendarBitrix: () => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  // UX-01: мобильный off-canvas drawer (транзиентно, не персистим).
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  toggleMobileNav: () => void
  rightPanelCollapsed: boolean
  toggleRightPanel: () => void
  focusMode: boolean
  toggleFocusMode: () => void
  setFocusMode: (on: boolean) => void
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  skin: Skin
  setSkin: (skin: Skin) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      calendarShowBitrix: true,
      toggleCalendarBitrix: () => set((s) => ({ calendarShowBitrix: !s.calendarShowBitrix })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed: boolean) => set({ sidebarCollapsed: collapsed }),
      mobileNavOpen: false,
      setMobileNavOpen: (open: boolean) => set({ mobileNavOpen: open }),
      toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
      rightPanelCollapsed: false,
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      focusMode: false,
      toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
      setFocusMode: (on: boolean) => set({ focusMode: on }),
      theme: 'light',
      toggleTheme: () => set((s) => {
        const theme: Theme = s.theme === 'dark' ? 'light' : 'dark'
        applyTheme(theme)
        return { theme }
      }),
      setTheme: (theme: Theme) => {
        applyTheme(theme)
        set({ theme })
      },
      // Дефолт 'rd' (решение владельца): у старых пользователей в persisted-стейте
      // ключа skin нет → merge оставит 'rd', т.е. все получают тёплую тему.
      skin: 'rd',
      setSkin: (skin: Skin) => {
        applySkin(skin)
        set({ skin })
      },
    }),
    {
      name: 'pm-tool-ui',
      // ВАЖНО: version НЕ бампать — zustand-persist без migrate СБРАСЫВАЕТ весь стейт
      // при несовпадении версии (пользователи потеряли бы тему/сайдбар/фокус).
      // focusMode персистим — раньше refresh сбрасывал режим фокуса (жалоба владельца).
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed,
        focusMode: s.focusMode,
        theme: s.theme,
        skin: s.skin,
        calendarShowBitrix: s.calendarShowBitrix,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<UIState>),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme)
          applySkin(state.skin)
        }
      },
    }
  )
)
