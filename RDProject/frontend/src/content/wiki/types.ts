/* ─────────────────────────────────────────────────────────────────────────────
 * ВНИМАНИЕ, ИСКЛЮЧЕНИЕ ИЗ ПРАВИЛА «никаких строк в коде».
 *
 * Всё под src/content/wiki/** — это САМ КОНТЕНТ справки, а не подписи интерфейса. Справка
 * переведена на все три языка портала (каталог на язык: wiki/ru, wiki/lv, wiki/en), но живёт
 * здесь, а не в локалях, по двум причинам: 23 страницы прозы сделали бы ru.json/lv.json/en.json
 * нередактируемыми, а плоские ключи локалей не выражают структуру блоков — таблицу, шаги,
 * скриншот с подписью. Хром вики (пункт меню, «Наверх», поиск) — по-прежнему через i18n.
 *
 * Русский — язык-источник: состав страниц, адреса (slug), группы и якоря разделов берутся
 * из него, переводится только текст. Тест wiki.test.ts это стережёт.
 *
 * Не «чините» это, перенося тексты в локали.
 * ───────────────────────────────────────────────────────────────────────────── */

/** Блок статьи. Union намеренно узкий: markdown-рендерера в проекте нет, ставить зависимость
 *  нельзя (npm install на хосте запрещён), а dangerouslySetInnerHTML не заводим вовсе —
 *  так у справки просто нет XSS-поверхности. Нужен новый вид блока — добавьте сюда. */
export type WikiBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  /** Врезка: info — просто важно, tip — совет, warn — можно потерять данные или время. */
  | { kind: 'note'; tone: 'info' | 'tip' | 'warn'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'steps'; items: { title: string; text: string }[] }
  /** Скриншот из public/wiki-shots/. Снимается спекой e2e/wiki-shots.spec.ts, руками не кладём. */
  | { kind: 'shot'; src: string; alt: string; caption?: string }

export interface WikiSection {
  /** Якорь в адресе страницы (#id). Менять — значит ломать чужие ссылки. */
  id: string
  title: string
  blocks: WikiBlock[]
}

export interface WikiPage {
  /** Часть адреса: /wiki/<slug>. */
  slug: string
  title: string
  /** Одна строка для карточки в списке и для поиска. */
  summary: string
  group: WikiGroup
  /** Куда ведёт кнопка «Открыть раздел». Для страниц про разделы проекта нужен id проекта. */
  appRoute?: (projectId?: string) => string
  sections: WikiSection[]
}

export type WikiGroup = 'start' | 'project' | 'portal'

export const WIKI_GROUP_ORDER: WikiGroup[] = ['start', 'project', 'portal']
