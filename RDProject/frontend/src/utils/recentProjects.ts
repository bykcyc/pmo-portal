// UX-04: sidebar показывает компактный набор проектов (избранные + недавние),
// а не весь список проектов. Хранение — localStorage, ключ на пользователя
// (зеркало SavedViews), чтобы у разных РП свои избранные/недавние.

const RECENT_MAX = 6

function recentKey(uid: string): string {
  return `pm-recent:${uid}`
}
function favKey(uid: string): string {
  return `pm-fav:${uid}`
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function getRecentProjectIds(uid: string): string[] {
  return readList(recentKey(uid))
}

/** Записать посещённый проект первым; список без дублей, обрезан до RECENT_MAX. */
export function pushRecentProject(uid: string, id: string) {
  if (!uid || !id) return
  const next = [id, ...readList(recentKey(uid)).filter((x) => x !== id)].slice(0, RECENT_MAX)
  writeList(recentKey(uid), next)
}

export function getFavoriteProjectIds(uid: string): string[] {
  return readList(favKey(uid))
}

export function isFavoriteProject(uid: string, id: string): boolean {
  return readList(favKey(uid)).includes(id)
}

/** Переключить избранное; возвращает новый список id избранных. */
export function toggleFavoriteProject(uid: string, id: string): string[] {
  const cur = readList(favKey(uid))
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]
  writeList(favKey(uid), next)
  return next
}
