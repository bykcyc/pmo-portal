import apiClient from './client'

export interface GanttTask {
  id: string
  text: string
  wbs: string
  start_date: string | null
  end_date: string | null
  duration: number
  progress: number
  parent: string | number
  type: string
  open: boolean
  critical?: boolean
  baseline_start?: string | null
  baseline_end?: string | null
  assignee_name?: string | null
  status?: string | null
  priority?: string | null
  bar_color?: string | null
  actual_start?: string | null
  actual_end?: string | null
}

export interface GanttLink {
  id: string
  source: string
  target: string
  type: string
  lag: number
}

export interface GanttData {
  tasks: GanttTask[]
  links: GanttLink[]
}

interface Response<T> { data: T }

export async function getGanttData(projectId: string): Promise<GanttData> {
  const { data } = await apiClient.get<Response<GanttData>>(`/projects/${projectId}/gantt-data`)
  return data.data
}

export async function createDependency(
  projectId: string,
  taskId: string,
  dependsOnId: string,
  depType: string,
): Promise<void> {
  await apiClient.post(`/projects/${projectId}/task-dependencies`, {
    task_id: taskId, depends_on_id: dependsOnId, dependency_type: depType,
  })
}

export async function deleteDependency(projectId: string, did: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/task-dependencies/${did}`)
}
