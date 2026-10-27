/**
 * Лёгкая разметка описаний. Своя и намеренно бедная, поэтому под тестом должны быть не
 * «фичи markdown», а ровно те случаи, на которых самодельный разбор обычно и ломается:
 * незакрытый маркер, звёздочка внутри слова, вложенность, пустое содержимое.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasMarkup, renderRichText, stripRichText } from './richText'
import markupCases from './markupCases.json'

const html = (src: string) =>
  renderToStaticMarkup(<>{renderRichText(src)}</>)

describe('renderRichText', () => {
  it('жирный, курсив и моноширинный', () => {
    const out = html('**важно** и *тонко* и `код`')
    expect(out).toContain('<strong')
    expect(out).toContain('важно')
    expect(out).toContain('<em')
    expect(out).toContain('<code')
  })

  it('жирный не распадается на два курсива', () => {
    // '**' начинается с '*', и без приоритета «длинный маркер первым» текст
    // «**важно**» разобрался бы как курсив вокруг «*важно*».
    const out = html('**важно**')
    expect(out).toContain('<strong')
    expect(out).not.toContain('<em')
  })

  it('незакрытый маркер остаётся текстом, а не съедает остаток', () => {
    const out = html('сумма **1000 без закрытия')
    expect(out).toContain('**1000 без закрытия')
    expect(out).not.toContain('<strong')
  })

  it('звёздочка внутри слова не превращается в курсив', () => {
    const out = html('файл some_var*2 и ещё')
    expect(out).not.toContain('<em')
  })

  it('маркеры вокруг пустоты — это текст', () => {
    expect(html('** ** и дальше')).not.toContain('<strong')
  })

  it('маркированный список', () => {
    const out = html('- раз\n- два')
    expect(out).toContain('<ul')
    expect((out.match(/<li/g) || []).length).toBe(2)
  })

  it('нумерованный список', () => {
    const out = html('1. раз\n2. два')
    expect(out).toContain('<ol')
    expect((out.match(/<li/g) || []).length).toBe(2)
  })

  it('подзаголовок', () => {
    expect(html('## Что сделать')).toContain('Что сделать')
  })

  it('переносы строк внутри абзаца сохраняются', () => {
    // Это главное, ради чего всё затевалось: в плоском поле перенос терялся вовсе.
    expect(html('первая\nвторая')).toContain('<br')
  })

  it('пустой текст даёт пусто, а не пустой абзац', () => {
    expect(renderRichText('')).toEqual([])
    expect(renderRichText(null)).toEqual([])
    expect(renderRichText('   \n  ')).toEqual([])
  })

  it('текст без маркеров отрисовывается как был — старые описания не ломаются', () => {
    const out = html('Обычное описание задачи без всякой разметки.')
    expect(out).toContain('Обычное описание задачи без всякой разметки.')
    expect(out).not.toContain('<strong')
  })

  it('разметку в страницу не вставляем: угловые скобки остаются текстом', () => {
    // Описание пишут внешний помощник и синхронизация Bitrix — это недоверенный ввод.
    const out = html('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
})

describe('звёздочка в тексте — не разметка', () => {
  // Разбор брал ближайшую пару звёздочек, не спрашивая, годятся ли они в пару. Поэтому
  // «5 * 4» съедалось: первая звёздочка открывала курсив, а закрывала его звёздочка из
  // совсем другого места. В выгрузке и в Bitrix знак умножения при этом ПРОПАДАЛ.
  it('умножение остаётся умножением', () => {
    const out = html('2 * 3 = 6 и *курсив*')
    expect(out).toContain('2 * 3 = 6')
    expect((out.match(/<em/g) || []).length).toBe(1)
    expect(stripRichText('В расчёте 5 * 4 и ещё 6 * 7 итого')).toBe('В расчёте 5 * 4 и ещё 6 * 7 итого')
  })

  it('одинокая звёздочка не съедает текст до следующей', () => {
    expect(stripRichText('2 * 3 = 6 и *курсив*')).toBe('2 * 3 = 6 и курсив')
  })

  it('звёздочка внутри слова остаётся собой', () => {
    expect(html('some_var*2 и файл*.txt')).not.toContain('<em')
    expect(stripRichText('some_var*2 и файл*.txt')).toBe('some_var*2 и файл*.txt')
  })

  it('звёздочка после пробела перед пробелом — просто знак', () => {
    expect(html('шаг 1 * шаг 2 * шаг 3')).not.toContain('<em')
  })

  it('открывающая может стоять после скобки или кавычки', () => {
    expect(html('(*важное*) и «*тоже*»')).toContain('<em')
    expect((html('(*важное*) и «*тоже*»').match(/<em/g) || []).length).toBe(2)
  })
})

describe('вложенная разметка', () => {
  it('курсив внутри жирного', () => {
    const out = html('**жирный с *курсивом* внутри**')
    expect(out).toContain('<strong')
    expect(out).toContain('<em')
    expect(out).not.toContain('*')
  })

  it('курсив в самом конце жирного — три звёздочки подряд', () => {
    // Здесь наивный поиск и ломался: закрывающими он брал ПЕРВЫЕ две из трёх, и одна
    // звёздочка оставалась висеть в тексте.
    const out = html('**жирный с *курсивом***')
    expect(out).toContain('<strong')
    expect(out).toContain('<em')
    expect(out).not.toContain('*')
    expect(stripRichText('**жирный с *курсивом***')).toBe('жирный с курсивом')
  })

  it('жирный внутри курсива', () => {
    const out = html('*курсив с **жирным** внутри*')
    expect(out).toContain('<em')
    expect(out).toContain('<strong')
    expect(out).not.toContain('*')
  })

  it('три звёздочки с обеих сторон — и жирный, и курсив', () => {
    const out = html('***и то и другое***')
    expect(out).toContain('<strong')
    expect(out).toContain('<em')
    expect(stripRichText('***и то и другое***')).toBe('и то и другое')
  })

  it('внутри моноширинного разметки нет', () => {
    // Код — это «как написано»: звёздочки внутри него портить нельзя.
    const out = html('вот `a * b` и `**не жирный**`')
    expect(out).not.toContain('<em')
    expect(out).not.toContain('<strong')
    expect(stripRichText('вот `a * b` и `**не жирный**`')).toBe('вот a * b и **не жирный**')
  })
})

describe('hasMarkup', () => {
  it('звёздочка в тексте разметкой не считается', () => {
    // Иначе поле описания открывалось бы просмотром там, где смотреть нечего.
    expect(hasMarkup('5 * 4 = 20')).toBe(false)
    expect(hasMarkup('обычное описание')).toBe(false)
    expect(hasMarkup('')).toBe(false)
  })

  it('настоящая разметка считается', () => {
    expect(hasMarkup('**важно**')).toBe(true)
    expect(hasMarkup('- пункт')).toBe(true)
    expect(hasMarkup('## Итог')).toBe(true)
    expect(hasMarkup('1. раз')).toBe(true)
    expect(hasMarkup('`код`')).toBe(true)
  })
})

describe('stripRichText', () => {
  it('снимает маркеры, оставляя текст', () => {
    expect(stripRichText('**важно** и *тонко* и `код`')).toBe('важно и тонко и код')
  })

  it('список превращает в точки, а не теряет', () => {
    expect(stripRichText('- раз\n- два')).toBe('• раз\n• два')
  })

  it('подзаголовок остаётся строкой', () => {
    expect(stripRichText('## Что сделать')).toBe('Что сделать')
  })

  it('пустое остаётся пустым', () => {
    expect(stripRichText(null)).toBe('')
  })

  it('пустая строка между абзацами уцелевает', () => {
    // Ловушка была в классе отступа: \s включает перевод строки, и «^\s*» съедал
    // пустую строку вместе с маркером. Зеркало на бэкенде (_plain_text) правится тем же тестом.
    expect(stripRichText('Абзац.\n\n- раз\n- два'))
      .toBe('Абзац.\n\n\u2022 раз\n\u2022 два')
    expect(stripRichText('Абзац.\n\n## Итог')).toBe('Абзац.\n\nИтог')
    // Отступ пробелами перед маркером по-прежнему снимается вместе с ним.
    expect(stripRichText('   - раз')).toBe('\u2022 раз')
  })
})

describe('разбор не квадратичный', () => {
  // Текст описания приходит от внешнего помощника и из Bitrix — то есть недоверенный, и
  // длиной до 20 000 знаков (столько принимает сервер). Первая версия разбора искала
  // закрывающую серию перебором остатка строки на КАЖДУЮ открывающую: 20 000 знаков занимали
  // полторы секунды, а stripRichText зовётся на каждую строку таблицы. Порог здесь с большим
  // запасом: важно поймать возврат квадрата, а не мерить машину.
  const LIMIT_MS = 300

  it.each([
    ['звёздочки подряд', '*'.repeat(5000)],
    ['много открывающих', '*a '.repeat(3000)],
    ['много пар', '*a* '.repeat(3000)],
    ['предел поля', ('текст *курс* и **жир** '.repeat(900)).slice(0, 20000)],
    // Этот вход и есть настоящий квадрат: закрывающие серии ЕСТЬ, но ни одна не подходит,
    // и поиск каждый раз доходил до конца строки. Прежние четыре случая шли по быстрой
    // ветке и квадрата не ловили — проверка была вхолостую.
    ['закрывающие есть, но не те', ' *a**'.repeat(4000)],
    // 2000 звёздочек стек JS ещё держит, и без предела глубины проверка проходила
    // вхолостую. 5000 — уже RangeError прямо в отрисовке описания.
    ['глубокая вложенность', '*'.repeat(5000) + 'важно' + '*'.repeat(5000)],
  ])('%s', (_name, src) => {
    const t0 = Date.now()
    stripRichText(src)
    renderRichText(src)
    expect(Date.now() - t0).toBeLessThan(LIMIT_MS)
  })
})

describe('список и год', () => {
  it('«2024. Итоги года.» — предложение, а не список', () => {
    // На экране год превращался в пункт списка с номером 1, а в таблице и в Bitrix
    // оставался годом: показ и снятие расходились на обычном тексте.
    const out = html('2024. Итоги года.')
    expect(out).not.toContain('<ol')
    expect(out).toContain('2024. Итоги года.')
  })

  it('у каждого пункта авторский номер, а не пересчёт подряд', () => {
    // Атрибут start задавал только ПЕРВЫЙ номер, и список «3. / 7.» на экране становился
    // «3. / 4.» — расходясь со снятием маркеров, где номера остаются авторскими.
    const out = html('3. третий\n7. седьмой')
    expect(out).toContain('value="3"')
    expect(out).toContain('value="7"')
    expect(stripRichText('3. третий\n7. седьмой')).toBe('3. третий\n7. седьмой')
  })

  it('двузначный номер списком остаётся', () => {
    expect(html('10. десятый')).toContain('<ol')
  })
})

describe('показ не теряет содержимое', () => {
  // Снятие маркеров проверено плотно, а показ — почти нет: сломай renderRichText, и часть
  // тестов этого не заметит. Здесь проверяется именно то, что рисуется на экране.
  it('подзаголовок теряет решётки, но не текст', () => {
    const out = html('## Что сделать')
    expect(out).toContain('Что сделать')
    expect(out).not.toContain('#')
  })

  it('маркированный список рисуется списком без дефисов', () => {
    const out = html('- раз\n- два')
    expect(out).toContain('<ul')
    expect((out.match(/<li/g) || []).length).toBe(2)
    expect(out).not.toContain('- раз')
  })

  it('моноширинный рисуется и сохраняет содержимое', () => {
    const out = html('вот `a * b` тут')
    expect(out).toContain('<code')
    expect(out).toContain('a * b')
  })

  it('слишком глубокая вложенность не теряет текст', () => {
    // Предел глубины нужен против подобранного ввода, но текст пропадать не должен.
    // Точную строку тут закреплять нечем — она зависит от самой величины предела; важно,
    // что текст цел, а пропадают только звёздочки.
    const src = '*'.repeat(40) + 'важно' + '*'.repeat(40)
    const out = stripRichText(src)
    expect(out).toContain('важно')
    expect(out.replace(/\*/g, '')).toBe('важно')
    expect(html(src)).toContain('важно')
  })
})

describe('зеркало с бэкендом', () => {
  // Один набор случаев на обе стороны: тот же файл (через зеркало tools/markup/sync_cases.py)
  // проверяет `_plain_text` в pytest. Юнит-тесты стерегут каждую сторону по отдельности —
  // этот набор стережёт их СОВПАДЕНИЕ, потому что расходились они уже дважды, и молча.
  it.each(markupCases.cases)('снятие маркеров: $in', ({ in: src, out }) => {
    expect(stripRichText(src)).toBe(out)
  })
})
