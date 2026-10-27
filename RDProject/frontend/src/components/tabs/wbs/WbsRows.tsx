import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Plus, Trash2, GripVertical, Calendar, MessageSquare, Pencil, Layers, Diamond, SquareCheck } from 'lucide-react'
import { formatDate, localIsoDate, parseDateStrict } from '@/utils/date'
import type { Task, TaskNode } from '@/types/task'
import { ICON_SM } from '@/constants/ui'
import PersonPicker from '@/components/PersonPicker'
import {
  TABLE_ACTION_CELL_WIDE_CLASS,
  TABLE_ACTION_GROUP_CLASS,
  TABLE_DRAG_CELL_CLASS,
  TABLE_ICON_BUTTON_CLASS,
  TABLE_CELL_TEXT_CLASS,
} from '@/components/tableStyles'
import { DATE_FIELDS, type EditCell } from './wbsConstants'
import { stripRichText } from '@/utils/richText'

// Тёмных пар не было ни у одного статуса, кроме «не начата». Отменённую уводим в серый: она
// не «плохая», а снятая, а красным в соседней колонке уже говорит критичный приоритет.
const STATUS_COLORS: Record<string, string> = {
  not_started: 'text-gray-500 dark:text-slate-400', in_progress: 'text-blue-500 dark:text-blue-300',
  completed: 'text-green-600 dark:text-emerald-300', cancelled: 'text-gray-500 dark:text-slate-400',
  on_hold: 'text-yellow-600 dark:text-amber-300',
}

interface Condition { key: string; color: string; bg: string }

function getCondition(task: Task, t: (k: string) => string): Condition | null {
  if (task.status === 'completed' || task.status === 'cancelled') return null
  if (task.task_type === 'phase') return null

  const today = localIsoDate()

  // Overdue: deadline passed but not done
  if (task.planned_end && task.planned_end < today) {
    return { key: 'wbs.conditions.overdue', color: 'text-red-700 dark:text-rose-300', bg: 'bg-red-100 dark:bg-rose-950/40' }
  }

  // Should have started: planned start passed but still not_started
  if (task.planned_start && task.planned_start < today && task.status === 'not_started') {
    return { key: 'wbs.conditions.shouldStart', color: 'text-orange-700 dark:text-amber-300', bg: 'bg-orange-100 dark:bg-amber-950/40' }
  }

  // Late start: actually started later than planned
  if (task.actual_start && task.planned_start && task.actual_start > task.planned_start && task.status === 'in_progress') {
    return { key: 'wbs.conditions.lateStart', color: 'text-yellow-700 dark:text-amber-300', bg: 'bg-yellow-100 dark:bg-amber-950/40' }
  }

  // Stalled: in progress but 0% done
  if (task.status === 'in_progress' && task.progress === 0) {
    return { key: 'wbs.conditions.stalled', color: 'text-orange-700 dark:text-amber-300', bg: 'bg-orange-100 dark:bg-amber-950/40' }
  }

  // On hold
  if (task.status === 'on_hold') {
    return { key: 'wbs.conditions.onHold', color: 'text-yellow-700 dark:text-amber-300', bg: 'bg-yellow-100 dark:bg-amber-950/40' }
  }

  // No dates set
  if (!task.planned_start && !task.planned_end) {
    return { key: 'wbs.conditions.noDates', color: 'text-gray-500 dark:text-slate-300', bg: 'bg-gray-100 dark:bg-slate-800' }
  }

  // No assignee
  if (!task.assignee_name && task.task_type === 'task') {
    return { key: 'wbs.conditions.noAssignee', color: 'text-gray-500 dark:text-slate-300', bg: 'bg-gray-100 dark:bg-slate-800' }
  }

  // Deadline approaching (within 3 days)
  if (task.planned_end) {
    const daysLeft = Math.round((new Date(task.planned_end).getTime() - new Date(today).getTime()) / 86400000)
    if (daysLeft >= 0 && daysLeft <= 3) {
      return { key: 'wbs.conditions.deadlineSoon', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950/40' }
    }
  }

  return null
}
// У красного и оранжевого не было тёмной пары: на тёмном фоне red-600 даёт около 3:1 и
// «Критичный» читается хуже обычного серого текста — ровно эта жалоба и пришла. Светлую тему
// не трогаем, добавляем парные dark:-оттенки посветлее.
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-300', high: 'text-orange-600 dark:text-orange-300',
  medium: 'text-blue-500 dark:text-blue-300', low: 'text-gray-500 dark:text-slate-400',
}
const STATUS_OPTIONS = ['not_started', 'in_progress', 'completed', 'cancelled', 'on_hold']
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low']
// Типы задач в WBS: только фаза и задача (веху убрали — по запросу).
// (TypeIcon ниже сохраняет иконку milestone на случай старых данных, но выбрать её нельзя.)
const TYPE_OPTIONS = ['phase', 'task']

