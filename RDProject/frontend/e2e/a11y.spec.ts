import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Запускается из изолированного раннера (C:\pw-runner), где установлен @axe-core/playwright.
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
}

test('portfolio: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/portfolio')
  await page.waitForTimeout(1000)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

test('project WBS: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/projects/47/wbs')
  await page.waitForTimeout(1200)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

// Бэклог под гейтом: у пункта появилась карточка-модалка, а раздел не проверялся
// ни здесь, ни в no-console-errors — новый диалог проехал бы мимо CI молча.
test('project Backlog: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/projects/47/backlog')
  // Ждём именно ТАБЛИЦУ: на 1200 мс проверка успевала пройти по скелету загрузки и зеленела
  // вхолостую — а критическое замечание жило в фильтре, которого ещё не было на экране.
  await page.waitForSelector('tbody tr', { timeout: 10000 })
  await page.waitForTimeout(600)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

test('project Kanban: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/projects/47/kanban')
  await page.waitForTimeout(1200)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

test('calendar: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/calendar')
  await page.waitForTimeout(1000)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

test('drafts: no critical accessibility violations', async ({ page }) => {
  await login(page)
  await page.goto('/drafts')
  await page.waitForTimeout(1000)
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => v.id), 'critical a11y violations').toEqual([])
})

// A11Y-01/03 (accessible names + RAG aria): проверяем именно правила именования/aria,
// не привязываясь к contrast (это отдельная задача A11Y-02) — чтобы тест ловил регресс имён.
const NAMING_RULES = [
  'button-name', 'select-name', 'aria-input-field-name', 'aria-command-name',
  'aria-prohibited-attr', 'label', 'link-name', 'image-alt', 'frame-title',
]
async function loginPm(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('pm1@company.com')
  await page.locator('input[type=password]').fill('pm123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
}
async function expectNoNamingViolations(page: import('@playwright/test').Page, where: string) {
  await page.waitForTimeout(1000)
  const results = await new AxeBuilder({ page }).analyze()
  const naming = results.violations.filter((v) => NAMING_RULES.includes(v.id))
  expect(naming.map((v) => v.id), `naming/aria a11y violations on ${where}`).toEqual([])
}

test('projects list: no naming/aria violations (filters have names, A11Y-01)', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await expectNoNamingViolations(page, 'projects')
})

test('settings: no naming/aria violations (row-action icons named, A11Y-01)', async ({ page }) => {
  await login(page) // owner видит Settings
  await page.goto('/settings')
  await expectNoNamingViolations(page, 'settings')
})

test('portfolio: RAG indicator not aria-prohibited (A11Y-03)', async ({ page }) => {
  await login(page)
  await page.goto('/portfolio')
  await expectNoNamingViolations(page, 'portfolio')
})

test('editable passport: form controls have names (A11Y-01)', async ({ page }) => {
  await loginPm(page) // pm1 владеет PRJ-47 → редактируемый PassportForm с контролами
  await page.goto('/projects/47/passport')
  await expectNoNamingViolations(page, 'passport')
})

// A11Y-02 (системный контраст): гейтим serious color-contrast на ключевых страницах. Раньше CI
// проверял только impact==='critical', и сотни serious-нарушений контраста (text-slate-500 на
// светлом, text-gray-400 10px и т.п.) проходили молча. Теперь регресс контраста валит сборку.
// passport читаем owner-ом (READ_ALL_ROLES) — контраст проверяется и на read-only виде; так
// избегаем 2FA-гейта pm1 (снимать 2FA у фикстуры нельзя — данные владельца).
const CONTRAST_PAGES: { path: string; name: string; pm?: boolean }[] = [
  { path: '/projects', name: 'projects' },
  { path: '/portfolio', name: 'portfolio' },
  { path: '/settings', name: 'settings' },
  { path: '/projects/47/passport', name: 'passport' },
  { path: '/drafts', name: 'drafts' },
]
// Обе темы оформления × обе цветовые схемы: Warm (дефолт) и Classic обязаны держать AA
// на светлом И тёмном. Раньше гейт крутился только в дефолте (одна комбинация).
const THEME_COMBOS = [
  { skin: 'rd', theme: 'light' },
  { skin: 'rd', theme: 'dark' },
  { skin: 'classic', theme: 'light' },
  { skin: 'classic', theme: 'dark' },
] as const

async function seedUi(page: import('@playwright/test').Page, skin: string, theme: string) {
  await page.addInitScript(([s, t]) => {
    localStorage.setItem('pm-tool-ui', JSON.stringify({
      state: { sidebarCollapsed: false, rightPanelCollapsed: false, focusMode: false, theme: t, skin: s },
      version: 0,
    }))
  }, [skin, theme] as const)
}

for (const combo of THEME_COMBOS) {
  for (const pg of CONTRAST_PAGES) {
    test(`${pg.name} [${combo.skin}/${combo.theme}]: no serious color-contrast violations (A11Y-02)`, async ({ page }) => {
      await seedUi(page, combo.skin, combo.theme)
      if (pg.pm) await loginPm(page)
      else await login(page)
      await page.goto(pg.path)
      await page.waitForTimeout(1200)
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.flatMap((v) => v.nodes).map((n) => n.html.slice(0, 90)), `contrast on ${pg.name} (${combo.skin}/${combo.theme})`).toEqual([])
    })
  }
}
