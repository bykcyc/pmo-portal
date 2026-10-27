// Общие типы auth-слоя. Вынесены из api/auth.ts, чтобы разорвать тип-цикл
// authStore → auth → client → authStore. Замыкающее ребро было `import type`
// (стирается при сборке → рантайм-цикла не было), но так и тип-граф/линт
// import/no-cycle остаются чистыми. Файл содержит ТОЛЬКО типы — никакого рантайм-кода.

export interface LoginPayload {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

/** Ответ /auth/login: либо токен (без 2FA), либо запрос второго шага (twofa_required + challenge). */
export interface LoginResult {
  access_token?: string
  token_type?: string
  twofa_required?: boolean
  challenge?: string
}

/** Ответ /me/2fa/setup — показываем один раз (QR + секрет для ручного ввода). */
export interface TotpSetup {
  secret: string
  otpauth_uri: string
  qr_data_uri: string
}

export interface UserResponse {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  bitrix24_user_id: number | null
  /** Двухфакторная аутентификация настроена. */
  twofa_enabled: boolean
  /** 2FA обязательна для этого пользователя (сейчас — для всех). */
  twofa_required: boolean
  /** Крайний срок настройки 2FA (ISO) — после него доступ блокируется; null если 2FA включена. */
  twofa_grace_until: string | null
}
