/** Экспорт массива плоских объектов в .xlsx (скачивание в браузере). */
export async function exportRowsToXlsx(filename: string, rows: Record<string, unknown>[], sheet = 'Data'): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename)
}
