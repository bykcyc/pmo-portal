import { useEffect } from 'react'
import { useExportStore, type SectionExport } from '@/store/exportStore'

/** Регистрирует экспорт секции в шапке проекта (меню «Ещё» → «Экспорт в Excel»).
 * ВАЖНО: rows мемоизировать (useMemo) — иначе эффект будет дёргаться каждый рендер. */
export function useSectionExport(filename: string, rows: SectionExport['rows']) {
  const setExport = useExportStore((s) => s.setExport)
  useEffect(() => {
    setExport(rows.length > 0 ? { filename, rows } : null)
    return () => setExport(null)
  }, [filename, rows, setExport])
}
