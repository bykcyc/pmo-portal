/**
 * Копирование в буфер обмена с фолбэком для НЕ-secure-context.
 *
 * `navigator.clipboard` существует только в secure context (HTTPS или localhost). В незащищённом
 * контексте (обычный HTTP) его нет вовсе — обращение к нему бросает TypeError,
 * и пользователь видел «Что-то пошло не так» вместо копирования. Поэтому: сначала пробуем
 * штатный async-API там, где он есть, иначе — старый `execCommand('copy')` через скрытую textarea,
 * который работает и по HTTP.
 *
 * Возвращает true при успехе — вызывающий сам решает, какой тост показать.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // падаем в фолбэк ниже (например, отказ разрешения)
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // Убираем из потока и с экрана, но оставляем выделяемым (display:none ломает execCommand).
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
