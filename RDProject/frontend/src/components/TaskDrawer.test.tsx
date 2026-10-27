/**
 * Карточка задачи — самая ходовая форма портала, и до сих пор она была без единого теста:
 * e2e и визуальные снимки модалок не открывают, то есть зелёный прогон не отличал бы рабочую
 * карточку от нерисующейся. Тесты держат ровно то, что тихо ломается и нигде больше не видно:
 * наружу уходит ПАТЧ (а не снимок формы), закрытие сохраняет, а не выбрасывает, недонабранная
 * дата и пустое название на сервер не уезжают, и отказ сервера не запирает карточку.
 *
 * Про «патч, а не снимок»: карточку держат открытой минутами, а статус, фактические даты и
 * исполнителя за это время пишет ещё и синхронизация с Bitrix24. Снимок формы, отправленный
 * при закрытии, откатил бы всё это — поэтому сравнение здесь точное (toEqual), а не «содержит».
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TaskDrawer from './TaskDrawer'
import type { Task } from '@/types/task'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/api/persons', () => ({ getPersons: vi.fn().mockResolvedValue([]), createPerson: vi.fn() }))
vi.mock('@/contexts/ProjectPermission', () => ({ useCanWrite: () => true }))
vi.mock('@/api/gantt', () => ({
  getGanttData: vi.fn().mockResolvedValue({ tasks: [], links: [] }),
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}))
// Вкладки «Вложения» и «История» тянут свои запросы и к делу тут не относятся.
vi.mock('@/components/ActivityPanel', () => ({ default: () => null }))
vi.mock('@/components/AttachmentsPanel', () => ({ default: () => null }))

const TASK = {
  id: 't1',
  project_id: '47',
  wbs_code: '1.2',
  title: 'Согласовать макет',
  task_type: 'task',
  status: 'in_progress',
  priority: 'medium',
  progress: 30,
  planned_start: '2026-09-01',
  planned_end: '2026-09-05',
  actual_start: null,
  actual_end: null,
  description: 'Первая строка.',
  assignee_name: null,
  assignee_person_id: null,
  bitrix24_task_id: null,
} as unknown as Task

const renderCard = (onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TaskDrawer task={TASK} projectId="47" onClose={onClose} onSave={onSave} />
    </QueryClientProvider>,
  )
  return { onSave, onClose }
}

const title = () => screen.getByLabelText('taskDrawer.title')

describe('TaskDrawer — подписи', () => {
  it('поля находятся по подписи — значит подписи связаны с полями', () => {
    renderCard()
    expect(screen.getByLabelText('taskDrawer.title')).toBeTruthy()
    expect(screen.getByLabelText('common.type')).toBeTruthy()
    expect(screen.getByLabelText('common.status')).toBeTruthy()
    expect(screen.getByLabelText('project.fields.priority')).toBeTruthy()
    expect(screen.getByLabelText('taskDrawer.progress')).toBeTruthy()
    expect(screen.getByLabelText('Длительность, дней')).toBeTruthy()
    expect(screen.getByLabelText('Оценка, ч')).toBeTruthy()
    expect(screen.getByLabelText('Факт, ч')).toBeTruthy()
    expect(screen.getByLabelText('taskDrawer.barColor')).toBeTruthy()
    // Исполнитель и даты — на общих полях портала: своё поле внутри и свой id,
    // так что имя им задаётся пропом, а не htmlFor снаружи.
    expect(screen.getByLabelText('taskDrawer.assigneeName')).toBeTruthy()
    expect(screen.getByLabelText('project.fields.plannedStart')).toBeTruthy()
  })
})

describe('TaskDrawer — запись', () => {
  it('наружу уходит только тронутое, а не весь снимок формы', async () => {
    const { onSave } = renderCard()
    fireEvent.change(title(), { target: { value: 'Согласовать макет с заказчиком' } })
    fireEvent.click(screen.getByText('taskDrawer.saveChanges'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]).toEqual(['t1', { title: 'Согласовать макет с заказчиком' }])
  })

  it('закрытие сохраняет набранное, а не выбрасывает его', async () => {
    const { onSave, onClose } = renderCard()
    fireEvent.change(title(), { target: { value: 'Имя из закрытия' } })
    fireEvent.mouseDown(screen.getByRole('dialog'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ title: 'Имя из закрытия' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('нетронутая карточка закрывается молча, без запроса', async () => {
    const { onSave, onClose } = renderCard()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('выделяли текст внутри, отпустили мышь на подложке — карточка остаётся', () => {
    const { onClose } = renderCard()
    fireEvent.mouseDown(title())
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('недонабранная дата на сервер не уезжает', async () => {
    // Плановые даты сервер проверяет и ответил бы 500, а фактические — колонки TEXT: «15.0»
    // молча осел бы в задаче и попал в сравнение с Bitrix. Поле отдаёт наружу только полную дату.
    const { onSave, onClose } = renderCard()
    fireEvent.change(screen.getByLabelText('project.fields.plannedStart'), { target: { value: '15.0' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('полная дата уезжает как ISO', async () => {
    const { onSave } = renderCard()
    fireEvent.change(screen.getByLabelText('project.fields.plannedEnd'), { target: { value: '12.09.2026' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ planned_end: '2026-09-12' })
  })

  it('пустое название не уезжает: задача не станет «Новой задачей»', async () => {
    // Сервер подставляет «Новая задача» вместо пустого названия — закрытие карточки молча
    // переименовало бы задачу тому, кто стёр заголовок и передумал.
    const { onSave } = renderCard()
    fireEvent.change(title(), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('taskDrawer.progress'), { target: { value: '60' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect('title' in onSave.mock.calls[0][1]).toBe(false)
  })

  it('сервер отказал — карточка остаётся, но второе нажатие всё же выпускает', async () => {
    // Без второго выхода пропавшая связь запирала карточку насовсем: все три выхода ведут
    // в сохранение, а оно не проходит.
    const { onSave, onClose } = renderCard(vi.fn().mockRejectedValue(new Error('нет связи')))
    fireEvent.change(title(), { target: { value: 'Не доедет' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Не доедет')).toBeTruthy()
    expect(screen.getByText('taskDrawer.saveFailedClose')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
