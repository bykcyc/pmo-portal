import apiClient from './client'
import type { UserListItem } from '@/types/user'

export async function getUsers(): Promise<UserListItem[]> {
  // GET /users отдаёт голый массив (байт-контракт), а не {data:[…]} как остальные эндпоинты.
  const { data } = await apiClient.get<UserListItem[]>('/users')
  return data
}

export interface AdminUser {
  id: string
  email: string
  full_name: string
  role: string
  bitrix24_user_id: number | null
  is_active: boolean
  created_at: string
  twofa_enabled: boolean
  /** До какого момента можно работать БЕЗ 2FA. null — ограничения нет (2FA включена или человек
   *  ещё не входил). Дата в прошлом — доступ к данным закрыт до подключения 2FA. */
  twofa_grace_until: string | null
  /** Когда синк людей погасил вход: в Bitrix24 сотрудник больше не активен. Поле есть только
   *  у таких учёток. Владелец включает вход обратно обычным «Активен» — и синк его больше не трогает. */
  offboarded_at?: string
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const { data } = await apiClient.get<{ data: AdminUser[] }>('/admin/users')
  return data.data
}

export async function createAdminUser(payload: {
  email: string; full_name: string; role: string; bitrix24_user_id?: number | null
  /** Либо задаём пароль руками, либо просим сервер сгенерировать (generate_password). */
  password?: string
  generate_password?: boolean
  /** Заводим логин человеку из справочника: сервер свяжет обе стороны сразу, и «Мои задачи»
   *  заработают, не дожидаясь ночного синка. */
  person_id?: string
}): Promise<{ user: AdminUser; generatedPassword?: string }> {
  const { data } = await apiClient.post<{ data: AdminUser; generated_password?: string }>('/admin/users', payload)
  // Пароль приходит РОВНО ОДИН РАЗ и дальше нигде не хранится: ни в кэше, ни в localStorage.
  return { user: data.data, generatedPassword: data.generated_password }
}

export async function updateAdminUser(id: string, payload: Record<string, unknown>): Promise<AdminUser> {
  const { data } = await apiClient.put<{ data: AdminUser }>(`/admin/users/${id}`, payload)
  return data.data
}

export async function changeUserPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.put(`/admin/users/${id}/password`, { new_password: newPassword })
}

export async function deleteAdminUser(id: string): Promise<void> {
  await apiClient.delete(`/admin/users/${id}`)
}

/** Сброс 2FA пользователю (потерял телефон): чистит 2FA и даёт свежий грейс. */
export async function resetUserTwoFa(id: string): Promise<void> {
  await apiClient.delete(`/admin/users/${id}/2fa`)
}
