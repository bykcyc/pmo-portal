import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronsDownUp, ChevronsUpDown, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTasks, createTask, updateTask, deleteTask, reorderTasks, createBitrix24Task, deleteBitrix24Task } from '@/api/tasks'
import { getGanttData } from '@/api/gantt'
import { getUserPrefs, putUserPrefs } from '@/api/prefs'
import { getProject } from '@/api/projects'
import { addDaysToIsoDate, formatDate, parseDateStrict } from '@/utils/date'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'
import type { Task, TaskNode } from '@/types/task'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import LogPanel from '@/components/LogPanel'
import BitrixTaskDialog from '@/components/BitrixTaskDialog'
import BulkTaskDialog from '@/components/BulkTaskDialog'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import TaskDrawer from '@/components/TaskDrawer'
import { useSectionExport } from '@/hooks/useSectionExport'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import {
  getManagedTableStyle,
  TABLE_ACTION_HEAD_WIDE_CLASS,
  TABLE_BASE_CLASS,
  TABLE_SCROLL_WRAP_CLASS,
} from '@/components/tableStyles'
import { NodeRow } from './wbs/WbsRows'
import CoAssigneesDialog from './wbs/CoAssigneesDialog'
import { DATE_FIELDS, type EditCell } from './wbs/wbsConstants'

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTree(tasks: Task[]): TaskNode[] {
  const map = new Map<string, TaskNode>()
  const roots: TaskNode[] = []
  const sorted = [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  sorted.forEach((t) => map.set(t.id, { ...t, children: [] }))
  sorted.forEach((t) => {
    const node = map.get(t.id)!
    if (t.parent_id && map.has(t.parent_id)) map.get(t.parent_id)!.children.push(node)
    else roots.push(node)
  })
  return roots
}

function assignWbsCodes(nodes: TaskNode[], prefix = ''): void {
  nodes.forEach((node, idx) => {
    node.wbs_code = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`
    if (node.children.length) assignWbsCodes(node.children, node.wbs_code)
  })
}

// Сортировка дерева по колонке (внутри каждого родителя, сохраняя иерархию).
// Вычисляемые колонки (wbs_code/dependencies/condition) не сортируем — нет прямого поля.
function sortTree(nodes: TaskNode[], field: string, dir: 'asc' | 'desc'): void {
  const mul = dir === 'asc' ? 1 : -1
  const val = (n: TaskNode) => (n as unknown as Record<string, unknown>)[field]
  nodes.sort((a, b) => {
    const va = val(a), vb = val(b)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
    return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true }) * mul
  })
  nodes.forEach((n) => { if (n.children.length) sortTree(n.children, field, dir) })
}

function daysDiff(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000))
}

// ── WBSTab ────────────────────────────────────────────────────────────────────

export default function WBSTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [logTask, setLogTask] = useState<{ id: string; title: string } | null>(null)
  const [bitrixNode, setBitrixNode] = useState<TaskNode | null>(null)
  const [detailTask, setDetailTask] = useState<TaskNode | null>(null)
  const [coTask, setCoTask] = useState<TaskNode | null>(null)
  // Подсказка при перетаскивании: над какой строкой мы и что произойдёт при отпускании.
  const [dropHint, setDropHint] = useState<{ id: string; zone: 'before' | 'inside' | 'after' } | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  // Плотность строк: приезжает из настроек пользователя, дальше живёт локально.
  const { data: userPrefs } = useQuery({ queryKey: ['me-prefs'], queryFn: getUserPrefs, staleTime: 300_000 })
  const [dense, setDense] = useState(false)
  useEffect(() => {
    if (userPrefs && typeof userPrefs.wbsDense === 'boolean') setDense(userPrefs.wbsDense)
  }, [userPrefs])

  const showConfirm = useConfirmStore(s => s.show)
  const showToast = useToastStore(s => s.show)

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })

  const WBS_COLS = useMemo<ColDef[]>(() => [
    { key: 'wbs_code', label: t('wbs.wbsCode'), defaultWidth: 56, minWidth: 40 },
    { key: 'title', label: t('wbs.titleColumn'), defaultWidth: 200, required: true, minWidth: 120, hint: t('wbs.hints.title') },
    { key: 'task_type', label: t('wbs.typeColumn'), defaultWidth: 52, minWidth: 44, hint: t('wbs.hints.task_type') },
    { key: 'planned_start', label: t('wbs.start'), defaultWidth: 96, hint: t('wbs.hints.planned_start') },
    { key: 'planned_end', label: t('wbs.end'), defaultWidth: 96, hint: t('wbs.hints.planned_end') },
    { key: 'actual_start', label: t('wbs.actualStart'), defaultWidth: 96, hint: t('wbs.hints.actual_start') },
    { key: 'actual_end', label: t('wbs.actualEnd'), defaultWidth: 96, hint: t('wbs.hints.actual_end') },
    { key: 'duration_days', label: t('wbs.duration'), defaultWidth: 56, minWidth: 40, hint: t('wbs.hints.duration_days') },
    { key: 'progress', label: t('wbs.progressColumn'), defaultWidth: 56, minWidth: 40, hint: t('wbs.hints.progress') },
    { key: 'status', label: t('wbs.statusColumn'), defaultWidth: 112, hint: t('wbs.hints.status') },
    { key: 'priority', label: t('wbs.priority'), defaultWidth: 80, hint: t('wbs.hints.priority') },
    { key: 'assignee_name', label: t('wbs.assigneeColumn'), defaultWidth: 112, hint: t('wbs.hints.assignee_name') },
    { key: 'co_assignees', label: t('wbs.coAssignees', { defaultValue: 'Соисполнители' }), defaultWidth: 130,
      hint: t('wbs.hints.co_assignees', { defaultValue: 'Кто ещё участвует в работе. Отвечает за задачу один человек — это колонка «Исполнитель».' }) },
    { key: 'dependencies', label: t('wbs.dependencies', { defaultValue: 'Зависит от' }), defaultWidth: 100 },
    { key: 'condition', label: t('wbs.conditionColumn'), defaultWidth: 110, hint: t('wbs.hints.condition') },
    { key: 'description', label: t('common.description'), defaultWidth: 192, hint: t('wbs.hints.description') },
    { key: 'bitrix24_task_id', label: t('bitrix24Task.column'), defaultWidth: 80 },
  ], [t])

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(104)
  const { isVis, getW, startResize, sort, setSort, hidden, toggleCol } = useColumnSettings('wbs', WBS_COLS, { maxTotalWidth: maxColumnWidthTotal })
  const visibleWbsCols = WBS_COLS.filter(c => isVis(c.key))
  const tableStyle = getManagedTableStyle(WBS_COLS, isVis, getW, 104)

  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId], queryFn: () => getTasks(projectId),
  })

  // Зависимости (предшественники): сырые id предшественников по target. Коды СДР назначаются
  // ниже (assignWbsCodes) — резолвим id→код после построения дерева.
  const { data: ganttData } = useQuery({
    queryKey: ['gantt', projectId], queryFn: () => getGanttData(projectId),
  })
  const predIdMap = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const l of (ganttData?.links ?? [])) {
      const tgt = String(l.target)
      const arr = m.get(tgt) ?? []
      if (!arr.includes(String(l.source))) arr.push(String(l.source))
      m.set(tgt, arr)
    }
    return m
  }, [ganttData])

  const invalidate = () => invalidateProjectTasks(qc, projectId)

  // Экспорт секции — в меню «Ещё» шапки проекта (плоский список задач, до построения дерева)
  const exportRows = useMemo(() => tasks.map((task) => ({
    title: task.title, task_type: task.task_type, status: task.status, priority: task.priority,
    planned_start: task.planned_start, planned_end: task.planned_end,
    duration_days: task.duration_days, progress: task.progress, assignee_name: task.assignee_name,
  })), [tasks])
  useSectionExport('wbs', exportRows)

  // Код СДР — СТАБИЛЬНЫЙ идентификатор задачи по естественной иерархии (sort_order), а не номер
  // строки: считаем его на несортированном дереве и «примораживаем» к задаче. Иначе при сортировке
  // по колонке коды переприсваивались позиции, и нельзя было понять, какая задача где (жалоба владельца).
  // Построение дерева/кодов/статистики мемоизировано по [tasks, sort, predIdMap]: инлайн-редактирование
  // ячейки держит черновик в отдельном стейте, и БЕЗ мемо каждый keystroke пересобирал дерево дважды
  // (buildTree + 4 обхода) — заметный джанк при вводе. editValue в deps НЕ входит → ввод не пересобирает.
  const { tree, predMap, stats } = useMemo(() => {
    const stableCode = new Map<string, string>()
    const natTree = buildTree(tasks)
    assignWbsCodes(natTree)
    const collectStable = (nodes: TaskNode[]) => nodes.forEach((n) => {
      stableCode.set(String(n.id), n.wbs_code || '')
      if (n.children.length) collectStable(n.children)
    })
    collectStable(natTree)

    const tree = buildTree(tasks)
    // Клик по заголовку колонки сортирует дерево (внутри уровней); без сортировки — по sort_order.
    if (sort && !['wbs_code', 'dependencies', 'condition'].includes(sort.field)) {
      sortTree(tree, sort.field, sort.dir)
    }
    // Проставляем замороженные коды на дерево отображения (сортировка их не меняет).
    const applyStable = (nodes: TaskNode[]) => nodes.forEach((n) => {
      n.wbs_code = stableCode.get(String(n.id)) ?? n.wbs_code
      if (n.children.length) applyStable(n.children)
    })
    applyStable(tree)

    // Колонка «Зависит от»: только номер СДР предшественника (напр. «1.2»); в форме задачи — название.
    const wbsCodeById = new Map<string, string>()
    const collectCodes = (nodes: TaskNode[]) => nodes.forEach(n => {
      wbsCodeById.set(String(n.id), n.wbs_code || `#${n.id}`)
      if (n.children.length) collectCodes(n.children)
    })
    collectCodes(tree)
    const predMap = new Map<string, string[]>()
    for (const [tgt, sources] of predIdMap) {
      predMap.set(tgt, sources.map(s => wbsCodeById.get(s) ?? `#${s}`))
    }

    const stats = {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      not_started: tasks.filter(t => t.status === 'not_started').length,
    }
    return { tree, predMap, stats }
  }, [tasks, sort, predIdMap])

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Свернуть/развернуть все уровни: собираем id всех задач, у которых есть дети.
  const toggleAllLevels = () => {
    if (collapsed.size > 0) { setCollapsed(new Set()); return }
    const parentIds = tasks.filter(p => tasks.some(c => c.parent_id === p.id)).map(p => p.id)
    setCollapsed(new Set(parentIds))
  }

  const startEdit = (id: string, field: string, value: string | number | null) => {
    setEditCell({ id, field })
    if (DATE_FIELDS.includes(field) && typeof value === 'string') {
      setEditValue(formatDate(value, ''))
    } else {
      setEditValue(value != null ? String(value) : '')
    }
  }
  const cancelEdit = () => setEditCell(null)

  const commitEdit = async (node: TaskNode, overrideValue?: string) => {
    if (!editCell || editCell.id !== node.id) return
    const { field } = editCell
    setEditCell(null)
    const ev = overrideValue ?? editValue

    let data: Partial<Task> = {}
    if (field === 'progress') {
      data = { progress: Math.max(0, Math.min(100, parseInt(ev) || 0)) }
    } else if (field === 'duration_days') {
      const days = ev ? parseInt(ev) : null
      data = { duration_days: days }
      if (days && node.planned_start) data.planned_end = addDaysToIsoDate(node.planned_start, days)
    } else if (DATE_FIELDS.includes(field)) {
      const iso = parseDateStrict(ev) ?? (ev.match(/^\d{4}-\d{2}-\d{2}$/) ? ev : null)
      // Непустой ввод, но дата не распознана (и это не ISO) — не затираем старое значение,
      // показываем ошибку. Пустой ввод (очистка даты) остаётся легальным.
      if (ev.trim() && iso === null) {
        showToast(t('fix.badDate', { defaultValue: 'Дата не распознана. Формат: дд.мм.гггг' }), 'error')
        return
      }
      data = { [field]: iso } as Partial<Task>
      if (field === 'planned_end' && iso && node.planned_start) {
        data.duration_days = daysDiff(node.planned_start, iso)
      } else if (field === 'planned_start' && iso) {
        if (node.planned_end) {
          data.duration_days = daysDiff(iso, node.planned_end)
        } else if (node.duration_days) {
          data.planned_end = addDaysToIsoDate(iso, node.duration_days)
        }
      }
    } else {
      data = { [field]: ev || null } as Partial<Task>
    }

    await updateTask(projectId, node.id, data)
    await invalidate()
  }

  const handleAddRoot = async (type: 'phase' | 'task') => {
    const siblings = tasks.filter(t => !t.parent_id)
    await createTask(projectId, { title: t(type === 'phase' ? 'wbs.newPhaseTitle' : 'wbs.newTaskTitle'), task_type: type, sort_order: siblings.length, level: 0 })
    await invalidate()
  }

  const handleAddChild = async (parentId: string, level: number) => {
    const siblings = tasks.filter(t => t.parent_id === parentId)
    await createTask(projectId, {
      title: t('wbs.newTaskTitle'), task_type: 'task',
      parent_id: parentId as unknown as Task['parent_id'],
      sort_order: siblings.length, level,
    })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('wbs.deleteConfirm'), async () => {
      // Снимок задачи до удаления — для undo (восстановленная задача получит новый id,
      // зависимости не восстанавливаются). Только существующие/непустые безопасные поля.
      const deleted = tasks.find(task => task.id === id)
      const restorePayload: Partial<Task> | null = deleted
        ? {
            title: deleted.title,
            status: deleted.status,
            priority: deleted.priority,
            task_type: deleted.task_type,
            progress: deleted.progress,
            ...(deleted.description ? { description: deleted.description } : {}),
            ...(deleted.planned_start ? { planned_start: deleted.planned_start } : {}),
            ...(deleted.planned_end ? { planned_end: deleted.planned_end } : {}),
            ...(deleted.duration_days != null ? { duration_days: deleted.duration_days } : {}),
            ...(deleted.assignee_name ? { assignee_name: deleted.assignee_name } : {}),
            ...(deleted.assignee_email ? { assignee_email: deleted.assignee_email } : {}),
            ...(deleted.parent_id ? { parent_id: deleted.parent_id } : {}),
            ...(deleted.estimated_hours != null ? { estimated_hours: deleted.estimated_hours } : {}),
            ...(deleted.actual_hours != null ? { actual_hours: deleted.actual_hours } : {}),
            ...(deleted.bar_color ? { bar_color: deleted.bar_color } : {}),
          }
        : null
      await deleteTask(projectId, id, { silentToast: true })
      await invalidate()
      qc.invalidateQueries({ queryKey: ['backlog', projectId] })
      if (logTask?.id === id) setLogTask(null)
      if (restorePayload) {
        showToast(t('common.deleted', { defaultValue: 'Удалено' }), 'success', {
          action: {
            label: t('common.undo', { defaultValue: 'Отменить' }),
            onClick: async () => {
              await createTask(projectId, restorePayload)
              await invalidate()
              qc.invalidateQueries({ queryKey: ['backlog', projectId] })
            },
          },
        })
      } else {
        showToast(t('common.deleted', { defaultValue: 'Удалено' }), 'success')
      }
    })
  }

  const flattenTree = useCallback((nodes: TaskNode[]): TaskNode[] => {
    const result: TaskNode[] = []
    const walk = (ns: TaskNode[]) => { ns.forEach(n => { result.push(n); walk(n.children) }) }
    walk(nodes)
    return result
  }, [])

  /**
   * Куда именно кладём: над строкой, ВНУТРЬ неё или под ней.
   *
   * Раньше зоны не было вовсе — перетаскивание всегда делало задачу СОСЕДОМ цели, то есть
   * вложить задачу в фазу, а подзадачу в задачу было нельзя ничем, кроме кнопки «добавить
   * подзадачу». Верхняя и нижняя четверть строки — «рядом», середина — «внутрь»: тот же
   * приём, что в любом дереве файлов.
   */
  const zoneOf = (e: React.DragEvent): 'before' | 'inside' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - r.top
    if (y < r.height * 0.25) return 'before'
    if (y > r.height * 0.75) return 'after'
    return 'inside'
  }

  /** Нельзя положить ветку внутрь её же потомка — дерево замкнулось бы и выпало с экрана. */
  const isDescendant = (flat: TaskNode[], ancestorId: string, nodeId: string): boolean => {
    let cur = flat.find(n => n.id === nodeId)
    while (cur?.parent_id) {
      if (cur.parent_id === ancestorId) return true
      cur = flat.find(n => n.id === cur!.parent_id)
    }
    return false
  }

  const handleDragStart = (e: React.DragEvent, id: string) => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId && dragId !== id) setDropHint({ id, zone: zoneOf(e) })
  }
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    setDropHint(null)
    if (!dragId || dragId === targetId) return
    const flat = flattenTree(tree)
    const dragNode = flat.find(n => n.id === dragId)
    const targetNode = flat.find(n => n.id === targetId)
    if (!dragNode || !targetNode) return
    if (isDescendant(flat, dragId, targetId)) return   // в своего же потомка — молча ничего

    const zone = zoneOf(e)
    const newParent = zone === 'inside' ? targetNode.id : targetNode.parent_id
    const newLevel = zone === 'inside' ? targetNode.level + 1 : targetNode.level
    const siblings = flat.filter(n => n.parent_id === newParent && n.id !== dragId)
    const at = zone === 'inside'
      ? siblings.length                                   // внутрь — в конец списка детей
      : siblings.findIndex(n => n.id === targetId) + (zone === 'after' ? 1 : 0)
    siblings.splice(Math.max(0, at), 0, { ...dragNode, parent_id: newParent, level: newLevel })
    const reorderItems = siblings.map((n, idx) => ({
      id: n.id, parent_id: n.parent_id, sort_order: idx, level: n.level, wbs_code: '',
    }))
    await reorderTasks(projectId, reorderItems)
    await invalidate()
    setDragId(null)
  }

  const dragProps = {
    draggable: canWrite,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragLeave: () => setDropHint(null),
    dropHint,
  }

  const guideSteps: GuideStep[] = [
    { title: t('wbs.guide.s1'), desc: t('wbs.guide.s1d') },
    { title: t('wbs.guide.s2'), desc: t('wbs.guide.s2d') },
    { title: t('wbs.guide.s3'), desc: t('wbs.guide.s3d') },
    { title: t('wbs.guide.s4'), desc: t('wbs.guide.s4d') },
    { title: t('wbs.guide.s5'), desc: t('wbs.guide.s5d') },
  ]

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <ProcessGuide steps={guideSteps} />
          <div className="flex gap-3 text-xs">
            <span className="text-gray-500 dark:text-slate-300">{t('wbs.total')}: <b>{stats.total}</b></span>
            <span className="text-green-600">{t('wbs.done')}: <b>{stats.completed}</b></span>
            <span className="text-blue-600">{t('wbs.inProgress')}: <b>{stats.in_progress}</b></span>
            <span className="text-gray-500 dark:text-slate-400">{t('wbs.notStarted')}: <b>{stats.not_started}</b></span>
          </div>
          {/* Плотность строк. Не масштаб браузера: тот мылит шрифт и ужимает вообще всё,
              включая сайдбар. Здесь меняются только отступы и кегль таблицы, а выбор
              запоминается за пользователем. */}
          <button
            onClick={() => setDense((v) => {
              const next = !v
              void putUserPrefs({ wbsDense: next }).catch(() => { /* не запомнили — не беда */ })
              return next
            })}
            aria-pressed={dense}
            title={t('wbs.densityHint', { defaultValue: 'Плотные строки: больше задач помещается на экран' })}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs ${dense
              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-950/40 dark:text-primary-200'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
          >
            <Rows3 size={12} />
            {t('wbs.density', { defaultValue: 'Плотно' })}
          </button>
          {tasks.length > 0 && (
            <button onClick={toggleAllLevels}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
              {collapsed.size > 0 ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              {collapsed.size > 0 ? t('wbs.expandAll', { defaultValue: 'Развернуть все' }) : t('wbs.collapseAll', { defaultValue: 'Свернуть все' })}
            </button>
          )}
          {canWrite && (
            <div className="ml-auto flex gap-2">
              <button onClick={() => handleAddRoot('phase')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-200 dark:hover:bg-slate-700">
                <Plus size={12} /> {t('wbs.phase')}
              </button>
              <button onClick={() => handleAddRoot('task')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
                <Plus size={12} /> {t('wbs.addTask')}
              </button>
              <button onClick={() => setShowBulk(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
                <Plus size={12} /> {t('bulk.button', { defaultValue: 'Массово' })}
              </button>
            </div>
          )}
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-12">{t('wbs.noTasks')}</p>
        ) : (
        <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS} data-density={dense ? 'compact' : undefined}>
            <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="w-7 min-w-7 max-w-7" />
                  {visibleWbsCols.map((col, index) => (
                    <ColTh key={col.key} col={col} sort={sort} onSort={setSort}
                      width={getW(col.key)} onResize={startResize(col.key)}
                      onResizePrev={index > 0 ? startResize(visibleWbsCols[index - 1].key) : undefined} />
                  ))}
                  <th className={TABLE_ACTION_HEAD_WIDE_CLASS}>
                    <ColumnToggler cols={WBS_COLS} hidden={hidden} onToggle={toggleCol} align="right" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {tree.map((node) => (
                  <NodeRow key={node.id} node={node} depth={0} collapsed={collapsed}
                    toggleCollapse={toggleCollapse} onDelete={handleDelete} onAddChild={handleAddChild}
                    onLog={(id, title) => setLogTask({ id, title })} onBitrix={setBitrixNode}
                    onOpenDetail={setDetailTask}
                    onOpenCoAssignees={setCoTask}
                    editCell={editCell} editValue={editValue} setEditValue={setEditValue}
                    startEdit={startEdit} commitEdit={commitEdit} cancelEdit={cancelEdit}
                    isVis={isVis} getW={getW} canWrite={canWrite} predMap={predMap} dragProps={dragProps} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showBulk && <BulkTaskDialog projectId={projectId} onClose={() => setShowBulk(false)} />}

      {logTask && (
        <LogPanel projectId={projectId} entityType="task" entityId={logTask.id}
          title={logTask.title} onClose={() => setLogTask(null)} />
      )}

      {bitrixNode && (
        <BitrixTaskDialog
          open
          onClose={() => setBitrixNode(null)}
          projectId={projectId}
          entityType="task"
          entityId={bitrixNode.id}
          bitrix24TaskId={bitrixNode.bitrix24_task_id}
          prefill={{
            title: bitrixNode.title,
            description: bitrixNode.description ?? null,
            assigneeName: bitrixNode.assignee_name,
            pmName: project?.pm_name ?? null,
            deadline: bitrixNode.planned_end,
          }}
          onCreateTask={async (payload) => {
            await createBitrix24Task(projectId, bitrixNode.id, payload)
            await invalidate()
          }}
          onDeleteTask={async () => {
            await deleteBitrix24Task(projectId, bitrixNode.id)
            await invalidate()
          }}
        />
      )}

      <TaskDrawer
        task={detailTask}
        projectId={projectId}
        onClose={() => setDetailTask(null)}
        onSave={async (id, data) => {
          await updateTask(projectId, id, data)
          await invalidate()
        }}
      />

      {coTask && (
        <CoAssigneesDialog
          taskTitle={coTask.title}
          value={coTask.co_assignees ?? []}
          canWrite={canWrite}
          onClose={() => setCoTask(null)}
          onSave={async (list) => {
            // Отправляем ИМЕНА и person_id; сервер опознаёт людей заново по справочнику —
            // он же отсекает дубликаты и самого ответственного. Клиент тут не источник правды.
            await updateTask(projectId, coTask.id, { co_assignees: list })
            setCoTask(null)
            await invalidate()
          }}
        />
      )}
    </div>
  )
}
