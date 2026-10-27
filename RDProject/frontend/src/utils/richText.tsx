import type { ReactNode } from 'react'

/**
 * Лёгкая разметка для длинных текстов портала (описание задачи и далее).
 *
 * Своя, маленькая и намеренно бедная: жирный, курсив, моноширинный, списки, заголовки и
 * переносы строк. Ни ссылок, ни картинок, ни таблиц — этого в описании задачи не просили, а
 * каждая из них стоит отдельного разговора о безопасности.
 *
 * ПОЧЕМУ НЕ HTML И НЕ БИБЛИОТЕКА. Описание задачи пишут не только люди из портала: его кладёт
 * внешний помощник и приносит синхронизация с Bitrix. Это недоверенный ввод. Любой путь через
 * `dangerouslySetInnerHTML` означал бы санитайзер и постоянную заботу о нём; здесь текст
 * превращается в React-элементы, и вставить разметку в страницу физически нечем.
 *
 * ХРАНИТСЯ ПО-ПРЕЖНЕМУ ТЕКСТОМ. Никакого признака формата у поля нет и не нужно: текст без
 * маркеров — частный случай размеченного, он отрисуется как был. Поэтому в базе ничего не
 * меняется, байтовый контракт API не двигается, а старые описания читаются как раньше.
 *
 * ОДИН РАЗБОР НА ВСЕХ. Показ, снятие маркеров и признак «размечено» раньше жили тремя разными
 * наборами регулярок и расходились: на экране «5 * 4» оставалось умножением, а в выгрузке и в
 * Bitrix превращалось в «5  4» — знак молча пропадал. Теперь строку разбирает одна функция
 * (`parseInline`), а показ и снятие — два способа прочитать её результат.
 */

/** Разобранный кусок строки. Вложенность настоящая: жирный может содержать курсив. */
type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'b'; kids: Inline[] }
  | { t: 'i'; kids: Inline[] }

/** Насколько глубоко разрешено вкладывать разметку. Настоящая вложенность — два уровня
 *  (курсив внутри жирного); всё сверх этого встречается только в подобранном вводе, а рекурсия
 *  по нему роняла бэкенд: описание в 2 КБ из одних звёздочек давало RecursionError и 500. */
const MAX_DEPTH = 8

/** Сколько серий-кандидатов смотрим в поисках закрывающей. Живой текст укладывается в
 *  единицы; предел нужен против подобранного ввода, где закрывающие есть, но ни одна не
 *  подходит, и поиск каждый раз доходил до конца строки — это и есть квадрат. */
const MAX_CANDIDATES = 64

/** Серия звёздочек: где начинается и сколько их подряд. */
type Run = { at: number; len: number }

/** Все серии звёздочек в строке — считаем ОДИН раз, а не на каждую открывающую. */
function scanRuns(s: string): Run[] {
  const runs: Run[] = []
  let i = 0
  while (i < s.length) {
    if (s[i] !== '*') { i += 1; continue }
    let len = 0
    while (s[i + len] === '*') len += 1
    runs.push({ at: i, len })
    i += len
  }
  return runs
}

/** Индекс первой серии, начинающейся правее `pos` (двоичный поиск: серий бывают тысячи). */
function firstRunAfter(runs: Run[], pos: number): number {
  let lo = 0
  let hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid].at <= pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Найти закрывающую серию для эмфазы длиной `want` в пределах [from, to).
 *
 * Две тонкости, из-за которых наивный `indexOf` и ломался:
 *  • перед закрывающей серией не должно быть пробела — иначе `*текст *` считалось бы курсивом,
 *    а на деле это звёздочка сама по себе;
 *  • серию РОВНО нужной длины предпочитаем более длинной, а из длинной берём ХВОСТ. Из-за
 *    этого `**жирный с *курсивом***` и разбирается правильно: закрывающие две звёздочки —
 *    последние две из трёх, а первая достаётся курсиву внутри.
 */
function findCloser(closers: Run[], from: number, to: number, want: number): number {
  let longer = -1
  let seen = 0
  for (let k = firstRunAfter(closers, from - 1); k < closers.length; k += 1) {
    const run = closers[k]
    if (run.at >= to) break
    if (seen++ >= MAX_CANDIDATES) break
    if (run.at <= from) continue                    // пустое содержимое разметкой не считается
    // Серии посчитаны по ВСЕЙ строке, а разбираем мы её кусок: серия на границе доступна не
    // целиком. Без обрезки закрывающая вылезала за край — «**жирный с *курсивом***» уносил
    // у внешнего жирного его же звёздочки.
    const len = Math.min(run.len, to - run.at)
    if (len === want) return run.at
    if (len > want && longer < 0) longer = run.at + len - want
  }
  return longer
}

/** Пробельный символ. Список явный, а не просто `\s`: зеркало на бэкенде проверяет
 *  `str.isspace()`, и наборы расходятся по краям — `\s` знает U+FEFF (BOM, приезжает при
 *  вставке из файла), а `isspace()` знает U+0085 и U+001C..U+001F. Текст с неразрывным
 *  пробелом из Word приходит постоянно, и на таком расхождении в портале был бы курсив,
 *  а в Bitrix — звёздочки. */
