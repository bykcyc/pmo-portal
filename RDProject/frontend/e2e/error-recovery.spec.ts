import { test, expect } from '@playwright/test'

// UX-02: при РЕАЛЬНОМ сбое API (бэкенд отдаёт 500) экран не должен быть пустым —
// страница показывает понятный error state с действием восстановления.
// ВАЖНО: мокаем ТОЛЬКО корневой /api/ (реальные вызовы), а не vite-модули из src/api/*.ts
// (их URL тоже содержит "/api/", и слишком широкий glob **/api/** ломает загрузку модулей в dev —
//  именно это давало ложный «пустой #root» в исходном аудите).
const API_500 = /^https?:\/\/[^/]+\/api\//

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
}

test('API 500 shows recovery UI, not a blank screen (UX-02)', async ({ page }) => {
  await login(page)
  await page.route(API_500, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }),
  )
  await page.goto('/portfolio')
  await page.waitForTimeout(2000)

  const rootText = (await page.locator('#root').innerText()).trim()
  expect(rootText.length, 'root must not be blank on API 500').toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: /обновить|retry|повторить|atjaunot/i }).first()).toBeVisible()
})
