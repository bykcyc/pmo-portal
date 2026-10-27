import { test, expect } from '@playwright/test'

// Публичный share (анонимный ?share=<токен> на обычных эндпоинтах) НЕ должен отдавать контактный
// PII. Тесты идут через API (request), создают одноразовый ZZZ-проект и прибирают за собой в finally
// (никаких мутаций витрины). Ловят регресс, если редакцию public-пути когда-нибудь снимут/сломают.

const PM = { email: 'pm1@company.com', password: 'pm123' }
const SECRET_EMAIL = 'e2e-share-secret@example.com'
const SECRET_PHONE = '+37100000000'

async function auth(request) {
  const r = await request.post('/api/auth/login', { data: PM })
  return { Authorization: `Bearer ${(await r.json()).access_token}` }
}

// одноразовый проект + участник команды с email/phone + опубликованный раздел «team»
async function setupSharedProject(request, headers) {
  const cr = await request.post('/api/projects', { headers, data: { name: 'ZZZ share e2e', code: 'ZZZSHARE' } })
  expect(cr.ok(), 'project created').toBeTruthy()
  const pid = String((await cr.json()).data.id)
  await request.post(`/api/projects/${pid}/team`, {
    headers, data: { name: 'E2E Person', role: 'Dev', email: SECRET_EMAIL, phone: SECRET_PHONE },
  })
  const sh = await request.post(`/api/projects/${pid}/share`, { headers, data: { enabled: true, sections: ['team'] } })
  expect(sh.ok(), 'share enabled').toBeTruthy()
  const token = (await sh.json()).data.token as string
  expect(token, 'share token issued').toBeTruthy()
  return { pid, token }
}

test('public share of a published section hides contact PII (email/phone)', async ({ request }) => {
  const headers = await auth(request)
  const { pid, token } = await setupSharedProject(request, headers)
  try {
    // анонимно (без Bearer) по share-токену — раздел виден, но БЕЗ контактов
    const pub = await request.get(`/api/projects/${pid}/team`, { params: { share: token } })
    expect(pub.status()).toBe(200)
    const items = (await pub.json()).data as Array<Record<string, unknown>>
    expect(items.length).toBe(1)
    expect(items[0].name).toBe('E2E Person')     // имя/роль публичному зрителю видны
    expect(items[0].email).toBeUndefined()        // контактный PII вырезан
    expect(items[0].phone).toBeUndefined()
    // тот же раздел под аутентифицированным владельцем — контакты ВИДНЫ (редакция только для public)
    const priv = await request.get(`/api/projects/${pid}/team`, { headers })
    const privItems = (await priv.json()).data as Array<Record<string, unknown>>
    expect(privItems[0].email).toBe(SECRET_EMAIL)
    expect(privItems[0].phone).toBe(SECRET_PHONE)
  } finally {
    await request.delete(`/api/projects/${pid}`, { headers })
  }
})

test('public share token does not expose an unpublished section', async ({ request }) => {
  const headers = await auth(request)
  const { pid, token } = await setupSharedProject(request, headers) // опубликован только team
  try {
    // тем же токеном тянем НЕопубликованный раздел stakeholders → публичного не минтит, нет auth → 401
    const denied = await request.get(`/api/projects/${pid}/stakeholders`, { params: { share: token } })
    expect(denied.status()).toBe(401)
  } finally {
    await request.delete(`/api/projects/${pid}`, { headers })
  }
})
