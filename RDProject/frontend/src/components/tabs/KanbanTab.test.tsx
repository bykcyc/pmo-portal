/**
 * Компонентный тест KanbanTab (аудит №5, хвост H5):
 * колонки по статусам, карточки (фазы отфильтрованы), read-only-гейтинг,
 * клавиатурный перенос через select → updateTask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import KanbanTab from './KanbanTab'
import { ProjectPermissionProvider } from '@/contexts/ProjectPermission'
import type { Task } from '@/types/task'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/api/tasks', () => ({
  getTasks: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
}))

// TaskDrawer (клик по карточке) не тестируем здесь — стаб, чтобы не тянуть его import-цепочку (i18n/api).
vi.mock('@/components/TaskDrawer', () => ({ default: () => null }))

import { getTasks, updateTask } from '@/api/tasks'

const task = (over: Partial<Task>): Task =>
  ({
    id: 't0',
    title: 'Task',
    task_type: 'task',
    status: 'not_started',
    priority: 'medium',
    parent_id: null,
    level: 0,
    sort_order: 0,
    progress: 0,
    planned_start: null,
    planned_end: null,
    duration_days: null,
    assignee_name: null,
    ...over,
  }) as unknown as Task

const TASKS: Task[] = [
  task({ id: 'ph1', title: 'Фаза-1', task_type: 'phase', status: 'in_progress' }),
  task({ id: 't1', title: 'Task One', status: 'in_progress', assignee_name: 'PM 1' }),
  task({ id: 't2', title: 'Task Two', status: 'not_started' }),
]

function renderBoard(canWrite: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPermissionProvider canWrite={canWrite}>
        <KanbanTab projectId="5" />
      </ProjectPermissionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getTasks).mockResolvedValue(TASKS)
  vi.mocked(updateTask).mockResolvedValue(TASKS[1])
})

describe('KanbanTab', () => {
  it('рендерит 5 колонок и карточки в своих статусах; фазы не показывает', async () => {
    renderBoard(false)
    expect(await screen.findByText('Task One')).toBeTruthy()
    expect(screen.getByText('Task Two')).toBeTruthy()
    // фаза отфильтрована
    expect(screen.queryByText('Фаза-1')).toBeNull()
    // 5 статус-колонок (заголовки = ключи wbs.statuses.* при мокнутом t)
    for (const s of ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']) {
      expect(screen.getByRole('heading', { name: `wbs.statuses.${s}` })).toBeTruthy()
    }
    // карточка в правильной колонке: aria-label "статус: количество" есть и на колонке, и на бейдже
    expect(screen.getAllByLabelText('wbs.statuses.in_progress: 1').length).toBeGreaterThan(0)
  })

  it('read-only: нет select «переместить в статус», карточки не draggable', async () => {
    renderBoard(false)
    await screen.findByText('Task One')
    expect(screen.queryAllByLabelText('Переместить в статус')).toHaveLength(0)
    expect(screen.getByText('Task One').closest('[draggable="true"]')).toBeNull()
  })

  it('canWrite: смена статуса через select зовёт updateTask с верными аргументами', async () => {
    renderBoard(true)
    await screen.findByText('Task One')
    const selects = screen.getAllByLabelText('Переместить в статус')
    expect(selects.length).toBe(2) // по одному на карточку
    // селект внутри карточки Task One
    const cardSelect = screen
      .getByText('Task One')
      .closest('div[draggable]')!
      .querySelector('select') as HTMLSelectElement
    fireEvent.change(cardSelect, { target: { value: 'completed' } })
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('5', 't1', { status: 'completed' })
    })
  })
})
