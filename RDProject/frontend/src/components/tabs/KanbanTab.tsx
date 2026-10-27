import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { getTasks, updateTask, createTask } from '@/api/tasks'
import type { Task, TaskStatus } from '@/types/task'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { useSectionExport } from '@/hooks/useSectionExport'
import { useToastStore } from '@/store/toastStore'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { PriorityBadge } from '@/components/ui/badges'
import ProcessGuide, { type GuideStep } from '@/components/ProcessGuide'
import TaskDrawer from '@/components/TaskDrawer'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'

const COLUMNS: TaskStatus[] = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  not_started: 'bg-slate-400 dark:bg-slate-500',
  in_progress: 'bg-blue-500',
  on_hold: 'bg-amber-400',
  completed: 'bg-emerald-500',
  cancelled: 'bg-rose-500',
}

export default function KanbanTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const toast = useToastStore((s) => s.show)
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)  // клик по карточке → тот же TaskDrawer, что в WBS/Ганте

  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => getTasks(projectId),
  })

  const cards = tasks.filter((task) => task.task_type !== 'phase')

  const guideSteps: GuideStep[] = [
    { title: t('kanban.guide.s1'), desc: t('kanban.guide.s1d') },
    { title: t('kanban.guide.s2'), desc: t('kanban.guide.s2d') },
    { title: t('kanban.guide.s3'), desc: t('kanban.guide.s3d') },
    { title: t('kanban.guide.s4'), desc: t('kanban.guide.s4d') },
  ]

  // Экспорт секции (меню «Ещё» шапки) — задачи доски без фаз
  const exportRows = useMemo(() => tasks.filter((tk) => tk.task_type !== 'phase').map((tk) => ({
    title: tk.title, status: tk.status, priority: tk.priority,
    planned_start: tk.planned_start, planned_end: tk.planned_end,
    progress: tk.progress, assignee_name: tk.assignee_name,
  })), [tasks])
  useSectionExport('board', exportRows)

  const moveTask = async (id: string, status: TaskStatus) => {
    try {
      await updateTask(projectId, id, { status })
      await invalidateProjectTasks(qc, projectId)
      toast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    } catch {
      toast(t('common.error', { defaultValue: 'Что-то пошло не так' }), 'error')
    }
  }

  // Создать задачу прямо из колонки — со статусом этой колонки (раньше создать можно было только в WBS)
  const addCard = async (status: TaskStatus) => {
    try {
      await createTask(projectId, { title: t('wbs.newTaskTitle'), task_type: 'task', status })
      await invalidateProjectTasks(qc, projectId)
    } catch {
      toast(t('common.error', { defaultValue: 'Что-то пошло не так' }), 'error')
    }
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault()
    setDragOverCol(null)
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    const task = cards.find((c) => c.id === id)
    if (!task || task.status === status) return
    void moveTask(id, status)
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((status) => (
          <div
            key={status}
            className="flex w-[85vw] shrink-0 flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 sm:w-72"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-3 py-2.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_ACCENT[status]}`} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t(`wbs.statuses.${status}`)}</h3>
            </div>
            <div className="p-2">
              <SkeletonRows rows={2} rowClassName="h-16" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (isError) {
    return (
      <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">
        {t('common.error')}
      </Surface>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <ProcessGuide steps={guideSteps} />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMNS.map((status) => {
        const colCards = cards.filter((card) => card.status === status)
        const isOver = dragOverCol === status
        const statusName = t(`wbs.statuses.${status}`)
        return (
          <div
            key={status}
            aria-label={`${statusName}: ${colCards.length}`}
            onDragOver={canWrite ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(status) } : undefined}
            onDragLeave={canWrite ? () => setDragOverCol((cur) => (cur === status ? null : cur)) : undefined}
            onDrop={canWrite ? (e) => handleDrop(e, status) : undefined}
            className={`flex w-[85vw] shrink-0 flex-col rounded-xl border transition-colors sm:w-72 ${
              isOver
                ? 'border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-3 py-2.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_ACCENT[status]}`} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{statusName}</h3>
              <span
                aria-label={`${statusName}: ${colCards.length}`}
                className="ml-auto rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                {colCards.length}
              </span>
              {canWrite && (
                <button
                  onClick={() => void addCard(status)}
                  aria-label={t('wbs.addTask', { defaultValue: 'Добавить задачу' })}
                  title={t('wbs.addTask', { defaultValue: 'Добавить задачу' })}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {colCards.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-slate-600 dark:text-slate-400">
                  {t('kanban.emptyColumn', { defaultValue: 'Нет задач' })}
                </p>
              ) : (
                colCards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    task={card}
                    canWrite={canWrite}
                    onDragStart={canWrite ? (e) => handleDragStart(e, card.id) : undefined}
                    onMove={(next) => moveTask(card.id, next)}
                    onOpen={() => setDetailTask(card)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
      </div>
      <TaskDrawer
        task={detailTask}
        projectId={projectId}
        onClose={() => setDetailTask(null)}
        onSave={async (id, data) => { await updateTask(projectId, id, data); await invalidateProjectTasks(qc, projectId) }}
      />
    </div>
  )
}

function KanbanCard({
  task,
  canWrite,
  onDragStart,
  onMove,
  onOpen,
}: {
  task: Task
  canWrite: boolean
  onDragStart?: (e: React.DragEvent) => void
  onMove: (status: TaskStatus) => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      draggable={canWrite}
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      role="button"
      tabIndex={0}
      className={`rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        canWrite ? 'cursor-grab hover:shadow-md active:cursor-grabbing' : 'cursor-pointer hover:shadow-md'
      }`}
    >
      <p className="mb-2 text-sm font-medium leading-snug text-slate-900 dark:text-slate-100">{task.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={task.priority}>{t(`wbs.priorities.${task.priority}`)}</PriorityBadge>
        {task.assignee_name && (
          <span className="truncate text-xs text-slate-600 dark:text-slate-400">{task.assignee_name}</span>
        )}
      </div>
      {canWrite && (
        <select
          aria-label={t('kanban.moveTo', { defaultValue: 'Переместить в статус' })}
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}  // Enter на select не должен всплывать и открывать TaskDrawer
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="mt-2 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-100 shadow-sm outline-none transition-colors focus:border-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {COLUMNS.map((s) => (
            <option key={s} value={s}>
              {t(`wbs.statuses.${s}`)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
