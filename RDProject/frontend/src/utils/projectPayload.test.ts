import { describe, it, expect } from 'vitest'
import {
  buildProjectPayload,
  hasProjectListContent,
  formatProjectChangeValue,
  normalizeProjectChanges,
} from './projectPayload'

const base = {
  name: 'P', status: 'active', priority: 'high',
  client: '', pm_name: '', planned_start: '', planned_end: '', actual_start: '', actual_end: '',
  goal: [], scope: [], project_result: [], success_criteria: '', key_milestones: [],
  description: '', budget: '', budget_currency: '',
}

describe('projectPayload', () => {
  it('empty strings -> null, empty arrays -> null, default currency', () => {
    const p = buildProjectPayload(base)
    expect(p.client).toBeNull()
    expect(p.goal).toBeNull()
    expect(p.budget).toBeNull()
    expect(p.budget_currency).toBe('EUR')
  })
  it('parses budget and keeps non-empty arrays', () => {
    const p = buildProjectPayload({ ...base, budget: '1500.5', goal: ['g1'] })
    expect(p.budget).toBe(1500.5)
    expect(p.goal).toEqual(['g1'])
  })
  it('hasProjectListContent', () => {
    expect(hasProjectListContent(['a'])).toBe(true)
    expect(hasProjectListContent([])).toBe(false)
    expect(hasProjectListContent(null)).toBe(false)
  })
  it('formatProjectChangeValue', () => {
    expect(formatProjectChangeValue('name', null)).toBe('-')
    expect(formatProjectChangeValue('goal', ['a', 'b'])).toBe('a, b')
    expect(formatProjectChangeValue('name', 'X')).toBe('X')
  })
  it('normalizeProjectChanges', () => {
    expect(normalizeProjectChanges(null)).toEqual([])
    expect(normalizeProjectChanges([{ field: 'name', old_value: 'a', new_value: 'b' } as never])).toHaveLength(1)
  })
})
