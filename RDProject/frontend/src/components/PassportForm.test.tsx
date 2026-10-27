/**
 * Паспорт не должен терять правки БЕЗ ухода со страницы.
 *
 * Гвард несохранённого спрашивает только на выходах — а форма умела молча перезаписать себя
 * прямо на месте: эффект по `initialData` перезаливал поля и гасил флаг при ЛЮБОМ новом объекте
 * от react-query. Живой триггер — кнопка «Синхр. с Bitrix»: она инвалидирует проект всегда,
 * потому что обновляет дату синхронизации. Человек с недописанным паспортом жал её, видел тост
 * «обновлено 0» — и текст исчезал. Спросить его было негде: он никуда не уходил.
 *
 * Второй случай здесь не менее важен: при СМЕНЕ проекта форму обязаны перезалить даже с грязью,
 * иначе на новом проекте останется паспорт старого — то есть чужие данные под чужим именем.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PassportForm, { type PassportFormValues } from './PassportForm'
import type { Project } from '@/types/project'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/api/persons', () => ({ getPersons: vi.fn().mockResolvedValue([]), createPerson: vi.fn() }))
vi.mock('@/contexts/ProjectPermission', () => ({ useCanWrite: () => true }))

const project = (over: Partial<Project> = {}): Project => ({
  id: '177',
  code: 'prj-52319',
  name: 'Внедрение ИИ в разработку',
  status: 'planning',
  priority: 'medium',
  goal: '',
  description: '',
  ...over,
} as Project)

// Мок t() отдаёт сам ключ, когда defaultValue не задан, — поэтому ищем поле по ключу,
// а не по русской подписи.
const nameField = () => screen.getByLabelText('project.fields.name') as HTMLInputElement

// PersonPicker внутри формы ходит в react-query — без провайдера падает весь рендер.
// Клиент один на файл: пересоздание на каждый rerender меняло бы контекст без нужды.
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (p: Project) => (
  <QueryClientProvider client={qc}>
    <PassportForm initialData={p} onSubmit={vi.fn()} />
  </QueryClientProvider>
)

describe('паспорт и свежие данные с сервера', () => {
  it('не затирает несохранённое, когда приходит новый ответ по ТОМУ ЖЕ проекту', () => {
    const { rerender } = render(wrap(project()))

    fireEvent.change(nameField(), { target: { value: 'Внедрение ИИ — правка' } })
    expect(nameField().value).toBe('Внедрение ИИ — правка')

    // Именно так выглядит перезапрос: НОВЫЙ объект с теми же данными (axios не переиспользует
    // ссылку), плюс изменившаяся дата синхронизации — из-за неё react-query и отдаёт новый объект.
    rerender(wrap(project({ bitrix_last_sync: '2026-08-12T09:00:00' } as Partial<Project>)))

    expect(nameField().value, 'правку стёрли данными с сервера').toBe('Внедрение ИИ — правка')
  })

  it('перезаливает форму при смене проекта, даже если есть несохранённое', () => {
    const { rerender } = render(wrap(project()))

    fireEvent.change(nameField(), { target: { value: 'недописанное' } })
    rerender(wrap(project({ id: '47', name: 'Демо-проект Б' })))

    // Иначе человек увидел бы паспорт ПРЕДЫДУЩЕГО проекта и сохранил его поверх нового.
    expect(nameField().value).toBe('Демо-проект Б')
  })

  it('первую загрузку данных показывает как есть', () => {
    render(wrap(project({ name: 'Как на сервере' })))
    expect(nameField().value).toBe('Как на сервере')
  })
})

describe('даты: в проект попадает только дописанное', () => {
  // Рядом с полем живёт кнопка-подсказка с меткой '…Hint', поэтому берём именно input.
  const dateField = () =>
    screen.getAllByLabelText(/^project\.fields\.plannedStart/).find(el => el.tagName === 'INPUT') as HTMLInputElement

  it('пока дату набирают по символу, в форму ничего не уходит', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={project({ planned_start: '2026-01-01' })} onSubmit={onSubmit} />
      </QueryClientProvider>,
    )
    const field = dateField()
    for (const partial of ['1', '12', '12.', '12.0', '12.08', '12.08.20']) {
      fireEvent.change(field, { target: { value: partial } })
      expect(field.value, 'человек должен видеть, что набирает').toBe(partial)
    }
    // Сохраняем ПОСРЕДИ набора — именно это и будет делать автосохранение.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalled()
    const sent = onSubmit.mock.calls[0][0] as { planned_start: string }
    // Раньше сюда уезжало «12.08.20»: колонки дат — TEXT, серверная проверка сравнивает их
    // как строки и мусор не отбраковывает.
    expect(sent.planned_start, 'недописанная дата ушла в проект').toBe('2026-01-01')

    fireEvent.change(field, { target: { value: '12.08.2026' } })
    expect(field.value).toBe('12.08.2026')
  })

  it('уход из поля с недописанной датой возвращает то, что реально сохранено', () => {
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={project({ planned_start: '2026-01-01' })} onSubmit={vi.fn()} />
      </QueryClientProvider>,
    )
    const field = dateField()
    fireEvent.change(field, { target: { value: '12.0' } })
    fireEvent.blur(field)
    // Иначе на экране остаётся текст, которого в проекте нет.
    expect(field.value).toBe('01.01.2026')
  })

  it('очистку поля пропускаем: это осознанное изменение', () => {
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={project({ planned_start: '2026-01-01' })} onSubmit={vi.fn()} />
      </QueryClientProvider>,
    )
    const field = dateField()
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(field.value).toBe('')
  })
})

describe('автосохранение', () => {
  const full = () => project({
    name: 'Внедрение ИИ', client: 'Заказчик', pm_name: 'РП',
    planned_start: '2026-07-01', planned_end: '2027-01-01',
  } as Partial<Project>)

  it('после загрузки данных НИЧЕГО не сохраняет само', async () => {
    // ЧЕСТНАЯ ОГОВОРКА: сам дефект — гонку formRef и snapshotRef, из-за которой автосохранение
    // отправляло ПУСТОЙ паспорт поверх проекта, — этот тест НЕ воспроизводит: в jsdom эффекты
    // успевают синхронизироваться, и он проходит даже на сломанном коде. Поймала гонку живая
    // проба в браузере, закрепляет её e2e (passport-autosave.spec.ts: «после открытия паспорта
    // ни одного PUT»). Здесь остаётся более слабое, но полезное: без правок не пишем.
    vi.useFakeTimers()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={onSubmit} autoSave hideSubmitButton />
      </QueryClientProvider>,
    )
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onSubmit, 'паспорт сохранился сам, хотя его не трогали').not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('правку сохраняет само, через паузу и целиком', async () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={onSubmit} autoSave hideSubmitButton />
      </QueryClientProvider>,
    )
    fireEvent.change(nameField(), { target: { value: 'Внедрение ИИ v2' } })
    expect(onSubmit, 'сохранили сразу, без паузы').not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const sent = onSubmit.mock.calls[0][0] as { name: string; client: string }
    expect(sent.name).toBe('Внедрение ИИ v2')
    // Паспорт уходит ЦЕЛИКОМ — остальные поля обязаны сохраниться, а не обнулиться.
    expect(sent.client).toBe('Заказчик')
    vi.useRealTimers()
  })

  it('правку, сделанную ВО ВРЕМЯ сохранения, не теряет', async () => {
    // Автосохранение открывает это окно на каждом сохранении, и быстро печатающий попадает
    // в него всегда: снимок брался с текущей формы уже ПОСЛЕ ответа сервера, поэтому буквы,
    // набранные во время запроса, считались сохранёнными, хотя на сервер не уходили.
    vi.useFakeTimers()
    let release: (() => void) | null = null
    // Сигнатуру задаём явно: без неё mock.calls типизируется как [] и tsc не даёт читать аргумент.
    const onSubmit = vi.fn((_v: PassportFormValues) => new Promise<void>(res => { release = () => res() }))
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={onSubmit} autoSave hideSubmitButton />
      </QueryClientProvider>,
    )

    fireEvent.change(nameField(), { target: { value: 'первая правка' } })
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((onSubmit.mock.calls[0][0] as { name: string }).name).toBe('первая правка')

    // Печатаем, пока запрос ещё в полёте, и только потом отпускаем сервер.
    fireEvent.change(nameField(), { target: { value: 'вторая правка' } })
    await act(async () => { release?.(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(2000) })

    expect(onSubmit, 'вторую правку проглотили').toHaveBeenCalledTimes(2)
    expect((onSubmit.mock.calls[1][0] as { name: string }).name).toBe('вторая правка')
    vi.useRealTimers()
  })

  it('без autoSave не сохраняет ничего (создание проекта, режим чтения)', async () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={onSubmit} hideSubmitButton />
      </QueryClientProvider>,
    )
    fireEvent.change(nameField(), { target: { value: 'правка читателя' } })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onSubmit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  /**
   * `autoSave` и `readOnly` — РАЗНЫЕ вопросы, и раньше был только первый.
   *
   * Читатель (наблюдатель проекта, руководство компании, анонимная ссылка) видел паспорт,
   * в котором поля выглядят живыми: печатать можно, а напечатанное молча пропадает —
   * сохранения нет. Проверяем не «не сохранил», а «даже набрать нельзя»: гашение полей
   * и есть единственный честный сигнал человеку, что правка не его дело.
   */
  it('в режиме чтения поля паспорта погашены, а не просто не сохраняются', () => {
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={vi.fn()} hideSubmitButton readOnly />
      </QueryClientProvider>,
    )
    // Проверяем ТОЛЬКО через `:disabled`. Свойство `el.disabled` отражает собственный атрибут
    // поля и через родительский fieldset остаётся false — измеряя его, мы бы «нашли» дефект
    // там, где его нет, и наоборот проглядели бы настоящий.
    const live = [...document.querySelectorAll('input, textarea, select')]
      .filter(el => !el.matches(':disabled'))
    expect(live.map(el => el.getAttribute('aria-label') ?? el.tagName), 'осталось правимое поле').toEqual([])
  })

  it('без readOnly паспорт остаётся живым — на создании проекта автосохранения тоже нет', () => {
    render(
      <QueryClientProvider client={qc}>
        <PassportForm initialData={full()} onSubmit={vi.fn()} hideSubmitButton />
      </QueryClientProvider>,
    )
    expect(nameField().matches(':disabled'), 'режим чтения протёк на обычную форму').toBe(false)
  })
})
