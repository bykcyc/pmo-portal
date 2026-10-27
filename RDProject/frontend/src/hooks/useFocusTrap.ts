import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

/**
 * Shared modal focus-trap: on open, moves focus into the dialog (a chosen initial element,
 * the first focusable element, or the dialog itself) and traps Tab/Shift+Tab within it.
 * On close, restores focus to whatever was focused before the dialog opened.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean, initialFocusRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusInitial = () => {
      const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container
      target.focus()
    }
    // Defer to next tick so the dialog's own contents (e.g. conditionally rendered) are mounted.
    const id = window.setTimeout(focusInitial, 0)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    container.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(id)
      container.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, ref, initialFocusRef])
}
