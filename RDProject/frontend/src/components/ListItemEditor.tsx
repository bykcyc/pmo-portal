import { useState, useMemo } from 'react'
import { Plus, Trash2, Check, X, GripVertical, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import HintIcon from '@/components/HintIcon'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TABLE_ICON_BUTTON_CLASS } from '@/components/tableStyles'

// Phase items are stored as strings prefixed with "§ "
export const PHASE_PREFIX = '§ '
export const isPhaseItem = (s: string) => s.startsWith(PHASE_PREFIX)
export const phaseName = (s: string) => s.slice(PHASE_PREFIX.length)

/** Return [startIndex, endIndex) of the phase group starting at `idx` */
function phaseGroup(items: string[], idx: number): [number, number] {
  let end = idx + 1
  while (end < items.length && !isPhaseItem(items[end])) end++
  return [idx, end]
}

/** Move a slice of array from [srcStart, srcEnd) to before destIndex */
function moveSlice(arr: string[], srcStart: number, srcEnd: number, destIndex: number): string[] {
  const slice = arr.slice(srcStart, srcEnd)
  const rest = [...arr.slice(0, srcStart), ...arr.slice(srcEnd)]
  const insertAt = destIndex > srcStart ? destIndex - (srcEnd - srcStart) : destIndex
  return [...rest.slice(0, insertAt), ...slice, ...rest.slice(insertAt)]
}

interface Props {
  label: string
  hint?: string
  items: string[]
  onChange: (items: string[]) => void
}

/* ─── Sortable row ─── */
interface SortableRowProps {
  id: string
  index: number
  item: string
  num: number | null
  isEditing: boolean
  editVal: string
  onEditVal: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onStartEdit: (i: number, val: string) => void
  onDelete: (i: number) => void
  inp: string
  isDragOverlay?: boolean
}

