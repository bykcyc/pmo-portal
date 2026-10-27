import api from './client'
import type { StatusReport, RisksSummary } from '@/types/report'

/** Отчёт может прийти без поля вех: коллекции проекта — схемо-свободный JSON, и статус-отчёт
 *  пишет не только форма вкладки (однажды его создал помощник, и вкладка упала целиком).
 *  Нормализуем НА ГРАНИЦЕ, как в getMeetings выше: одно место вместо охраны каждого места,
 *  где отчёт читают, — и новый код на вкладке не наступит на то же самое. */
function normalizeReport(r: StatusReport): StatusReport {
  return { ...r, milestones: r.milestones ?? [] }
}

export async function getReports(projectId: string): Promise<StatusReport[]> {
  const r = await api.get(`/projects/${projectId}/status-reports`)
  return (r.data.data as StatusReport[]).map(normalizeReport)
}

export async function getReport(projectId: string, id: string): Promise<StatusReport> {
  const r = await api.get(`/projects/${projectId}/status-reports/${id}`)
  return normalizeReport(r.data.data)
}

export async function createReport(projectId: string, payload: Record<string, unknown>): Promise<StatusReport> {
  const r = await api.post(`/projects/${projectId}/status-reports`, payload)
  return normalizeReport(r.data.data)   // ответ на запись кладут прямо в состояние — тоже нормализуем
}

export async function updateReport(projectId: string, id: string, payload: Record<string, unknown>): Promise<StatusReport> {
  const r = await api.put(`/projects/${projectId}/status-reports/${id}`, payload)
  return normalizeReport(r.data.data)
}

export async function deleteReport(projectId: string, id: string): Promise<void> {
  await api.delete(`/projects/${projectId}/status-reports/${id}`)
}

export async function getRisksSummary(projectId: string): Promise<RisksSummary> {
  const r = await api.get(`/projects/${projectId}/risks-summary`)
  return r.data.data
}