// Говорящая иконка типа задачи вместо текста в колонке «Тип».
export function TypeIcon({ type, label }: { type: string; label: string }) {
  const cfg: Record<string, { Icon: typeof Layers; cls: string }> = {
    phase: { Icon: Layers, cls: 'text-indigo-500 dark:text-indigo-400' },
    task: { Icon: SquareCheck, cls: 'text-blue-500 dark:text-blue-400' },
    milestone: { Icon: Diamond, cls: 'text-amber-500 dark:text-amber-400' },
  }
  const { Icon, cls } = cfg[type] ?? cfg.task
  return (
    <span className="inline-flex items-center gap-1" title={label} aria-label={label}>
      <Icon size={15} className={cls} />
    </span>
  )
}

// ── DateCellInput ─────────────────────────────────────────────────────────────

export function DateCellInput({ value, onChange, onCommit, onCancel, inpCls }: {
  value: string
  onChange: (v: string) => void
  onCommit: (isoOverride?: string) => void
  onCancel: () => void
  inpCls: string
}) {
  const pickerRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative flex items-center">
      <input
        autoFocus type="text" placeholder="дд.мм.гггг" aria-label="Дата (дд.мм.гггг)"
        className={`${inpCls} pr-5`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }}
      />
      <button
        type="button" tabIndex={-1}
        onMouseDown={e => { e.preventDefault(); pickerRef.current?.showPicker?.() }}
        className="absolute right-0.5 text-gray-500 dark:text-slate-400 hover:text-gray-600"
      >
        <Calendar size={10} />
      </button>
      <input
        ref={pickerRef} type="date" tabIndex={-1}
        // Значение ОБЯЗАНО быть привязано. Без него браузерный календарь открывается пустым
        // и на текущем месяце: кнопка Clear тогда «стирает» уже пустое значение, события
        // change не происходит, и ничего не сохраняется — ровно то, на что жаловались.
        // Тот же приём давно стоит в паспорте проекта (PassportForm), где Clear работает.
        value={parseDateStrict(value) ?? ''}
        // Выбор даты только ПОКАЗЫВАЕМ, а не сохраняем сразу: сохранение снимало ячейку с
        // редактирования и уносило вместе с ней сам календарь, из-за чего стрелки месяцев
        // вели себя как перещёлкивание значения. Запись уходит на blur/Enter видимого поля —
        // этот путь уже работает.
        onChange={e => onChange(formatDate(e.target.value, ''))}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}

