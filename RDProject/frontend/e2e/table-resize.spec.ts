import { test, expect, type Page } from '@playwright/test'

// Регресс на баг «ползунок схлопывает колонку в минимум, расширить не даёт» (жалоба тестера).
// Корень был в useColumnSettings.getResizeBounds: ширину колонки клампили суммой ВИДИМОЙ области,
// хотя таблица намеренно шире контейнера и скроллится → max уходил ниже min и любое перетаскивание
// жало колонку в пол. Снимков тут НЕТ намеренно: проверяем поведение, а не пиксели.

async function dismissTwoFaGate(page: Page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

/** Тянем правую ручку заголовка на dx. steps обязателен: без промежуточных move
 *  слушатель mousemove не успевает отработать и drag не воспроизводится. */
async function dragBy(page: Page, th: ReturnType<Page['locator']>, dx: number) {
  const handle = th.locator('div.cursor-col-resize').last()
  const h = (await handle.boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 12 })
  await page.mouse.up()
}

const widthOf = async (th: ReturnType<Page['locator']>) => (await th.boundingBox())!.width

// WBS — худший случай (16 колонок, ~1590px против ~800-900px видимых: именно здесь max
// схлопывался в min). Meetings — та таблица, что «работала», её проверяем на отсутствие регрессии.
// Колонку ищем по ТЕКСТУ <th>, а не по роли columnheader: Chromium снимает табличные ARIA-роли,
// когда CSS меняет display у таблицы, и getByRole('columnheader') возвращает пусто (проверено).
for (const { name, path, column } of [
  { name: 'WBS', path: 'wbs', column: 'Название' },
  { name: 'Совещания', path: 'meetings', column: 'Совещания' },
]) {
  test(`${name}: колонку можно расширить и сузить, ширина переживает перезагрузку`, async ({ page }) => {
    // Тест делает логин + два перехода + reload, и каждый шаг ждёт «тишины» на живом дев-сервере;
    // дефолтных 30с не хватает, особенно на холодном Vite после рестарта контейнера.
    test.setTimeout(120_000)
    await login(page)
    // Чистим сохранённые ширины ОДИН раз, а не через addInitScript: тот выполняется на каждой
    // загрузке, включая reload() ниже, и стёр бы ровно то, что мы проверяем на переживание.
    await page.evaluate(() => {
      Object.keys(localStorage).filter(k => k.startsWith('pmtool:cols:')).forEach(k => localStorage.removeItem(k))
    })
    await page.goto(`/projects/47/${path}`)
    await dismissTwoFaGate(page)

    const th = page.locator('table th').filter({ hasText: column }).first()
    await expect(th).toBeVisible({ timeout: 15000 })
    const start = await widthOf(th)

    await dragBy(page, th, 120)
    await expect.poll(() => widthOf(th), { timeout: 5000 }).toBeGreaterThan(start + 80)
    const grown = await widthOf(th)

    // обратное направление: баг жал в минимум в ОБЕ стороны
    await dragBy(page, th, -60)
    await expect.poll(() => widthOf(th), { timeout: 5000 }).toBeLessThan(grown - 30)
    const shrunk = await widthOf(th)
    expect(shrunk).toBeGreaterThan(start)      // всё ещё шире исходной, а не схлопнута в пол

    await page.reload()
    await dismissTwoFaGate(page)
    await expect(th).toBeVisible({ timeout: 15000 })
    await expect.poll(() => widthOf(th), { timeout: 5000 }).toBeGreaterThan(start)
  })
}
