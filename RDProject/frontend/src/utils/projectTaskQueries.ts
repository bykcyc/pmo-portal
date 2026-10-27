import type { QueryClient } from '@tanstack/react-query'

/** Keep WBS, Kanban, task drawers, and Gantt in sync after a task mutation.
 * Плюс производные представления, которые раньше зависали до 30с staleTime/refocus:
 * чек-лист подготовки + RAG проекта (['project',id,'summary']), колокол/виджет внимания
 * (['attention']), «Мои задачи»/Календарь (['my-tasks']). */
export async function invalidateProjectTasks(queryClient: QueryClient, projectId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['project', projectId, 'summary'] }),
    queryClient.invalidateQueries({ queryKey: ['attention'] }),
    queryClient.invalidateQueries({ queryKey: ['my-tasks'] }),
  ])
}
