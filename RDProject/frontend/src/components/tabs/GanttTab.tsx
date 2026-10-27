import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Columns3, Columns2, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getGanttData, createDependency, deleteDependency } from '@/api/gantt'
import type { GanttData } from '@/api/gantt'
import { createTask, updateTask, getTasks } from '@/api/tasks'
import type { Task } from '@/types/task'
import TaskDrawer from '@/components/TaskDrawer'
import { Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useSectionExport } from '@/hooks/useSectionExport'
import { useTranslation } from 'react-i18next'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import i18n from '@/i18n'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { useToastStore } from '@/store/toastStore'
import { localIsoDate } from '@/utils/date'
import { escapeHtml } from '@/utils/html'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'

// Локальная YYYY-MM-DD из Date (без UTC-сдвига), с опциональным сдвигом на N дней.
function localDay(d: Date | undefined, addDays = 0): string | null {
  if (!d) return null
  return localIsoDate(d, addDays)
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface GanttMarker {
  start_date: Date
  css?: string
  text?: string
  title?: string
}

interface GanttTaskPosition {
  left: number
  top: number
  width: number
  height: number
  rowHeight: number
}

interface GanttAPI {
  config: Record<string, unknown>
  templates: Record<string, (...args: unknown[]) => string>
  columns: unknown[]
  init: (el: HTMLElement) => void
  parse: (data: unknown) => void
  clearAll: () => void
  detachAllEvents?: () => void
  render: () => void
  attachEvent: (event: string, fn: (...args: unknown[]) => unknown) => string
  addMarker: (marker: GanttMarker) => string
  addTaskLayer: (renderer: (task: Record<string, unknown>) => HTMLElement | false) => string
  getTaskPosition: (task: Record<string, unknown>, start: Date, end: Date) => GanttTaskPosition
  getScrollState: () => { x: number; y: number }
  scrollTo: (x: number, y: number) => void
  posFromDate?: (date: Date) => number
  getTask?: (id: string) => Record<string, unknown> | null
  isTaskExists?: (id: string) => boolean
  $task_data?: HTMLElement
}

let ganttModule: GanttAPI | null = null

async function loadGantt(): Promise<GanttAPI> {
  if (ganttModule) return ganttModule
  const mod = await import('dhtmlx-gantt')
  ganttModule = (mod as unknown as { gantt: GanttAPI }).gantt
  return ganttModule
}

const PRIORITY_COLORS: Record<string, string> = {
  // low — нейтральный серый (как в constants/statusColors везде), не зелёный: раньше Гант красил
  // низкий приоритет зелёным (читается «хорошо»), а бейджи/таблицы — серым → рассинхрон.
  critical: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#94a3b8',
}

const STATUS_LABELS: Record<string, string> = {
  not_started: i18n.t('gantt.statuses.not_started'),
  in_progress: i18n.t('gantt.statuses.in_progress'),
  completed: i18n.t('gantt.statuses.completed'),
  cancelled: i18n.t('gantt.statuses.cancelled'),
  on_hold: i18n.t('gantt.statuses.on_hold'),
}

function formatDateCompact(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr === '—') return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}.${mm}.${yy}`
}

function setGanttScale(g: GanttAPI, view: 'week' | 'month' | 'quarter') {
  if (view === 'week') {
    g.config.scale_unit = 'week'; g.config.date_scale = 'Week #%W'
    g.config.subscales = [{ unit: 'day', step: 1, date: '%D %d' }]
    g.config.column_width = 36
  } else if (view === 'month') {
    g.config.scale_unit = 'month'; g.config.date_scale = '%F %Y'
    g.config.subscales = [{ unit: 'week', step: 1, date: '#%W' }]
    g.config.column_width = 70
  } else {
    g.config.scale_unit = 'month'; g.config.date_scale = '%F %Y'
    g.config.subscales = []; g.config.step = 3; g.config.column_width = 100
  }
  g.render()
}

// Column definitions
// Ширина грида (таблицы слева): Community-редакция DHTMLX не даёт ни пер-колоночного
// resize, ни штатного разделителя — рисуем свою ручку и меняем config.grid_width.
const GRID_W_KEY = 'pm-gantt-grid-w'
const GRID_W_DEFAULT = 374
const GRID_W_MIN = 240
const GRID_W_MAX = 900

const COMPACT_COLUMNS = [
  // width '*': колонка задачи забирает всё свободное место грида — потянув разделитель
  // грид|диаграмма (grid_resize), пользователь растягивает именно название задачи.
  // resize: true — ручки ресайза на границах колонок.
  {
    name: 'text', label: i18n.t('gantt.columns.task'), tree: true, width: '*', min_width: 140, resize: true,
    template: (t: Record<string, unknown>) => escapeHtml(t.text),
  },
  {
    name: 'start_date', label: i18n.t('gantt.columns.start'), width: 68, min_width: 56, align: 'center', resize: true,
    template: (t: Record<string, unknown>) => formatDateCompact(t.start_date as string),
  },
  {
    name: 'end_date', label: i18n.t('gantt.columns.end'), width: 68, min_width: 56, align: 'center', resize: true,
    template: (t: Record<string, unknown>) => formatDateCompact(t.end_date_str as string),
  },
]

const EXTRA_COLUMNS = [
  // «Дни» — не в компактном виде, а в расширенном («Все колонки»), по просьбе владельца.
  { name: 'duration', label: i18n.t('gantt.columns.days'), width: 38, min_width: 34, align: 'center', resize: true },
  {
    name: 'progress', label: '%', width: 36, align: 'center',
    template: (t: Record<string, unknown>) => `${Math.round((t.progress as number) * 100)}%`,
  },
  {
    name: 'status', label: i18n.t('gantt.columns.status'), width: 72, align: 'center',
    template: (t: Record<string, unknown>) => {
      const s = t.status as string
      return escapeHtml(STATUS_LABELS[s] ?? s ?? '—')
    },
  },
  {
    name: 'assignee', label: i18n.t('gantt.columns.assignee'), width: 80, align: 'center',
    template: (t: Record<string, unknown>) => escapeHtml((t.assignee as string) ?? '—'),
  },
]

interface Props { projectId: string }

export default function GanttTab({ projectId }: Props) {
  const { t } = useTranslation()
  const canWrite = useCanWrite()
  const canWriteRef = useRef(canWrite)
  const containerRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const initialized = useRef(false)
  const latestData = useRef<GanttData | null>(null)
  const latestTasks = useRef<Task[]>([])
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [view, setView] = useState<'week' | 'month' | 'quarter'>('month')
  const [expanded, setExpanded] = useState(false)
  const [allOpen, setAllOpen] = useState(true)
  const [gridW, setGridW] = useState<number>(() => {
    const v = Number(localStorage.getItem(GRID_W_KEY))
    return v >= GRID_W_MIN && v <= GRID_W_MAX ? v : GRID_W_DEFAULT
  })
  const gridWRef = useRef(gridW)
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const phaseToastAt = useRef(0)  // троттлинг тоста «фазу нельзя двигать» (DHTMLX стреляет событие дважды)

  const { data: ganttData, isLoading, isError, refetch } = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => getGanttData(projectId),
  })

  const { data: taskList = [] } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => getTasks(projectId),
  })

  useEffect(() => { latestData.current = ganttData ?? null }, [ganttData])
  useEffect(() => { latestTasks.current = taskList }, [taskList])

  // Экспорт секции (меню «Ещё» шапки) — те же задачи, что и в WBS
  const exportRows = useMemo(() => taskList.map((tk) => ({
    title: tk.title, task_type: tk.task_type, status: tk.status, priority: tk.priority,
    planned_start: tk.planned_start, planned_end: tk.planned_end,
    duration_days: tk.duration_days, progress: tk.progress, assignee_name: tk.assignee_name,
  })), [taskList])
  useSectionExport('gantt', exportRows)

  useEffect(() => {
    if (!ganttModule || !initialized.current) return
    setGanttScale(ganttModule, view)
  }, [view])

  // Toggle columns expanded/compact
  useEffect(() => {
    if (!ganttModule || !initialized.current) return
    const g = ganttModule
    g.config.columns = expanded ? [...COMPACT_COLUMNS, ...EXTRA_COLUMNS] : [...COMPACT_COLUMNS]
    g.render()
  }, [expanded])

  // Ширина грида: применяем при изменении (колонка «Задача» с width:'*' забирает прирост)
  useEffect(() => {
    gridWRef.current = gridW
    if (ganttModule && initialized.current) {
      ganttModule.config.grid_width = gridW
      ganttModule.render()
    }
  }, [gridW])

  const onGridResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = gridWRef.current
    const move = (ev: MouseEvent) => {
      setGridW(Math.min(GRID_W_MAX, Math.max(GRID_W_MIN, startW + ev.clientX - startX)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setGridW((w) => {
        try { localStorage.setItem(GRID_W_KEY, String(w)) } catch { /* приватный режим */ }
        return w
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Клавиатурный доступ к ручке ширины грида: dhtmlx-канвас сама по себе тач/мышь-only
  // (сторонний лимит), но наш hand-rolled разделитель обязан работать со стрелками.
  const GRID_RESIZE_STEP = 12
  const onGridResizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? GRID_RESIZE_STEP * 4 : GRID_RESIZE_STEP
    const delta = e.key === 'ArrowRight' ? step : -step
    setGridW((w) => {
      const next = Math.min(GRID_W_MAX, Math.max(GRID_W_MIN, w + delta))
      try { localStorage.setItem(GRID_W_KEY, String(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  // Read-only for users who can't write this project (mirrors server RBAC):
  // disables drag/resize/link gestures so they never trigger a silently-failing save.
  useEffect(() => {
    canWriteRef.current = canWrite
    if (ganttModule && initialized.current) {
      ganttModule.config.readonly = !canWrite
      ganttModule.render()
    }
  }, [canWrite])

  const parseData = useCallback(() => {
    if (!latestData.current || !ganttModule) return
    const today = localIsoDate()
    ganttModule.clearAll()
    ganttModule.parse({
      data: latestData.current.tasks.map((t) => ({
        id: t.id,
        text: t.text,
        wbs: t.wbs,
        start_date: t.start_date ?? today,
        end_date_str: t.end_date ?? '—',
        duration: t.duration || 1,
        progress: t.progress,
        parent: t.parent,
        type: t.type,
        open: t.open,
        assignee: t.assignee_name ?? '—',
        status: t.status ?? 'not_started',
        priority: t.priority ?? 'medium',
        color: t.bar_color ?? PRIORITY_COLORS[t.priority ?? 'medium'] ?? '#3b82f6',
        critical: t.critical ?? false,
        baseline_start: t.baseline_start ?? null,
        baseline_end: t.baseline_end ?? null,
      })),
      links: latestData.current.links,
    })
  }, [])

  const initGantt = useCallback(async () => {
    if (!containerRef.current || initialized.current) return
    let g: GanttAPI
    try { g = await loadGantt() } catch { return }

    initialized.current = true

    // ── Core config ──
    g.config.date_format = '%Y-%m-%d'
    // Перетаскивание меняет даты С ТОЧНОСТЬЮ ДО ДНЯ в любом масштабе.
    //
    // По умолчанию DHTMLX округляет результат драга до единицы ШКАЛЫ. В режиме «квартал»
    // шкала — три месяца, поэтому сдвиг на пару недель округлялся в ноль: бар возвращался
    // на место, PUT не уходил, и каскад по зависимостям (он на сервере, в обработчике
    // сохранения задачи) не срабатывал вовсе. Выглядело как «связи работают только в месяце».
    g.config.round_dnd_dates = false
    g.config.duration_unit = 'day'
    g.config.sort = true
    g.config.row_height = 28
    g.config.bar_height = 16
    g.config.scale_height = 50
    g.config.show_progress = true
    g.config.show_markers = true  // may be ignored in Community edition
    g.config.show_errors = false  // не показывать внутренние всплывашки DHTMLX (напр. «Task not found»)
    g.config.smart_rendering = true
    g.config.fit_tasks = true
    // Auto-shift dependent tasks when a predecessor moves or a link is added
    // (the original product's #1 pain point: Excel needs manual redrawing).
    // Don't reschedule on initial load — only react to user actions.
    g.config.auto_scheduling = true
    g.config.auto_scheduling_strict = true
    g.config.auto_scheduling_initial = false
    g.config.scroll_size = 14
    g.config.autosize = false
    g.config.grid_resize = true
    g.config.grid_width = gridWRef.current  // сохранённая пользователем ширина таблицы
    g.config.readonly = !canWriteRef.current

    // ── Columns (compact by default) ──
    g.config.columns = [...COMPACT_COLUMNS]

    // ── Scale ──
    setGanttScale(g, view)

    // ── Templates ──
    g.templates.grid_file = () => ''
    g.templates.grid_folder = () => ''

    // Task bar text: show task name + progress inside the bar
    g.templates.task_text = (_start: unknown, _end: unknown, task: unknown) => {
      const t = task as { text: string; progress: number }
      const pct = Math.round(t.progress * 100)
      if (pct > 0 && pct < 100) {
        return `<span class="gantt-bar-text">${escapeHtml(t.text)}</span><span class="gantt-bar-pct">${pct}%</span>`
      }
      return `<span class="gantt-bar-text">${escapeHtml(t.text)}</span>`
    }

    // Task class: mark completed / cancelled / critical-path tasks
    g.templates.task_class = (_start: unknown, _end: unknown, task: unknown) => {
      const t = task as { progress: number; status: string; critical?: boolean }
      const classes: string[] = []
      if (t.progress >= 1 || t.status === 'completed') classes.push('gantt-task-completed')
      if (t.status === 'cancelled') classes.push('gantt-task-cancelled')
      if (t.critical) classes.push('gantt-critical')
      return classes.join(' ')
    }

    // Row class: highlight completed rows
    g.templates.task_row_class = (_start: unknown, _end: unknown, task: unknown) => {
      const t = task as { progress: number; status: string }
      if (t.progress >= 1 || t.status === 'completed') return 'gantt-row-completed'
      return ''
    }

    // Grid row class
    g.templates.grid_row_class = (_start: unknown, _end: unknown, task: unknown) => {
      const t = task as { progress: number; status: string }
      if (t.progress >= 1 || t.status === 'completed') return 'gantt-row-completed'
      return ''
    }

    // ── Оверлеи «Базовый план» + «Сегодня» рисуем ВРУЧНУЮ в слое .gantt_task_bg (полная высота
    // контента). addTaskLayer/addMarker в Community-сборке отсутствуют (undefined) → штатные
    // способы не работали: базовый план не рисовался вовсе, линия «Сегодня» обрезалась по высоте
    // видимой области (.gantt_data_area = 493px вместо 840px контента). ──
    const redrawOverlays = () => {
      const root = containerRef.current
      const bg = root?.querySelector('.gantt_task_bg') as HTMLElement | null
      if (!bg) return
      root!.querySelectorAll('.gantt-today-line, .gantt-baseline-bar').forEach((n) => n.remove())

      // Базовый план: серая полоса под задачей на плановых датах снимка.
      if (typeof g.getTaskPosition === 'function' && typeof g.getTask === 'function') {
        for (const t of (latestData.current?.tasks ?? [])) {
          if (!t.baseline_start || !t.baseline_end) continue
          // isTaskExists ОБЯЗАТЕЛЕН: getTask/getTaskPosition для отсутствующей задачи бросают
          // assert → DHTMLX сыпал всплывашки «Task not found id=…». Рисуем только для тех, что в модели.
          if (typeof g.isTaskExists === 'function' && !g.isTaskExists(String(t.id))) continue
          let task: Record<string, unknown> | null = null
          try { task = g.getTask(String(t.id)) } catch { continue }
          if (!task) continue
          try {
            const p = g.getTaskPosition(task, new Date(t.baseline_start), new Date(t.baseline_end))
            const bar = document.createElement('div')
            bar.className = 'gantt-baseline-bar'
            bar.style.cssText = `left:${p.left}px;top:${p.top + p.rowHeight - 7}px;width:${Math.max(2, p.width)}px;`
            bg.appendChild(bar)
          } catch { /* пропускаем задачу */ }
        }
      }

      // Линия «Сегодня» — явная высота = полная высота контента (не bottom:0, иначе обрезалась
      // по высоте видимой области; берём scrollHeight фона).
      if (typeof g.posFromDate === 'function') {
        let x: number | null = null
        try { x = g.posFromDate(new Date()) } catch { x = null }
        if (typeof x === 'number' && !Number.isNaN(x)) {
          const fullH = Math.max(bg.scrollHeight, bg.offsetHeight)
          const line = document.createElement('div')
          line.className = 'gantt-today-line'
          line.style.cssText = `left:${x}px;top:0;height:${fullH}px;`
          line.setAttribute('title', i18n.t('gantt.today', { defaultValue: 'Сегодня' }))
          bg.appendChild(line)
        }
      }
    }
    g.attachEvent('onGanttRender', () => { redrawOverlays(); return true })

    // ── Events ──
    // Одиночный клик — только выделение (раньше сразу распахивался редактор — «нажимаю,
    // открывается окно»). Редактор задачи — по двойному клику, как в Excel/MS Project.
    g.attachEvent('onTaskClick', () => true)
    g.attachEvent('onTaskDblClick', (id: unknown) => {
      const task = latestTasks.current.find(t => t.id === String(id))
      if (task) setEditTask(task)
      return false  // не открывать штатный lightbox DHTMLX
    })

    // Фазы (summary) нельзя двигать/растягивать: их срок ВЫЧИСЛЯЕТСЯ из дочерних задач,
    // бэкенд правки дат фазы игнорирует → драг «не сохранялся, а после рестарта пропадал»
    // (жалоба владельца). Блокируем драг фаз с подсказкой; двигать нужно задачи внутри.
    g.attachEvent('onBeforeTaskDrag', (id: unknown) => {
      const t2 = latestData.current?.tasks.find((x) => String(x.id) === String(id))
      if (t2 && t2.type === 'phase') {
        const now = Date.now()
        if (now - phaseToastAt.current > 1500) {
          phaseToastAt.current = now
          useToastStore.getState().show(
            i18n.t('gantt.phaseLocked', { defaultValue: 'Срок фазы вычисляется из её задач — двигайте задачи внутри фазы.' }),
            'info',
          )
        }
        return false
      }
      return true
    })

    // Дебаунс сохранения: при драге с авто-планированием DHTMLX стреляет onAfterTaskUpdate
    // ДВАЖДЫ по одной задаче → два параллельных PUT → второй падал 409 UpdateConflict
    // («какая-то ошибка» при растягивании срока). Шлём только финальное состояние.
    g.attachEvent('onAfterTaskUpdate', (id: unknown, task: unknown) => {
      const key = String(id)
      const t = task as { start_date: Date; end_date: Date; progress: number }
      const payload = {
        // Локальная дата (не toISOString/UTC — иначе день уезжает в +TZ);
        // end у DHTMLX эксклюзивна (полночь следующего дня) → вычитаем 1 день.
        planned_start: localDay(t.start_date),
        planned_end: localDay(t.end_date, -1),
        progress: Math.round(t.progress * 100),
      }
      const timers = saveTimers.current
      const prev = timers.get(key)
      if (prev) clearTimeout(prev)
      timers.set(key, setTimeout(async () => {
        timers.delete(key)
        try {
          await updateTask(projectId, key, payload)
          // Инвалидируем И ['gantt'] (источник баров) — иначе после сохранения бар
          // откатывался к устаревшему кэшу («срок не меняется»). ['tasks'] — для экспорта/дровера.
          await invalidateProjectTasks(qc, projectId)
        } catch {
          // Save failed (e.g. 403) — global toast shows the message; resync to revert the local move.
          qc.invalidateQueries({ queryKey: ['gantt', projectId] })
        }
      }, 350))
      return true
    })

    g.attachEvent('onAfterLinkAdd', async (_id: unknown, link: unknown) => {
      const l = link as { source: string; target: string; type: string }
      // DHTMLX link: source = predecessor, target = successor.
      // Adapter expects task_id = dependent (successor), depends_on_id = predecessor,
      // so the dependency survives a reload with the same direction.
      try {
        await createDependency(projectId, l.target, l.source, l.type)
      } catch (err) {
        // Сервер отклоняет связь с собственной фазой, цикл и дубль. Без этого сообщения
        // стрелка просто исчезала после обновления — отказ выглядел как сбой портала.
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        useToastStore.getState().show(
          detail || i18n.t('common.error', { defaultValue: 'Ошибка' }), 'error')
      } finally {
        qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      }
    })

    g.attachEvent('onAfterLinkDelete', async (id: unknown) => {
      try {
        await deleteDependency(projectId, String(id))
      } finally {
        qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      }
    })

    g.init(containerRef.current)
    parseData()
  }, [projectId, qc, parseData, view])

  useEffect(() => {
    initGantt()
    return () => {
      initialized.current = false
      // Реальный teardown: без него dhtmlx-синглтон копит обработчики от каждого init и
      // держит DOM прошлого проекта. detachAllEvents снимает накопленные хендлеры,
      // clearAll очищает данные/разметку — иначе переход Гант→Гант рушил React removeChild.
      const g = ganttModule
      if (g) {
        try { g.detachAllEvents?.() } catch { /* ignore */ }
        try { g.clearAll() } catch { /* ignore */ }
      }
    }
  }, [initGantt])

  useEffect(() => {
    if (!ganttData || !initialized.current) return
    parseData()
  }, [ganttData, parseData])

  const handleAddTask = async () => {
    const today = localIsoDate()
    const created = await createTask(projectId, {
      title: t('wbs.newTaskTitle'), task_type: 'task', sort_order: 999, level: 0,
      planned_start: today, planned_end: today,
    })
    setEditTask(created)
  }

  const handleSaveTask = async (id: string, data: Partial<Task>) => {
    await updateTask(projectId, id, data)
    await invalidateProjectTasks(qc, projectId)
    setEditTask(null)
  }

  // Collapse/expand every WBS level at once. Community DHTMLX exposes eachTask/open/close
  // on the gantt singleton but they aren't on our narrow GanttAPI type — cast a typed shape.
  const toggleAllLevels = () => {
    const g = ganttModule
    if (!g) return
    const open = !allOpen
    const api = g as unknown as {
      eachTask?: (cb: (task: { id: string }) => void) => void
      open?: (id: string) => void
      close?: (id: string) => void
      render?: () => void
    }
    api.eachTask?.((task) => { if (open) api.open?.(task.id); else api.close?.(task.id) })
    api.render?.()
    setAllOpen(open)
  }

  const guideSteps: GuideStep[] = [
    { title: t('gantt.guide.s1'), desc: t('gantt.guide.s1d') },
    { title: t('gantt.guide.s2'), desc: t('gantt.guide.s2d') },
    { title: t('gantt.guide.s3'), desc: t('gantt.guide.s3d') },
    { title: t('gantt.guide.s4'), desc: t('gantt.guide.s4d') },
  ]

  const isEmpty = !ganttData || ganttData.tasks.length === 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ProcessGuide steps={guideSteps} />
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 dark:border-slate-700 rounded-md text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            title={expanded ? t('gantt.showCompactColumns') : t('gantt.showAllColumns')}>
            {expanded ? <Columns2 size={ICON_SM} /> : <Columns3 size={ICON_SM} />}
            {expanded ? t('gantt.compact') : t('gantt.allColumns')}
          </button>
          <button onClick={toggleAllLevels}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 dark:border-slate-700 rounded-md text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            title={t('gantt.toggleLevels', { defaultValue: 'Свернуть/развернуть все уровни' })}
            aria-label={t('gantt.toggleLevels', { defaultValue: 'Свернуть/развернуть все уровни' })}>
            {allOpen ? <ChevronsDownUp size={ICON_SM} /> : <ChevronsUpDown size={ICON_SM} />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-gray-200 dark:border-slate-700 rounded-md overflow-hidden">
            {(['week', 'month', 'quarter'] as const).map(v => (
              // Подпись одной буквой экономит место, но «W/M/Q» сами по себе ничего не говорят —
              // подсказка и aria-подпись объясняют масштаб словами.
              <button key={v} onClick={() => setView(v)}
                title={t(`gantt.scale.${v}`, { defaultValue: v })}
                aria-label={t(`gantt.scale.${v}`, { defaultValue: v })}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${view === v ? 'bg-primary-600 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                {v === 'week' ? 'W' : v === 'month' ? 'M' : 'Q'}
              </button>
            ))}
          </div>
          {canWrite && (
            <button onClick={handleAddTask}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover transition-colors">
              <Plus size={12} /> {t('gantt.addTask')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-2 text-xs text-gray-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5 cursor-help" title={t('gantt.criticalPathHint', { defaultValue: 'Цепочка задач, определяющая срок всего проекта: задержка любой из них сдвигает финал. Такие бары обведены красным.' })}>
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: '#f43f5e' }} />
          {t('gantt.criticalPath', { defaultValue: 'Критический путь' })}
        </span>
        <span className="flex items-center gap-1.5 cursor-help" title={t('gantt.baselineHint', { defaultValue: 'Серая полоса под задачей — плановые даты из сохранённого снимка («Базовый план»). Видно, на сколько задача уехала от обещанного.' })}>
          <span className="inline-block h-1.5 w-4 rounded-sm" style={{ backgroundColor: '#cbd5e1' }} />
          {t('gantt.baseline', { defaultValue: 'Базовый план' })}
        </span>
        <span className="flex items-center gap-1.5 cursor-help" title={t('gantt.todayHint', { defaultValue: 'Красная вертикальная линия — сегодняшняя дата. Всё слева от неё должно быть выполнено.' })}>
          <span className="inline-block h-3 w-0.5" style={{ backgroundColor: '#ef4444' }} />
          {t('gantt.today', { defaultValue: 'Сегодня' })}
        </span>
      </div>

      <div className="relative">
        {/* Контейнер dhtmlx — БЕЗ React-детей: g.init() перетирает его innerHTML, и любой
            React-узел внутри (оверлеи ниже) ронял removeChild при размонтировании. */}
        <div ref={containerRef} style={{ height: '560px', width: '100%' }}
          className="gantt-wrapper border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden relative" />
        {/* Оверлеи — СОСЕДИ контейнера (absolute inset-0 поверх той же области), не его дети. */}
        {isError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-slate-900 p-4 rounded-lg">
            <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 text-center text-sm text-rose-700 dark:text-rose-300">
              <p className="mb-3">{t('common.error')}</p>
              <Button variant="secondary" onClick={() => void refetch()}>{t('common.retry')}</Button>
            </Surface>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0 z-10 bg-white dark:bg-slate-900 p-4 rounded-lg">
            <SkeletonRows rows={8} />
          </div>
        ) : isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-slate-900 z-10 gap-3 rounded-lg">
            <p className="text-gray-500 dark:text-slate-300 text-sm">{t('gantt.emptyState')}</p>
          </div>
        )}
        {/* Своя ручка ширины таблицы: Community-DHTMLX не рисует ни колоночный resize,
            ни штатный разделитель. Драг двигает config.grid_width (растёт колонка «Задача»). */}
        {!isEmpty && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('gantt.resizeGrid', { defaultValue: 'Ширина таблицы задач' })}
            aria-valuenow={gridW}
            aria-valuemin={GRID_W_MIN}
            aria-valuemax={GRID_W_MAX}
            title={t('gantt.resizeGridHint', { defaultValue: 'Потяните, чтобы изменить ширину таблицы задач' })}
            tabIndex={0}
            onMouseDown={onGridResizeStart}
            onKeyDown={onGridResizeKeyDown}
            style={{ left: gridW - 3 }}
            className="absolute inset-y-1 z-20 w-1.5 cursor-col-resize rounded bg-slate-300/0 transition-colors hover:bg-blue-500/50 active:bg-blue-500/70 focus-visible:outline-none focus-visible:bg-blue-500/70 focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        )}
      </div>

      <TaskDrawer task={editTask} onClose={() => setEditTask(null)} onSave={handleSaveTask} projectId={projectId} />
    </div>
  )
}
