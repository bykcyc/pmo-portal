import type { Task } from '@/types/task'

/**
 * Опорные точки проекта для паспорта — это ВСЕГДА План работ, а не отдельный список.
 *
 * Правило одно на все проекты: есть фазы — опорные точки это фазы; фаз нет — это задачи
 * верхнего уровня. Раньше был ещё третий источник — список, набранный в паспорте текстом, — и
 * он расходился с планом: у одного проекта веха «презентация» стояла в тексте на 1 июля, а та
 * же задача в плане — на 30 сентября. Двух списков одного и того же не бывает; остаётся план.
 *
 * Подзадачи в опорные точки не попадают: это детализация работы, а не точки отчёта.
 */

export type MilestoneState = 'done' | 'cancelled' | 'open'

export interface Milestone {
  id: string
  title: string
  /** Плановое окончание, как оно лежит в задаче; `null` — дата не проставлена. */
  date: string | null
  state: MilestoneState
}

const isPhase = (t: Task) => t.task_type === 'phase'

/**
 * Фаза выполнена, если закрыта сама ИЛИ закрыты все её задачи.
 *
 * Второе обязательно: человек закрывает задачи, а строку фазы над ними закрыть забывает —
 * и фаза висела бы незакрытой при всех сделанных детях. Пустая фаза выполненной не считается:
 * «все ноль детей закрыты» — это не достижение, а отсутствие работы.
 */
function phaseState(phase: Task, all: Task[]): MilestoneState {
  if (phase.status === 'completed') return 'done'
  if (phase.status === 'cancelled') return 'cancelled'
  const children = all.filter(t => String(t.parent_id ?? '') === String(phase.id) && !isPhase(t))
  if (!children.length) return 'open'
  const live = children.filter(t => t.status !== 'cancelled')
  if (!live.length) return 'cancelled'
  return live.every(t => t.status === 'completed') ? 'done' : 'open'
}

/** Задача выполнена — по СТАТУСУ. Процент выполнения здесь ни при чём: наполовину сделанная
 *  точка отчёта не наступила. */
function taskState(task: Task): MilestoneState {
  if (task.status === 'completed') return 'done'
  if (task.status === 'cancelled') return 'cancelled'
  return 'open'
}

export function planMilestones(tasks: Task[]): Milestone[] {
  const phases = tasks.filter(isPhase)
  if (phases.length) {
    return phases.map(p => ({
      id: String(p.id),
      title: p.title,
      date: p.planned_end ?? null,
      state: phaseState(p, tasks),
    }))
  }
  return tasks
    .filter(t => !isPhase(t) && !t.parent_id)
    .map(t => ({
      id: String(t.id),
      title: t.title,
      date: t.planned_end ?? null,
      state: taskState(t),
    }))
}
