import { test, expect } from '@playwright/test'

async function loginAs(page, email: string, password: string) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL('**/projects**')
  await dismissTwoFaGate(page)
}

// 2FA обязательна для всех, поэтому до её подключения портал держит модалку-гейт поверх
// страницы — она перехватывает клики. Гейт монтируется заново после КАЖДОГО перехода и
// не мгновенно, а после загрузки профиля, поэтому закрывать надо после каждого goto.
async function dismissTwoFaGate(page) {
  const gate = page.getByRole('dialog').filter({ hasText: /двухфакторн|two-factor|divfaktoru/i })
  const visible = await gate.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
  if (!visible) return
  await gate.getByRole('button', { name: /закрыть|close|aizvērt/i }).click().catch(() => {})
  await gate.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
}

test('WBS task CRUD round-trip via UI (pm1)', async ({ page, request }) => {
  // Дефолтные 30с этому тесту мало НЕ из-за портала: в одиночку он проходит за ~7с, но файлы
  // гоняются параллельно, и visual.spec 3.5 минуты грузит дев снимками — логин+переход+WBS
  // не успевают. Ставим запас; если тест начнёт падать и с ним — это уже настоящая регрессия.
  test.setTimeout(90_000)
  // Аудит№5: полный круг создать→править→удалить через UI (раньше CRUD был покрыт только API-тестами).
  // Проект НЕ хардкодим по id: id движка OpenProject меняются при ре-миграции (раньше стоял /projects/3,
  // который после ресида исчез). Находим редактируемый проект pm1 динамически через API и прибираем за собой.
  const login = await request.post('/api/auth/login', { data: { email: 'pm1@company.com', password: 'pm123' } })
  const token = (await login.json()).access_token
  const pr = await request.get('/api/projects', { headers: { Authorization: `Bearer ${token}` } })
  const projects = ((await pr.json()).data ?? []) as Array<{ id: string; code: string; name: string; status: string }>
  const editable = projects.filter((p) => p.status !== 'completed')
  // Выбор проекта ДЕТЕРМИНИРОВАННЫЙ, и оба условия оплачены реальными падениями:
  //  • не витрина 47 — её снимает visual.spec, и CRUD-задача попала бы в кадр;
  //  • не эфемерные проекты других тестов — share.spec создаёт «ZZZ share e2e» под тем же pm1
  //    и удаляет его в finally. Пока на деве было много проектов, «первый из списка» почти всегда
  //    попадал на стабильный; после чистки (остались 47 и 177) выбор стал падать на чужой
  //    временный, share его сносил — и WBS под нами исчезала.
  const SHOWCASE = '47'
  const stable = (p: { id: string; code: string; name?: string }) =>
    p.id !== SHOWCASE && p.code !== 'DEMO' && !/^ZZZ/i.test(p.name ?? '') && !/^ZZZ/i.test(p.code ?? '')
  const target = editable.find(stable) ?? editable.find((p) => p.id !== SHOWCASE) ?? editable[0] ?? projects[0]
  expect(target, 'pm1 has at least one editable project').toBeTruthy()
  const pid = target.id

  await loginAs(page, 'pm1@company.com', 'pm123')
  await page.goto(`/projects/${pid}/wbs`)
  await dismissTwoFaGate(page)   // гейт монтируется заново на каждой странице

  // Ждём, пока ProjectDetailPage догрузит проект и WBS отрендерит панель статистики
  // (она показывается всегда). Только после этого canWrite вычислен и тулбар с кнопками виден.
  await expect(page.getByText(/Всего|Total/i).first()).toBeVisible({ timeout: 30000 })
  const addBtn = page.getByRole('button', { name: /Добавить задачу|Add Task/i })
  await expect(addBtn.first()).toBeVisible({ timeout: 15000 })

  // CREATE: появляется строка с дефолтным названием
  await addBtn.first().click()
  const newRow = page.locator('tr', { hasText: /Новая задача|New task/i }).first()
  await expect(newRow).toBeVisible()

  // UPDATE: инлайн-переименование (клик по названию → input aria-label «Изменить значение» → Enter)
  await newRow.getByText(/Новая задача|New task/i).first().click()
  const editInput = page.getByLabel('Изменить значение')
  await editInput.fill('e2e задача CRUD')
  await editInput.press('Enter')
  const row = page.locator('tr', { hasText: 'e2e задача CRUD' })
  await expect(row).toBeVisible()

  // DELETE: иконка в строке → confirm-диалог → строки нет (заодно уборка)
  await row.hover()
  await row.getByRole('button', { name: /^Удалить$|^Delete$/i }).click()
  // кнопка подтверждения теперь локализована (было хардкод «Confirm») — ищем в самом диалоге
  await page.getByRole('dialog').getByRole('button', { name: /^(Удалить|Delete|Dzēst)$/i }).click()
  await expect(page.locator('tr', { hasText: 'e2e задача CRUD' })).toHaveCount(0)
})
