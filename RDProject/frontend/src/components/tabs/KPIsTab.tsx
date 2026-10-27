import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getKPIs, createKPI, updateKPI, deleteKPI, reorderKPIs } from '@/api/kpi'
import type { KPI } from '@/types/kpi'
import { useCanWrite } from '@/contexts/ProjectPermission'
import TruncatedCell from '@/components/ui/TruncatedCell'
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

const STATUS_COLORS: Record<string, string> = {
  on_track: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  at_risk: 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300',
  off_track: 'bg-red-100 text-red-700 dark:bg-rose-950/40 dark:text-rose-300',
}

export default function KPIsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)

  const [localRows, setLocalRows] = useState<KPI[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const STATUS_OPTIONS = [
    { value: 'on_track', label: t('kpis.statuses.on_track') },
    { value: 'at_risk', label: t('kpis.statuses.at_risk') },
    { value: 'off_track', label: t('kpis.statuses.off_track') },
  ]

  const COLS: ColDef[] = [
    { key: 'name', label: t('kpis.name'), defaultWidth: 220, required: true, hint: t('kpis.hints.name') },
    // Цель / факт / единица: портал их хранил и импортировал из Excel, но никогда не
    // показывал — метрика без целевого значения ничего не измеряет, а статус «под угрозой»
    // приходилось ставить на глаз.
    { key: 'target', label: t('kpis.target', { defaultValue: 'Цель' }), defaultWidth: 90, hint: t('kpis.hints.target', { defaultValue: 'Значение, к которому идём. Без него статус метрики — мнение, а не измерение.' }) },
    { key: 'current_value', label: t('kpis.currentValue', { defaultValue: 'Факт' }), defaultWidth: 90, hint: t('kpis.hints.currentValue', { defaultValue: 'Достигнутое значение на сегодня.' }) },
    { key: 'unit', label: t('kpis.unit', { defaultValue: 'Ед.' }), defaultWidth: 70, hint: t('kpis.hints.unit', { defaultValue: 'Единица измерения: %, шт., дни, EUR.' }) },
    { key: 'status', label: t('kpis.status'), defaultWidth: 90, hint: t('kpis.hints.status') },
    { key: 'description', label: t('common.description'), defaultWidth: 200, hint: t('kpis.hints.description') },
    { key: 'formula', label: t('kpis.formula'), defaultWidth: 140, hint: t('kpis.hints.formula') },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('kpis.guide.s1'), desc: t('kpis.guide.s1d') },
    { title: t('kpis.guide.s2'), desc: t('kpis.guide.s2d') },
    { title: t('kpis.guide.s3'), desc: t('kpis.guide.s3d') },
    { title: t('kpis.guide.s4'), desc: t('kpis.guide.s4d') },
    { title: t('kpis.guide.s5'), desc: t('kpis.guide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('kpis.guideDefinitions.onTrack'), desc: t('kpis.guideDefinitions.onTrackDesc') },
    { term: t('kpis.guideDefinitions.atRisk'), desc: t('kpis.guideDefinitions.atRiskDesc') },
    { term: t('kpis.guideDefinitions.offTrack'), desc: t('kpis.guideDefinitions.offTrackDesc') },
    { term: t('kpis.guideDefinitions.formula'), desc: t('kpis.guideDefinitions.formulaDesc') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(84)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('kpis', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 84)

  const { data: kpis = EMPTY_ARRAY, isLoading, isError } = useQuery({
    queryKey: ['kpis', projectId],
    queryFn: () => getKPIs(projectId),
  })

  useEffect(() => { setLocalRows(kpis) }, [kpis])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => kpis as unknown as Record<string, unknown>[], [kpis])
  useSectionExport('kpis', exportRows)

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
      await reorderKPIs(projectId, toSortOrderPayload(nextRows))
      await invalidate()
    } catch {
      setLocalRows(kpis)
    }
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kpis', projectId] })

  const commitEdit = async () => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    await updateKPI(projectId, id, { [field]: editValue || null })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('kpis.deleteConfirm'), async () => {
      await deleteKPI(projectId, id); await invalidate()
      if (logEntity?.id === id) setLogEntity(null)
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.name?.trim()) return
    await createKPI(projectId, { ...addValues, status: addValues.status || 'on_track' } as Partial<KPI>); await invalidate()
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
      : <span className={span} role="button" tabIndex={0} onKeyDown={cellKeyDown(id, field, value)} onClick={() => beginEdit(id, field, value)}>
          {opts.find(o => o.value === value)?.label ?? value ?? '—'}
        </span>

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('kpis.title')} ({kpis.length})</h3>
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        {kpis.length === 0 && !addRow ? (
          <EmptyValueState
            message={t('adopt.empty.kpis', { defaultValue: '3–5 измеримых целей — и на вопрос «как идёт проект?» вы отвечаете цифрами, а не ощущениями.' })}
            actionLabel={canWrite ? t('kpis.add') : undefined}
            onAction={canWrite ? () => { setAddRow(true); setAddValues({ status: 'on_track' }) } : undefined}
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
                    {isVis('name') && (
                      <td className="py-1 pr-4"><input autoFocus className={addInp} placeholder={t('kpis.name') + '…'} value={addValues.name ?? ''} onChange={e => setAddValues(v => ({ ...v, name: e.target.value }))} /></td>
                    )}
                    {isVis('target') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('kpis.target', { defaultValue: 'Цель' })} value={addValues.target ?? ''} onChange={e => setAddValues(v => ({ ...v, target: e.target.value }))} /></td>
                    )}
                    {isVis('current_value') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('kpis.currentValue', { defaultValue: 'Факт' })} value={addValues.current_value ?? ''} onChange={e => setAddValues(v => ({ ...v, current_value: e.target.value }))} /></td>
                    )}
                    {isVis('unit') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('kpis.unit', { defaultValue: 'Ед.' })} value={addValues.unit ?? ''} onChange={e => setAddValues(v => ({ ...v, unit: e.target.value }))} /></td>
                    )}
                    {isVis('status') && (
                      <td className="py-1 pr-4">
                        <select className={addInp} value={addValues.status ?? 'on_track'} onChange={e => setAddValues(v => ({ ...v, status: e.target.value }))}>
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    )}
                    {isVis('description') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('common.description') + '…'} value={addValues.description ?? ''} onChange={e => setAddValues(v => ({ ...v, description: e.target.value }))} /></td>
                    )}
                    {isVis('formula') && (
                      <td className="py-1 pr-4"><input className={addInp} placeholder={t('kpis.formula') + '…'} value={addValues.formula ?? ''} onChange={e => setAddValues(v => ({ ...v, formula: e.target.value }))} /></td>
                    )}
                    <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                      <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                      <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                    </div></td>
                  </tr>
                )}
                {displayRows.map((k, idx) => (
                  <tr key={k.id} draggable={dragEnabled} onDragStart={() => onDragStart(idx)} onDragOver={e => dragEnabled && onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                    className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                    <td className={`${TABLE_DRAG_CELL_CLASS} ${dragEnabled ? 'text-gray-300 dark:text-slate-600 cursor-grab' : 'text-gray-200 dark:text-slate-700 cursor-default'}`}><GripVertical size={14} /></td>
                    {isVis('name') && <td className="py-1 pr-4 overflow-hidden font-medium">{cellTrunc(k.id, 'name', k.name)}</td>}
                    {isVis('target') && <td className="py-1 pr-4 overflow-hidden tabular-nums">{cellTrunc(k.id, 'target', k.target)}</td>}
                    {isVis('current_value') && <td className="py-1 pr-4 overflow-hidden tabular-nums">{cellTrunc(k.id, 'current_value', k.current_value)}</td>}
                    {isVis('unit') && <td className="py-1 pr-4 overflow-hidden">{cellTrunc(k.id, 'unit', k.unit)}</td>}
                    {isVis('status') && (
                      <td className="py-1 pr-4">
                        {editCell?.id === k.id && editCell?.field === 'status'
                          ? selCell(k.id, 'status', k.status, STATUS_OPTIONS)
                          : <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${canWrite ? 'cursor-pointer' : ''} ${k.status ? STATUS_COLORS[k.status] : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200'}`}
                              role="button" tabIndex={0} onKeyDown={cellKeyDown(k.id, 'status', k.status)}
                              onClick={() => beginEdit(k.id, 'status', k.status)}>
                              {k.status ? t(`kpis.statuses.${k.status}`) : '—'}
                            </span>
                        }
                      </td>
                    )}
                    {isVis('description') && <td className="py-1 pr-4 overflow-hidden">{cellTrunc(k.id, 'description', k.description)}</td>}
                    {isVis('formula') && <td className="py-1 pr-4 overflow-hidden">{cellTrunc(k.id, 'formula', k.formula)}</td>}
                    <td className={TABLE_ACTION_CELL_CLASS}>
                      <div className={TABLE_ACTION_GROUP_CLASS}>
                        <button onClick={e => { e.stopPropagation(); setLogEntity({ id: k.id, name: k.name }) }}
                          aria-label={t('common.log', { defaultValue: 'История' })}
                          className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                        {canWrite && (
                          <button onClick={e => { e.stopPropagation(); handleDelete(k.id) }}
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
        {!addRow && canWrite && kpis.length > 0 && (
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setAddRow(true); setAddValues({ status: 'on_track' }) }}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              <Plus size={11} /> {t('kpis.add')}
            </button>
          </div>
        )}
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="kpi" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
