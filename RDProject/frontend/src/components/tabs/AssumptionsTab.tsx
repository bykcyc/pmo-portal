import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getAssumptions, createAssumption, updateAssumption, deleteAssumption , reorderAssumptions } from '@/api/team'
import { moveManualRows, toSortOrderPayload } from '@/utils/manualOrder'
import type { Assumption } from '@/types/team'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import LogPanel from '@/components/LogPanel'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideDefinition, GuideStep } from '@/components/ProcessGuide'
import { useConfirmStore } from '@/store/confirmStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import PersonPicker from '@/components/PersonPicker'
import TruncatedCell from '@/components/ui/TruncatedCell'
import { useSectionExport } from '@/hooks/useSectionExport'
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
  TABLE_SCROLL_WRAP_CLASS,
  TABLE_CELL_TEXT_CLASS,
} from '@/components/tableStyles'

const TYPE_COLORS: Record<string, string> = {
  assumption: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  constraint: 'bg-red-100 text-red-700 dark:bg-rose-950/40 dark:text-rose-300',
  dependency: 'bg-orange-100 text-orange-700 dark:bg-amber-950/40 dark:text-amber-300',
}
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  confirmed: 'bg-primary-100 text-primary-700',
  invalid: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200',
}

export default function AssumptionsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)

  const [localRows, setLocalRows] = useState<Assumption[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const TYPE_OPTIONS = [
    { value: 'assumption', label: t('assumptions.types.assumption') },
    { value: 'constraint', label: t('assumptions.types.constraint') },
    { value: 'dependency', label: t('assumptions.types.dependency') },
  ]
  const STATUS_OPTIONS = [
    { value: 'active', label: t('assumptions.statuses.active') },
    { value: 'confirmed', label: t('assumptions.statuses.confirmed') },
    { value: 'invalid', label: t('assumptions.statuses.invalid') },
  ]

  const COLS: ColDef[] = [
    { key: 'type', label: t('assumptions.type'), defaultWidth: 100, hint: t('assumptions.hints.type') },
    { key: 'description', label: t('assumptions.description'), defaultWidth: 280, required: true, hint: t('assumptions.hints.description') },
    { key: 'owner', label: t('assumptions.owner'), defaultWidth: 120, hint: t('assumptions.hints.owner') },
    { key: 'status', label: t('common.status'), defaultWidth: 90, hint: t('assumptions.hints.status') },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('assumptions.guide.s1'), desc: t('assumptions.guide.s1d') },
    { title: t('assumptions.guide.s2'), desc: t('assumptions.guide.s2d') },
    { title: t('assumptions.guide.s3'), desc: t('assumptions.guide.s3d') },
    { title: t('assumptions.guide.s4'), desc: t('assumptions.guide.s4d') },
    { title: t('assumptions.guide.s5'), desc: t('assumptions.guide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('assumptions.guideDefinitions.assumption'), desc: t('assumptions.guideDefinitions.assumptionDesc') },
    { term: t('assumptions.guideDefinitions.constraint'), desc: t('assumptions.guideDefinitions.constraintDesc') },
    { term: t('assumptions.guideDefinitions.dependency'), desc: t('assumptions.guideDefinitions.dependencyDesc') },
    { term: t('assumptions.guideDefinitions.statuses'), desc: t('assumptions.guideDefinitions.statusesDesc') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(84)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('assumptions', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 84)

  const { data: assumptions = EMPTY_ARRAY, isLoading, isError } = useQuery({
    queryKey: ['assumptions', projectId],
    queryFn: () => getAssumptions(projectId),
  })

  useEffect(() => { setLocalRows(assumptions) }, [assumptions])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => assumptions.map((a) => ({
    description: a.description, type: a.type, status: a.status,
  })), [assumptions])
  useSectionExport('assumptions', exportRows)

  const displayRows = [...localRows].sort((a, b) => {
    if (!sort) return 0
    const av = a[sort.field as keyof typeof a] ?? ''
    const bv = b[sort.field as keyof typeof b] ?? ''
    const cmp = String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  // Порядок строк живёт на сервере: раньше перетаскивание меняло только локальный массив
  // и первое же обновление данных возвращало строку на место.
  const dragEnabled = editCell === null && !sort
  const onDragStart = (idx: number) => setDragIdx(idx)
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const onDrop = async (idx: number) => {
    if (!dragEnabled || dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const nextRows = moveManualRows(localRows, displayRows, dragIdx, idx)
    setLocalRows(nextRows); setDragIdx(null); setDragOverIdx(null)
    try {
      await reorderAssumptions(projectId, toSortOrderPayload(nextRows))
      await invalidate()
    } catch {
      setLocalRows(assumptions)
    }
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['assumptions', projectId] })

  const commitEdit = async (overrideValue?: string) => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    const val = overrideValue ?? editValue
    await updateAssumption(projectId, id, { [field]: val || null })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('assumptions.deleteConfirm'), async () => {
      await deleteAssumption(projectId, id); await invalidate()
      if (logEntity?.id === id) setLogEntity(null)
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.description?.trim()) return
    await createAssumption(projectId, { ...addValues, status: addValues.status || 'active' } as Partial<Assumption>); await invalidate()
    setAddRow(false); setAddValues({})
  }

  const inp = 'w-full text-xs border border-blue-400 rounded px-1 py-0 outline-none bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'
  const span = `${TABLE_CELL_TEXT_CLASS} min-h-[18px] text-gray-700 dark:text-slate-200`
  const spanTrunc = span
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

  const cellTrunc = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <input autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }} />
      : <TruncatedCell className={spanTrunc} text={value} onActivate={() => beginEdit(id, field, value)} />

  const selCell = (id: string, field: string, value: string | null, opts: { value: string; label: string }[]) =>
    editCell?.id === id && editCell?.field === field
      ? <select autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}>
          <option value="">—</option>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      : <TruncatedCell className={span} text={opts.find(o => o.value === value)?.label ?? value}
          onActivate={() => beginEdit(id, field, value)} />

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('assumptions.title')} ({assumptions.length})</h3>
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        {assumptions.length === 0 && !addRow ? (
          <EmptyValueState
            message={t('adopt.empty.assumptions', { defaultValue: 'Зафиксируйте договорённости и ограничения сейчас — через полгода не придётся вспоминать, почему решили именно так.' })}
            actionLabel={canWrite ? t('assumptions.add') : undefined}
            onAction={canWrite ? () => { setAddRow(true); setAddValues({ status: 'active' }) } : undefined}
          />
        ) : (
          <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
            <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className={TABLE_DRAG_HEAD_CLASS} />
                  {visibleCols.map((col, index) => (
                    <ColTh
                      key={col.key}
                      col={col}
                      sort={sort}
                      onSort={setSort}
                      width={getW(col.key)}
                      onResize={startResize(col.key)}
                      onResizePrev={index > 0 ? startResize(visibleCols[index - 1].key) : undefined}
                    />
                  ))}
                  <th className={TABLE_ACTION_HEAD_CLASS} />
                </tr>
              </thead>
              <tbody>
                {addRow && canWrite && (
                  <tr className="border-b border-primary-200 dark:border-slate-600 bg-primary-50 dark:bg-slate-800/70">
                    <td />
                    {isVis('type') && (
                      <td className="py-1 pr-4">
                        <select className={addInp} value={addValues.type ?? ''} onChange={e => setAddValues(v => ({ ...v, type: e.target.value }))}>
                          <option value="">—</option>
                          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    )}
                    {isVis('description') && (
                      <td className="py-1 pr-4"><input autoFocus className={addInp} placeholder={t('assumptions.description') + '…'} value={addValues.description ?? ''} onChange={e => setAddValues(v => ({ ...v, description: e.target.value }))} /></td>
                    )}
                    {isVis('owner') && (
                      <td className="py-1 pr-4"><PersonPicker className={addInp} placeholder={t('assumptions.owner') + '…'} value={addValues.owner ?? ''} onChange={v => setAddValues(prev => ({ ...prev, owner: v }))} /></td>
                    )}
                    {isVis('status') && (
                      <td className="py-1 pr-4">
                        <select className={addInp} value={addValues.status ?? 'active'} onChange={e => setAddValues(v => ({ ...v, status: e.target.value }))}>
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    )}
                    <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                      <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                      <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                    </div></td>
                  </tr>
                )}
                {displayRows.map((a, idx) => (
                  <tr key={a.id} draggable={dragEnabled}
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={e => dragEnabled && onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                    className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                    <td className={`${TABLE_DRAG_CELL_CLASS} ${dragEnabled ? 'text-gray-300 dark:text-slate-600 cursor-grab' : 'text-gray-200 dark:text-slate-700 cursor-default'}`}><GripVertical size={14} /></td>
                    {isVis('type') && (
                      <td className="py-2 pr-4">
                        {editCell?.id === a.id && editCell?.field === 'type'
                          ? selCell(a.id, 'type', a.type, TYPE_OPTIONS)
                          : <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${canWrite ? 'cursor-pointer' : ''} ${a.type ? (TYPE_COLORS[a.type] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200') : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}
                              role="button" tabIndex={0} onKeyDown={cellKeyDown(a.id, 'type', a.type)}
                              onClick={() => beginEdit(a.id, 'type', a.type)}>
                              {a.type ? t(`assumptions.types.${a.type}`) : '—'}
                            </span>
                        }
                      </td>
                    )}
                    {isVis('description') && (
                      <td className="py-2 pr-4 overflow-hidden">{cellTrunc(a.id, 'description', a.description)}</td>
                    )}
                    {isVis('owner') && (
                      <td className="py-2 pr-4">{personCell(a.id, 'owner', a.owner)}</td>
                    )}
                    {isVis('status') && (
                      <td className="py-2 pr-4">
                        {editCell?.id === a.id && editCell?.field === 'status'
                          ? selCell(a.id, 'status', a.status, STATUS_OPTIONS)
                          : <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${canWrite ? 'cursor-pointer' : ''} ${a.status ? (STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200') : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200'}`}
                              role="button" tabIndex={0} onKeyDown={cellKeyDown(a.id, 'status', a.status)}
                              onClick={() => beginEdit(a.id, 'status', a.status)}>
                              {a.status ? t(`assumptions.statuses.${a.status}`) : '—'}
                            </span>
                        }
                      </td>
                    )}
                    <td className={TABLE_ACTION_CELL_CLASS}>
                      <div className={TABLE_ACTION_GROUP_CLASS}>
                        <button onClick={e => { e.stopPropagation(); setLogEntity({ id: a.id, name: a.description }) }}
                          aria-label={t('common.log', { defaultValue: 'История' })}
                          className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                        {canWrite && (
                          <button onClick={e => { e.stopPropagation(); handleDelete(a.id) }}
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
        {!addRow && canWrite && assumptions.length > 0 && (
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setAddRow(true); setAddValues({ status: 'active' }) }}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              <Plus size={11} /> {t('assumptions.add')}
            </button>
          </div>
        )}
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="assumption" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
