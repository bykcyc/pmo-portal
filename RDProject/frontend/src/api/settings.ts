import apiClient from './client'

export interface RagThresholds {
  red_high: number
  red_overdue: number
  amber_medium: number
}

export async function getRagSettings(): Promise<RagThresholds> {
  const { data } = await apiClient.get<{ data: RagThresholds }>('/admin/settings/rag')
  return data.data
}

export async function putRagSettings(t: RagThresholds): Promise<RagThresholds> {
  const { data } = await apiClient.put<{ data: RagThresholds }>('/admin/settings/rag', t)
  return data.data
}

/** Пороги «перегружен»: их правит руководитель портфеля в «Настройках». */
export interface WorkloadThresholds {
  tasks: number
  hours: number
  pm_projects: number
}

export async function getWorkloadSettings(): Promise<WorkloadThresholds> {
  const { data } = await apiClient.get<{ data: WorkloadThresholds }>('/admin/settings/workload')
  return data.data
}

export async function putWorkloadSettings(t: WorkloadThresholds): Promise<WorkloadThresholds> {
  const { data } = await apiClient.put<{ data: WorkloadThresholds }>('/admin/settings/workload', t)
  return data.data
}

export interface BitrixSettings {
  configured: boolean
  host: string
  source: string
}

export async function getBitrixSettings(): Promise<BitrixSettings> {
  const { data } = await apiClient.get<{ data: BitrixSettings }>('/admin/settings/bitrix')
  return data.data
}

export async function setBitrixWebhook(webhook_url: string): Promise<BitrixSettings> {
  const { data } = await apiClient.put<{ data: BitrixSettings }>('/admin/settings/bitrix', { webhook_url })
  return data.data
}

export interface SmtpSettings {
  configured: boolean
  host: string
  port: number | null
  user: string
  from: string
  starttls: boolean
  password_set: boolean
  source: string
}

export interface SmtpPayload {
  host: string
  port: number | null
  user: string
  from: string
  password?: string
  starttls: boolean
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const { data } = await apiClient.get<{ data: SmtpSettings }>('/admin/settings/smtp')
  return data.data
}

export async function setSmtpSettings(payload: SmtpPayload): Promise<SmtpSettings> {
  const { data } = await apiClient.put<{ data: SmtpSettings }>('/admin/settings/smtp', payload)
  return data.data
}

/** Автоприём черновиков помощника — только для владельца портала. */
export interface McpSettings {
  auto_apply: boolean
}

export async function getMcpSettings(): Promise<McpSettings> {
  const { data } = await apiClient.get<{ data: McpSettings }>('/admin/settings/mcp')
  return data.data
}

export async function putMcpSettings(s: McpSettings): Promise<McpSettings> {
  const { data } = await apiClient.put<{ data: McpSettings }>('/admin/settings/mcp', s)
  return data.data
}
