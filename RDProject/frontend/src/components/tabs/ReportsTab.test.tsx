/**
 * Вкладка «Отчёты» на данных, которые она не создавала.
 *
 * Коллекции проекта — схемо-свободный JSON, и статус-отчёт пишет не только форма на этой
 * вкладке: помощник (MCP) и черновики кладут свой набор полей. Однажды помощник создал
 * отчёт БЕЗ поля `milestones`, и вкладка упала целиком — «Cannot read properties of
 * undefined (reading 'length')» вместо списка отчётов. Тип обещал массив, поэтому TypeScript
 * промолчал.
 *
 * Здесь проверяется не «поле необязательное» (это сказал бы и тип), а что страница ЖИВА
 * на таком отчёте: список рисуется, заголовок отчёта виден, счётчик вех показывает ноль.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReportsTab from './ReportsTab'
import { ProjectPermissionProvider } from '@/contexts/ProjectPermission'
import type { StatusReport } from '@/types/report'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : (opts?.defaultValue ?? key),
  }),
}))

vi.mock('@/api/reports', () => ({
  getReports: vi.fn(),
  getRisksSummary: vi.fn(),
  createReport: vi.fn(),
  updateReport: vi.fn(),
  deleteReport: vi.fn(),
}))
vi.mock('@/api/tasks', () => ({ getTasks: vi.fn() }))
vi.mock('@/api/budget', () => ({ getBudgetSummary: vi.fn() }))
vi.mock('@/api/projects', () => ({ getProject: vi.fn() }))

import { getReports, getRisksSummary } from '@/api/reports'
import { getTasks } from '@/api/tasks'
import { getBudgetSummary } from '@/api/budget'
import { getProject } from '@/api/projects'

/** Отчёт, созданный помощником: поля `milestones` нет вовсе. */
const REPORT_FROM_ASSISTANT = {
  id: 'r1',
  project_id: '5',
  report_date: '2026-01-15',
  period: 'Līdz 15.01.2026.',
  summary: 'Darbs turpinās.',
  next_steps: 'Nākamais solis.',
  conclusions: 'Secinājumi.',
  created_at: '2026-01-15T10:00:00+00:00',
} as unknown as StatusReport

function renderTab(reports: StatusReport[]) {
  vi.mocked(getReports).mockResolvedValue(reports)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPermissionProvider canWrite>
        <ReportsTab projectId="5" />
      </ProjectPermissionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getRisksSummary).mockResolvedValue({ high: [], medium: [] })
  vi.mocked(getTasks).mockResolvedValue([])
  vi.mocked(getBudgetSummary).mockResolvedValue({} as never)
  vi.mocked(getProject).mockResolvedValue({} as never)
})

describe('ReportsTab на чужих данных', () => {
  it('не падает на отчёте без поля вех и показывает его в списке', async () => {
    renderTab([REPORT_FROM_ASSISTANT])
    // Период — подпись строки отчёта. Если бы вкладка упала, её не было бы вовсе.
    expect(await screen.findByText('Līdz 15.01.2026.')).toBeTruthy()
    // Счётчик вех показывает ноль, а не ломается и не врёт.
    await waitFor(() => expect(screen.getByText('reports.milestonesCount:0')).toBeTruthy())
  })

  it('отчёт с вехами по-прежнему считает их правильно', async () => {
    renderTab([{
      ...REPORT_FROM_ASSISTANT,
      id: 'r2',
      period: 'С вехами',
      milestones: [
        { id: 'm1', name: 'Веха один' },
        { id: 'm2', name: 'Веха два' },
      ],
    } as StatusReport])
    expect(await screen.findByText('С вехами')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('reports.milestonesCount:2')).toBeTruthy())
  })
})
