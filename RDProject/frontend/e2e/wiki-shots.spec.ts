import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/* Это ИНСТРУМЕНТ СЪЁМКИ, а не регрессия. Никаких toHaveScreenshot: спека кладёт PNG в
 * public/wiki-shots/, откуда их отдаёт сам портал (public копируется в dist и НЕ попадает
 * в js-бандл). Гейтом эти файлы не являются — их пересъём осознанный.
 *
 * Запуск (из C:\pw-runner) — только явно, через WIKI_SHOTS:
 *     WIKI_SHOTS=passport,wbs npx playwright test wiki-shots.spec.ts     // только эти
 *     WIKI_SHOTS=all npx playwright test wiki-shots.spec.ts              // все
 *
 * Без этой переменной спека пропускается. Иначе полный прогон гейта (`npx playwright test`)
 * молча перезаписывал бы PNG датами того дня, когда его запустили, и каждый прогон приносил
 * бы в коммит бинарный мусор, к правкам отношения не имеющий.
 *
 * ПЕРЕСНИМАТЬ ТОЛЬКО ИЗМЕНИВШИЕСЯ страницы: 20+ PNG в каждом коммите раздувают историю.
 *
 * Имя каталога wiki-shots, а не wiki — иначе путь файла столкнулся бы с SPA-маршрутом /wiki.
 */

const OUT = path.resolve(__dirname, '../public/wiki-shots')
const PID = '47'                 // витрина: 33 задачи, риски, бюджет — на пустом проекте снимать нечего
const MAX_BYTES = 250_000        // бюджет на файл; ловим разрастание сразу, а не на git push
const WANT = (process.env.WIKI_SHOTS || '').trim()
const ONLY = (WANT === 'all' ? '' : WANT).split(',').map(s => s.trim()).filter(Boolean)

test.skip(!WANT, 'инструмент съёмки: запускать явно через WIKI_SHOTS=all или список страниц')

// Проект 47 (витрина) бюджета НЕ содержит вовсе — помесячную сетку снимаем на 177,
// единственном проекте дева со статьями и помесячным план/фактом.
const PID_BUDGET = '177'

/** Черновик помощника на деве не существует и через REST не создаётся: строку в project_drafts
 *  пишет только MCP-инструмент propose_changes. Поэтому кадр снимается на ФИКСТУРЕ — page.route
 *  подменяет два GET-а, страница рисуется настоящая, база не трогается, «Принять» никто не жмёт.
 *  Побочная польза: кадр детерминирован и не поедет вслед за живыми данными. */
const DRAFT_FIXTURE = {
  id: '9001', project_id: PID_BUDGET, author: 'assistant@company.com',
  source: 'расшифровка планёрки 14 августа', title: 'Итоги планёрки: сроки пилота и риски',
  status: 'open', created_at: '2026-08-14T10:12:00+00:00',
  counts: { add: 5, edit: 2, delete: 0, skip: 1, clash: 1, selected: 7 },
  items: [
    { id: 'i1', section: 'tasks', op: 'add', selected: true, data: { title: 'Собрать замеры «после»: время ревью и покрытие', planned_start: '2026-09-01', planned_end: '2026-09-12' } },
    { id: 'i2', section: 'tasks', op: 'add', selected: true, data: { title: 'Памятка по промптам для ревью кода', planned_end: '2026-09-05' } },
    { id: 'i3', section: 'tasks', op: 'edit', selected: true, target_id: '551', target_title: 'Пилотные задачи: код, ревью, автотесты', data: { planned_end: '2026-10-16' }, was: { planned_end: '2026-10-23' } },
    { id: 'i4', section: 'tasks', op: 'skip', selected: false, data: { title: 'Замеры «до»: время ревью, покрытие тестами' }, note: 'уже есть в плане работ — повтор' },
    { id: 'i5', section: 'tasks', op: 'clash', selected: false, data: { title: 'Стартовый воркшоп: что ИИ умеет' }, note: 'в портале срок 11.09, на планёрке назвали 28.08 — решает руководитель' },
    { id: 'i6', section: 'risks', op: 'add', selected: true, data: { title: 'Разработчики не доверяют подсказкам ИИ' } },
    { id: 'i7', section: 'risks', op: 'edit', selected: true, target_id: '80', target_title: 'Утечка кода во внешний сервис', data: { mitigation: 'запретить публичные модели, вести список разрешённых' } },
    { id: 'i8', section: 'team', op: 'add', selected: true, data: { full_name: 'Анна Калниня', role: 'аналитик' } },
    { id: 'i9', section: 'budget-items', op: 'add', selected: true, data: { name: 'Обучение: курс по промпт-инжинирингу', amount: 600 } },
  ],
}

type Shot = {
  name: string
  url: string
  /** Подмена ответов API фикстурой. Ставится ДО goto. */
  mock?: (page: Page) => Promise<void>
  /** Клики и прокрутка перед съёмкой: вкладка внутри раздела, фильтр, скролл таблицы. */
  prepare?: (page: Page) => Promise<void>
  /** Высота кадра, по умолчанию 620. */
  height?: number
}

