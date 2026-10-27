import { describe, it, expect } from 'vitest'
import { getWikiPages, findWikiPage, searchWikiPages, getGroupTitles } from './index'

// Список реально существующих снимков берём у Vite, а не через fs: типов Node в проекте нет,
// а glob видит ровно те файлы, что попадут в сборку.
const SHOT_FILES = new Set(
  Object.keys(import.meta.glob('/public/wiki-shots/*.png')).map(p => p.replace('/public', '')),
)

const LANGS = ['ru', 'lv', 'en'] as const

describe.each(LANGS)('контент справки [%s]', (lang: string) => {
  const pages = getWikiPages(lang)

  it('адреса страниц уникальны — иначе одна затмит другую', () => {
    const slugs = pages.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('якоря разделов уникальны внутри страницы', () => {
    for (const page of pages) {
      const ids = page.sections.map(s => s.id)
      expect(new Set(ids).size, `дубль якоря на странице ${page.slug}`).toBe(ids.length)
    }
  })

  it('у каждой страницы есть заголовок, описание и хотя бы один раздел', () => {
    for (const page of pages) {
      expect(page.title.length, page.slug).toBeGreaterThan(0)
      expect(page.summary.length, page.slug).toBeGreaterThan(0)
      expect(page.sections.length, page.slug).toBeGreaterThan(0)
    }
  })

  it('каждый скриншот реально лежит в public/wiki-shots', () => {
    // Ссылка на несуществующий файл — это «битая картинка» у пользователя, и без такой
    // проверки заметить её можно только глазами на нужной странице.
    expect(SHOT_FILES.size, 'снимки не найдены вовсе — проверьте путь glob').toBeGreaterThan(0)
    for (const page of pages) {
      for (const s of page.sections) {
        for (const b of s.blocks) {
          if (b.kind !== 'shot') continue
          expect(SHOT_FILES.has(b.src), `нет файла ${b.src} (${lang}/${page.slug})`).toBe(true)
          expect(b.alt.length, `пустой alt у ${b.src}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('заголовки групп переведены', () => {
    const titles = getGroupTitles(lang)
    for (const key of ['start', 'project', 'portal'] as const) {
      expect(titles[key].length, `${lang}: пустой заголовок группы ${key}`).toBeGreaterThan(0)
    }
  })
})

describe('перевод против русского оригинала', () => {
  const ru = getWikiPages('ru')

  it.each(['lv', 'en'])('%s: состав и структура совпадают с русским набором', (lang: string) => {
    const other = getWikiPages(lang)
    // Оглавление обязано быть полным на любом языке: реестр подставляет русскую страницу,
    // если перевода ещё нет, поэтому расхождение здесь = поломка реестра, а не пробел в переводе.
    expect(other.map(p => p.slug)).toEqual(ru.map(p => p.slug))
    for (const [i, page] of other.entries()) {
      const src = ru[i]
      expect(page.group, `${lang}/${page.slug}: сменилась группа`).toBe(src.group)
      // Якоря — часть адресов вида /wiki/<slug>#<id>. Переводить их нельзя: ссылки разъедутся.
      expect(page.sections.map(s => s.id), `${lang}/${page.slug}: якоря разделов`).toEqual(src.sections.map(s => s.id))
      const shots = (p: typeof page) => p.sections.flatMap(s => s.blocks.filter(b => b.kind === 'shot').map(b => (b as { src: string }).src))
      expect(shots(page), `${lang}/${page.slug}: пути к снимкам`).toEqual(shots(src))
    }
  })

  it.each(['lv', 'en'])('%s: заголовки реально переведены, а не скопированы', (lang: string) => {
    const other = getWikiPages(lang)
    const same = other.filter((p, i) => p.title === ru[i].title).map(p => p.slug)
    // Точное совпадение допустимо для терминов вроде «Bitrix24», но не для большинства страниц.
    expect(same.length, `${lang}: не переведены заголовки — ${same.join(', ')}`).toBeLessThan(ru.length / 2)
  })
})

describe('поиск и адресация', () => {
  it('ищет по тексту внутри блоков, а не только по заголовку', () => {
    expect(searchWikiPages('двухфактор', 'ru').map(p => p.slug)).toContain('start')
    expect(searchWikiPages('зависит от', 'ru').map(p => p.slug)).toContain('wbs-gantt')
    expect(searchWikiPages('этого точно нет нигде', 'ru')).toHaveLength(0)
    expect(searchWikiPages('  ', 'ru')).toHaveLength(getWikiPages('ru').length)
  })

  it('находит страницу по адресу на любом языке', () => {
    for (const lang of LANGS) {
      expect(findWikiPage('start', lang)?.title, lang).toBeTruthy()
      expect(findWikiPage('нет-такой', lang), lang).toBeUndefined()
    }
  })

  it('неизвестный язык откатывается на русский, а не падает', () => {
    expect(getWikiPages('de').map(p => p.slug)).toEqual(getWikiPages('ru').map(p => p.slug))
    expect(getWikiPages(undefined).length).toBeGreaterThan(0)
  })
})
