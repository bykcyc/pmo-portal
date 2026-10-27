/**
 * Карточка риска: то, чего не умела таблица.
 *
 * В реестре план митигации редактировался однострочным полем шириной 160px, а текст в ячейке
 * обрезан двумя строками — прочитать и написать план было физически негде. Тесты держат ровно это:
 * три длинных поля существуют, правка доезжает до onSave, а балл пересчитывается ДО сохранения.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RiskDrawer from './RiskDrawer'
import type { Risk } from '@/types/risk'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/api/persons', () => ({ getPersons: vi.fn().mockResolvedValue([]), createPerson: vi.fn() }))
vi.mock('@/contexts/ProjectPermission', () => ({ useCanWrite: () => true }))

const RISK = {
  id: 'r1',
  code: 'R-03',
  title: 'ИТ не даст API в срок',
  category: 'technical',
  probability: 'high',
  impact: 'high',
  status: 'open',
  owner: 'Jānis Liepbergs',
  description: 'Интеграция зависит от чужой команды',
  mitigation_plan: 'Эскалация спонсору; параллельно импорт через файлы',
  contingency_plan: 'Запуск без онлайн-интеграции',
  score: 9,
  updates: [],
} as unknown as Risk

const renderDrawer = (onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RiskDrawer risk={RISK} code="R-03" onClose={onClose} onSave={onSave} />
    </QueryClientProvider>,
  )
  return Object.assign(onSave, { onClose })
}

describe('RiskDrawer', () => {
  it('показывает план митигации целиком — в многострочном поле, а не в 160px инпуте', () => {
    renderDrawer()
    const mitigation = screen.getByLabelText('risks.mitigation') as HTMLTextAreaElement
    expect(mitigation.tagName).toBe('TEXTAREA')
    expect(mitigation.value).toBe('Эскалация спонсору; параллельно импорт через файлы')

    // и два соседних плана — тоже полноценные поля
    expect((screen.getByLabelText('risks.description') as HTMLTextAreaElement).tagName).toBe('TEXTAREA')
    expect((screen.getByLabelText('risks.contingencyPlan') as HTMLTextAreaElement).tagName).toBe('TEXTAREA')
  })

  it('наружу уходит только тронутое, а не весь риск', async () => {
    // Точное сравнение, а не «содержит»: карточка живёт минутами, и снимок целиком откатил бы
    // статус или владельца, если их за это время поменяли в реестре. Со «содержит» правка
    // «обратно к снимку» прошла бы незамеченной.
    const onSave = renderDrawer()
    fireEvent.change(screen.getByLabelText('risks.mitigation'), {
      target: { value: 'Договориться с ИТ о выделенном человеке на две недели' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]).toEqual(['r1', {
      mitigation_plan: 'Договориться с ИТ о выделенном человеке на две недели',
    }])
  })

  it('закрытие сохраняет набранное, а не выбрасывает', async () => {
    const onSave = renderDrawer()
    fireEvent.change(screen.getByLabelText('risks.contingencyPlan'), { target: { value: 'План Б' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ contingency_plan: 'План Б' })
    await waitFor(() => expect(onSave.onClose).toHaveBeenCalled())
  })

  it('пустое название не уезжает: риск не станет безымянным', async () => {
    const onSave = renderDrawer()
    fireEvent.change(screen.getByLabelText('risks.titleCol'), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('risks.mitigation'), { target: { value: 'Новый план' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ mitigation_plan: 'Новый план' })
  })

  it('сервер отказал — карточка остаётся, но второе нажатие всё же выпускает', async () => {
    // Без второго выхода отказ сервера превращал карточку в ловушку: ни крестик, ни Escape,
    // ни подложка не работали, пока сервер не ответит.
    const onSave = renderDrawer(vi.fn().mockRejectedValue(new Error('нет связи')))
    fireEvent.change(screen.getByLabelText('risks.mitigation'), { target: { value: 'Не доедет' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.onClose).not.toHaveBeenCalled()
    expect(screen.getByText('taskDrawer.saveFailedClose')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave.onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledTimes(1)   // второй раз не долбимся в сервер
  })

  it('балл пересчитывается сразу при смене вероятности — до сохранения', () => {
    renderDrawer()
    expect(screen.getByText('9')).toBeTruthy()               // высокая × высокое
    fireEvent.change(screen.getByLabelText('risks.probability'), { target: { value: 'low' } })
    expect(screen.getByText('3')).toBeTruthy()               // низкая × высокое
    expect(screen.queryByText('9')).toBeNull()
  })
})
