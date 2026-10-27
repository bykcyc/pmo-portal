import apiClient from './client'
import type { BudgetItem, BudgetSummary, ConsolidatedBudget } from '@/types/budget'

interface ListResponse<T> { data: T[] }
interface SingleResponse<T> { data: T }

export async function getBudgetItems(projectId: string): Promise<BudgetItem[]> {
  const { data } = await apiClient.get<ListResponse<BudgetItem>>(`/projects/${projectId}/budget-items`)
  return data.data
}
export async function createBudgetItem(projectId: string, payload: Partial<BudgetItem>): Promise<BudgetItem> {
  const { data } = await apiClient.post<SingleResponse<BudgetItem>>(`/projects/${projectId}/budget-items`, payload)
  return data.data
}
export async function updateBudgetItem(projectId: string, bid: string, payload: Partial<BudgetItem>): Promise<BudgetItem> {
  const { data } = await apiClient.put<SingleResponse<BudgetItem>>(`/projects/${projectId}/budget-items/${bid}`, payload)
  return data.data
}
export async function deleteBudgetItem(projectId: string, bid: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/budget-items/${bid}`)
}
export async function upsertMonthly(
  projectId: string,
  bid: string,
  entries: { year: number; month: number; planned: number | null; actual: number | null; actual_hours?: number | null }[],
): Promise<void> {
  await apiClient.put(`/projects/${projectId}/budget-items/${bid}/monthly`, { entries })
}
export async function getBudgetSummary(projectId: string): Promise<BudgetSummary> {
  const { data } = await apiClient.get<SingleResponse<BudgetSummary>>(`/projects/${projectId}/budget-summary`)
  return data.data
}
export async function updateBudgetSettings(
  projectId: string,
  payload: { budget_target?: string | number; income_target?: string | number; budget_currency?: string; budget_rate?: string | number | null },
): Promise<void> {
  await apiClient.put(`/projects/${projectId}/budget-settings`, payload)
}

/** Сводный бюджет по дереву. Один маршрут, вид определяет сервер: зонтик / подпроект / вне дерева. */
export async function getBudgetConsolidated(projectId: string): Promise<ConsolidatedBudget> {
  const { data } = await apiClient.get<SingleResponse<ConsolidatedBudget>>(`/projects/${projectId}/budget-consolidated`)
  return data.data
}

/**
 * Отнести статью к блоку зонтика. ОТДЕЛЬНЫЙ маршрут, а не поле в обычном PUT: это ссылка в
 * чужой проект, и проверить её можно только на сервере (существует ли блок, тот ли это зонтик,
 * совпадают ли валюты). Поле объявлено серверным — обычная правка статьи его не примет.
 */
export async function linkBudgetItem(projectId: string, bid: string, parentItemId: string): Promise<BudgetItem> {
  const { data } = await apiClient.post<SingleResponse<BudgetItem>>(
    `/projects/${projectId}/budget-items/${bid}/link`, { parent_item_id: parentItemId })
  return data.data
}

export async function unlinkBudgetItem(projectId: string, bid: string): Promise<BudgetItem> {
  const { data } = await apiClient.delete<SingleResponse<BudgetItem>>(`/projects/${projectId}/budget-items/${bid}/link`)
  return data.data
}
