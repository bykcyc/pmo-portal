import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

// 2FA обязательна для всех, поэтому до её подключения портал держит модалку-гейт поверх
// страницы — она перехватывает клики. Гейт монтируется заново после КАЖДОГО перехода и
// не мгновенно, а после загрузки профиля, поэтому закрывать надо после каждого goto.
async function dismissTwoFaGate(page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

test('saved views: save → apply → delete round-trip on portfolio', async ({ page }) => {
  // D3/H6: сохранённые виды (localStorage, per-user). Группировки по клиенту в портфеле
  // больше нет, поэтому сохраняем ФИЛЬТР ПО СТАТУСУ: и значение селекта, и его эффект на
  // списке переживают сохранение, сброс и применение вида.
  await login(page)
  await page.goto('/portfolio')
  await dismissTwoFaGate(page)

  const statusSelect = page.getByLabel(/^Status$|^Статус$/i).first()

  // Тест обязан утверждать ЭФФЕКТ фильтра, а не только значение селекта: иначе он не отличит
  // работающий фильтр от сломанного. Мерить эффект строками нельзя — группы в портфеле по
  // умолчанию свёрнуты, и строк на странице нет вовсе. Зато в заголовке группы всегда виден
  // её счётчик, и он на фильтр реагирует.
  //
  // Фильтруем по «Завершён», а НЕ по «В планировании»: оба проекта дева в планировании, и
  // фильтр по нему на экране не меняет ничего — именно поэтому проверка эффекта здесь когда-то
  // и потерялась при переписывании теста.
  const group = page.locator('button[aria-expanded]').filter({ hasText: /Без вида|No kind/i }).first()
  await expect(group).toBeVisible()
  // Первое число в заголовке — размер группы («проектов: 2 · ещё не заведены: 1»).
  const size = async () => Number((await group.innerText()).match(/(\d+)/)?.[1] ?? -1)
  const total = await size()
  expect(total, 'группа пуста — проверять эффект фильтра не на чем').toBeGreaterThan(0)

  // 1) ставим фильтр → проектов в группе становится меньше
  await statusSelect.selectOption('completed')
  await expect(statusSelect).toHaveValue('completed')
  await expect.poll(size, { timeout: 5000 }).toBeLessThan(total)

  // 2) сохраняем вид (Enter в поле имени коммитит)
  await page.getByRole('button', { name: /Сохранить вид|Save view/i }).click()
  const nameInput = page.getByLabel(/Имя вида|View name/i)
  await nameInput.fill('e2e-view')
  await nameInput.press('Enter')
  await expect(page.getByText(/Сохранено|Saved/i).first()).toBeVisible()

  // 3) сбрасываем фильтр → группа снова полная
  await statusSelect.selectOption('')
  await expect(statusSelect).toHaveValue('')
  await expect.poll(size, { timeout: 5000 }).toBe(total)

  // 4) применяем сохранённый вид из селекта → фильтр вернулся И подействовал на список
  await page.getByLabel(/— виды —|— views —/i).selectOption('e2e-view')
  await expect(statusSelect).toHaveValue('completed')
  await expect.poll(size, { timeout: 5000 }).toBeLessThan(total)

  // 5) удаляем вид (X в контроле видов) → опция исчезает
  await page.getByRole('button', { name: /^Удалить$|^Delete$/i }).click()
  await expect(page.getByText(/Вид удалён|View deleted/i).first()).toBeVisible()
  await expect(page.getByLabel(/— виды —|— views —/i).locator('option', { hasText: 'e2e-view' })).toHaveCount(0)

  // 6) прибираем UI-состояние
  await statusSelect.selectOption('')
})
