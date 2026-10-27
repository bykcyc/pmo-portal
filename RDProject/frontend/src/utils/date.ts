/** Convert ISO yyyy-mm-dd → dd.mm.yyyy for display. Returns fallback ('—') if empty/null. */
export function formatDate(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

/** Convert dd.mm.yyyy → ISO yyyy-mm-dd. Returns raw value unchanged if not a complete dd.mm.yyyy. */
export function parseDate(dmy: string): string {
  const m = dmy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return dmy
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Convert dd.mm.yyyy → ISO yyyy-mm-dd strictly. Returns null if not a complete dd.mm.yyyy. */
export function parseDateStrict(dmy: string | null | undefined): string | null {
  if (!dmy) return null
  const m = dmy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Format ISO datetime string → dd.mm.yyyy hh:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

/** Format a Date as local YYYY-MM-DD without converting it through UTC. */
export function localIsoDate(date = new Date(), addDays = 0): string {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + addDays)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Add calendar days to an ISO date without timezone-dependent UTC shifts. */
export function addDaysToIsoDate(iso: string, days: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return localIsoDate(d, days)
}

/**
 * Попадает ли ISO-дата в отрезок [from, to] (границы включительно, пустая граница — открыта).
 *
 * Сравниваем СТРОКАМИ: формат YYYY-MM-DD для этого и придуман, а `new Date(iso)` читает дату как
 * UTC и на восточной от Гринвича стороне сдвигает её на день назад — фильтр «по 31 марта» терял
 * бы 31 марта.
 *
 * Элемент БЕЗ даты в заданный отрезок не попадает: спросили «что начинается в марте» — вещь без
 * даты начала на этот вопрос не отвечает. Пока обе границы пусты, фильтр не применяется вовсе и
 * элементы без дат видны.
 */
export function isWithinDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!value) return false
  const v = String(value).slice(0, 10)
  if (from && v < from) return false
  if (to && v > to) return false
  return true
}
