import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html'

describe('escapeHtml', () => {
  it('escapes markup and attribute delimiters', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;',
    )
  })

  it('handles nullish values', () => {
    expect(escapeHtml(null)).toBe('')
  })
})
