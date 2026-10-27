/**
 * Личные настройки интерфейса — хранятся в УЧЁТКЕ, а не в localStorage.
 *
 * Человек открывает портал и с ноутбука, и с рабочей машины: настройка «какие диаграммы
 * показывать» должна ехать за ним, иначе на второй машине он увидит чужой (умолчательный) вид
 * и решит, что портал сбросил его работу.
 */
import apiClient from './client'

export type UserPrefs = Record<string, unknown>

export async function getUserPrefs(): Promise<UserPrefs> {
  const { data } = await apiClient.get<{ data: UserPrefs }>('/me/prefs')
  return data.data ?? {}
}

/** Отправляем только изменившиеся ключи — сервер сливает их с уже сохранёнными. */
export async function putUserPrefs(patch: UserPrefs): Promise<UserPrefs> {
  const { data } = await apiClient.put<{ data: UserPrefs }>('/me/prefs', patch)
  return data.data ?? {}
}
