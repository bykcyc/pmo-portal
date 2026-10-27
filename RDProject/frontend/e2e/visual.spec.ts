import { test, expect, type Page } from '@playwright/test'

/**
 * Визуальные голден-снапшоты перед миграцией бэкенда (OpenProject → Postgres).
 * Фронт при миграции не меняется — после переключения на v2 все снимки обязаны
 * совпасть до пикселя. Красный снимок = бэкенд отдал другие данные/порядок.
 *
 * Прогон:  npx playwright test visual.spec.ts --workers=1
 * Обновить базлайны (осознанно!):  ... --update-snapshots
 */

/**
 * ВНИМАНИЕ: часы НЕ замораживаем. `page.clock.setFixedTime()` подвешивает
 * `page.screenshot()` (скриншот ждёт стабильного кадра, а время не идёт) —
 * воспроизводится начиная с 4-й страницы. Поэтому снимки day-зависимы:
 * базлайны и сверку v1↔v2 делать В ОДИН ДЕНЬ. Если день сменился —
 * пересоздать базлайны: npx playwright test visual.spec.ts --update-snapshots
 */
const PID = '47' // prj-40451 (витрина): 33 задачи, 6 рисков, встречи, бюджет, базовый план

const PAGES = ['/portfolio', '/projects', '/my-work', '/calendar', '/how-to', '/profile', '/settings', '/projects/new', '/drafts']

/** Дата, на которой сняты эталоны календаря.
 *
 *  Календарь подсвечивает «сегодня», поэтому его снимок расходился КАЖДЫЙ день после съёмки:
 *  в диффе краснели ровно две клетки — вчерашняя и сегодняшняя. Маска тут не помогает, она
 *  ходит вместе с клеткой. Поэтому на время съёмки часы в браузере останавливаем, и значение
 *  подобрано не случайно: это тот самый день, когда снят действующий эталон, — значит
 *  пересъёмка не нужна, а снимок перестаёт зависеть от календаря на стене.
 *
 *  Останавливаем именно Date (setFixedTime), а не всё время целиком: таймеры и ожидания
 *  Playwright продолжают идти, иначе прогон повис бы на первом же waitForTimeout. */
const FROZEN_TODAY = new Date('2026-09-15T10:00:00Z')

/** Страницы, которым нужны остановленные часы. Пока такая одна — календарь; Гант обходится
 *  маской линии «Сегодня», а остальным экранам дата безразлична. */
const CLOCK_FROZEN_PAGES = new Set(['/calendar'])
const SECTIONS = [
  'passport', 'team', 'stakeholders', 'assumptions', 'comm-plan', 'kpis',
  'wbs', 'gantt', 'kanban', 'baseline', 'risks', 'decisions', 'budget',
  'backlog', 'meetings', 'reports',
]

test.use({ viewport: { width: 1440, height: 900 } })

/** Семейство оформления (Warm/Classic — этап B темизации): задаётся env-переменной
 *  PMO_SKIN ('rd' по умолчанию | 'classic'). Пока обе семьи визуально идентичны (сток),
 *  эталоны общие; после RD-флипа (этап D) rd-прогон получит эталоны с префиксом rd-. */
const SKIN = (process.env.PMO_SKIN === 'classic' ? 'classic' : 'rd') as 'rd' | 'classic'
/** Эталоны двух семейств живут раздельно: rd-* — Warm (дефолт портала),
 *  без префикса — Classic (пиксельный якорь исходного вида, НЕ перезаписывать). */
const SNAP_PREFIX = SKIN === 'rd' ? 'rd-' : ''

/** Тема и skin ставятся ДО загрузки приложения — иначе первый кадр рисуется дефолтом. */
async function seedTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(([t, s]) => {
    localStorage.setItem('pm-tool-ui', JSON.stringify({
      state: { sidebarCollapsed: false, rightPanelCollapsed: false, focusMode: false, theme: t, skin: s },
      version: 0,
    }))
  }, [theme, SKIN] as const)
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**', { timeout: 30000 })
}

/** Счётчик незавершённых XHR к бэкенду.
 *  Ставится один раз на страницу; ждать networkidle нельзя — vite держит HMR-websocket. */
function trackRequests(page: Page): { inflight: () => number } {
  let n = 0
  const isApi = (u: string) => u.includes('/api/') || /\/(projects|portfolio|attention|users|me)\b/.test(u)
  page.on('request', (r) => { if (isApi(r.url())) n++ })
  page.on('requestfinished', (r) => { if (isApi(r.url())) n-- })
  page.on('requestfailed', (r) => { if (isApi(r.url())) n-- })
  return { inflight: () => n }
}

/** 2FA-гейт (грейс-период): у owner-аккаунта на деве включена обязательная
 *  2FA без настроенного секрета → модалка «Настройте двухфакторную аутентификацию»
 *  всплывает при КАЖДОЙ полной загрузке (dismissed — только React-state). Эталоны сняты
 *  без неё; закрытая модалка = null в DOM, т.е. пиксельно то же состояние. Закрываем
 *  перед каждым снимком. В тексте модалки счётчик «Осталось дней: N» — с ним в кадре
 *  эталоны краснели бы ежедневно. */
