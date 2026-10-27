import { useEffect, useRef, useState } from 'react'

export function useTableColumnLimit(extraWidth: number) {
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const [maxColumnWidthTotal, setMaxColumnWidthTotal] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = tableContainerRef.current
    if (!node) return

    const update = () => {
      const next = Math.max(0, node.clientWidth - extraWidth)
      setMaxColumnWidthTotal(next)
    }

    update()

    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [extraWidth])

  return { tableContainerRef, maxColumnWidthTotal }
}
