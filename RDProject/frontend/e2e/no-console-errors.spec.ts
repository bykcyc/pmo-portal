import { test, expect } from '@playwright/test'

// UX-03 regression: цикличный re-render («Maximum update depth exceeded») в рабочих вкладках.
// Ловим его в консоли/pageerror при открытии секций, где раньше нестабильный `data = []`
// из useQuery дёргал useEffect(setLocalRows) в бесконечный цикл.

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
}

const SECTIONS = ['team', 'assumptions', 'comm-plan', 'kpis', 'stakeholders', 'risks']

test('no infinite re-render (Maximum update depth) when opening tabs', async ({ page }) => {
  const errors: string[] = []
  const record = (text: string) => {
    if (/Maximum update depth exceeded/i.test(text)) errors.push(text)
  }
  page.on('console', (msg) => { if (msg.type() === 'error') record(msg.text()) })
  page.on('pageerror', (err) => record(String(err)))

  await login(page)
  for (const s of SECTIONS) {
    await page.goto(`/projects/47/${s}`)
    // Если цикл есть — он заливает консоль сразу; даём кадрам отрисоваться.
    await page.waitForTimeout(1200)
  }
  // Экран согласования черновиков: там тоже useEffect(setItems) по данным useQuery.
  await page.goto('/drafts')
  await page.waitForTimeout(1200)
  expect(errors, `re-render loop detected:\n${errors.slice(0, 3).join('\n')}`).toHaveLength(0)
})