// ── NodeRow ───────────────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TaskNode; depth: number; collapsed: Set<string>
  toggleCollapse: (id: string) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string, level: number) => void
  onLog: (id: string, title: string) => void
  onBitrix: (node: TaskNode) => void
  onOpenDetail: (node: TaskNode) => void
  onOpenCoAssignees: (node: TaskNode) => void
  editCell: EditCell | null; editValue: string
  setEditValue: (v: string) => void
  startEdit: (id: string, field: string, value: string | number | null) => void
  commitEdit: (node: TaskNode, overrideValue?: string) => Promise<void>
  cancelEdit: () => void
  isVis: (k: string) => boolean
  getW: (k: string) => number
  canWrite: boolean
  predMap: Map<string, string[]>
  dragProps: {
    draggable: boolean
    onDragStart: (e: React.DragEvent, id: string) => void
    onDragOver: (e: React.DragEvent, id: string) => void
    onDrop: (e: React.DragEvent, id: string) => void
    onDragLeave: () => void
    /** Что произойдёт при отпускании над этой строкой — рисуем, иначе человек не угадает. */
    dropHint: { id: string; zone: 'before' | 'inside' | 'after' } | null
  }
}

export function NodeRow({ node, depth, collapsed, toggleCollapse, onDelete, onAddChild, onLog, onBitrix, onOpenDetail,
  onOpenCoAssignees,
  editCell, editValue, setEditValue, startEdit, commitEdit, cancelEdit,
  isVis, getW, canWrite, predMap, dragProps }: NodeRowProps) {
  const { t } = useTranslation()
  const isCollapsed = collapsed.has(node.id)
  const hint = dragProps.dropHint?.id === node.id ? dragProps.dropHint.zone : null
  const hasChildren = node.children.length > 0
  const editing = (field: string) => editCell?.id === node.id && editCell?.field === field
  const cellCls = `${TABLE_CELL_TEXT_CLASS} rounded outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`
  const inpCls = 'w-full text-xs border border-blue-400 rounded px-1 py-0 outline-none bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'
  const cellKeyDown = (field: string, value: string | number | null) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (canWrite) startEdit(node.id, field, value) }
  }

  const getOptionLabel = (value: string) => {
    if (TYPE_OPTIONS.includes(value)) return t(`wbs.types.${value}`)
    if (STATUS_OPTIONS.includes(value)) return t(`wbs.statuses.${value}`)
    if (PRIORITY_OPTIONS.includes(value)) return t(`wbs.priorities.${value}`)
    return value
  }

  const makeDateInput = (field: string) => (
    <DateCellInput
      value={editValue}
      onChange={setEditValue}
      onCommit={(iso?) => { void commitEdit(node, iso) }}
      onCancel={cancelEdit}
      inpCls={inpCls}
    />
  )

  const makeInput = (field: string, type = 'text') => (
    <input autoFocus type={type} className={inpCls} value={editValue}
      aria-label={t('wbs.editValue', { defaultValue: 'Изменить значение' })}
      onChange={e => setEditValue(e.target.value)}
      onBlur={() => commitEdit(node)}
      onKeyDown={e => { if (e.key === 'Enter') { void commitEdit(node) } if (e.key === 'Escape') cancelEdit() }} />
  )
  const makePersonInput = () => (
    <PersonPicker autoFocus className={inpCls} value={editValue}
      onChange={v => setEditValue(v)} onSelect={(v) => { void commitEdit(node, v) }} />
  )
  const makeSelect = (options: string[]) => (
    <select autoFocus className={inpCls} value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={() => commitEdit(node)}>
      {options.map(o => <option key={o} value={o}>{getOptionLabel(o)}</option>)}
    </select>
  )

  const cell = (field: string, display: React.ReactNode, value: string | number | null, type = 'text') =>
    editing(field)
      ? (DATE_FIELDS.includes(field) ? makeDateInput(field) : makeInput(field, type))
      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(field, value)} onClick={() => { if (canWrite) startEdit(node.id, field, value) }}>{display ?? '—'}</span>

  const selectCell = (field: string, display: React.ReactNode, value: string | null, options: string[]) =>
    editing(field)
      ? makeSelect(options)
      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(field, value)} onClick={() => { if (canWrite) startEdit(node.id, field, value) }}>{display ?? '—'}</span>

  return (
    <>
      {/* Подсказка перетаскивания: линия сверху/снизу — встанет рядом, рамка — ляжет ВНУТРЬ.
          Без неё человек не угадает, что получится, и вложенность выглядит случайной. */}
      <tr className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 group ${
        // Фаза — заголовок куска работы, и на глаз она должна отличаться от задач под ней.
        // Тон, а не жирность: жирным название фазы и так набрано, а разделить нужно СТРОКИ.
        //
        // Полупрозрачная накладка, а НЕ именованный оттенок: скин Warm переопределяет
        // slate-50/slate-800 своими кремовыми и графитовыми тонами, и строка фазы там слилась
        // с фоном таблицы в обеих темах — визуальные снимки это и поймали, байт в байт.
        // Накладка сдвигает тон от того, что под ней, какой бы ни была палитра.
        //
        // Подсветку перетаскивания не трогаем — она идёт следующими тремя условиями и
        // перекрывает этот фон, потому что стоит после него.
        node.task_type === 'phase' ? 'bg-black/[0.05] dark:bg-white/[0.08]' : ''} ${
        hint === 'before' ? 'border-t-2 border-t-primary-500' : ''} ${
        hint === 'after' ? 'border-b-2 border-b-primary-500' : ''} ${
        hint === 'inside' ? 'bg-primary-50 outline outline-2 -outline-offset-2 outline-primary-500 dark:bg-primary-950/30' : ''}`}
        draggable={dragProps.draggable && !editCell}
        onDragStart={(e) => dragProps.onDragStart(e, node.id)}
        onDragOver={(e) => dragProps.onDragOver(e, node.id)}
        onDragLeave={dragProps.onDragLeave}
        onDrop={(e) => dragProps.onDrop(e, node.id)}>
        <td className={`${TABLE_DRAG_CELL_CLASS} pl-2 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 cursor-grab`}><GripVertical size={ICON_SM} /></td>
        {isVis('wbs_code') && (
          <td className="py-1 text-xs font-mono text-gray-500 dark:text-slate-400 pr-1" style={{ width: getW('wbs_code') }}>{node.wbs_code}</td>
        )}
        <td className="py-1 pr-2" style={{ width: getW('title'), minWidth: 120, paddingLeft: `${depth * 16 + 4}px` }}>
          <span className="flex min-w-0 items-center gap-1">
            {hasChildren ? (
              <button onClick={() => toggleCollapse(node.id)}
                aria-label={isCollapsed ? t('common.expand', { defaultValue: 'Развернуть' }) : t('common.collapse', { defaultValue: 'Свернуть' })}
                className="text-gray-500 dark:text-slate-400 shrink-0 hover:text-gray-700 dark:hover:text-slate-100">
                {isCollapsed ? <ChevronRight size={ICON_SM} /> : <ChevronDown size={ICON_SM} />}
              </button>
            ) : <span className="w-3.5 shrink-0" />}
            <span className={`min-w-0 flex-1 text-sm ${node.task_type === 'phase' ? 'font-semibold' : ''}`}>
              {editing('title')
                ? makeInput('title')
                : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown('title', node.title)} onClick={() => { if (canWrite) startEdit(node.id, 'title', node.title) }}>{node.title}</span>
              }
            </span>
            {canWrite && (
              <button onClick={() => onOpenDetail(node)}
                className="shrink-0 p-0.5 text-gray-300 dark:text-slate-600 hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title={t('wbs.openDetail')} aria-label={t('wbs.openDetail')}>
                <Pencil size={12} />
              </button>
            )}
          </span>
        </td>
        {isVis('task_type') && (
          <td className="py-1 pr-2 text-xs" style={{ width: getW('task_type') }}>
            {selectCell('task_type', <TypeIcon type={node.task_type} label={t(`wbs.types.${node.task_type}`)} />, node.task_type, TYPE_OPTIONS)}
          </td>
        )}
        {isVis('planned_start') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('planned_start') }}>
            {cell('planned_start', formatDate(node.planned_start), node.planned_start)}
          </td>
        )}
        {isVis('planned_end') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('planned_end') }}>
            {cell('planned_end', formatDate(node.planned_end), node.planned_end)}
          </td>
        )}
        {isVis('actual_start') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('actual_start') }}>
            {cell('actual_start', formatDate(node.actual_start), node.actual_start)}
          </td>
        )}
        {isVis('actual_end') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('actual_end') }}>
            {cell('actual_end', formatDate(node.actual_end), node.actual_end)}
          </td>
        )}
        {isVis('duration_days') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('duration_days') }}>
            {cell('duration_days', node.duration_days != null ? String(node.duration_days) : null, node.duration_days, 'number')}
          </td>
        )}
        {isVis('progress') && (
          <td className="py-1 pr-2 text-xs" style={{ width: getW('progress') }}>
            {cell('progress', `${node.progress}%`, node.progress, 'number')}
          </td>
        )}
        {isVis('status') && (
          <td className="py-1 pr-2 text-xs" style={{ width: getW('status') }}>
            {selectCell('status', <span className={STATUS_COLORS[node.status] ?? 'text-gray-400'}>{t(`wbs.statuses.${node.status}`)}</span>, node.status, STATUS_OPTIONS)}
          </td>
        )}
        {isVis('priority') && (
          <td className="py-1 pr-2 text-xs" style={{ width: getW('priority') }}>
            {selectCell('priority', <span className={PRIORITY_COLORS[node.priority] ?? 'text-gray-400'}>{t(`wbs.priorities.${node.priority}`)}</span>, node.priority, PRIORITY_OPTIONS)}
          </td>
        )}
        {isVis('assignee_name') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('assignee_name') }}>
            {editing('assignee_name')
              ? makePersonInput()
              : <span className={cellCls} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (canWrite) startEdit(node.id, 'assignee_name', node.assignee_name) } }}
                  onClick={() => { if (canWrite) startEdit(node.id, 'assignee_name', node.assignee_name) }}>{node.assignee_name ?? '—'}</span>}
          </td>
        )}
        {isVis('co_assignees') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-300" style={{ width: getW('co_assignees') }}>
            {/* Открываем диалог, а не правим в ячейке: людей бывает несколько, каждого надо
                найти в справочнике и каждого можно снять — в ширину колонки это не влезает. */}
            <span className={cellCls} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenCoAssignees(node) } }}
              onClick={() => onOpenCoAssignees(node)}>
              {(node.co_assignees?.length ?? 0) === 0
                ? '—'
                : node.co_assignees!.map(c => c.name).join(', ')}
            </span>
          </td>
        )}
        {isVis('dependencies') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-400" style={{ width: getW('dependencies') }}>
            {(predMap.get(String(node.id)) ?? []).length > 0
              ? <span className="font-mono">{(predMap.get(String(node.id)) ?? []).join(', ')}</span>
              : <span className="text-gray-300 dark:text-slate-600">—</span>}
          </td>
        )}
        {isVis('condition') && (() => {
          const cond = getCondition(node, t)
          // Раньше «Состояние» было пустым для здоровых/завершённых строк (алерт-колонка).
          // Теперь показываем спокойное «В норме»/«Выполнена» вместо пустоты; фаза — прочерк.
          return (
            <td className="py-1 pr-2 text-xs" style={{ width: getW('condition') }}>
              {cond ? (
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${cond.color} ${cond.bg}`}>
                  {t(cond.key)}
                </span>
              ) : node.task_type === 'phase' ? (
                <span className="text-gray-300 dark:text-slate-600">—</span>
              ) : node.status === 'cancelled' ? (
                <span className="text-gray-500 dark:text-slate-400">{t('wbs.statuses.cancelled')}</span>
              ) : node.status === 'completed' ? (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight text-green-700 dark:text-emerald-300 bg-green-100 dark:bg-emerald-950/40">{t('wbs.statuses.completed')}</span>
              ) : (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight text-green-700 dark:text-emerald-300 bg-green-50 dark:bg-emerald-950/30">{t('wbs.conditions.ok', { defaultValue: 'В норме' })}</span>
              )}
            </td>
          )
        })()}
        {isVis('description') && (
          <td className="py-1 pr-2 text-xs text-gray-500 dark:text-slate-400" style={{ width: getW('description') }}>
            {/* Правку описания из ячейки убрали намеренно: это был input[type=text], а браузер
                вырезает из его значения переводы строк — достаточно кликнуть в ячейку и уйти
                мимо, чтобы многострочное описание схлопнулось в одну строку и уехало на сервер.
                Клик открывает карточку задачи, где описание живёт во весь размер окна. В самой
                ячейке маркеры сняты: «**важно**» в узкой колонке читалось бы мусором. */}
            <span className={cellCls} role="button" tabIndex={0}
              aria-label={`${t('wbs.descriptionInCard', { defaultValue: 'Описание правится в карточке — нажмите, чтобы открыть' })}: ${node.title}`}
              title={t('wbs.descriptionInCard', { defaultValue: 'Описание правится в карточке — нажмите, чтобы открыть' })}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(node) } }}
              onClick={() => onOpenDetail(node)}>
              {stripRichText(node.description) || '—'}
            </span>
          </td>
        )}
        {isVis('bitrix24_task_id') && (
          <td className="py-1 pr-2 text-xs" style={{ width: getW('bitrix24_task_id') }}>
            {node.bitrix24_task_id ? (
              canWrite ? (
                <button onClick={() => onBitrix(node)} className="text-primary-600 dark:text-blue-400 hover:text-primary-800 font-mono font-medium">
                  {node.bitrix24_task_id}
                </button>
              ) : (
                <span className="text-primary-600 font-mono font-medium">{node.bitrix24_task_id}</span>
              )
            ) : (
              canWrite ? (
                <button onClick={() => onBitrix(node)} className="text-gray-500 dark:text-slate-400 hover:text-primary-600">
                  {t('bitrix24Task.create')}
                </button>
              ) : <span className="text-gray-300 dark:text-slate-600">—</span>
            )}
          </td>
        )}
        <td className={TABLE_ACTION_CELL_WIDE_CLASS}>
          <span className={`${TABLE_ACTION_GROUP_CLASS} opacity-0 group-hover:opacity-100`}>
            <button onClick={() => onLog(node.id, node.title)}
              className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`} title={t('common.log', { defaultValue: 'История' })} aria-label={t('common.log', { defaultValue: 'История' })}><MessageSquare size={12} /></button>
            {canWrite && (
              <>
                <button onClick={() => onAddChild(node.id, node.level + 1)}
                  className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-primary-600`} title={t('wbs.addChild')} aria-label={t('wbs.addChild')}><Plus size={12} /></button>
                <button onClick={() => onDelete(node.id)}
                  aria-label={t('common.delete')}
                  className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-red-500`}><Trash2 size={12} /></button>
              </>
            )}
          </span>
        </td>
      </tr>
      {!isCollapsed && node.children.map((child) => (
        <NodeRow key={child.id} node={child} depth={depth + 1} collapsed={collapsed}
          toggleCollapse={toggleCollapse} onDelete={onDelete} onAddChild={onAddChild} onLog={onLog} onBitrix={onBitrix} onOpenDetail={onOpenDetail} onOpenCoAssignees={onOpenCoAssignees}
          editCell={editCell} editValue={editValue} setEditValue={setEditValue}
          startEdit={startEdit} commitEdit={commitEdit} cancelEdit={cancelEdit}
          isVis={isVis} getW={getW} canWrite={canWrite} predMap={predMap} dragProps={dragProps} />
      ))}
    </>
  )
}
