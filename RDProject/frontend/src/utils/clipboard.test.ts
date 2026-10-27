import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard } from './clipboard'

/**
 * Ключевой кейс — НЕ-secure-context (обычный HTTP), где navigator.clipboard отсутствует.
 * Именно там раньше падало в «Что-то пошло не так»; теперь должен срабатывать execCommand-фолбэк.
 */
describe('copyToClipboard', () => {
  const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const origSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext')

  const setSecure = (v: boolean) =>
    Object.defineProperty(window, 'isSecureContext', { value: v, configurable: true })
  const setClipboard = (c: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true })
  // jsdom НЕ реализует execCommand, поэтому spyOn на него падает — задаём метод напрямую как мок.
  const mockExec = (ret: boolean) => {
    const fn = vi.fn().mockReturnValue(ret)
    ;(document as unknown as { execCommand: unknown }).execCommand = fn
    return fn
  }

  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
    if (origSecure) Object.defineProperty(window, 'isSecureContext', origSecure)
    delete (document as unknown as { execCommand?: unknown }).execCommand
  })

  it('secure context: пишет через navigator.clipboard', async () => {
    setSecure(true)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const exec = mockExec(true)

    expect(await copyToClipboard('https://x/pub/abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://x/pub/abc')
    expect(exec).not.toHaveBeenCalled()   // фолбэк не задействован
  })

  it('НЕ-secure (http://IP): clipboard отсутствует → фолбэк execCommand', async () => {
    setSecure(false)
    setClipboard(undefined)
    const exec = mockExec(true)

    expect(await copyToClipboard('http://ip/pub/abc')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('фолбэк вернул false → общий провал (покажем тост-ошибку)', async () => {
    setSecure(false)
    setClipboard(undefined)
    mockExec(false)

    expect(await copyToClipboard('http://ip/pub/abc')).toBe(false)
  })

  it('secure-API бросил → мягко падаем в фолбэк, а не в ошибку', async () => {
    setSecure(true)
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    const exec = mockExec(true)

    expect(await copyToClipboard('https://x/pub/abc')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })
})
