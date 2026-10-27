import { test, expect, type Page } from '@playwright/test'

/* Паспорт сохраняется сам: кнопки «Сохранить» нет, состояния «изменено, но не сохранено» тоже.
 *
 * Первый тест — не формальность. Именно так проявился самый опасный дефект этой работы:
 * formRef обновляется эффектом ПОСЛЕ рендера, а snapshotRef — сразу, и в это окно автосейв
 * отправлял ПУСТОЙ паспорт поверх проекта. PUT уходил с name:"" и обнулял цель, объём,
 * заказчика, РП и даты; название уцелело только потому, что сервер игнорирует пустое имя.
 * Юнит-тест это НЕ ловит — в jsdom эффекты успевают синхронизироваться. Ловит только браузер.
 */

const PID = '177'

async function dismissTwoFaGate(page: Page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

async function openPassport(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
  await page.goto(`/projects/${PID}/passport`)
  await dismissTwoFaGate(page)
  const name = page.getByLabel('Название', { exact: true }).first()
  await expect(name).toBeVisible({ timeout: 15000 })
  return name
}

/** Все PUT-ы паспорта за прогон — с телом, чтобы видеть, ЧТО ушло, а не только сколько раз. */
function watchPuts(page: Page) {
  const puts: string[] = []
  page.on('request', r => {
    if (r.method() === 'PUT' && r.url().includes(`/projects/${PID}`)) puts.push(String(r.postData() ?? ''))
  })
  return puts
}

test('после открытия паспорта ни одного сохранения не происходит', async ({ page }) => {
  test.setTimeout(120_000)
  const puts = watchPuts(page)
  await openPassport(page)
  await page.waitForTimeout(5000)   // заведомо больше паузы автосейва
  expect(puts, `паспорт сохранился сам: ${puts[0]?.slice(0, 120)}`).toHaveLength(0)
})

test('правка сохраняется сама, статус проходит «Сохранение…» → «Сохранено», и переживает перезагрузку', async ({ page }) => {
  test.setTimeout(120_000)
  const puts = watchPuts(page)
  const name = await openPassport(page)
  const original = await name.inputValue()

  await name.fill(original + ' E2E')
  await expect(page.getByText(/Сохранение…|Saving…/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Сохранено в \d{1,2}:\d{2}|Saved at/)).toBeVisible({ timeout: 15_000 })

  // Уходит паспорт ЦЕЛИКОМ: пустое тело затёрло бы проект.
  expect(puts).toHaveLength(1)
  const body = JSON.parse(puts[0]) as Record<string, unknown>
  expect(body.name).toBe(original + ' E2E')
  expect(body.client, 'в теле пусто — так и затирали проект').toBeTruthy()

  await page.reload()
  await dismissTwoFaGate(page)
  const again = page.getByLabel('Название', { exact: true }).first()
  await expect(again).toBeVisible({ timeout: 15000 })
  await expect(again, 'правка не доехала до сервера').toHaveValue(original + ' E2E')

  // Возвращаем как было — тоже автосохранением. Правки схлопываются внутри сеанса, поэтому
  // версия проекта откатывается сама и эталоны остаются зелёными.
  await again.fill(original)
  await expect(page.getByText(/Сохранено в \d{1,2}:\d{2}|Saved at/)).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await dismissTwoFaGate(page)
  await expect(page.getByLabel('Название', { exact: true }).first()).toHaveValue(original, { timeout: 15000 })
})

test('кнопки «Сохранить паспорт» больше нет', async ({ page }) => {
  test.setTimeout(120_000)
  await openPassport(page)
  await expect(page.getByRole('button', { name: /Сохранить паспорт|Save passport/i })).toHaveCount(0)
})
