import { test, expect } from '@playwright/test'

/**
 * Сводный бюджет по дереву — весь путь, ради которого делалась фаза C: ставка на общем
 * проекте → блок в часах → подпроект относит к нему свою статью → факт часами → остаток.
 *
 * Спека работает на СВОИХ временных проектах и удаляет их в `finally`. Это единственный
 * безопасный способ проверить дерево: витринный проект 47 одиночный, а вешать на него
 * подпроект значило бы двигать данные, на которых стоят визуальные снимки.
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

test('сводный бюджет: часы, ставка и остаток по блоку зонтика', async ({ page }) => {
  test.setTimeout(120_000)   // как у crud.spec: файлы гоняются вместе с visual.spec

  await loginAs(page, 'owner@company.com', 'admin123')
  const api = apiOf(page)
  const made: string[] = []

  try {
    const umb = JSON.parse((await api('POST', '/projects', {
      code: 'TMP-E2E-PRG', name: 'E2E программа', status: 'active',
    })).body).data
    made.push(String(umb.id))
    const sub = JSON.parse((await api('POST', '/projects', {
      code: 'TMP-E2E-MOD', name: 'E2E модуль', status: 'active',
    })).body).data
    made.push(String(sub.id))
    await api('POST', `/projects/${umb.id}/subprojects`, { project_id: String(sub.id) })

    // ── ставка часа задаётся ЧЕРЕЗ ЭКРАН: это единственное поле бюджета с проверкой, и
    //    важно, что отказ сервера доходит до человека, а не тонет.
    await page.goto(`/projects/${umb.id}/budget`)
    await dismissTwoFaGate(page)
    await page.getByRole('button', { name: /задать|set|norādīt/i }).first().click()
    await page.getByLabel(/ставка часа|hourly rate|stundas likme/i).fill('50')
    await page.getByRole('button', { name: /сохранить|save|saglabāt/i }).first().click()
    await expect(page.getByText(/50 EUR\/(ч|h)/)).toBeVisible({ timeout: 10_000 })

    // ── часы превращаются в деньги СЕРВЕРОМ при записи
    const block = JSON.parse((await api('POST', `/projects/${umb.id}/budget-items`, {
      name: 'Блок А', category: 'implementation', planned_hours: 800,
    })).body).data
    expect(block.amount).toBe(40000)

    const mine = JSON.parse((await api('POST', `/projects/${sub.id}/budget-items`, {
      name: 'Работы блока А', category: 'implementation',
    })).body).data

    // ── подпроект видит блоки зонтика и относит к ним свою статью
    await page.goto(`/projects/${sub.id}/budget`)
    await dismissTwoFaGate(page)
    await expect(page.getByText(/взято из бюджета|taken from the parent|ņemts no kopprojekta/i)).toBeVisible()
    await page.locator('select').last().selectOption({ index: 1 })
    await expect.poll(async () => {
      const items = JSON.parse((await api('GET', `/projects/${sub.id}/budget-items`)).body).data
      return items.find((i) => i.id === mine.id)?.parent_item_id
    }, { timeout: 10_000 }).toBe(block.id)

    // ── факт часами: 120 ч × 50 = 6000 считает сервер
    await api('PUT', `/projects/${sub.id}/budget-items/${mine.id}/monthly`, {
      entries: [{ year: 2026, month: 8, actual_hours: 120 }],
    })
    const after = JSON.parse((await api('GET', `/projects/${sub.id}/budget-items`)).body).data
      .find((i) => i.id === mine.id)
    expect(after.monthly.find((e) => Number(e.month) === 8).actual).toBe(6000)

    // ── привязка НИЧЕГО не обнуляет: свой факт подпроекта на месте
    const own = JSON.parse((await api('GET', `/projects/${sub.id}/budget-summary`)).body).data
    expect(own.expense_actual).toBe(6000)

    // ── у зонтика — остаток по блоку, и он виден на экране
    const tree = JSON.parse((await api('GET', `/projects/${umb.id}/budget-consolidated`)).body).data
    const b = tree.blocks.find((x) => x.item_id === block.id)
    expect(b.planned).toBe(40000)
    expect(b.consumed_by_children).toBe(6000)
    expect(b.remaining).toBe(34000)

    await page.goto(`/projects/${umb.id}/budget`)
    await dismissTwoFaGate(page)
    await expect(page.getByText(/распределение по подпроектам|split across subprojects|sadalījums pa apakš/i))
      .toBeVisible({ timeout: 10_000 })
    // toLocaleString разделяет разряды НЕРАЗРЫВНЫМ пробелом — сравнивать по нормализованному тексту.
    const text = (await page.locator('body').innerText()).replace(/[  \s]+/g, ' ')
    expect(text).toContain('34 000')
  } finally {
    for (const id of [...made].reverse()) await api('DELETE', `/projects/${id}`)
  }
})
