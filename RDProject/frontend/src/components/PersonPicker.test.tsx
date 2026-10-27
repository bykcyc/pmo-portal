/**
 * PersonPicker: поиск и подтверждение свободного текста.
 *
 * КЛЮЧ К ТЕСТУ — контролируемый родитель (`Host`), который возвращает набранное значение обратно
 * в `value`. Именно так работают все 14 потребителей, и именно это раньше убивало фильтрацию:
 * эффект `[value]` гасил её на каждом нажатии клавиши. Без такого родителя баг не воспроизводится
 * и тест был бы зелёным на сломанном коде.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PersonPicker from './PersonPicker'
import { getPersons } from '@/api/persons'
import type { Person } from '@/types/person'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/api/persons', () => ({
  getPersons: vi.fn(),
  createPerson: vi.fn(),
}))

const person = (id: string, full_name: string): Person =>
  ({ id, full_name, email: null, bitrix24_id: null } as unknown as Person)

const PEOPLE = [
  person('1', 'Līga Ozoliņa'),
  person('2', 'Jānis Liepbergs'),
  person('3', 'Viktors Sokolovs'),
]

/** Родитель как в реальных вкладках: пишет onChange в свой стейт и возвращает его в value. */
function Host({ onSelect }: { onSelect?: (v: string) => void }) {
  const [v, setV] = useState('')
  return <PersonPicker value={v} onChange={setV} onSelect={onSelect} />
}

const renderPicker = (onSelect?: (v: string) => void) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Host onSelect={onSelect} />
    </QueryClientProvider>,
  )
}

const typeInto = (text: string) => {
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: text } })
  return input
}

/**
 * Имена людей в выпадающем списке. Служебные строки («+ Добавить», «показаны первые N»)
 * отбрасываем по ключу перевода — в разметке у них есть иконка, поэтому в textContent
 * попадает и пробел вокруг неё: сравнивать надо с trim(), иначе служебная строка утечёт
 * в ожидания и тест соврёт.
 */
const optionNames = () =>
  screen
    .getAllByRole('option')
    .map(o => (o.textContent || '').trim())
    .filter(txt => !txt.startsWith('persons.'))

describe('PersonPicker', () => {
  beforeEach(() => {
    vi.mocked(getPersons).mockResolvedValue(PEOPLE)
  })

  it('фильтрует список по набранному тексту (родитель возвращает value эхом)', async () => {
    renderPicker()
    typeInto('liep')
    await waitFor(() => expect(optionNames()).toEqual(['Jānis Liepbergs']))
  })

  it('Escape в мини-форме «добавить человека» не доходит до карточки', async () => {
    // И список, и мини-форма живут в портале у самого `body`, а карточки задачи, пункта
    // бэклога и риска слушают Escape на document. Без остановки человек, передумавший заводить
    // человека, закрывал этим нажатием всю карточку — вместе с несохранённым описанием.
    const onDocKey = vi.fn()
    document.addEventListener('keydown', onDocKey)
    try {
      renderPicker()
      typeInto('Nov')
      const add = await screen.findByText('persons.add')
      fireEvent.click(add.closest('button') as HTMLButtonElement)
      const first = await screen.findByPlaceholderText('persons.firstName')
      onDocKey.mockClear()
      fireEvent.keyDown(first, { key: 'Escape' })
      expect(onDocKey).not.toHaveBeenCalled()
      // При этом свою работу Escape сделал: мини-форма закрылась.
      expect(screen.queryByPlaceholderText('persons.firstName')).toBeNull()
    } finally {
      document.removeEventListener('keydown', onDocKey)
    }
  })

  it('находит имя, набранное без диакритики: «liga» → «Līga Ozoliņa»', async () => {
    renderPicker()
    typeInto('liga')
    await waitFor(() => expect(optionNames()).toEqual(['Līga Ozoliņa']))
  })

  it('Enter сохраняет свободный текст («разработчики») — раньше это было невозможно', async () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    const input = typeInto('разработчики')
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('разработчики')
  })

  it('уход фокуса тоже сохраняет свободный текст', async () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    const input = typeInto('Отдел контента')
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy())
    fireEvent.blur(input)
    expect(onSelect).toHaveBeenCalledWith('Отдел контента')
  })

  it('без onSelect (паспорт, карточка задачи) свободный текст НЕ коммитится', async () => {
    renderPicker()                     // onSelect не передан
    const input = typeInto('что-то')
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    // падать нечему: важно, что компонент не бросил и значение осталось в поле
    expect((input as HTMLInputElement).value).toBe('что-то')
  })

  it('выбор человека из списка отдаёт его имя', async () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    typeInto('viktors')
    const opt = await screen.findByText('Viktors Sokolovs')
    fireEvent.click(opt)
    expect(onSelect).toHaveBeenCalledWith('Viktors Sokolovs')
  })
})

describe('скрытые из пикеров люди', () => {
  const hidden = (id: string, full_name: string): Person =>
    ({ id, full_name, email: null, bitrix24_id: null, hidden_from_pickers: true } as unknown as Person)

  it('технический логин не показывается в списке', async () => {
    vi.mocked(getPersons).mockResolvedValue([...PEOPLE, hidden('9', 'Portfolio Owner')])
    renderPicker()
    typeInto('o')
    await waitFor(() => expect(optionNames().length).toBeGreaterThan(0))
    expect(optionNames()).not.toContain('Portfolio Owner')
    expect(optionNames()).toContain('Viktors Sokolovs')   // обычных людей не задели
  })

  it('но УЖЕ выбранного скрытого показывает — иначе его не вернуть после замены', async () => {
    vi.mocked(getPersons).mockResolvedValue([...PEOPLE, hidden('9', 'Portfolio Owner')])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PersonPicker value="Portfolio Owner" onChange={() => {}} />
      </QueryClientProvider>,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    await waitFor(() => expect(optionNames().length).toBeGreaterThan(0))
    expect(optionNames()).toContain('Portfolio Owner')
  })
})