const WS = /[\s\u0085\u001c-\u001f\ufeff]/

/** Есть ли в куске хоть один НЕпробельный символ. Отдельно от `trim()`: тот обрезает не тот
 *  набор, что `strip()` на бэкенде, и пустота внутри обратных кавычек мерялась по-разному. */
const hasInk = (s: string) => Array.from(s).some((ch) => !WS.test(ch))

/** Перед открывающей звёздочкой допустимы начало строки, пробельный символ и открывающая
 *  пунктуация. Иначе `some_var*2` стал бы разметкой, а это имя переменной, а не курсив. */
const OPEN_PUNCT = /[([{«"'“—–-]/

/** Разбор куска строки [from, to) в дерево. Серии переданы готовыми — их считают один раз. */
function parseRange(text: string, from: number, to: number, runs: Run[], closers: Run[],
                    depth: number): Inline[] {
  // Глубже некуда — оставшийся кусок отдаём текстом как есть. Разметка там всё равно
  // выдуманная, а рекурсия по ней роняет разбор.
  if (depth >= MAX_DEPTH) return from < to ? [{ t: 'text', v: text.slice(from, to) }] : []
  const out: Inline[] = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = '' } }

  let i = from
  while (i < to) {
    const ch = text[i]

    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      const inner = close > i + 1 && close < to ? text.slice(i + 1, close) : ''
      if (hasInk(inner)) {
        flush()
        out.push({ t: 'code', v: inner })   // внутри кода разметки нет: он и есть «как написано»
        i = close + 1
        continue
      }
      buf += ch; i += 1; continue
    }

    if (ch === '*') {
      const run = runs[firstRunAfter(runs, i - 1)]
      const len = run && run.at === i ? Math.min(run.len, to - i) : 1
      const want = len >= 2 ? 2 : 1
      // Начало КУСКА считается началом строки: внутри жирного курсив вправе открыться первым
      // же символом («***оба***» — это курсив внутри жирного, а не три звёздочки текстом).
      const atStart = i === from
      const before = atStart ? '' : text[i - 1]
      const after = i + len < to ? text[i + len] : ''
      const canOpen = Boolean(after) && !WS.test(after)
        && (atStart || WS.test(before) || OPEN_PUNCT.test(before))
      if (canOpen) {
        const start = i + want                       // из серии в 3 звёздочки открывают две
        const close = findCloser(closers, start, to, want)
        if (close > start && hasInk(text.slice(start, close))) {
          flush()
          out.push({ t: want === 2 ? 'b' : 'i', kids: parseRange(text, start, close, runs, closers, depth + 1) })
          i = close + want
          continue
        }
      }
      buf += text.slice(i, i + len)                  // не разметка — обычные звёздочки
      i += len
      continue
    }

    buf += ch
    i += 1
  }
  flush()
  return out
}

/** Разбор ОДНОЙ строки в дерево кусков. */
function parseInline(text: string): Inline[] {
  if (!text.includes('*') && !text.includes('`')) return text ? [{ t: 'text', v: text }] : []
  const runs = scanRuns(text)
  // Закрывающей может быть только серия, перед которой не пробел. Если таких нет вовсе —
  // ни одна открывающая не закроется, и перебирать остаток строки незачем.
  const closers = runs.filter((r) => r.at > 0 && !WS.test(text[r.at - 1]))
  return parseRange(text, 0, text.length, runs, closers, 0)
}

/** Дерево кусков → React. */
function toNodes(list: Inline[], keyPrefix: string): ReactNode[] {
  return list.map((node, n) => {
    const key = `${keyPrefix}-${n}`
    if (node.t === 'text') return node.v
    if (node.t === 'code') {
      return (
        <code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800">
          {node.v}
        </code>
      )
    }
    if (node.t === 'b') return <strong key={key} className="font-semibold">{toNodes(node.kids, key)}</strong>
    return <em key={key} className="italic">{toNodes(node.kids, key)}</em>
  })
}

/** Дерево кусков → текст без маркеров. */
function toPlain(list: Inline[]): string {
  return list.map((node) => {
    if (node.t === 'text') return node.v
    if (node.t === 'code') return node.v
    return toPlain(node.kids)
  }).join('')
}

/** Есть ли в куске хоть одна настоящая разметка (а не просто звёздочка в тексте). */
function marked(list: Inline[]): boolean {
  return list.some((node) => node.t !== 'text')
}

const inline = (text: string, keyPrefix: string): ReactNode[] => toNodes(parseInline(text), keyPrefix)

// Маркер строки: сам знак плюс пробелы. Требование «дальше есть текст» проверяем ОБЩИМ
// предикатом, а не `\S`: на бэкенде это `(?=\S)`, и наборы пробельных там расходятся —
// «## <BOM>Итог» один считал заголовком, другой нет.
const BULLET_RE = /^[ \t]*[-*][ \t]+/
// Не больше двух цифр: «2024. Итоги года.» — это предложение, а не пункт списка. На экране
// оно превращалось в список с номером 1, а в таблице и в Bitrix оставалось годом.
const NUMBER_RE = /^[ \t]*(\d{1,2})[.)][ \t]+/
const HEADING_RE = /^[ \t]*#{1,3}[ \t]+/

