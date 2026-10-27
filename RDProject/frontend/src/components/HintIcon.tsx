import { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

interface Props {
  text: string
  size?: number
  className?: string
}

export default function HintIcon({ text, size = 12, className = '' }: Props) {
  const focusMode = useUIStore((s) => s.focusMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (focusMode) return null

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={text}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-300 transition-colors leading-none"
      >
        <HelpCircle size={size} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg bg-gray-800 text-white text-[11px] leading-relaxed p-2.5 shadow-xl whitespace-normal">
          {text}
        </div>
      )}
    </div>
  )
}
