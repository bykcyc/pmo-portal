/**
 * 2FA-фронт: гейт-модалка (закрываемость зависит от грейса) и флоу привязки (setup → код → enable).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TwoFactorGate from './TwoFactorGate'
import TwoFactorEnroll from './TwoFactorEnroll'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string; n?: number }) => o?.defaultValue ?? k }),
}))

const getMe = vi.fn()
const startTotpSetup = vi.fn()
const enableTotp = vi.fn()
vi.mock('@/api/auth', () => ({
  getMe: () => getMe(),
  startTotpSetup: () => startTotpSetup(),
  enableTotp: (code: string, password: string) => enableTotp(code, password),
}))

vi.mock('@/store/toastStore', () => ({ useToastStore: () => vi.fn() }))

let mockUser: Record<string, unknown> | null = null
const setUser = vi.fn()
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: mockUser, setUser }),
}))

const base = { id: 'u', email: 'a@b', full_name: 'A', role: 'pm', is_active: true, bitrix24_user_id: null }

describe('TwoFactorGate', () => {
  beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

  it('не показывается, когда 2FA уже включена', () => {
    mockUser = { ...base, twofa_enabled: true, twofa_required: true, twofa_grace_until: null }
    render(<TwoFactorGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('в пределах грейса — закрываемая (есть кнопка закрытия)', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
    mockUser = { ...base, twofa_enabled: false, twofa_required: true, twofa_grace_until: future }
    render(<TwoFactorGate />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('Закрыть')).toBeTruthy()
  })

  it('после истечения грейса — блокирующая (кнопки закрытия нет)', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    mockUser = { ...base, twofa_enabled: false, twofa_required: true, twofa_grace_until: past }
    render(<TwoFactorGate />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByLabelText('Закрыть')).toBeNull()
  })
})

describe('TwoFactorEnroll', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('setup → показывает QR и секрет, ввод кода → enable + onDone', async () => {
    startTotpSetup.mockResolvedValue({ secret: 'ABCDEF', otpauth_uri: 'otpauth://totp/x', qr_data_uri: 'data:image/svg+xml;base64,PHN2Zz4=' })
    enableTotp.mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<TwoFactorEnroll onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Настроить 2FA' }))
    await waitFor(() => expect(screen.getByText('ABCDEF')).toBeTruthy())
    // QR отрисован как data-URI (без внешних запросов)
    expect((document.querySelector('img') as HTMLImageElement).src).toContain('data:image/svg+xml;base64,')

    fireEvent.change(screen.getByLabelText('Код из приложения'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('Подтвердите паролем'), { target: { value: 'mypass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
    await waitFor(() => expect(enableTotp).toHaveBeenCalledWith('123456', 'mypass'))
    expect(onDone).toHaveBeenCalled()
  })

  it('нецифры в коде отсекаются, короткий код не отправляется', async () => {
    startTotpSetup.mockResolvedValue({ secret: 'S', otpauth_uri: 'u', qr_data_uri: 'data:,' })
    render(<TwoFactorEnroll onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настроить 2FA' }))
    const input = await screen.findByLabelText('Код из приложения') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12ab' } })
    expect(input.value).toBe('12')  // буквы отсечены
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
    expect(enableTotp).not.toHaveBeenCalled()  // <6 цифр — не отправляем
  })
})
