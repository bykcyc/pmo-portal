import apiClient from './client'

/**
 * Доступ помощника к проекту («замок») и личные токены подключения.
 *
 * Замок по умолчанию ЗАКРЫТ: у нетронутого проекта признака в данных просто нет. Поэтому
 * `enabled: false` на сервере не пишется, а удаляет ключ — так документ проекта, которого
 * замка не касались, остаётся байт-в-байт прежним.
 */
export interface AgentAccess {
  enabled: boolean
  /** бюджет, журнал решений и оценки стейкхолдеров — отдельным согласием */
  sensitive: boolean
}

export async function getAgentAccess(projectId: string): Promise<AgentAccess> {
  const { data } = await apiClient.get<{ data: AgentAccess }>(`/projects/${projectId}/agent-access`)
  return data.data
}

export async function setAgentAccess(projectId: string, cfg: AgentAccess): Promise<AgentAccess> {
  const { data } = await apiClient.post<{ data: AgentAccess }>(`/projects/${projectId}/agent-access`, cfg)
  return data.data
}

export interface AgentToken {
  id: string
  user_email?: string
  name: string
  /** хвост значения — узнать в списке; полного значения нет нигде */
  token_hint: string
  scopes: string
  created_at: string
  expires_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/** Ответ на выпуск: `token` приходит ОДИН раз и больше не хранится нигде. */
export interface IssuedToken {
  id: string
  token: string
  name: string
  scopes: string
  expires_at: string
}

export async function getMyTokens(): Promise<AgentToken[]> {
  const { data } = await apiClient.get<{ data: AgentToken[] }>('/me/agent-tokens')
  return data.data
}

export async function createToken(name: string, scopes = 'read+draft'): Promise<IssuedToken> {
  const { data } = await apiClient.post<{ data: IssuedToken }>('/me/agent-tokens', { name, scopes })
  return data.data
}

export async function revokeToken(id: string): Promise<void> {
  await apiClient.delete(`/me/agent-tokens/${id}`)
}

export async function getAllTokens(): Promise<AgentToken[]> {
  const { data } = await apiClient.get<{ data: AgentToken[] }>('/admin/agent-tokens')
  return data.data
}

export interface McpLogRow {
  id: string
  at: string
  user_email: string
  token_id: string | null
  tool: string
  project_id: string | null
  ok: boolean
  detail: string
}

export async function getMcpLog(): Promise<McpLogRow[]> {
  const { data } = await apiClient.get<{ data: McpLogRow[] }>('/admin/mcp-log')
  return data.data
}
