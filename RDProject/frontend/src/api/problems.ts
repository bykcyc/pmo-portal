import apiClient from './client'

export interface ProblemReport {
  id: string
  reporter_email: string
  reporter_name: string | null
  description: string
  page_url: string | null
  user_agent: string | null
  has_screenshot: boolean
  created_at: string
  /** open | resolved. Автор узнаёт о решении в колокольчике. */
  status?: string
  resolution?: string | null
  resolved_at?: string | null
  resolved_by?: string | null
}

/** Отправить баг-репорт. Любой залогиненный. Скриншот опционален (PNG blob из html2canvas). */
export async function createProblem(description: string, pageUrl: string, screenshot: Blob | null): Promise<void> {
  const form = new FormData()
  form.append('description', description)
  form.append('page_url', pageUrl)
  if (screenshot) form.append('screenshot', screenshot, 'screenshot.png')
  // Content-Type: undefined → axios сам поставит multipart с boundary
  await apiClient.post('/problems', form, { headers: { 'Content-Type': undefined } })
}

/** Список репортов — только владельцу портфеля (сервер проверяет роль). */
export async function getProblems(): Promise<ProblemReport[]> {
  const { data } = await apiClient.get<{ data: ProblemReport[] }>('/problems')
  return data.data
}

/**
 * Отметить проблему решённой — и сказать об этом автору.
 *
 * Не то же самое, что удалить: удаление уносит и жалобу, и возможность ответить. Человек,
 * нажавший «Сообщить о проблеме», до сих пор не узнавал о починке вообще ничего.
 */
export async function resolveProblem(id: string, resolution: string): Promise<void> {
  await apiClient.post(`/problems/${id}/resolve`, { resolution })
}

export async function deleteProblem(id: string): Promise<void> {
  await apiClient.delete(`/problems/${id}`)
}

/** Скриншот owner-only → тянем блоб С АВТОРИЗАЦИЕЙ (Bearer в axios-интерсепторе; `<img src>` его
 *  не пошлёт). Возвращаем object-URL — вызывающий обязан revokeObjectURL после показа. */
export async function fetchProblemScreenshot(id: string): Promise<string> {
  const r = await apiClient.get(`/problems/${id}/screenshot`, { responseType: 'blob' })
  return URL.createObjectURL(r.data as Blob)
}