const SHOTS: Shot[] = [
  { name: 'passport', url: `/projects/${PID}/passport` },
  { name: 'wbs', url: `/projects/${PID}/wbs` },
  { name: 'gantt', url: `/projects/${PID}/gantt` },
  { name: 'kanban', url: `/projects/${PID}/kanban` },
  { name: 'risks', url: `/projects/${PID}/risks` },
  { name: 'meetings', url: `/projects/${PID}/meetings` },
  { name: 'my-work', url: '/my-work' },
  { name: 'calendar', url: '/calendar' },
  { name: 'projects', url: '/projects' },

  // Бюджет → вкладка «Помесячный план» (подпись именно такая, не «Помесячно»). Сетка 12 месяцев
  // шире видимой области: без зума в кадр попадает ЛИБО колонка «Тип» с подписями План/Факт,
  // ЛИБО заполненные месяцы. Зум 0.85 вмещает и то, и другое.
  {
    name: 'budget-monthly',
    url: `/projects/${PID_BUDGET}/budget`,
    height: 250,   // ниже начинается график накопления — в кадр он не нужен
    prepare: async (page) => {
      await page.getByRole('button', { name: /Помесячный план|Monthly Plan|Mēneša plāns/ }).click()
      await page.waitForTimeout(800)
      await page.evaluate(() => { document.body.style.zoom = '0.85' })
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('main button')].find(b => /Помесячн|Monthly|Mēneša/.test(b.textContent || ''))
        btn?.scrollIntoView({ block: 'start' })
        // ths[4] — колонка «Тип» (Название, Категория, Бюджет статьи, Свободно, Тип, 12 месяцев…):
        // берём по индексу, чтобы не зависеть от языка интерфейса.
        const tbl = document.querySelector('main table')
        const wrap = tbl?.closest('.overflow-x-auto')
        const ths = tbl ? [...tbl.querySelectorAll('thead th')] : []
        if (wrap && ths[4]) wrap.scrollLeft = (ths[4] as HTMLElement).offsetLeft - (ths[0] as HTMLElement).offsetWidth
      })
      await page.waitForTimeout(500)
    },
  },

  // Базовый план: снимок выбирать не надо — вкладка сама подставляет самый свежий. Чип
  // «План менялся после снимка» оставляет только строки с реальным отклонением.
  {
    name: 'baseline',
    url: `/projects/${PID}/baseline`,
    height: 560,
    prepare: async (page) => {
      await page.getByRole('button', { name: /План менялся после снимка/ }).click()
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        document.querySelector('main h4')?.scrollIntoView({ block: 'start' })
        window.scrollBy(0, -70)
      })
      await page.waitForTimeout(400)
    },
  },

  // Приём черновика помощника: экран /drafts/:id на фикстуре (см. DRAFT_FIXTURE).
  {
    name: 'draft-review',
    url: '/drafts/9001',
    height: 620,
    mock: async (page) => {
      // Глоб '**/api/drafts' не ловит '/api/drafts/9001' — маршрута нужно два.
      await page.route('**/api/drafts', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [{ ...DRAFT_FIXTURE, items: undefined }] }),
      }))
      await page.route('**/api/drafts/9001', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: DRAFT_FIXTURE }),
      }))
    },
  },
]

async function dismissTwoFaGate(page: Page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

// Узкое окно намеренно: меньше пикселей — легче файл, а текст крупнее относительно кадра
// и потому читается, когда статья показывает картинку шириной ~700px.
test.use({ viewport: { width: 1100, height: 780 } })

test('снять скриншоты для справки', async ({ page }) => {
  test.setTimeout(300_000)
  fs.mkdirSync(OUT, { recursive: true })

  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)

  const targets = ONLY.length ? SHOTS.filter(s => ONLY.includes(s.name)) : SHOTS
  expect(targets.length, 'WIKI_SHOTS не совпал ни с одним именем').toBeGreaterThan(0)

  for (const shot of targets) {
    if (shot.mock) await shot.mock(page)      // подмена API — обязательно ДО goto
    await page.goto(shot.url)
    await dismissTwoFaGate(page)
    // Текстовые лоадеры — не скелетоны, ждём именно их исчезновения.
    await page.getByText(/^Загрузка|^Loading/i).first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    if (shot.prepare) await shot.prepare(page)
    await page.mouse.move(0, 0)               // убираем hover-подсветку строк из кадра
    await page.waitForTimeout(1200)

    // Снимаем ОБЛАСТЬ страницы по координатам main: сайдбар в кадр не попадает, а высота
    // ограничена. Именно page.screenshot({clip}), а не locator.screenshot({clip}) —
    // у локатора опции clip нет, она молча игнорируется и снимает элемент целиком (проверено:
    // так получались файлы по 550 КБ вместо ожидаемых 100).
    // Три поправки для кадров с прокруткой и зумом: box.y после скролла уходит в минус;
    // page.screenshot режет клип по ВИДИМОЙ области (y + height ≤ 780, иначе PNG выйдет ниже
    // заказанного); при зуме боксы приходят увеличенными — ширину держим прежней, 860.
    const box = (await page.locator('main').first().boundingBox())!
    const top = Math.max(0, box.y)
    const height = Math.min(shot.height ?? 620, box.height, 780 - top)
    const file = path.join(OUT, `${shot.name}.png`)
    await page.screenshot({
      path: file,
      clip: { x: Math.max(0, box.x), y: top, width: Math.min(box.width, 860), height },
    })
    await page.evaluate(() => { document.body.style.zoom = '' })  // иначе зум утечёт в следующий кадр

    const size = fs.statSync(file).size
    expect(size, `${shot.name}.png весит ${Math.round(size / 1024)} КБ — обрежьте кадр`).toBeLessThan(MAX_BYTES)
    console.log(`${shot.name}.png — ${Math.round(size / 1024)} КБ`)
  }
})
