import { test, expect, type Page } from '@playwright/test'

/* Справка на трёх языках: проверяем, что переключение языка интерфейса действительно
 * переключает КОНТЕНТ, а не только хром вокруг него.
 *
 * Главная ловушка, ради которой спека и написана: реестр `getWikiPages(lang)` подставляет
 * русскую страницу, если перевода нет. Это правильно для оглавления (оно остаётся полным),
 * но означает, что забытый файл перевода НИКАК не проявится — ни ошибкой, ни пустотой.
 * Поэтому здесь проверка «в тексте нет кириллицы», а не «страница открылась».
 */

const SLUGS = [
  'start', 'roles',
  'passport', 'team', 'wbs-gantt', 'kanban', 'baseline', 'assumptions', 'comm-plan',
  'kpis', 'stakeholders', 'risks', 'budget', 'meetings', 'reports', 'decisions', 'backlog',
  'projects', 'portfolio', 'portfolio-metrics', 'my-work', 'bitrix', 'assistant', 'profile', 'settings',
]

const LANGS = [
  { code: 'ru', group: 'Начало работы', startTitle: 'С чего начать', cyrillic: true },
  { code: 'lv', group: 'Darba sākums', startTitle: 'Ar ko sākt', cyrillic: false },
  { code: 'en', group: 'Getting started', startTitle: 'Where to start', cyrillic: false },
]

const CYRILLIC = /[Ѐ-ӿ]/

async function dismissTwoFaGate(page: Page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

test('справка открывается на всех трёх языках и переведена целиком', async ({ page }) => {
  test.setTimeout(300_000)

  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('owner@company.com')
  await page.locator('input[type=password]').fill('admin123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)

  for (const lang of LANGS) {
    // Язык выставляем ДО загрузки приложения: i18n читает localStorage один раз при init.
    // Скрипты накапливаются и выполняются в порядке регистрации — побеждает последний,
    // то есть язык текущей итерации, каким бы ни был порядок LANGS.
    await page.addInitScript(code => window.localStorage.setItem('i18nextLng', code), lang.code)

    await page.goto('/wiki')
    // Оглавление: группы переведены, все статьи на месте (сколько именно — считает SLUGS).
    await expect(page.getByText(lang.group, { exact: true }).first()).toBeVisible()
    const links = page.locator('nav a[href^="/wiki/"]')
    await expect(links).toHaveCount(SLUGS.length)

    for (const slug of SLUGS) {
      await page.goto(`/wiki/${slug}`)
      const article = page.locator('main')
      await expect(article, `${lang.code}/${slug}: пустая страница`).toContainText(/\S{20,}/)
      // У каждой статьи есть хотя бы один раздел — иначе отрендерился «каркас без блоков».
      await expect(article.locator('section[id] > h2').first(), `${lang.code}/${slug}: нет разделов`).toBeVisible()

      if (!lang.cyrillic) {
        const body = (await article.innerText()).replace(/Bitrix24?/g, '')
        expect(CYRILLIC.test(body), `${lang.code}/${slug}: русский текст в переводе`).toBe(false)
      }
    }

    await page.goto('/wiki/start')
    await expect(page.getByRole('heading', { name: lang.startTitle }).first()).toBeVisible()
  }

  expect(errors, 'ошибки в консоли').toEqual([])
})
