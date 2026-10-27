import axios from 'axios'

// ВАЖНО: отдельный «голый» axios без интерсепторов основного клиента.
// Публичная страница открывается разлогиненным зрителем — здесь НЕ должно быть
// ни Bearer-токена, ни авто-logout на 401, ни success/error-тостов основного клиента.
// Vite проксирует /api на адаптер, срезая префикс /api → GET /public/{token} попадает
// в адаптерный /public/{token}.
const publicClient = axios.create({ baseURL: '/api' })

export interface PublicProjectData {
  project: Record<string, any>
  sections: string[]
}

export async function getPublicProject(token: string): Promise<PublicProjectData> {
  const res = await publicClient.get<{ data: PublicProjectData }>(`/public/${token}`)
  return res.data.data
}
