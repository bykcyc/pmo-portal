import type { WikiGroup, WikiPage } from './types'
import { WIKI_PAGES as RU } from './ru'
import { WIKI_PAGES as LV } from './lv'
import { WIKI_PAGES as EN } from './en'

/** Справка переведена на все три языка портала: это гайд, к которому возвращаются ПОСЛЕ
 *  обучения, поэтому он должен быть на языке человека, а не только на языке докладчика.
 *
 *  Все три набора импортируются статически, а не подгружаются по языку. Так проще (никакой
 *  асинхронности в компоненте и тестах), а платы почти нет: страница /wiki и так грузится
 *  отдельным lazy-чанком — тот, кто справку не открывал, не скачивает ни одного языка. */
const BY_LANG: Record<string, WikiPage[]> = { ru: RU, lv: LV, en: EN }

/** Русский — язык-источник и запасной вариант: если страница на другом языке ещё не написана,
 *  человек увидит русскую вместо «страница не найдена». */
export const FALLBACK_LANG = 'ru'

export function getWikiPages(lang?: string): WikiPage[] {
  const base = BY_LANG[(lang || '').slice(0, 2)] ?? BY_LANG[FALLBACK_LANG]
  const bySlug = new Map(base.map(p => [p.slug, p]))
  // Порядок и состав задаёт русский набор: перевод может отставать, но оглавление
  // должно оставаться полным.
  return BY_LANG[FALLBACK_LANG].map(ru => bySlug.get(ru.slug) ?? ru)
}

export const GROUP_TITLES: Record<string, Record<WikiGroup, string>> = {
  ru: { start: 'Начало работы', project: 'Разделы проекта', portal: 'Портал' },
  lv: { start: 'Darba sākums', project: 'Projekta sadaļas', portal: 'Portāls' },
  en: { start: 'Getting started', project: 'Project sections', portal: 'Portal' },
}

export const getGroupTitles = (lang?: string) =>
  GROUP_TITLES[(lang || '').slice(0, 2)] ?? GROUP_TITLES[FALLBACK_LANG]

export const findWikiPage = (slug: string, lang?: string) =>
  getWikiPages(lang).find(p => p.slug === slug)

/** Поиск по заголовкам, описаниям и тексту блоков — обычный includes по нижнему регистру.
 *  Полноценный поисковый движок для двух десятков страниц был бы избыточен. */
export function searchWikiPages(query: string, lang?: string): WikiPage[] {
  const pages = getWikiPages(lang)
  const q = query.trim().toLowerCase()
  if (!q) return pages
  const haystack = (p: WikiPage) => [
    p.title,
    p.summary,
    ...p.sections.flatMap(s => [
      s.title,
      ...s.blocks.flatMap(b => {
        switch (b.kind) {
          case 'p': case 'note': return [b.text]
          case 'ul': case 'ol': return b.items
          case 'steps': return b.items.flatMap(i => [i.title, i.text])
          case 'table': return [...b.head, ...b.rows.flat()]
          case 'shot': return [b.alt, b.caption ?? '']
        }
      }),
    ]),
  ].join(' ').toLowerCase()
  return pages.filter(p => haystack(p).includes(q))
}