async function dismissTwoFaGate(page: Page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

/** Ждём, пока все запросы к бэкенду завершатся и пройдёт 1.2 с непрерывной тишины.
 *  Данные приходят ВОЛНАМИ (страница → правая панель-советник), и короткое окно
 *  давало ложную «тишину» между ними: снимок ловил «Следующий шаг» вместо «Готово».
 *  Плюс текстовый лоадер «Загрузка проекта…» — он не скелетон. */
/** Отпечаток темы: дев-Vite в докере НЕДЕТЕРМИНИРОВАННО отдаёт устаревший JIT-CSS
 *  отдельным клиентам после правок tailwind.config/переменных (двумя пробами доказано:
 *  одновременно один клиент видит новую палитру, другой — старую). Перед снимком
 *  сверяем маркерную переменную; не совпала — жёсткая перезагрузка, до 3 попыток,
 *  дальше — громкий отказ вместо съёмки мусора. */
async function ensureSkinCss(page: Page) {
  // Проверяем СКВОЗНОЙ рендер утилиты, а не значение переменной: ловили состояние,
  // когда :root уже новый, а правило .bg-sky-50 в отданном CSS ещё старое литеральное.
  const expected = SKIN === 'rd' ? 'rgb(253, 250, 232)' : 'rgb(240, 249, 255)'
  for (let i = 0; i < 4; i++) {
    const v = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'bg-sky-50'
      document.body.appendChild(el)
      const c = getComputedStyle(el).backgroundColor
      el.remove()
      return c
    }).catch(() => '')
    if (v === expected) return
    await page.reload({ waitUntil: 'load' }).catch(() => {})
    await page.waitForTimeout(1500)
  }
  throw new Error(`Тема не применилась: bg-sky-50 рендерит не ${expected} (устаревший JIT-CSS дев-сервера)`)
}

async function settle(page: Page, net: { inflight: () => number }) {
  await page.waitForLoadState('load').catch(() => {})
  await ensureSkinCss(page)
  const deadline = Date.now() + 25000
  let quietSince = 0
  while (Date.now() < deadline) {
    if (net.inflight() <= 0) {
      if (!quietSince) quietSince = Date.now()
      else if (Date.now() - quietSince > 1200) break
    } else {
      quietSince = 0
    }
    await page.waitForTimeout(100)
  }
  await dismissTwoFaGate(page)
  // Любые текстовые лоадеры («Загрузка проекта…», «Загрузка…» в таблицах) — не скелетоны.
  await page.getByText(/^Загрузка|^Loading/i).first()
    .waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await page.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  // Пока шрифты не загружены, текст рисуется запасным начертанием и весь блок съезжает
  // на пиксель — снимок расходился целиком при одинаковых данных.
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  // Убираем курсор в угол: иначе он «висит» над строкой с прошлой страницы и показывает
  // hover-иконки строки (↗ промоут / 🗑 удалить) + hover-подсветку фильтр-селекта —
  // они мелькали по позиции мыши и красили снимки недетерминированно.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(900)
}

/** Правая панель проекта: карточка советника рендерится ПОЗЖЕ (данные берутся из
 *  кэша react-query, нового запроса нет — сетевая тишина её не ловит) и сдвигает
 *  «Прогресс подготовки» вниз. Без этого ожидания базлайн снимался без неё. */
async function settleProjectPanel(page: Page) {
  await page.getByText(/На этой странице|On this page/i).first()
    .waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}

const shot = (page: Page, name: string) =>
  expect.soft(page).toHaveScreenshot(`${SNAP_PREFIX}${name}.png`, {
    // Линия «Сегодня» позиционируется по scrollWidth Ганта — на пиксель гуляет между рендерами.
    // Бейдж непрочитанных на колокольчике — живые данные (счёт растёт ежедневно от уведомлений
    // «застой»/совещаний): без маски он красил ВСЕ снимки при любом дрейфе данных.
    mask: [
      page.locator('.gantt-today-line'),
      page.locator('aside span.rounded-full.bg-rose-600'),
    ],
    maskColor: '#ff00ff',
  })

for (const theme of ['light', 'dark'] as const) {
  test(`visual: pages (${theme})`, async ({ page }) => {
    test.setTimeout(180000)
    const net = trackRequests(page)
    await seedTheme(page, theme)
    await login(page)

    for (const route of PAGES) {
      if (CLOCK_FROZEN_PAGES.has(route)) await page.clock.setFixedTime(FROZEN_TODAY)
      await page.goto(route)
      await settle(page, net)
      await shot(page, `${theme}-page${route.replace(/\//g, '_')}`)
    }
  })

  test(`visual: project sections (${theme})`, async ({ page }) => {
    test.setTimeout(600000)
    const net = trackRequests(page)
    await seedTheme(page, theme)
    await login(page)

    for (const section of SECTIONS) {
      await page.goto(`/projects/${PID}/${section}`)
      await settle(page, net)
      await settleProjectPanel(page)
      if (section === 'gantt') {
        // DHTMLX рисует канву асинхронно после монтирования
        await page.locator('.gantt-wrapper').waitFor({ timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(1500)
      }
      await shot(page, `${theme}-section-${section}`)
    }
  })
}

test('visual: login page', async ({ page }) => {
  const net = trackRequests(page)
  await seedTheme(page, 'light')
  await page.goto('/login')
  await settle(page, net)
  await expect(page).toHaveScreenshot(`${SNAP_PREFIX}light-page_login.png`)
})
