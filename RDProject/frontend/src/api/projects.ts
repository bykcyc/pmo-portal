import apiClient from './client'
import type { PortfolioProject } from './portfolio'
import type { Project, ProjectListItem, ProjectSummary, ProjectVersionLogEntry } from '@/types/project'

interface ListResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

interface SingleResponse<T> {
  data: T
}

export interface ProjectFilters {
  status?: string
  priority?: string
  project_kind?: string
  pm_id?: string
  page?: number
  per_page?: number
}

export async function getProjects(filters: ProjectFilters = {}): Promise<ListResponse<ProjectListItem>> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.project_kind) params.set('project_kind', filters.project_kind)
  if (filters.pm_id) params.set('pm_id', filters.pm_id)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.per_page) params.set('per_page', String(filters.per_page))
  const { data } = await apiClient.get<ListResponse<ProjectListItem>>(`/projects?${params}`)
  return data
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await apiClient.get<SingleResponse<Project>>(`/projects/${id}`)
  return data.data
}

export async function createProject(payload: Record<string, unknown>): Promise<Project> {
  const { data } = await apiClient.post<SingleResponse<Project>>('/projects', payload)
  return data.data
}

export interface BitrixSyncResult {
  checked: number; updated: number; last_sync: string; skipped?: string
  /** Совещания: сколько связок с календарём проверили и у скольких событие в Bitrix уже удалено.
   *  Необязательные — старый бэкенд их не отдаёт (портал и сервер обновляются не одновременно). */
  meetings_checked?: number
  meetings_unlinked?: number
}

/** PULL-синк статусов задач проекта из Bitrix. force=true — кнопка (в обход серверного троттла 15 мин);
 *  без force — авто при открытии проекта (сервер сам решит, не пора ли, по дате последней синхронизации). */
export async function syncBitrix(id: string, force = false): Promise<BitrixSyncResult> {
  const { data } = await apiClient.post<SingleResponse<BitrixSyncResult>>(
    `/projects/${id}/bitrix24/sync${force ? '?force=true' : ''}`, {})
  return data.data
}

