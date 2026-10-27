/**
 * Окно с полным текстом у обрезанной ячейки.
 *
 * Юнит-тесты держат логику на подменённых размерах: в jsdom высоты нулевые, и «влез / не влез»
 * там можно только сыграть. Здесь проверяется настоящая вёрстка — что текст в колонке
 * действительно обрезан, что окно поверх него не перехватывает мышь и что клик после наведения
 * по-прежнему открывает правку. Это и была главная просьба: «навёл — и уже не могу кликнуть»
 * не должно случаться.
 *
 * Проверяем СВОЮ строку, а не первую попавшуюся обрезанную: иначе гейт зависел бы от длины
 * чужих демо-подписей, а клик правкой уходил бы в живые данные проекта.
 */
import { test, expect } from '@playwright/test'
import { apiLogin, auth, cleanupAll, openSection, pickProject, uiLogin, willDelete } from './helpers'

const WHO = 'ZZZ e2e длинный текст'
const NOTES = 'ZZZ e2e: отвечает за приёмку и согласование бюджета, на связи через помощника '
  + 'по вторникам, в отпуске с 20 числа, замещает коллега из соседнего отдела'

test.afterEach(async ({ request }) => { await cleanupAll(request) })

test('длинный текст в ячейке показывается целиком и не мешает править', async ({ page, request }) => {
  test.setTimeout(60_000)
  const token = await apiLogin(request)
  const H = auth(token)
  const pid = await pickProject(request, token)
  const sh = (await (await request.post(`/api/projects/${pid}/stakeholders`, {
    headers: H, data: { name: WHO, role: 'Спонсор', notes: NOTES },
  })).json()).data
  willDelete(`/api/projects/${pid}/stakeholders/${sh.id}`, H)

  await uiLogin(page)
  await openSection(page, pid, 'stakeholders')

  // Своя строка, колонка «Заметки» — последняя текстовая ячейка в ней. 140 символов в колонке
  // шириной 130 px обрезаются гарантированно, поэтому это утверждение, а не поиск наугад.
  const row = page.locator('tr', { hasText: WHO })
  await expect(row).toHaveCount(1)
  const cell = row.locator('span[role="button"]').last()
  await expect(cell).toBeVisible()
  await expect.poll(async () => cell.evaluate(
    (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
  { message: 'ячейка «Заметки» не обрезана — проверять нечего' }).toBe(true)

  await cell.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('замещает коллега из соседнего отдела')   // именно ПОЛНЫЙ текст

  // Сердце правки: окно не ловит мышь. Иначе оно съело бы и клик, и подсветку ячейки.
  await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

  // Клик сразу после наведения обязан попасть в ячейку и открыть правку, а не упереться в окно.
  await cell.click()
  await expect(row.locator('input:focus')).toHaveCount(1)
  await page.keyboard.press('Escape')                 // отменяем правку, ничего не записывая
  await expect(row.locator('input:focus')).toHaveCount(0)

  await page.mouse.move(4, 4)
  await cell.hover()
  await expect(tip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
})
