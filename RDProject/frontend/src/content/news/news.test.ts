import { describe, it, expect } from 'vitest'
import { getNews, latestNewsDate, hasUnreadNews, FALLBACK_LANG } from './index'
import { NEWS as RU } from './ru'
import { NEWS as LV } from './lv'
import { NEWS as EN } from './en'

const LANGS = ['ru', 'lv', 'en'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

describe.each(LANGS)('новости [%s]', (lang: string) => {
  const items = getNews(lang)

  it('список непустой — иначе раздел в меню ведёт в никуда', () => {
    expect(items.length).toBeGreaterThan(0)
  })

  it('ключи уникальны: по ним считается «прочитано»', () => {
    const ids = items.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('у каждой новости есть дата в формате YYYY-MM-DD, заголовок, строка списка и блоки', () => {
    for (const n of items) {
      expect(n.date, n.id).toMatch(ISO_DATE)
      expect(n.title.length, n.id).toBeGreaterThan(0)
      expect(n.summary.length, n.id).toBeGreaterThan(0)
      expect(n.blocks.length, n.id).toBeGreaterThan(0)
    }
  })

  it('новее — выше: порядок задан вручную и не должен разъезжаться', () => {
    const dates = items.map(n => n.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })
})

describe('паритет языков', () => {
  // Смысл правила: новость пишется сразу на трёх языках. Забытый перевод не должен
  // тихо выпадать из списка — фолбэк подставит русский, но состав обязан совпадать.
  it('во всех языках один и тот же состав новостей в том же порядке', () => {
    const ids = (set: typeof RU) => set.map(n => n.id)
    expect(ids(LV), 'латышский набор разошёлся с русским').toEqual(ids(RU))
    expect(ids(EN), 'английский набор разошёлся с русским').toEqual(ids(RU))
  })

  it('даты одинаковые во всех языках — по ним считается отметка непрочитанного', () => {
    const byId = (set: typeof RU) => Object.fromEntries(set.map(n => [n.id, n.date]))
    expect(byId(LV)).toEqual(byId(RU))
    expect(byId(EN)).toEqual(byId(RU))
  })

  it('перевод отличается от источника — иначе это забытая копипаста', () => {
    for (const ru of RU) {
      const lv = LV.find(n => n.id === ru.id)
      const en = EN.find(n => n.id === ru.id)
      expect(lv?.title, `латышский заголовок не переведён: ${ru.id}`).not.toBe(ru.title)
      expect(en?.title, `английский заголовок не переведён: ${ru.id}`).not.toBe(ru.title)
    }
  })

  it('неизвестный язык откатывается на русский, а не на пустоту', () => {
    expect(getNews('de').map(n => n.id)).toEqual(RU.map(n => n.id))
    expect(getNews(undefined).map(n => n.id)).toEqual(RU.map(n => n.id))
    expect(FALLBACK_LANG).toBe('ru')
  })
})

describe('отметка непрочитанного', () => {
  it('самая свежая дата — это максимум по списку', () => {
    expect(latestNewsDate()).toBe(RU.map(n => n.date).sort().reverse()[0])
  })

  it('не открывал ни разу — точка горит', () => {
    expect(hasUnreadNews('')).toBe(true)
  })

  it('прочитал самую свежую — точка гаснет', () => {
    expect(hasUnreadNews(latestNewsDate())).toBe(false)
  })

  it('прочитал старое, вышла новая — точка загорается снова', () => {
    expect(hasUnreadNews('2000-01-01')).toBe(true)
  })
})
