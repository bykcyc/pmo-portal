import { describe, it, expect, beforeEach } from 'vitest'
import { AxiosError, type AxiosAdapter } from 'axios'
import apiClient from './client'
import { useToastStore } from '@/store/toastStore'

/** Адаптер вместо сети: сервер отвечает ошибкой с `detail`, как это делает FastAPI. */
const failWith = (status: number, detail: string): AxiosAdapter => async (config) => {
  throw new AxiosError(detail, AxiosError.ERR_BAD_REQUEST, config, null, {
    status, statusText: '', headers: {}, config, data: { detail },
  })
}

const errorToasts = () =>
  useToastStore.getState().items.filter((i) => i.variant === 'error').map((i) => i.message)

/**
 * Общий тост ошибки интерсептора. Живой случай: без настроенного Bitrix каждая страница
 * проекта показывала красное «Bitrix24 не настроен» — сырой detail, по-русски даже в EN/LV, —
 * хотя авто-синк при открытии глотает ошибку молча, а у кнопки синка свой локализованный тост.
 */
describe('apiClient: тост ошибки мутации', () => {
  beforeEach(() => useToastStore.setState({ items: [] }))

  it('авто-синк Bitrix при открытии проекта молчит, когда Bitrix не настроен', async () => {
    await expect(apiClient.post('/projects/47/bitrix24/sync', {}, { adapter: failWith(400, 'Bitrix24 не настроен') }))
      .rejects.toBeInstanceOf(AxiosError)
    expect(errorToasts()).toEqual([])
  })

  it('ручной синк не дублирует свой локализованный тост сырым detail', async () => {
    await expect(apiClient.post('/projects/47/bitrix24/sync?force=true', {}, { adapter: failWith(400, 'Bitrix24 не настроен') }))
      .rejects.toBeInstanceOf(AxiosError)
    expect(errorToasts()).toEqual([])
  })

  it('соседняя операция Bitrix (привязка задачи) по-прежнему показывает ошибку', async () => {
    await expect(apiClient.post('/projects/47/tasks/9/bitrix24-task', {}, { adapter: failWith(502, 'Bitrix не ответил') }))
      .rejects.toBeInstanceOf(AxiosError)
    expect(errorToasts()).toEqual(['Bitrix не ответил'])
  })
})
