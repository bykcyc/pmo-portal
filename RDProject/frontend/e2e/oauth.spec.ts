import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/*
 * Подключение помощника по OAuth — единственный путь, которым внешний клиент получает доступ
 * к данным портала, поэтому здесь проверяется не «страница открылась», а сами гарантии:
 * чужой адрес возврата не обслуживается, чужой клиент не обменяет код, повтор кода не проходит.
 * Всё через API + один проход по странице согласия глазами браузера.
 */

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
// PKCE-пара из примера RFC 7636: в спеке нет крипто-зависимостей, а значения проверяемые.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

async function seedUi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pm-tool-ui', JSON.stringify({
      state: { sidebarCollapsed: false, rightPanelCollapsed: false, focusMode: false, theme: 'light', skin: 'rd' },
      version: 0,
    }))
  })
}

async function registerClient(request: APIRequestContext, name = 'Claude', uris = [REDIRECT]) {
  const r = await request.post('/api/oauth/register', {
    data: {
      client_name: name, redirect_uris: uris, grant_types: ['authorization_code'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    },
  })
  expect(r.status(), 'клиент зарегистрирован').toBe(201)
  return (await r.json()).client_id as string
}

async function authorize(request: APIRequestContext, clientId: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'probe',
    scope: 'read draft', ...extra,
  })
  return request.get(`/api/oauth/authorize?${q}`, { maxRedirects: 0 })
}

async function pmToken(request: APIRequestContext) {
  const r = await request.post('/api/auth/login', { data: { email: 'pm1@company.com', password: 'pm123' } })
  return (await r.json()).access_token as string
}

/** Полный путь до кода авторизации: регистрация -> authorize -> человек нажал «Разрешить». */
async function codeFor(request: APIRequestContext, clientId: string) {
  const res = await authorize(request, clientId)
  const rid = new URL(res.headers()['location']).searchParams.get('rid')!
  const jwt = await pmToken(request)
  const ok = await request.post(`/api/oauth/consent/${rid}/approve`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  expect(ok.status()).toBe(200)
  const back = new URL((await ok.json()).data.redirect_to)
  expect(back.searchParams.get('state'), 'state вернулся нетронутым').toBe('probe')
  return { code: back.searchParams.get('code')!, rid }
}

test('метаданные замыкают цепочку обнаружения', async ({ request }) => {
  const unauth = await request.post('/api/mcp', {
    headers: { Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  })
  expect(unauth.status(), 'без токена — 401, а не 404/421').toBe(401)
  expect(unauth.headers()['www-authenticate'] || '', 'заголовок называет метаданные ресурса')
    .toContain('resource_metadata=')

  const prm = await request.get('/api/.well-known/oauth-protected-resource/mcp')
  expect(prm.status()).toBe(200)
  const asUrl = (await prm.json()).authorization_servers[0] as string
  expect(asUrl.endsWith('/'), 'издатель без хвостового слэша (сравнение побайтовое)').toBeFalsy()

  const meta = await request.get('/api/.well-known/oauth-authorization-server')
  expect(meta.status()).toBe(200)
  const m = await meta.json()
  expect(m.code_challenge_methods_supported).toEqual(['S256'])
  expect(m.registration_endpoint, 'без самостоятельной регистрации клиент не подключится').toBeTruthy()
})

test('человек подтверждает — клиент получает рабочий токен', async ({ request }) => {
  const cid = await registerClient(request)
  const { code } = await codeFor(request, cid)

  const tok = await request.post('/api/oauth/token', {
    form: { grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: VERIFIER },
  })
  expect(tok.status()).toBe(200)
  const access = (await tok.json()).access_token as string

  const mcp = await request.post('/api/mcp', {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  })
  expect(mcp.status(), 'полученным токеном помощник входит').toBe(200)

  // Повторный обмен тем же кодом обязан провалиться (RFC 6749: код одноразовый).
  const again = await request.post('/api/oauth/token', {
    form: { grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: VERIFIER },
  })
  expect(again.status()).toBe(400)

  // Отзыв клиентом гасит токен и у нас: «отключил коннектор» должно значить то, что значит.
  const rev = await request.post('/api/oauth/revoke', { form: { token: access, client_id: cid, client_secret: '' } })
  expect(rev.status()).toBe(200)
  const after = await request.post('/api/mcp', {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  })
  expect(after.status(), 'после отзыва — 401').toBe(401)
})

test('незарегистрированный адрес возврата не обслуживается', async ({ request }) => {
  const cid = await registerClient(request)
  const res = await authorize(request, cid, { redirect_uri: 'https://evil.example/steal' })
  expect(res.status(), 'ошибка отдаётся на месте, а не редиректом на чужой адрес').toBe(400)
  expect(res.headers()['location'], 'редиректа нет вовсе').toBeUndefined()
})

test('чужой клиент не обменяет чужой код, а неверный verifier не пройдёт', async ({ request }) => {
  const cid = await registerClient(request)
  const { code } = await codeFor(request, cid)

  const evil = await registerClient(request, 'Злоумышленник', ['https://evil.example/cb'])
  const stolen = await request.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code', code, client_id: evil,
      redirect_uri: 'https://evil.example/cb', code_verifier: VERIFIER,
    },
  })
  expect(stolen.status()).toBe(400)

  const badPkce = await request.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT,
      code_verifier: 'sovsem-drugoj-verifier-dostatochno-dlinnyj-nabor-simvolov',
    },
  })
  expect(badPkce.status()).toBe(400)
})

test('токен просят только для нашего ресурса', async ({ request }) => {
  const cid = await registerClient(request)
  const res = await authorize(request, cid, { resource: 'https://evil.example/mcp' })
  const loc = res.headers()['location'] || ''
  expect(new URL(loc).searchParams.get('error')).toBe('invalid_target')
})

test('согласие требует входа в портал и возвращает человека обратно', async ({ page, request }) => {
  const cid = await registerClient(request)
  const res = await authorize(request, cid)
  const rid = new URL(res.headers()['location']).searchParams.get('rid')!

  await seedUi(page)
  await page.goto(`/connect?rid=${rid}`)
  await page.waitForURL('**/login', { timeout: 15000 })              // не вошёл → на вход
  await page.getByPlaceholder('you@company.com').fill('pm1@company.com')
  await page.locator('input[type=password]').fill('pm123')
  await page.getByRole('button', { name: /sign in|войти/i }).click()
  await page.waitForURL(`**/connect?rid=${rid}`, { timeout: 30000 }) // и обратно, не на список проектов

  await page.waitForTimeout(1200)
  await expect(page.getByText('claude.ai'), 'виден адрес возврата, а не только имя').toBeVisible()
  await expect(page.getByText('pm1@company.com'), 'видно, от чьего имени').toBeVisible()

  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.flatMap((v) => v.nodes).map((n) => n.html.slice(0, 90)), 'контраст на странице согласия').toEqual([])
})
