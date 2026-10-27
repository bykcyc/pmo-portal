import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
  action?: ToastAction
}

interface ToastOptions {
  action?: ToastAction
  duration?: number
}

interface ToastState {
  items: ToastItem[]
  show: (message: string, variant?: ToastVariant, opts?: ToastOptions) => void
  dismiss: (id: number) => void
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  show: (message, variant = 'info', opts) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    set((state) => ({ items: [...state.items, { id, message, variant, action: opts?.action }] }))
    // Тосты с action живут дольше, чтобы юзер успел нажать кнопку.
    const duration = opts?.duration ?? (opts?.action ? 6000 : 4000)
    window.setTimeout(() => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
    }, duration)
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}))
