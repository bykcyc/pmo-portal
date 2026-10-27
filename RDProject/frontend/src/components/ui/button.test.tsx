import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('renders children and handles click', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('applies sm size class', () => {
    render(<Button size="sm">X</Button>)
    expect(screen.getByRole('button', { name: 'X' }).className).toContain('text-xs')
  })
  it('disabled prevents click', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>D</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'D' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
