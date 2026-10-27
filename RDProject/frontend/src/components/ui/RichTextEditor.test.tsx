/**
 * Поле описания с лёгким оформлением.
 *
 * Главное здесь — не кнопки, а то, ЧТО человек видит, открыв описание. Разметка рисовалась
 * только по кнопке «Просмотр», и её никто не нажимал: и автор, и читатель видели «**важно**»
 * буквально. Пока описания писали руками, это терпели; когда их начал оформлять внешний
 * помощник, первое, что встретило бы людей, — мусор из звёздочек.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RichTextEditor from './RichTextEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

const MARKED = 'Первая строка.\n\n- **важно** раз\n- два'

describe('RichTextEditor — что видно при открытии', () => {
  it('размеченный текст открывается оформленным, а не звёздочками', () => {
    const { container } = render(<RichTextEditor value={MARKED} onChange={vi.fn()} />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelectorAll('strong').length).toBe(1)
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.textContent).not.toContain('**')
  })

  it('пустое поле открывается на правке: смотреть там нечего', () => {
    const { container } = render(<RichTextEditor value="" onChange={vi.fn()} />)
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('текст без разметки тоже открывается на правке', () => {
    const { container } = render(<RichTextEditor value="Обычное описание задачи." onChange={vi.fn()} />)
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('из просмотра можно перейти к правке и обратно', () => {
    const { container } = render(<RichTextEditor value={MARKED} onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('Правка'))
    expect(container.querySelector('textarea')).not.toBeNull()
    fireEvent.click(screen.getByText('Просмотр'))
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('пока человек печатает, режим под руками не переключается', () => {
    // Значение меняется на каждое нажатие, и «текст стал размеченным» — не повод отобрать
    // у человека поле ввода на середине слова.
    const { container, rerender } = render(<RichTextEditor value="" onChange={vi.fn()} />)
    rerender(<RichTextEditor value="**жи" onChange={vi.fn()} />)
    rerender(<RichTextEditor value="**жирный**" onChange={vi.fn()} />)
    expect(container.querySelector('textarea')).not.toBeNull()
  })
})

describe('RichTextEditor — только просмотр', () => {
  it('читателю текст показан оформленным, а переключателя правки нет', () => {
    const { container } = render(<RichTextEditor value={MARKED} onChange={vi.fn()} disabled />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelectorAll('strong').length).toBe(1)
    const toggle = screen.getByText('Правка').closest('button') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
  })

  it('читателю и неразмеченный текст показан текстом, а не в поле ввода', () => {
    const { container } = render(<RichTextEditor value="Обычное описание." onChange={vi.fn()} disabled />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('Обычное описание.')
  })
})
