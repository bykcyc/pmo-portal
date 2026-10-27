import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

// 2FA обязательна для всех, поэтому до её подключения портал показывает модалку-гейт
// поверх страницы — она перехватывает клики (role=dialog, aria-modal). Тесты, которые
// кликают, обязаны её закрыть. Хелпер — порт из visual.spec.
async function dismissTwoFaGate(page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

test('login -> portfolio shows projects', async ({ page }) => {
  await login(page)
  await page.goto('/portfolio')
  await dismissTwoFaGate(page)
  await expect(page.getByText(/portfolio|портфель/i).first()).toBeVisible()
  // Список разложен по видам проектов и при открытии СВЁРНУТ (решение владельца):
  // сначала раскрываем группу, потом проверяем, что строки проектов на месте. Проект 47 вида
  // не имеет, поэтому живёт в группе «Без вида» — на неё и опираемся.
  await page.getByRole('button', { name: /Без вида/ }).first().click()
  await expect(page.getByText(/prj-40451/i).first()).toBeVisible()
})

test('open project risk register', async ({ page }) => {
  await login(page)
  await page.goto('/projects/47/risks')
  await expect(page.getByText(/risk register|реестр рисков/i).first()).toBeVisible()
})

test('project Gantt renders', async ({ page }) => {
  await login(page)
  await page.goto('/projects/47/gantt')
  // DHTMLX Gantt mounts into .gantt-wrapper; presence proves the tab loaded
  await expect(page.locator('.gantt-wrapper')).toBeVisible()
})

test('portfolio analytics renders', async ({ page }) => {
  await login(page)
  await page.goto('/portfolio')
  await dismissTwoFaGate(page)
  // Аналитика после переделки портфеля: тепловой карты рисков больше нет (убрана по решению
  // владельца), остались тренды, сроки и два графика загрузки.
  await expect(page.getByText(/Тренды портфеля/i).first()).toBeVisible()
  await expect(page.getByText(/Сроки завершения проектов/i).first()).toBeVisible()
  await expect(page.getByText(/Загрузка по исполнителям|workload/i).first()).toBeVisible()
})

test('portfolio manager may edit a project he does not lead (WP2)', async ({ page }) => {
  // WP2 инвертировал старый инвариант: owner (Руководитель портфеля) больше НЕ наблюдатель —
  // он правит ЛЮБОЙ проект. PRJ-002 ведёт не он, но управляющие контролы обязаны быть.
  await login(page)
  await page.goto('/projects/47/team')
  await expect(page.getByRole('button', { name: /Добавить|Add/i }).first()).toBeVisible()
  await expect(
    page.getByText(/наблюдатель \(owner\)|viewing as an observer|Просмотр: редактирование доступно|View only/i),
  ).toHaveCount(0)
})

test('portfolio groups by kind', async ({ page }) => {
  // Список сгруппирован по ВИДУ проекта (стратегический / операционный / пилотный / без вида);
  // группировка по клиенту убрана вместе с карточным видом.
  await login(page)
  await page.goto('/portfolio')
  await dismissTwoFaGate(page)
  await expect(page.getByRole('button', { name: /Стратегический/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Пилотный/ }).first()).toBeVisible()

  // Проверяем ЭФФЕКТ раскрытия, а не факт «на экране есть хоть какой-то prj-»: без этого
  // тест зеленел бы и при неработающей группировке. Две тонкости, на которых первая версия
  // проверки села: группы по умолчанию СВЁРНУТЫ (таблицы нет вовсе), а код проекта
  // встречается на странице и вне группы — поэтому ищем строго внутри панели группы.
  const group = page.getByRole('button', { name: /Без вида|No kind/i }).first()
  const panel = group.locator('xpath=..')
  await expect(group).toBeVisible()
  await expect(panel.locator('table')).toHaveCount(0)   // свёрнута по умолчанию
  await group.click()
  await expect(panel.locator('table')).toHaveCount(1)   // раскрылась
  // Витринный проект дева — без вида, значит лежит именно здесь.
  await expect(panel.getByText(/prj-40451/i).first()).toBeVisible()
  await group.click()
  await expect(panel.locator('table')).toHaveCount(0)   // и сворачивается обратно
})

test('calendar page renders month grid', async ({ page }) => {
  // G2: month-view calendar of task deadlines from /me/tasks
  await login(page)
  await page.goto('/calendar')
  await expect(page.getByRole('button', { name: /Сегодня|Today/i }).first()).toBeVisible()
})

test('theme toggle switches to dark mode', async ({ page }) => {
  // G3: dark theme toggle applies the .dark class on <html>
  await login(page)
  await page.goto('/portfolio')
  await dismissTwoFaGate(page)
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByRole('button', { name: /Тёмная тема|Dark theme/i }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('kanban board renders status columns', async ({ page }) => {
  // D2: board view of tasks grouped by status
  await login(page)
  await page.goto('/projects/47/kanban')
  await expect(page.getByRole('heading', { name: /In progress|В работе/i }).first()).toBeVisible()
})

/* Внешний скрипт (в отличие от инлайна) требует сетевого запроса, поэтому проверять его
 * на 'commit' бессмысленно — там ещё не разобран даже <head>. Правильная точка —
 * DOMContentLoaded: если классы стоят там, скрипт отработал до отрисовки <body>,
 * то есть мигания нет. */
test('boot-theme.js применяет тему до отрисовки body', async ({ page }) => {
  const errs: string[] = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })

  await page.goto('/login')
  await page.evaluate(() => localStorage.setItem('pm-tool-ui', JSON.stringify({ state: { theme: 'dark', skin: 'classic' }, version: 0 })))

  // Снимаем классы В МОМЕНТ DOMContentLoaded, а не после — иначе замер поймает уже React.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      ;(window as any).__atDCL = document.documentElement.className
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const atDCL = await page.evaluate(() => (window as any).__atDCL)
  console.log('[boot] классы на DOMContentLoaded:', JSON.stringify(atDCL))

  await page.waitForLoadState('networkidle')
  const after = await page.evaluate(() => document.documentElement.className)
  console.log('[boot] классы после загрузки:', JSON.stringify(after))
  await page.evaluate(() => localStorage.removeItem('pm-tool-ui'))
  console.log('[boot] ошибки консоли:', JSON.stringify(errs))

  expect(atDCL, 'тёмная тема не встала до отрисовки').toContain('dark')
  expect(atDCL, 'Classic не встал до отрисовки').toContain('theme-classic')
  expect(errs).toEqual([])
})
