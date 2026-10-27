import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getCommPlan, createCommPlanItem, updateCommPlanItem, deleteCommPlanItem, reorderCommPlanItems } from '@/api/kpi'
import type { CommPlanItem } from '@/types/kpi'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import LogPanel from '@/components/LogPanel'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import { useConfirmStore } from '@/store/confirmStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import PersonPicker from '@/components/PersonPicker'
import TruncatedCell from '@/components/ui/TruncatedCell'
import { useSectionExport } from '@/hooks/useSectionExport'
import { moveManualRows, toSortOrderPayload } from '@/utils/manualOrder'
import { EMPTY_ARRAY } from '@/utils/emptyArray'
import {
  getManagedTableStyle,
  TABLE_ACTION_CELL_CLASS,
  TABLE_ACTION_GROUP_CLASS,
  TABLE_BASE_CLASS,
  TABLE_DRAG_CELL_CLASS,
  TABLE_DRAG_HEAD_CLASS,
  TABLE_ACTION_HEAD_CLASS,
  TABLE_ICON_BUTTON_CLASS,
  TABLE_CELL_TEXT_CLASS,
  TABLE_SCROLL_WRAP_CLASS,
} from '@/components/tableStyles'

export default function CommPlanTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)

  const [localRows, setLocalRows] = useState<CommPlanItem[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const COLS: ColDef[] = [
    { key: 'goal', label: t('commPlan.goal'), defaultWidth: 200, required: true, hint: t('commPlan.hints.goal') },
    { key: 'channel', label: t('commPlan.channel'), defaultWidth: 120, hint: t('commPlan.hints.channel') },
    { key: 'audience', label: t('commPlan.audience'), defaultWidth: 150, hint: t('commPlan.hints.audience') },
    { key: 'frequency', label: t('commPlan.frequency'), defaultWidth: 100, hint: t('commPlan.hints.frequency') },
    { key: 'responsible', label: t('commPlan.responsible'), defaultWidth: 120, hint: t('commPlan.hints.responsible') },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('commPlan.guide.s1'), desc: t('commPlan.guide.s1d') },
    { title: t('commPlan.guide.s2'), desc: t('commPlan.guide.s2d') },
    { title: t('commPlan.guide.s3'), desc: t('commPlan.guide.s3d') },
    { title: t('commPlan.guide.s4'), desc: t('commPlan.guide.s4d') },
    { title: t('commPlan.guide.s5'), desc: t('commPlan.guide.s5d') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(84)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('comm-plan', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 84)

  const { data: items = EMPTY_ARRAY, isLoading, isError } = useQuery({
    queryKey: ['comm_plan', projectId],
    queryFn: () => getCommPlan(projectId),
  })

  useEffect(() => { setLocalRows(items) }, [items])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => items.map((c) => ({
    goal: c.goal, channel: c.channel, audience: c.audience,
    frequency: c.frequency, responsible: c.responsible,
  })), [items])
  useSectionExport('comm-plan', exportRows)

  const displayRows = [...localRows].sort((a, b) => {
    if (!sort) return 0
    const av = a[sort.field as keyof typeof a] ?? ''
    const bv = b[sort.field as keyof typeof b] ?? ''
    const cmp = String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const dragEnabled = editCell === null && !sort
  const onDragStart = (idx: number) => setDragIdx(idx)
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const onDrop = async (idx: number) => {
    if (!dragEnabled || dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const nextRows = moveManualRows(localRows, displayRows, dragIdx, idx)
    setLocalRows(nextRows)
    setDragIdx(null)
    setDragOverIdx(null)
    try {
      await reorderCommPlanItems(projectId, toSortOrderPayload(nextRows))
      await invalidate()
    } catch {
      setLocalRows(items)
    }
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['comm_plan', projectId] })

  const commitEdit = async (overrideValue?: string) => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    const val = overrideValue ?? editValue
    await updateCommPlanItem(projectId, id, { [field]: val || null })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('commPlan.deleteConfirm'), async () => {
      await deleteCommPlanItem(projectId, id); await invalidate()
      if (logEntity?.id === id) setLogEntity(null)
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.goal?.trim()) return
    await createCommPlanItem(projectId, { ...addValues, sort_order: items.length }); await invalidate()
    setAddRow(false); setAddValues({})
  }

  const inp = 'w-full text-xs border border-blue-400 rounded px-1 py-0 outline-none bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'
  const span = `${TABLE_CELL_TEXT_CLASS} min-h-[18px] text-gray-700 dark:text-slate-200`
  const addInp = 'text-xs border border-gray-300 rounded px-1 py-0.5 w-full focus:outline-none focus:border-blue-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'

  const beginEdit = (id: string, field: string, value: string | null) => {
    if (!canWrite) return
    setEditCell({ id, field })
    setEditValue(value ?? '')
  }
  const cellKeyDown = (id: string, field: string, value: string | null) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(id, field, value) }
  }

  const cell = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <input autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }} />
      : <TruncatedCell className={span} text={value} onActivate={() => beginEdit(id, field, value)} />

  const personCell = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <PersonPicker autoFocus className={inp} value={editValue}
          onChange={v => setEditValue(v)} onSelect={v => commitEdit(v)} />
      : <TruncatedCell className={span} text={value} onActivate={() => beginEdit(id, field, value)} />

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('commPlan.title')} ({items.length})</h3>
          <ProcessGuide steps={guideSteps} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        {items.length === 0 && !addRow ? (
          <EmptyValueState
            message={t('adopt.empty.commPlan', { defaultValue: 'Пропишите, кому и когда докладывать, — и встречи с рассылками перестанут жить у вас в голове.' })}
            actionLabel={canWrite ? t('commPlan.add') : undefined}
            onAction={canWrite ? () => { setAddRow(true); setAddValues({}) } : undefined}
          />
        ) : (
          <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
            <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className={TABLE_DRAG_HEAD_CLASS} />
                  {visibleCols.map((col, index) => (
                    <ColTh key={col.key} col={col} sort={sort} onSort={setSort} width={getW(col.key)} onResize={startResize(col.key)}
                      onResizePrev={index > 0 ? startResize(visibleCols[index - 1].key) : undefined} />
                  ))}
                  <th className={TABLE_ACTION_HEAD_CLASS} />
                </tr>
              </thead>
              <tbody>
                {addRow && canWrite && (
                  <tr className="border-b border-primary-200 dark:border-slate-600 bg-primary-50 dark:bg-slate-800/70">
                    <td />
                    {isVis('goal') && (
                      <td className="py-1 pr-4"><input autoFocus className={addInp} placeholder={t('commPlan.goal') + '…'} value={addValues.goal ?? ''} onChange={e => setAddValues(v => ({ ...v, goal: e.target.value }))} /></td>
                    )}
                    {isVis('channel') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('commPlan.channel') + '…'} value={addValues.channel ?? ''} onChange={e => setAddValues(v => ({ ...v, channel: e.target.value }))} /></td>
                    )}
                    {isVis('audience') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('commPlan.audience') + '…'} value={addValues.audience ?? ''} onChange={e => setAddValues(v => ({ ...v, audience: e.target.value }))} /></td>
                    )}
                    {isVis('frequency') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('commPlan.frequency') + '…'} value={addValues.frequency ?? ''} onChange={e => setAddValues(v => ({ ...v, frequency: e.target.value }))} /></td>
                    )}
                    {isVis('responsible') && (
                      <td className="py-1 pr-4"><PersonPicker className={addInp} placeholder={t('commPlan.responsible') + '…'} value={addValues.responsible ?? ''} onChange={v => setAddValues(prev => ({ ...prev, responsible: v }))} /></td>
                    )}
                    <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                      <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                      <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                    </div></td>
                  </tr>
                )}
                {displayRows.map((c, idx) => (
                  <tr key={c.id} draggable={dragEnabled} onDragStart={() => onDragStart(idx)} onDragOver={e => dragEnabled && onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                    className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                    <td className={`${TABLE_DRAG_CELL_CLASS} ${dragEnabled ? 'text-gray-300 dark:text-slate-600 cursor-grab' : 'text-gray-200 dark:text-slate-700 cursor-default'}`}><GripVertical size={14} /></td>
                    {isVis('goal') && <td className="py-1 pr-4 max-w-xs">{cell(c.id, 'goal', c.goal)}</td>}
                    {isVis('channel') && <td className="py-1 pr-4">{cell(c.id, 'channel', c.channel)}</td>}
                    {isVis('audience') && <td className="py-1 pr-4">{cell(c.id, 'audience', c.audience)}</td>}
                    {isVis('frequency') && <td className="py-1 pr-4">{cell(c.id, 'frequency', c.frequency)}</td>}
                    {isVis('responsible') && <td className="py-1 pr-4">{personCell(c.id, 'responsible', c.responsible)}</td>}
                    <td className={TABLE_ACTION_CELL_CLASS}>
                      <div className={TABLE_ACTION_GROUP_CLASS}>
                        <button onClick={e => { e.stopPropagation(); setLogEntity({ id: c.id, name: c.goal }) }}
                          aria-label={t('common.log', { defaultValue: 'История' })}
                          className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                        {canWrite && (
                          <button onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                            aria-label={t('common.delete')}
                            className={`${TABLE_ICON_BUTTON_CLASS} hover:text-red-500`}><X size={ICON_SM} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!addRow && canWrite && items.length > 0 && (
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setAddRow(true); setAddValues({}) }}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              <Plus size={11} /> {t('commPlan.add')}
            </button>
          </div>
        )}
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="comm_plan" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
