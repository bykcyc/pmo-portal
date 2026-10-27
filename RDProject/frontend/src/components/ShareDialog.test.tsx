/**
 * Диалог доступа хранит ДВЕ независимые настройки, и ведут они себя по-разному намеренно.
 *
 * Замок помощника — выключатель: щелчок сразу уходит на сервер. Так он и читается человеком,
 * и так между экраном и действительностью не появляется зазора. Живой случай, ради которого
 * это переделано: человек снял доступ, увидел «Сохранено» и ушёл — а запрос не ушёл вовсе,
 * и проект остался открытым. Для настройки доступа молчание опаснее любой ошибки.
 *
 * Публичная ссылка — форма: разделы выбирают в несколько щелчков, поэтому у неё кнопка.
 * Кнопка неактивна, пока менять нечего: «Сохранено» без единого запроса — та же ложь.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ShareDialog from './ShareDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

const getShare = vi.fn()
const setShare = vi.fn()
const getAgentAccess = vi.fn()
const setAgentAccess = vi.fn()

vi.mock('@/api/share', () => ({
  getShare: (...a: unknown[]) => getShare(...a),
  setShare: (...a: unknown[]) => setShare(...a),
}))
vi.mock('@/api/agent', () => ({
  getAgentAccess: (...a: unknown[]) => getAgentAccess(...a),
  setAgentAccess: (...a: unknown[]) => setAgentAccess(...a),
}))
vi.mock('@/constants/projectSections', () => ({
  getProjectSections: () => [{ id: 'passport', displayName: 'Паспорт проекта' }],
}))
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ShareDialog projectId="47" onClose={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Помощник живёт на второй вкладке: настройки отвечают на разные вопросы и сохраняются по-разному. */
async function openAgentTab() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Помощник (MCP)' }))
}

describe('ShareDialog: две настройки — два независимых сохранения', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getShare.mockResolvedValue({ enabled: false, token: '', sections: [] })
    getAgentAccess.mockResolvedValue({ enabled: false, sensitive: false })
    setShare.mockResolvedValue({ enabled: false, token: 'tok', sections: [] })
    setAgentAccess.mockResolvedValue({ enabled: true, sensitive: false })
  })

  it('замок применяется сразу по щелчку, без кнопки «Сохранить»', async () => {
    renderDialog()
    await openAgentTab()
    fireEvent.click(await screen.findByLabelText('Открыть проект помощнику'))

    await waitFor(() => expect(setAgentAccess).toHaveBeenCalledWith('47', { enabled: true, sensitive: true }))
    expect(setShare, 'публичная ссылка не должна выпускаться заодно с замком').not.toHaveBeenCalled()
  })

  it('СНЯТИЕ замка тоже уходит на сервер сразу', async () => {
    // Живой случай: человек снял доступ, увидел «Сохранено» и ушёл — а запрос не ушёл вовсе.
    getAgentAccess.mockResolvedValue({ enabled: true, sensitive: true })
    setAgentAccess.mockResolvedValue({ enabled: false, sensitive: false })
    renderDialog()
    await openAgentTab()
    fireEvent.click(await screen.findByLabelText('Открыть проект помощнику'))

    await waitFor(() => expect(setAgentAccess).toHaveBeenCalledWith('47', { enabled: false, sensitive: false }))
  })

  it('галочка одна: отдельного согласия на бюджет и решения больше нет', async () => {
    // Решение владельца. Вторая галочка была лишним вопросом, а её пропуск оставлял
    // проект открытым лишь наполовину — форма при этом показывала «открыт».
    getAgentAccess.mockResolvedValue({ enabled: true, sensitive: true })
    renderDialog()
    await openAgentTab()
    await screen.findByLabelText('Открыть проект помощнику')
    // Именно число переключателей: слова «включая бюджет» остались в пояснении — и должны там быть.
    const panel = screen.getByRole('tabpanel')
    expect(panel.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  })

  it('на вкладке помощника нет кнопки «Сохранить»', async () => {
    // Кнопка рядом с выключателем означала бы, что он ещё не применён, — ровно то заблуждение,
    // ради которого вкладки и разведены.
    renderDialog()
    await openAgentTab()
    await screen.findByLabelText('Открыть проект помощнику')
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  })

  it('правка публичной ссылки не трогает замок помощника', async () => {
    renderDialog()
    const pub = await screen.findByLabelText('Открыть доступ по ссылке')
    fireEvent.click(pub)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(setShare).toHaveBeenCalledTimes(1))
    expect(setAgentAccess, 'замок не трогали — писать его не за чем').not.toHaveBeenCalled()
  })

  it('«Сохранить» неактивна, пока публичную часть не тронули', async () => {
    // Иначе кнопка отвечает «Сохранено», не отправив ни одного запроса.
    renderDialog()
    await screen.findByLabelText('Открыть доступ по ссылке')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })
})