function SortableRow({
  id, index, item, num, isEditing, editVal, onEditVal,
  onCommitEdit, onCancelEdit, onStartEdit, onDelete, inp, isDragOverlay,
}: SortableRowProps) {
  const { t } = useTranslation()
  const phase = isPhaseItem(item)
  const displayVal = phase ? phaseName(item) : item

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id })

  const style = isDragOverlay ? {} : {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 px-2 ${phase ? 'py-2 bg-primary-50 dark:bg-slate-800/70 border-l-3 border-l-primary-400 dark:border-l-primary-700' : 'py-1'} ${isDragOverlay ? 'bg-white dark:bg-slate-900 shadow-lg rounded border border-gray-200 dark:border-slate-700' : ''}`}
    >
      {/* drag handle */}
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center text-gray-300 hover:text-gray-500 dark:hover:text-slate-400 active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
        aria-label={t('common.dragToReorder', { defaultValue: 'Перетащить для сортировки' })}
      >
        <GripVertical size={phase ? 14 : 12} />
      </button>

      {/* number / phase icon */}
      {phase ? (
        <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded bg-primary-100 text-primary-600">
          <Layers size={12} />
        </span>
      ) : (
        <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400 shrink-0 w-4 text-right select-none">{num}.</span>
      )}

      {isEditing ? (
        <>
          <input autoFocus className={inp} value={editVal}
            onChange={e => onEditVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCommitEdit() } if (e.key === 'Escape') onCancelEdit() }} />
          <button type="button" aria-label={t('common.save', { defaultValue: 'Сохранить' })} onClick={onCommitEdit} className={`${TABLE_ICON_BUTTON_CLASS} shrink-0 text-green-600 hover:text-green-800`}><Check size={14} /></button>
          <button type="button" aria-label={t('common.cancel', { defaultValue: 'Отмена' })} onClick={onCancelEdit} className={`${TABLE_ICON_BUTTON_CLASS} shrink-0 text-gray-400 hover:text-gray-600`}><X size={14} /></button>
        </>
      ) : (
        <>
          <span className={`flex-1 cursor-pointer hover:text-primary-700 ${phase ? 'text-sm font-semibold text-gray-700 dark:text-slate-200' : 'text-sm text-gray-800 dark:text-slate-200'}`}
            onClick={() => onStartEdit(index, displayVal)}>
            {displayVal}
          </span>
          <button type="button" aria-label={t('common.delete', { defaultValue: 'Удалить' })} onClick={() => onDelete(index)} className={`${TABLE_ICON_BUTTON_CLASS} shrink-0 text-gray-300 hover:text-red-500`}><Trash2 size={phase ? 13 : 11} /></button>
        </>
      )}
    </div>
  )
}

/* ─── Main component ─── */
export default function ListItemEditor({ label, hint, items, onChange }: Props) {
  const { t } = useTranslation()
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [addVal, setAddVal] = useState('')
  const [adding, setAdding] = useState<'item' | 'phase' | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const inp = 'flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500'

  // Stable IDs: "row-<index>"
  const ids = useMemo(() => items.map((_, i) => `row-${i}`), [items.length])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const commitEdit = () => {
    if (editIdx === null) return
    const trimmed = editVal.trim()
    const next = items.map((item, i) => {
      if (i !== editIdx) return item
      return isPhaseItem(item) ? PHASE_PREFIX + trimmed : trimmed
    }).filter(s => {
      if (isPhaseItem(s)) return phaseName(s).length > 0
      return s.length > 0
    })
    onChange(next)
    setEditIdx(null)
  }

  const commitAdd = () => {
    if (!addVal.trim()) { setAdding(null); return }
    const value = adding === 'phase'
      ? PHASE_PREFIX + addVal.trim()
      : addVal.trim()
    onChange([...items, value])
    setAddVal('')
    setAdding(null)
  }

  const del = (i: number) => {
    // If deleting a phase, also delete its children
    if (isPhaseItem(items[i])) {
      const [start, end] = phaseGroup(items, i)
      onChange([...items.slice(0, start), ...items.slice(end)])
    } else {
      onChange(items.filter((_, idx) => idx !== i))
    }
  }

  /* ── Drag handlers ── */
  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string)
    setEditIdx(null) // cancel any edit
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return

    const fromIdx = ids.indexOf(active.id as string)
    const toIdx = ids.indexOf(over.id as string)
    if (fromIdx < 0 || toIdx < 0) return

    if (isPhaseItem(items[fromIdx])) {
      // Moving a phase — grab the whole group
      const [start, end] = phaseGroup(items, fromIdx)
      // Determine destination: place before the target item's phase-group start, or at toIdx
      let dest = toIdx
      if (toIdx > fromIdx) {
        // moving down: place after the target item
        dest = toIdx + 1
      }
      onChange(moveSlice(items, start, end, dest))
    } else {
      // Moving a single item
      const next = [...items]
      const [removed] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, removed)
      onChange(next)
    }
  }

  // Compute per-phase numbering
  const numbering: (number | null)[] = []
  let counter = 0
  for (const item of items) {
    if (isPhaseItem(item)) { counter = 0; numbering.push(null) }
    else { counter++; numbering.push(counter) }
  }

  // Active drag item for overlay
  const activeIdx = activeId ? ids.indexOf(activeId) : -1
  const activeItem = activeIdx >= 0 ? items[activeIdx] : null

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1">
          <label className="text-[11px] font-medium text-gray-500 dark:text-slate-400">{label}</label>
          {/* Общий HintIcon, а не своя копия: только он уважает фокус-режим (иначе подсказки
              у «Цели», «Объёма», «Результата» остаются на экране, когда всё прочее спрятано). */}
          {hint && <HintIcon text={hint} size={11} />}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setAdding('phase'); setAddVal('') }}
            className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:text-primary-700 font-medium">
            <Layers size={12} />{t('common.addPhase')}
          </button>
          <button type="button" onClick={() => { setAdding('item'); setAddVal('') }}
            className="flex items-center gap-0.5 text-[11px] text-primary-600 dark:text-blue-400 hover:text-primary-800">
            <Plus size={11} />{t('common.add')}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="border border-gray-200 dark:border-slate-700 rounded divide-y divide-gray-100 dark:divide-slate-800 min-h-[32px] bg-white dark:bg-slate-900">
            {items.length === 0 && !adding && (
              <p className="px-3 py-1.5 text-xs text-gray-400 italic">—</p>
            )}
            {items.map((item, i) => (
              <SortableRow
                key={ids[i]}
                id={ids[i]}
                index={i}
                item={item}
                num={numbering[i]}
                isEditing={editIdx === i}
                editVal={editVal}
                onEditVal={setEditVal}
                onCommitEdit={commitEdit}
                onCancelEdit={() => setEditIdx(null)}
                onStartEdit={(idx, val) => { setEditIdx(idx); setEditVal(val) }}
                onDelete={del}
                inp={inp}
              />
            ))}
            {adding && (
              <div className={`flex items-center gap-1.5 px-2 ${adding === 'phase' ? 'py-2 bg-primary-50 border-l-3 border-l-primary-400' : 'py-1'}`}>
                {adding === 'phase'
                  ? <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded bg-primary-100 text-primary-600"><Layers size={12} /></span>
                  : <span className="text-[11px] text-gray-300 shrink-0 w-4 text-right select-none">+</span>
                }
                <input autoFocus className={inp} value={addVal}
                  onChange={e => setAddVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd() } if (e.key === 'Escape') setAdding(null) }}
                  placeholder={adding === 'phase' ? t('common.phaseName') + '…' : '…'} />
                <button type="button" aria-label={t('common.save', { defaultValue: 'Сохранить' })} onClick={commitAdd} className={`${TABLE_ICON_BUTTON_CLASS} shrink-0 text-green-600 hover:text-green-800`}><Check size={14} /></button>
                <button type="button" aria-label={t('common.cancel', { defaultValue: 'Отмена' })} onClick={() => setAdding(null)} className={`${TABLE_ICON_BUTTON_CLASS} shrink-0 text-gray-400 hover:text-gray-600`}><X size={14} /></button>
              </div>
            )}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeItem !== null && activeIdx >= 0 && (
            <SortableRow
              id="overlay"
              index={activeIdx}
              item={activeItem}
              num={numbering[activeIdx]}
              isEditing={false}
              editVal=""
              onEditVal={() => {}}
              onCommitEdit={() => {}}
              onCancelEdit={() => {}}
              onStartEdit={() => {}}
              onDelete={() => {}}
              inp={inp}
              isDragOverlay
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
