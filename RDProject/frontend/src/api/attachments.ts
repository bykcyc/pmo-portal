import apiClient from './client'

export interface Attachment {
  id: number
  file_name: string | null
  size: number | null
  content_type: string
  author: string | null
  created_at: string | null
}

export async function getAttachments(projectId: string, wpId: string): Promise<Attachment[]> {
  const { data } = await apiClient.get<{ data: Attachment[] }>(
    `/projects/${projectId}/work-packages/${wpId}/attachments`,
  )
  return data.data
}

export async function uploadAttachment(
  projectId: string,
  wpId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  // Content-Type: undefined → axios ставит multipart/form-data с корректным boundary
  await apiClient.post(`/projects/${projectId}/work-packages/${wpId}/attachments`, form, {
    headers: { 'Content-Type': undefined },
    onUploadProgress: (e) => {
      if (!onProgress) return
      const total = e.total ?? 0
      const percent = total > 0 ? Math.round((e.loaded * 100) / total) : 0
      onProgress(percent)
    },
  })
}

export async function deleteAttachment(projectId: string, aid: number): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/attachments/${aid}`)
}

export async function downloadAttachment(projectId: string, aid: number, fileName: string): Promise<void> {
  const r = await apiClient.get(`/projects/${projectId}/attachments/${aid}/content`, { responseType: 'blob' })
  const url = URL.createObjectURL(r.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'file'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
