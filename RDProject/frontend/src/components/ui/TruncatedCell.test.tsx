/**
 * Ячейка с окном полного текста.
 *
 * Тесты держат ровно то, ради чего окно и делалось, и то, чем оно легко испортило бы таблицу:
 * окно появляется ТОЛЬКО когда текст не влез, не ловит мышь (иначе по ячейке нельзя кликнуть),
 * не содержит ничего фокусируемого (иначе правка закроется по потере фокуса) и уходит по Escape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import TruncatedCell from './TruncatedCell'

/** jsdom считает, что наведения нет; на рабочих машинах оно есть. */
const withHover = (hover: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: hover, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** Размеры в jsdom всегда нулевые — подменяем их так, будто текст обрезан по высоте. */
const clip = (clipped: boolean) => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(clipped ? 40 : 20)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(20)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
}

const LONG = 'Отвечает за приёмку и согласование бюджета, на связи через помощника по вторникам'

beforeEach(() => { vi.useFakeTimers(); withHover(true) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const hover = (el: HTMLElement) => {
  fireEvent.mouseEnter(el)
  act(() => { vi.advanceTimersByTime(400) })
}

describe('TruncatedCell', () => {
  it('текст влез — окна нет', () => {
    clip(false)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    hover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('текст не влез — по наведению показывает его целиком', () => {
    clip(true)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip').textContent).toBe(LONG)
  })

  it('окно не ловит мышь — иначе по ячейке нельзя было бы кликнуть', () => {
    // Самая дорогая ошибка этой правки: панель поверх ячейки съедает и клик, и подсветку.
    clip(true)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip').className).toContain('pointer-events-none')
  })

  it('внутри окна нет ничего фокусируемого: правка сохраняется по потере фокуса', () => {
    clip(true)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    hover(screen.getByRole('button'))
    const tip = screen.getByRole('tooltip')
    expect(tip.querySelectorAll('button, a, input, select, textarea, [tabindex]').length).toBe(0)
  })

  it('клик по ячейке открывает правку, а окно при этом уходит', () => {
    clip(true)
    const onActivate = vi.fn()
    render(<TruncatedCell className="c" text={LONG} onActivate={onActivate} />)
    const cell = screen.getByRole('button')
    hover(cell)
    fireEvent.click(cell)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('Enter и пробел работают как клик', () => {
    clip(false)
    const onActivate = vi.fn()
    render(<TruncatedCell className="c" text={LONG} onActivate={onActivate} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('Escape закрывает окно', () => {
    clip(true)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('клавиатурой — по фокусу, без наведения и без задержки', () => {
    // На планшете наведения нет вовсе; клавиатурный путь обязан работать и там.
    clip(true)
    withHover(false)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    const cell = screen.getByRole('button')
    hover(cell)
    expect(screen.queryByRole('tooltip')).toBeNull()   // мышью на сенсорном — молчим
    fireEvent.focus(cell)
    expect(screen.getByRole('tooltip').textContent).toBe(LONG)
  })

  it('окно связано с ячейкой для программ чтения', () => {
    clip(true)
    render(<TruncatedCell className="c" text={LONG} onActivate={() => {}} />)
    const cell = screen.getByRole('button')
    hover(cell)
    expect(cell.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('пустая ячейка показывает прочерк и окна не открывает', () => {
    clip(true)
    render(<TruncatedCell className="c" text={null} onActivate={() => {}} />)
    const cell = screen.getByRole('button')
    expect(cell.textContent).toBe('—')
    hover(cell)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
