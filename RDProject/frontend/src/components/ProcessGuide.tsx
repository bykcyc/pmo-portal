import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/uiStore'

export interface GuideStep {
  title: string
  desc: string
}

export interface GuideDefinition {
  term: string
  desc: string
}

interface Props {
  steps: GuideStep[]
  definitions?: GuideDefinition[]
}

export default function ProcessGuide({ steps, definitions = [] }: Props) {
  const { t } = useTranslation()
  const focusMode = useUIStore((s) => s.focusMode)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const computePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const panelWidth = panelRef.current?.offsetWidth ?? 560
    const maxLeft = window.innerWidth - panelWidth - margin
    const left = Math.max(margin, Math.min(rect.left, maxLeft))
    setPos({ top: rect.bottom + margin, left })
  }

  // Пересчитываем позицию сразу после отрисовки панели (до paint — без «прыжка»).
  useLayoutEffect(() => {
    if (!open) return
    computePosition()
  }, [open])

  // Пока открыто: закрытие по клику вне/Escape + пересчёт при скролле/resize.
  useEffect(() => {
    if (!open) return
    const reposition = () => computePosition()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  if (focusMode) return null
  if (steps.length === 0) return null

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
          open
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200'
            : 'bg-gray-100 text-gray-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-primary-900 dark:hover:text-primary-300'
        }`}
      >
        <HelpCircle size={11} />
        {t('guide.howTo')}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 min-w-[520px] max-w-[760px]"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              {t('guide.process')}
            </span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <X size={14} />
            </button>
          </div>

          <div className="flex items-start gap-1">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start flex-1 min-w-0">
                <div className="flex flex-col items-center min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-200 flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="mt-1.5 text-center px-1">
                    <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 leading-tight">
                      {step.title}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">
                      {step.desc}
                    </div>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="shrink-0 mt-2">
                    <ChevronRight size={12} className="text-gray-300 dark:text-gray-600" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {definitions.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('guide.importantDetails')}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {definitions.map((definition, index) => (
                  <div key={`${definition.term}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-100">
                      {definition.term}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                      {definition.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
