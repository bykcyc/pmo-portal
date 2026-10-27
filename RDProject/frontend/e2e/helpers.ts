/**
 * Общее для спек, которые работают на своих временных данных.
 *
 * Появился, когда три ручные пробы переезжали в гейт: у каждой была своя копия входа и своя
 * копия «закрыть гейт 2FA», и копии уже начинали расходиться. Старые спеки (crud, share, a11y…)
 * пока держат собственные копии — переводить их скопом рискованнее, чем оставить как есть;
 * НОВЫЕ спеки берут вход отсюда, чтобы копий не становилось больше.
 *
 * Файл не заканчивается на .spec.ts, поэтому Playwright не примет его за тест, а зеркало
 * раннера копирует все .ts — то есть он доедет (tools/e2e/sync_runner.py).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const PM = { email: 'pm1@company.com', password: 'pm123' }
export const OWNER = { email: 'owner@company.com', password: 'admin123' }

/** Витрина: на ней висят визуальные эталоны, поэтому временные данные туда не кладём. */
export const SHOWCASE = '47'

export async function apiLogin(request: APIRequestContext, who = PM): Promise<string> {
  const r = await request.post('/api/auth/login', { data: who })
  expect(r.ok(), 'вход по API').toBeTruthy()
  return (await r.json()).access_token
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/**
 * 2FA обязательна для всех, поэтому до её подключения портал держит модалку-гейт поверх
 * страницы — она перехватывает клики. Гейт монтируется заново после КАЖДОГО перехода и не
 * мгновенно, а после загрузки профиля: закрывать надо после каждого goto, и именно ожиданием,
 * а не мгновенной проверкой видимости.
 */
export async function dismissTwoFaGate(page: Page): Promise<void> {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

export async function uiLogin(page: Page, who = PM): Promise<void> {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill(who.email)
  await page.locator('input[type=password]').fill(who.password)
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

export async function openSection(page: Page, pid: string, section: string): Promise<void> {
  await page.goto(`/projects/${pid}/${section}`)
  await dismissTwoFaGate(page)
}

type Cleanup = { path: string; headers: Record<string, string> }
const trash: Cleanup[] = []

/**
 * Отложенная уборка. Копится здесь, а выносится в `test.afterEach` — НЕ в `finally` внутри теста:
 * когда тест упирается в свой бюджет времени, Playwright обрывает его тело, и `finally` не
 * выполняется вовсе. Осевший «ZZZ e2e …» проект потом лезет в кадр визуальных эталонов и
 * сбивает выбор проекта у соседних спек.
 *
 * Массив общий на прогон (в одном процессе модуль один), но `cleanupAll` опустошает его после
 * КАЖДОГО теста, а тесты идут по одному — пересечься нечему.
 */
export function willDelete(path: string, headers: Record<string, string>): void {
  trash.push({ path, headers })
}

export async function cleanupAll(request: APIRequestContext): Promise<void> {
  while (trash.length) {
    const t = trash.pop()!
    await request.delete(t.path, { headers: t.headers }).catch(() => {})
  }
}

/**
 * Проект для временных данных. Не витрина (её снимает visual.spec) и не чужой эфемерный
 * «ZZZ…» — share.spec такие создаёт и удаляет, и WBS исчезала бы под нами прямо на ходу.
 */
export async function pickProject(request: APIRequestContext, token: string): Promise<string> {
  const r = await request.get('/api/projects', { headers: auth(token) })
  const projects = ((await r.json()).data ?? []) as Array<{ id: string; code: string; name: string; status: string }>
  const stable = projects.filter((p) => p.status !== 'completed' && p.id !== SHOWCASE
    && p.code !== 'DEMO' && !/^ZZZ/i.test(p.name ?? '') && !/^ZZZ/i.test(p.code ?? ''))
  const target = stable[0] ?? projects.find((p) => p.id !== SHOWCASE) ?? projects[0]
  expect(target, 'на деве нет подходящего проекта').toBeTruthy()
  return String(target.id)
}
