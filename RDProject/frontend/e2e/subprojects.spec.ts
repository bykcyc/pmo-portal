import { test, expect } from '@playwright/test'

/**
 * Проект внутри проекта (фаза B) глазами человека: привязать модуль к программе, увидеть его
 * в сводке зонтика и в Портфеле под своим зонтиком, открыть разбор, отвязать.
 *
 * Спека работает на СВОИХ временных проектах и удаляет их в `finally`. Витринный проект 47
 * одиночный, и вешать на него подпроект нельзя: на нём стоят визуальные снимки.
 *
 * Коды начинаются с `TMP-E2E-`, чтобы остатки от упавшего прогона было видно с одного взгляда.
 *
 * ВАЖНО: набор запускается `--workers=1` (см. RDProject/CLAUDE.md). Параллельно с visual.spec
 * эта спека идти не должна — временные проекты попадут в снимки Портфеля и списка проектов.
 */

async function loginAs(page, email: string, password: string) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

async function dismissTwoFaGate(page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

/** Вызов API из контекста страницы — токен лежит в localStorage после логина. */
const apiOf = (page) => async (method: string, url: string, body?: unknown) =>
  page.evaluate(async ([method, url, body]) => {
    const token = JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.token
    const r = await fetch('/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, body: await r.text() }
  }, [method, url, body] as const)

test('подпроекты: связь, сводка зонтика, дерево в портфеле, отвязка', async ({ page }) => {
  test.setTimeout(150_000)

  await loginAs(page, 'owner@company.com', 'admin123')
  const api = apiOf(page)
  const made: string[] = []

  try {
    const umb = JSON.parse((await api('POST', '/projects', {
      code: 'TMP-E2E-UMB', name: 'E2E зонтик', status: 'active', project_kind: 'pilot',
    })).body).data
    made.push(String(umb.id))
    const sub = JSON.parse((await api('POST', '/projects', {
      code: 'TMP-E2E-SUB', name: 'E2E подпроект', status: 'active', project_kind: 'pilot',
    })).body).data
    made.push(String(sub.id))

    // ── вкладка «Подпроекты» у одиночного проекта видна тому, кто может их привязать
    //    (здесь это владелец портфеля). Ветку «детей нет и привязать некому» стережёт
    //    юнит-тест showsSubprojectsTab — через браузер до неё не добраться дёшево.
    const subprojectsTab = () =>
      page.getByRole('button', { name: /^подпроекты$|^subprojects$|^apakšprojekti$/i })
    await page.goto(`/projects/${sub.id}/passport`)
    await dismissTwoFaGate(page)
    await page.getByRole('button', { name: /^контроль$|^control$|^kontrole$/i }).first().click()
    await expect(subprojectsTab()).toBeVisible({ timeout: 10_000 })

    // ── привязка
    expect((await api('POST', `/projects/${umb.id}/subprojects`, { project_id: String(sub.id) })).status).toBe(200)

    // ── а вот у ПОДПРОЕКТА вкладки нет никогда: дерево одноуровневое, внуков не бывает
    await page.goto(`/projects/${sub.id}/passport`)
    await dismissTwoFaGate(page)
    await page.getByRole('button', { name: /^контроль$|^control$|^kontrole$/i }).first().click()
    await expect(subprojectsTab()).toHaveCount(0)

    // ── паспорт ребёнка знает про зонтик, паспорт зонтика — про количество детей
    const child = JSON.parse((await api('GET', `/projects/${sub.id}`)).body).data
    expect(String(child.parent_id)).toBe(String(umb.id))
    expect(child.parent_code).toBe('TMP-E2E-UMB')
    const parent = JSON.parse((await api('GET', `/projects/${umb.id}`)).body).data
    expect(parent.subprojects_count).toBe(1)

    // ── второй уровень запрещён: дерево ровно одноуровневое
    expect((await api('POST', `/projects/${sub.id}/subprojects`, { project_id: String(umb.id) })).status)
      .toBeGreaterThanOrEqual(409)

    // ── зонтик нельзя сделать шаблоном: он спрятался бы из списков вместе с живыми модулями
    expect((await api('POST', `/projects/${umb.id}/template`, { on: true })).status).toBe(422)

    // ── сводка на вкладке: строка модуля и разбор «что с проектом» по клику
    await page.goto(`/projects/${umb.id}/subprojects`)
    await dismissTwoFaGate(page)
    await expect(page.getByText('E2E подпроект')).toBeVisible({ timeout: 15_000 })
    // Кликаем ПЕРВУЮ ячейку строки (стрелка), а не название: название — ссылка на проект,
    // и она нарочно не раскрывает строку, а уводит внутрь.
    await page.getByRole('row', { name: /E2E подпроект/ }).getByRole('cell').first().click()
    await expect(page.getByText(/что с проектом|what.s wrong|kas ar projektu/i)).toBeVisible({ timeout: 10_000 })

    // ── в шапке ребёнка видно, частью чего он стал
    await page.goto(`/projects/${sub.id}/passport`)
    await dismissTwoFaGate(page)
    await expect(page.getByText(/TMP-E2E-UMB/).first()).toBeVisible({ timeout: 15_000 })

    // ── в Портфеле подпроект стоит ПОД своим зонтиком, а не где придётся
    await page.goto('/portfolio')
    await dismissTwoFaGate(page)
    // Группы по виду проекта свёрнуты по умолчанию — раскрываем «пилот», где лежат оба.
    await page.getByRole('button', { name: /пилот|pilot|pilotprojekt/i }).first().click({ timeout: 20_000 })
    await expect(page.getByText('E2E зонтик').first()).toBeVisible({ timeout: 20_000 })
    const order = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent || '')
      return {
        umb: rows.findIndex((t) => t.includes('E2E зонтик')),
        sub: rows.findIndex((t) => t.includes('E2E подпроект')),
      }
    })
    expect(order.umb).toBeGreaterThanOrEqual(0)
    expect(order.sub).toBe(order.umb + 1)

    // ── отвязка: связь снимается, проекты остаются
    expect((await api('DELETE', `/projects/${umb.id}/subprojects/${sub.id}`)).status).toBe(200)
    expect(JSON.parse((await api('GET', `/projects/${sub.id}`)).body).data.parent_id).toBeNull()

    // ── а теперь зонтиком быть некому — шаблон разрешён
    expect((await api('POST', `/projects/${umb.id}/template`, { on: true })).status).toBe(200)
    await api('POST', `/projects/${umb.id}/template`, { on: false })
  } finally {
    // Зонтик первым: ON DELETE SET NULL освобождает ребёнка, а не уносит его.
    for (const id of made) await api('DELETE', `/projects/${id}`)
  }
})
