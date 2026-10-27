/**
 * Карточка не выбрасывает набранное.
 *
 * Юнит-тесты карточек проверяют это на моках: что уходит в onSave и закрылась ли карточка.
 * Здесь проверяется то, чего мок показать не может, — что правка ДОЕХАЛА ДО СЕРВЕРА после
 * закрытия, и что жест мышью (нажал внутри, отпустил на затемнении) карточку не захлопывает:
 * в jsdom этого события нет вовсе, оно есть только в настоящем браузере.
 *
 * Все данные свои и временные; проект берётся не витринный, чтобы не попасть в визуальные эталоны.
 */
import { test, expect } from '@playwright/test'
import { apiLogin, auth, cleanupAll, openSection, pickProject, uiLogin, willDelete } from './helpers'

const TASK = 'ZZZ e2e карточка задачи'
const BL = 'ZZZ e2e пункт бэклога'

test.afterEach(async ({ request }) => { await cleanupAll(request) })

test('карточка задачи: закрытие сохраняет, жест мышью не закрывает, мусорная дата не уезжает', async ({ page, request }) => {
  // Много переходов и ожиданий подряд; параллельно идут тяжёлые файлы — 30 с не хватает.
  test.setTimeout(90_000)
  const token = await apiLogin(request)
  const H = auth(token)
  const pid = await pickProject(request, token)
  const task = (await (await request.post(`/api/projects/${pid}/tasks`, {
    headers: H,
    data: { title: TASK, task_type: 'task', description: 'Исходное описание.', status: 'in_progress',
            planned_start: '2026-09-01', planned_end: '2026-09-05' },
  })).json()).data
  const tid = String(task.id)
  willDelete(`/api/projects/${pid}/tasks/${tid}`, H)
  const fresh = async () => ((await (await request.get(`/api/projects/${pid}/tasks`, { headers: H })).json()).data ?? [])
    .find((t: { id: string }) => String(t.id) === tid)

  await uiLogin(page)
  await openSection(page, pid, 'wbs')

  // Карточку открывает ячейка «Описание» (её aria-label кончается названием задачи);
  // клик по НАЗВАНИЮ включил бы правку ячейки, а не карточку.
  const openCard = async () => {
    await page.getByRole('button', { name: new RegExp(`: ${TASK}$`) }).first().click()
    const dlg = page.getByRole('dialog').filter({ hasText: TASK })
    await expect(dlg).toBeVisible()
    return dlg
  }

  let dlg = await openCard()
  await dlg.getByRole('button', { name: /^Описание$|^Description$|^Apraksts$/ }).click()
  const area = dlg.locator('textarea').first()
  await expect(area).toBeVisible()
  await area.fill('Набрано и НЕ сохранено кнопкой.')
  await dlg.click({ position: { x: 6, y: 6 } })            // щелчок по затемнению
  await expect(dlg).toBeHidden()
  await expect.poll(async () => (await fresh())?.description, { timeout: 10_000 })
    .toBe('Набрано и НЕ сохранено кнопкой.')

  // Жест «выделил текст внутри, отпустил за краем панели»: браузер отдаёт click общему предку
  // начала и конца движения — то есть затемнению. С onClick карточка закрывалась.
  dlg = await openCard()
  const panel = dlg.locator('> div').first()
  const box = await panel.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(8, 8, { steps: 10 })
  await page.mouse.up()
  await expect(dlg).toBeVisible()

  // Escape в мини-форме «+ Добавить человека» отменяет только её: список живёт в портале
  // у самого body, а карточка слушает Escape на document.
  //
  // Клик по «Деталям» обязателен и БЕЗ .catch: карточка переоткрывается на вкладке «Описание»
  // (состояние вкладки переживает закрытие), а там combobox'а нет вовсе — отказ должен падать
  // здесь, а не тремя строками ниже с непонятным сообщением.
  await dlg.getByRole('button', { name: /^Детали$|^Details$|^Detaļas$/ }).click()
  const picker = dlg.locator('input[role="combobox"]').first()
  await picker.click()
  await picker.fill('ZZZНетТакого')
  const addBtn = page.locator('[role="option"]').filter({ hasText: /Добав|Add|Pievien/ }).first()
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  // Именно поле мини-формы: «первый input с placeholder» на странице — это поиск в шапке
  // раздела, он виден всегда, и такое ожидание не смогло бы упасть никогда.
  const firstName = page.getByPlaceholder(/^(Имя|First name|Vārds)$/i)
  await expect(firstName, 'мини-форма «+ Добавить человека» не открылась').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(firstName, 'Escape должен закрыть мини-форму').toHaveCount(0)
  await expect(dlg, 'и НЕ должен закрыть карточку').toBeVisible()

  // Недобранная дата наружу не уходит: поле отдаёт только полную дату или явную очистку.
  const before = await fresh()
  await dlg.locator('input[placeholder="дд.мм.гггг"]').first().fill('15.0')
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  expect((await fresh())?.planned_start).toBe(before?.planned_start)
})

test('карточка пункта бэклога: правка даты и сразу закрытие не откатывает её', async ({ page, request }) => {
  test.setTimeout(60_000)
  const token = await apiLogin(request)
  const H = auth(token)
  const pid = await pickProject(request, token)
  const item = (await (await request.post(`/api/projects/${pid}/backlog`, {
    headers: H, data: { title: BL, planned_start: '2026-09-01', planned_end: '2026-09-05', estimated_days: 5 },
  })).json()).data
  willDelete(`/api/projects/${pid}/backlog/${item.id}`, H)

  await uiLogin(page)
  await openSection(page, pid, 'backlog')
  await page.getByRole('button', { name: item.code }).first().click()
  const dlg = page.getByRole('dialog').filter({ hasText: BL })
  await expect(dlg).toBeVisible()

  // Поле «дней» — теневая копия значения формы. Пока копия не следовала за каскадом, закрытие
  // пересчитывало даты ОТ НЕЁ и откатывало только что выставленное окончание.
  await dlg.locator('input[placeholder="дд.мм.гггг"]').nth(1).fill('12.09.2026')
  await dlg.click({ position: { x: 6, y: 6 } })            // закрываем, не покидая поля
  await expect(dlg).toBeHidden()

  await expect.poll(async () => {
    const b = ((await (await request.get(`/api/projects/${pid}/backlog`, { headers: H })).json()).data ?? [])
      .find((x: { id: string }) => String(x.id) === String(item.id))
    return `${b?.planned_end} / ${b?.estimated_days}`
  }, { timeout: 10_000 }).toBe('2026-09-12 / 12')
})