export async function updateProject(id: string, payload: Record<string, unknown>): Promise<Project> {
  const { data } = await apiClient.put<SingleResponse<Project>>(`/projects/${id}`, payload)
  return data.data
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/projects/${id}`)
}

export async function cloneProject(id: string, payload: { code?: string; name?: string } = {}): Promise<Project> {
  const { data } = await apiClient.post<SingleResponse<Project>>(`/projects/${id}/clone`, payload)
  return data.data
}

export async function archiveProject(id: string): Promise<{ archived: boolean }> {
  const { data } = await apiClient.post<SingleResponse<{ archived: boolean }>>(`/projects/${id}/archive`)
  return data.data
}

export async function unarchiveProject(id: string): Promise<{ archived: boolean }> {
  const { data } = await apiClient.post<SingleResponse<{ archived: boolean }>>(`/projects/${id}/unarchive`)
  return data.data
}

export async function setProjectTemplate(id: string, on: boolean): Promise<{ is_template: boolean }> {
  const { data } = await apiClient.post<SingleResponse<{ is_template: boolean }>>(`/projects/${id}/template`, { on })
  return data.data
}

export interface TemplateListItem {
  id: string
  code: string
  name: string
  status: string
  pm_name: string | null
}

export async function getTemplates(): Promise<TemplateListItem[]> {
  const { data } = await apiClient.get<{ data: TemplateListItem[] }>('/templates')
  return data.data
}

export async function getProjectSummary(id: string): Promise<ProjectSummary> {
  const { data } = await apiClient.get<SingleResponse<ProjectSummary>>(`/projects/${id}/summary`)
  return data.data
}

export async function getVersionLog(id: string): Promise<ProjectVersionLogEntry[]> {
  const { data } = await apiClient.get<{ data: ProjectVersionLogEntry[] }>(`/projects/${id}/version_log`)
  return data.data
}

export interface TransferResult {
  pm_id: string
  pm_name: string
}

export async function transferProject(
  id: string,
  payload: { pm_id: string; pm_name: string },
): Promise<TransferResult> {
  const { data } = await apiClient.post<SingleResponse<TransferResult>>(`/admin/projects/${id}/transfer`, payload)
  return data.data
}

export interface TransferCandidate {
  id: string
  full_name: string
  email: string
}

/** Кому можно отдать ЭТОТ проект. Список считает сервер: раньше диалог брал людей из
 *  /admin/users — маршрута владельца портфеля, — и у РП открывался пустым. Заодно правило
 *  «кто может быть РП» перестало жить в двух местах. */
export async function getTransferCandidates(id: string): Promise<TransferCandidate[]> {
  const { data } = await apiClient.get<{ data: TransferCandidate[] }>(`/projects/${id}/transfer-candidates`)
  return data.data
}

export interface ActionLogEntry {
  at: string
  user_id: string | null
  user_name: string | null
  action: string
  detail: string | null
}

export async function getProjectActionLog(id: string): Promise<ActionLogEntry[]> {
  const { data } = await apiClient.get<{ data: ActionLogEntry[] }>(`/projects/${id}/action-log`)
  return data.data
}

// ── Со-руководители проекта (co-PM / editors) ───────────────────────────────
export interface ProjectEditor {
  id: string
  full_name: string
  email: string
}

export async function getProjectEditors(id: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.get<{ data: ProjectEditor[] }>(`/projects/${id}/editors`)
  return data.data
}

export async function addProjectEditor(id: string, userId: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.post<{ data: { editors: ProjectEditor[] } }>(`/projects/${id}/editors`, { user_id: userId })
  return data.data.editors
}

export async function removeProjectEditor(id: string, uid: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.delete<{ data: { editors: ProjectEditor[] } }>(`/projects/${id}/editors/${uid}`)
  return data.data.editors
}

// ── Наблюдатели проекта (observers) ─────────────────────────────────────────
// Форма записи та же, что у со-РП, но права другие: наблюдатель видит проект целиком
// и не может изменить ничего. Разделение обеспечивает сервер.
export async function getProjectObservers(id: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.get<{ data: ProjectEditor[] }>(`/projects/${id}/observers`)
  return data.data
}

export async function addProjectObserver(id: string, userId: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.post<{ data: { observers: ProjectEditor[] } }>(`/projects/${id}/observers`, { user_id: userId })
  return data.data.observers
}

export async function removeProjectObserver(id: string, uid: string): Promise<ProjectEditor[]> {
  const { data } = await apiClient.delete<{ data: { observers: ProjectEditor[] } }>(`/projects/${id}/observers/${uid}`)
  return data.data.observers
}

// ── Подпроекты ──────────────────────────────────────────────────────────────────────────
// Связь ставится отдельным маршрутом, а не полем паспорта: она раздаёт права (РП зонтика
// правит подпроекты, участники подпроектов читают друг друга) — такое не должно проезжать
// обычным сохранением вместе с названием.

/** Строка подпроекта = строка портфеля: прогресс, просрочка, риски, RAG, бюджет. */
export type SubprojectRow = PortfolioProject & { pm_id?: string | null }

export async function getSubprojects(id: string): Promise<SubprojectRow[]> {
  const { data } = await apiClient.get<{ data: SubprojectRow[] }>(`/projects/${id}/subprojects`)
  return data.data
}

export async function addSubproject(umbrellaId: string, projectId: string): Promise<void> {
  await apiClient.post(`/projects/${umbrellaId}/subprojects`, { project_id: projectId })
}

export async function removeSubproject(umbrellaId: string, projectId: string): Promise<void> {
  await apiClient.delete(`/projects/${umbrellaId}/subprojects/${projectId}`)
}

/** Зафиксировать текущую версию паспорта: номер перестаёт меняться, следующая правка уйдёт
 *  в новый. Нужно, когда паспорт печатают прямо сейчас и ждать конца сеанса (15 мин) незачем. */
export async function closeProjectVersion(projectId: string): Promise<{ version: string; closed: boolean }> {
  const { data } = await apiClient.post<{ data: { version: string; closed: boolean } }>(`/projects/${projectId}/version/close`)
  return data.data
}
