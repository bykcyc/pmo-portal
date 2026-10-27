import apiClient from './client'
import type { LoginPayload, TokenResponse, LoginResult, TotpSetup, UserResponse } from './authTypes'

// Типы вынесены в ./authTypes, чтобы разорвать тип-цикл authStore→auth→client→authStore.
// Ре-экспорт сохраняет обратную совместимость для тех, кто импортирует типы из '@/api/auth'.
export type { LoginPayload, TokenResponse, LoginResult, TotpSetup, UserResponse }

export async function login(payload: LoginPayload): Promise<LoginResult> {
  const { data } = await apiClient.post<LoginResult>('/auth/login', payload)
  return data
}

/** Второй шаг входа при включённой 2FA: challenge (из login) + 6-значный код. */
export async function verifyLoginTotp(challenge: string, code: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/login/totp', { challenge, code })
  return data
}

/** Начать настройку 2FA — вернёт QR + секрет (показать один раз). */
export async function startTotpSetup(): Promise<TotpSetup> {
  const { data } = await apiClient.post<{ data: TotpSetup }>('/me/2fa/setup')
  return data.data
}

/** Подтвердить настройку 2FA кодом из приложения + текущий пароль (re-auth) → включить. */
export async function enableTotp(code: string, password: string): Promise<void> {
  await apiClient.post('/me/2fa/enable', { code, password })
}

/** Отключить 2FA — требует текущий пароль. */
export async function disableTotp(password: string): Promise<void> {
  await apiClient.post('/me/2fa/disable', { password })
}

export async function getMe(): Promise<UserResponse> {
  const { data } = await apiClient.get<UserResponse>('/auth/me')
  return data
}

export async function updateMe(payload: { full_name?: string }): Promise<void> {
  await apiClient.put('/me', payload)
}

export async function changeMyPassword(current_password: string, new_password: string): Promise<void> {
  await apiClient.put('/me/password', { current_password, new_password })
}

export async function logoutSession(): Promise<void> {
  // серверный отзыв токена (best-effort — не блокируем выход при сетевой ошибке)
  try {
    await apiClient.post('/auth/logout')
  } catch {
    /* ignore */
  }
}
