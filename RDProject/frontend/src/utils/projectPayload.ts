import type { ProjectFieldChange } from '@/types/project'

export interface ProjectFormPayloadInput {
  name: string
  status: string
  priority: string
  /** Optional: older callers (e.g. Excel import) don't send it — backend treats missing/null as "not set". */
  project_kind?: string | null
  client: string | null | undefined
  pm_name: string | null | undefined
  planned_start: string | null | undefined
  planned_end: string | null | undefined
  actual_start: string | null | undefined
  actual_end: string | null | undefined
  goal: string[]
  scope: string[]
  project_result: string[]
  success_criteria: string | null | undefined
  key_milestones: string[]
  description: string | null | undefined
  budget: string | null | undefined
  budget_currency: string | null | undefined
}

export function buildProjectPayload(values: ProjectFormPayloadInput): Record<string, unknown> {
  return {
    name: values.name,
    status: values.status,
    priority: values.priority,
    project_kind: values.project_kind || null,
    client: values.client || null,
    pm_name: values.pm_name || null,
    planned_start: values.planned_start || null,
    planned_end: values.planned_end || null,
    actual_start: values.actual_start || null,
    actual_end: values.actual_end || null,
    goal: values.goal.length ? values.goal : null,
    scope: values.scope.length ? values.scope : null,
    project_result: values.project_result.length ? values.project_result : null,
    key_milestones: values.key_milestones.length ? values.key_milestones : null,
    success_criteria: values.success_criteria || null,
    description: values.description || null,
    budget: values.budget ? parseFloat(values.budget) : null,
    budget_currency: values.budget_currency || 'EUR',
  }
}

export function hasProjectListContent(items: string[] | null | undefined): boolean {
  return Array.isArray(items) && items.length > 0
}

export function formatProjectChangeValue(field: string, value: unknown): string {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return '-'
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ')
  }

  if (typeof value === 'string' && (field.includes('_start') || field.includes('_end'))) {
    return value
  }

  return String(value)
}

export function normalizeProjectChanges(changes: ProjectFieldChange[] | null | undefined): ProjectFieldChange[] {
  return Array.isArray(changes) ? changes : []
}
