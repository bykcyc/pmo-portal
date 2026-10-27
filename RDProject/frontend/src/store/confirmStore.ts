import { create } from 'zustand'

interface ConfirmOptions {
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  /** Своя подпись кнопки отмены (по умолчанию «Отмена»). */
  cancelLabel?: string
  /** Третья кнопка — для случаев, где выборов действительно три. Паспорт: сохранить и уйти /
   *  уйти без сохранения / остаться. Не задан — диалог остаётся прежним, двухкнопочным. */
  altLabel?: string
  altCallback?: () => void | Promise<void>
}

interface ConfirmState {
  open: boolean
  message: string
  confirmLabel: string
  cancelLabel: string
  altLabel: string
  variant: 'danger' | 'primary'
  callback: (() => void | Promise<void>) | null
  altCallback: (() => void | Promise<void>) | null
  show: (message: string, callback: () => void | Promise<void>, options?: ConfirmOptions) => void
  close: () => void
  accept: () => void
  acceptAlt: () => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  message: '',
  confirmLabel: '',  // пусто → ConfirmDialog подставит локализованный лейбл по variant (delete/confirm)
  cancelLabel: '',
  altLabel: '',
  variant: 'danger',
  callback: null,
  altCallback: null,
  show: (message, callback, options) => set({
    open: true,
    message,
    callback,
    confirmLabel: options?.confirmLabel ?? '',
    cancelLabel: options?.cancelLabel ?? '',
    altLabel: options?.altLabel ?? '',
    altCallback: options?.altCallback ?? null,
    variant: options?.variant ?? 'danger',
  }),
  // Сбрасываем ВСЕ поля вызова, а не только open/callback: иначе следующий двухкнопочный
  // confirm унаследует третью кнопку и чужие подписи от предыдущего.
  close: () => set({ open: false, callback: null, altCallback: null, altLabel: '', cancelLabel: '', confirmLabel: '' }),
  accept: () => {
    const { callback, close } = get()
    close()
    callback?.()
  },
  acceptAlt: () => {
    const { altCallback, close } = get()
    close()
    altCallback?.()
  },
}))