/** Текст строки после маркера — или null, если это не такая строка. */
function afterMarker(line: string, re: RegExp): string | null {
  const m = re.exec(line)
  if (!m) return null
  const rest = line.slice(m[0].length)
  return hasInk(rest) ? rest : null
}

const isBullet = (l: string) => afterMarker(l, BULLET_RE) !== null
const isNumber = (l: string) => afterMarker(l, NUMBER_RE) !== null
const isHeading = (l: string) => afterMarker(l, HEADING_RE) !== null
const stripBullet = (l: string) => afterMarker(l, BULLET_RE) ?? l
const stripNumber = (l: string) => afterMarker(l, NUMBER_RE) ?? l
const stripHeading = (l: string) => afterMarker(l, HEADING_RE) ?? l
/** Номер пункта, как его написал автор. */
const numberOf = (l: string) => Number(NUMBER_RE.exec(l)?.[1] ?? 1)

/** Текст с лёгкой разметкой → React-элементы. Пустой текст даёт пустой массив. */
export function renderRichText(text: string | null | undefined): ReactNode[] {
  const src = String(text ?? '')
  if (!src.trim()) return []
  const lines = src.split(/\r?\n/)
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }                       // пустые строки — это отступ

    if (isBullet(line) || isNumber(line)) {
      const ordered = isNumber(line)
      // Номер КАЖДОГО пункта берём авторский: сами по себе `<ol>` считают подряд, и список
      // «3. / 7.» на экране становился «3. / 4.», расходясь со снятием маркеров.
      const items: Array<{ text: string; num: number }> = []
      while (i < lines.length && (ordered ? isNumber(lines[i]) : isBullet(lines[i]))) {
        items.push({
          text: ordered ? stripNumber(lines[i]) : stripBullet(lines[i]),
          num: ordered ? numberOf(lines[i]) : 0,
        })
        i++
      }
      const cls = 'my-1 space-y-0.5 pl-5 ' + (ordered ? 'list-decimal' : 'list-disc')
      out.push(ordered
        ? <ol key={`l${key++}`} className={cls}>{items.map((it, n) => <li key={n} value={it.num}>{inline(it.text, `i${n}`)}</li>)}</ol>
        : <ul key={`l${key++}`} className={cls}>{items.map((it, n) => <li key={n}>{inline(it.text, `i${n}`)}</li>)}</ul>)
      continue
    }

    if (isHeading(line)) {
      out.push(
        <p key={`h${key++}`} className="mt-2 font-semibold first:mt-0">
          {inline(stripHeading(line), `h${key}`)}
        </p>)
      i++
      continue
    }

    // Обычный абзац: подряд идущие непустые строки, переносы внутри сохраняем.
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !isBullet(lines[i]) && !isNumber(lines[i])
           && !isHeading(lines[i])) {
      para.push(lines[i])
      i++
    }
    out.push(
      <p key={`p${key++}`} className="my-1 whitespace-pre-wrap first:mt-0">
        {para.map((l, n) => (
          <span key={n}>{n > 0 && <br />}{inline(l, `p${key}-${n}`)}</span>
        ))}
      </p>)
  }
  return out
}

/** Есть ли в тексте хоть один наш маркер. По нему решают, показать текст оформленным или
 *  открыть на правке: в тексте без разметки показывать нечего, там правка и нужна.
 *
 *  Спрашиваем у РАЗБОРА, а не у отдельных регулярок: иначе «5 * 4» считалось бы разметкой и
 *  поле открывалось бы просмотром, где смотреть нечего. */
export function hasMarkup(text: string | null | undefined): boolean {
  const src = String(text ?? '')
  if (!src.trim()) return false
  return src.split(/\r?\n/).some((line) =>
    isBullet(line) || isNumber(line) || isHeading(line) || marked(parseInline(line)))
}

/**
 * Тот же текст без маркеров — для мест, где разметку показать нечем.
 *
 * Нужен в двух случаях: узкая ячейка таблицы (там строка обрезается по высоте, и `**` читались
 * бы как мусор) и выгрузка в Bitrix, где ждут BB-код, а не звёздочки.
 *
 * Зеркало `_plain_text` на бэкенде — они обязаны давать один результат.
 */
export function stripRichText(text: string | null | undefined): string {
  return String(text ?? '').split(/\r?\n/).map((line) => {
    // ВНИМАНИЕ на класс отступа: `\s` включает перевод строки, и с флагом m «^\s*» съедал
    // пустую строку ПЕРЕД списком или подзаголовком — абзацы слипались.
    if (isHeading(line)) return toPlain(parseInline(stripHeading(line)))
    if (isBullet(line)) return '• ' + toPlain(parseInline(stripBullet(line)))
    return toPlain(parseInline(line))
  }).join('\n')
}
