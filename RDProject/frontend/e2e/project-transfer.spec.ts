/**
 * Руководитель проекта сам отдаёт СВОЙ проект и остаётся со-РП.
 *
 * Серверная часть закрыта юнит-тестами. Здесь то, чего они не видят: кнопка вообще ПОКАЗЫВАЕТСЯ
 * руководителю и поле «Руководитель проекта» в паспорте ему доступно (оба условия — фронтовые),
 * а список кандидатов НЕ ПУСТ — он приходит с отдельного маршрута, и, пока диалог брал людей
 * из маршрута владельца портфеля, у РП он открывался бы пустым и кнопка была бы декорацией.
 *
 * Проект свой, временный; удаляет его владельческая учётка — после передачи у РП уже нет права.
 */
import { test, expect } from '@playwright/test'
import { apiLogin, auth, cleanupAll, dismissTwoFaGate, OWNER, uiLogin, willDelete } from './helpers'

test.afterEach(async ({ request }) => { await cleanupAll(request) })

test('РП передаёт свой проект и остаётся со-РП', async ({ page, request }) => {
  test.setTimeout(60_000)
  const token = await apiLogin(request)
  const H = auth(token)
  const OH = auth(await apiLogin(request, OWNER))
  const me = await (await request.get('/api/auth/me', { headers: H })).json()
  const created = (await (await request.post('/api/projects', {
    headers: H, data: { name: 'ZZZ e2e передача', code: 'ZZZTR', status: 'planning' },
  })).json()).data
  const pid = String(created.id)
  // Удаляет владелец портфеля: после передачи у создателя уже нет права снести проект.
  willDelete(`/api/projects/${pid}`, OH)
  // Создатель становится РП сам: вписать другого при создании нельзя (сервер перетирает).
  expect(String(created.pm_id)).toBe(String(me.id))

  await uiLogin(page)
  await page.goto(`/projects/${pid}/passport`)
  await dismissTwoFaGate(page)

  const btn = page.getByRole('button', { name: /Передать РП|Nodot projektu|Hand over/i })
  await expect(btn, 'кнопка передачи видна руководителю своего проекта').toBeVisible()
  // Второе условие того же изменения, и оно чисто фронтовое: у основного РП поле «Руководитель
  // проекта» в паспорте — живой выбор, а не серая строка. Сузят право обратно до владельца
  // портфеля — кнопка останется, а поле умрёт, и без этой проверки гейт смолчит.
  await expect(page.getByRole('combobox', { name: /Руководитель проекта|Projekta vadītājs|Project manager/i }),
    'поле «Руководитель проекта» в паспорте доступно основному РП').toBeVisible()

  await btn.click()
  const dlg = page.getByRole('dialog').filter({ hasText: /Передать проект|Nodot projektu|Hand over/i }).first()
  await expect(dlg).toBeVisible()
  // Предупреждение о со-РП должно стоять ДО нажатия: иначе «Передать» читается как
  // «потерять проект насовсем».
  await expect(dlg).toContainText(/со-РП|līdzvadītāj|co-manager/i)

  const select = dlg.locator('select')
  // Сначала утверждаем, что кандидаты есть: иначе чтение value просто ждало бы минуту и упало
  // с «locator.getAttribute: Timeout», ничего не объяснив.
  await expect(select.locator('option'), 'список кандидатов пуст — значит пришёл не с того маршрута')
    .not.toHaveCount(1)
  const target = await select.locator('option').nth(1).getAttribute('value')
  await select.selectOption(target!)
  await dlg.getByRole('button', { name: /^(Передать|Nodot|Hand over)$/i }).click()
  await expect(dlg).toBeHidden()

  await expect.poll(async () =>
    String(((await (await request.get(`/api/projects/${pid}`, { headers: OH })).json()).data ?? {}).pm_id),
  { timeout: 10_000 }).toBe(String(target))

  // Отдал сам — остался со-РП: иначе человек теряет доступ к собственному проекту, и вернуть
  // его может только владелец портфеля.
  const editors = (await (await request.get(`/api/projects/${pid}/editors`, { headers: OH })).json()).data ?? []
  expect(editors.map((e: { id: string }) => String(e.id))).toContain(String(me.id))
})
