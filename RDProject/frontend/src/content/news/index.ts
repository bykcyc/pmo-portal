import type { NewsItem } from './types'
import { NEWS as RU } from './ru'
import { NEWS as LV } from './lv'
import { NEWS as EN } from './en'

/** Все три набора импортируются статически — как в справке: страница «Новости»
 *  и так грузится отдельным чанком, а асинхронность в компоненте и тестах дороже
 *  пары килобайт. */
const BY_LANG: Record<string, NewsItem[]> = { ru: RU, lv: LV, en: EN }

/** Русский — язык-источник и запасной вариант: непереведённую новость лучше показать
 *  по-русски, чем спрятать. */
export const FALLBACK_LANG = 'ru'

/** Новости на языке интерфейса. Состав и порядок задаёт русский набор:
 *  перевод может отставать, но список обязан оставаться полным. */
export function getNews(lang?: string): NewsItem[] {
  const base = BY_LANG[(lang || '').slice(0, 2)] ?? BY_LANG[FALLBACK_LANG]
  const byId = new Map(base.map(n => [n.id, n]))
  return BY_LANG[FALLBACK_LANG].map(ru => byId.get(ru.id) ?? ru)
}

/** Дата самой свежей новости. Язык не важен: даты одинаковые во всех наборах. */
export function latestNewsDate(): string {
  return BY_LANG[FALLBACK_LANG].reduce((max, n) => (n.date > max ? n.date : max), '')
}

/* ── Отметка «прочитано» ──────────────────────────────────────────────────────
 * Хранится в localStorage, а не на сервере: это подсказка «загляни», а не данные.
 * Серверное хранение потребовало бы поля в профиле и, значит, правки байтового
 * контракта /me — цена несоразмерна пользе. Минус решения честный: отметка живёт
 * на устройстве, и на втором компьютере точка загорится снова.
 */
// Версия в имени ключа не украшение. Отметка — это ДАТА последней прочитанной новости, и
// 16.09.2026 даты новостей исправили на настоящие (они накопили сдвиг до трёх дней вперёд).
// Старая отметка теперь БОЛЬШЕ самой свежей даты, и у того, кто читал новости накануне,
// значок «новое» не загорелся бы уже никогда. Смена ключа гасит старое значение: точка один
// раз загорится у всех — и дальше всё сходится.
const SEEN_KEY = 'pmo.news.seen.v2'

/** Чтение localStorage обёрнуто: приватное окно и запрет на данные сайта бросают. */
export function getNewsSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) || ''
  } catch {
    return ''
  }
}

export function markNewsSeen(date: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, date)
  } catch {
    /* приватное окно — отметка просто не сохранится, точка останется гореть */
  }
}

/** Есть ли непрочитанное. Пустая отметка = человек не открывал «Новости» ни разу. */
export function hasUnreadNews(seen = getNewsSeen()): boolean {
  const latest = latestNewsDate()
  return Boolean(latest) && seen < latest
}

export type { NewsItem }
