import apiClient from './client'

/**
 * Подключение помощника: страница согласия.
 *
 * Сюда человек попадает не по своей воле, а редиректом из ChatGPT/Claude, которые просят доступ.
 * Всё, что происходит на странице, — показать запрос и передать решение обратно; сам доступ
 * появляется только после «Разрешить», и только у того, кто вошёл в портал своей учётной записью.
 */
export interface ConsentRequest {
  id: string
  /** имя, которым назвался клиент; ему верить нельзя, он его придумывает сам */
  client_name: string
  /** куда уедет код — вот это подделать труднее, поэтому показываем рядом с именем */
  redirect_host: string
  scopes: string[]
  /** от чьего имени будет работать помощник */
  user_email: string
}

export async function getConsent(rid: string): Promise<ConsentRequest> {
  const { data } = await apiClient.get<{ data: ConsentRequest }>(`/oauth/consent/${rid}`)
  return data.data
}

export async function approveConsent(rid: string): Promise<string> {
  const { data } = await apiClient.post<{ data: { redirect_to: string } }>(`/oauth/consent/${rid}/approve`)
  return data.data.redirect_to
}

export async function denyConsent(rid: string): Promise<string> {
  const { data } = await apiClient.post<{ data: { redirect_to: string } }>(`/oauth/consent/${rid}/deny`)
  return data.data.redirect_to
}
