import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { useTranslation } from 'react-i18next'
import { getDecisions, createDecision, updateDecision, deleteDecision } from '@/api/decisions'
import { formatDate, parseDateStrict } from '@/utils/date'
import type { Decision } from '@/types/decision'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import LogPanel from '@/components/LogPanel'
import { useConfirmStore } from '@/store/confirmStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import PersonPicker from '@/components/PersonPicker'
import TruncatedCell from '@/components/ui/TruncatedCell'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import { useSectionExport } from '@/hooks/useSectionExport'
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

const EMPTY_DECISIONS: Decision[] = []

const STATUS_VALUES = ['active', 'superseded', 'revoked'] as const
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  superseded: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200',
  revoked: 'bg-red-100 text-red-600 dark:bg-rose-950/40 dark:text-rose-300',
}

export default function DecisionsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const STATUS_OPT = STATUS_VALUES.map(v => ({ value: v, label: t(`decisions.statuses.${v}`) }))
  const [filters, setFilters] = useState({ status: '', search: '' })

  const [localRows, setLocalRows] = useState<Decision[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const COLS: ColDef[] = [
    { key: 'title', label: t('decisions.titleField'), defaultWidth: 200, required: true, hint: t('decisions.hints.what') },
    { key: 'date', label: t('common.date'), defaultWidth: 90, hint: t('decisions.hints.madeAt') },
    { key: 'decided_by', label: t('decisions.decidedBy'), defaultWidth: 120, hint: t('decisions.hints.decidedBy') },
    { key: 'status', label: t('common.status'), defaultWidth: 90, hint: t('decisions.hints.status') },
    { key: 'description', label: t('common.description'), defaultWidth: 180, hint: t('decisions.hints.description') },
    { key: 'rationale', label: t('decisions.rationale'), defaultWidth: 160, hint: t('decisions.hints.why') },
    { key: 'alternatives', label: t('decisions.alternatives'), defaultWidth: 140, hint: t('decisions.hints.alternatives') },
    { key: 'impact', label: t('decisions.impact'), defaultWidth: 130, hint: t('decisions.hints.impact') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(128)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('decisions', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 128)

  const { data: decisions = EMPTY_DECISIONS, isLoading, isError } = useQuery({
    queryKey: ['decisions', projectId],
    queryFn: () => getDecisions(projectId, {}),
    staleTime: 30000,
  })

  const filteredDecisions = useMemo(() => {
    let rows = decisions
    if (filters.status) rows = rows.filter(d => d.status === filters.status)
    if (filters.search) {
      const q = filters.search.toLowerCase()
      rows = rows.filter(d => d.title.toLowerCase().includes(q) || (d.decided_by ?? '').toLowerCase().includes(q))
    }
    return rows
  }, [decisions, filters])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => decisions as unknown as Record<string, unknown>[], [decisions])
  useSectionExport('decisions', exportRows)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['decisions', projectId] })

  useEffect(() => { setLocalRows(filteredDecisions) }, [filteredDecisions])

  const displayRows = [...localRows].sort((a, b) => {
    if (!sort) return 0
    const av = a[sort.field as keyof typeof a] ?? ''
    const bv = b[sort.field as keyof typeof b] ?? ''
    const cmp = String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const onDragStart = (idx: number) => setDragIdx(idx)
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const arr = [...localRows]
    const [moved] = arr.splice(localRows.indexOf(displayRows[dragIdx]), 1)
    arr.splice(localRows.indexOf(displayRows[idx]), 0, moved)
    setLocalRows(arr); setDragIdx(null); setDragOverIdx(null)
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const commitEdit = async (overrideValue?: string) => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    const ev = overrideValue ?? editValue
    const val = field === 'date' ? (parseDateStrict(ev) ?? (ev || null)) : (ev || null)
    await updateDecision(projectId, id, { [field]: val })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('decisions.deleteConfirm'), async () => {
      await deleteDecision(projectId, id); await invalidate()
      if (logEntity?.id === id) setLogEntity(null)
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.title?.trim()) return
    const payload = Object.fromEntries(Object.entries(addValues).filter(([, v]) => v !== ''))
    await createDecision(projectId, { ...payload, status: payload.status || 'active' } as Partial<Decision>); await invalidate()
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
  const onCellKey = (run: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run() }
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

  const dateCell = (id: string, value: string | null) => {
    const startDate = () => { if (!canWrite) return; setEditCell({ id, field: 'date' }); setEditValue(formatDate(value, '')) }
    return editCell?.id === id && editCell?.field === 'date'
      ? <input autoFocus type="text" placeholder="дд.мм.гггг" className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }} />
      : <span className={span} role="button" tabIndex={0} onKeyDown={onCellKey(startDate)} onClick={startDate}>{formatDate(value)}</span>
  }

  const selCell = (id: string, field: string, value: string | null, opts: { value: string; label: string }[]) =>
    editCell?.id === id && editCell?.field === field
      ? <select autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      : <TruncatedCell className={span} text={opts.find(o => o.value === value)?.label ?? value}
          onActivate={() => beginEdit(id, field, value)} />

  const guideSteps: GuideStep[] = [
    { title: t('decisions.guide.s1'), desc: t('decisions.guide.s1d') },
    { title: t('decisions.guide.s2'), desc: t('decisions.guide.s2d') },
    { title: t('decisions.guide.s3'), desc: t('decisions.guide.s3d') },
    { title: t('decisions.guide.s4'), desc: t('decisions.guide.s4d') },
    { title: t('decisions.guide.s5'), desc: t('decisions.guide.s5d') },
  ]

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder={t('decisions.searchPlaceholder')} className="text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 w-48" />
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            className="text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2.5 py-1.5">
            <option value="">{t('decisions.allStatuses')}</option>
            {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ProcessGuide steps={guideSteps} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        {filteredDecisions.length === 0 && !addRow ? (
          <EmptyValueState
            message={t('adopt.empty.decisions', { defaultValue: 'Фиксируйте решения с «кто и почему» — и через месяц не будет споров, кто это придумал и зачем.' })}
            actionLabel={canWrite ? t('decisions.add') : undefined}
            onAction={canWrite ? () => { setAddRow(true); setAddValues({ status: 'active' }) } : undefined}
          />
        ) : (
          <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
          <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className={TABLE_DRAG_HEAD_CLASS} />
                {/* code — фикс-ширина в шапке (table-fixed): иначе ресайз соседних колонок дёргался */}
                <th style={{ width: 64 }} className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4 whitespace-nowrap">{t('decisions.code')}</th>
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
                  <td className="py-1 pr-4 text-gray-500 dark:text-slate-400 italic text-xs">auto</td>
                  {isVis('title') && (
                    <td className="py-1 pr-4"><input autoFocus className={addInp} placeholder={t('decisions.titleField') + '…'} value={addValues.title ?? ''} onChange={e => setAddValues(v => ({ ...v, title: e.target.value }))} /></td>
                  )}
                  {isVis('date') && (
                    <td className="py-1 pr-4"><input type="date" className={addInp} value={addValues.date ?? ''} onChange={e => setAddValues(v => ({ ...v, date: e.target.value }))} /></td>
                  )}
                  {isVis('decided_by') && (
                    <td className="py-1 pr-4"><PersonPicker className={addInp} placeholder={t('decisions.decidedBy') + '…'} value={addValues.decided_by ?? ''} onChange={v => setAddValues(prev => ({ ...prev, decided_by: v }))} /></td>
                  )}
                  {isVis('status') && (
                    <td className="py-1 pr-4">
                      <select className={addInp} value={addValues.status ?? 'active'} onChange={e => setAddValues(v => ({ ...v, status: e.target.value }))}>
                        {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {isVis('description') && (
                    <td className="py-1 pr-4"><input className={addInp} placeholder={t('common.description') + '…'} value={addValues.description ?? ''} onChange={e => setAddValues(v => ({ ...v, description: e.target.value }))} /></td>
                  )}
                  {isVis('rationale') && (
                    <td className="py-1 pr-4"><input className={addInp} placeholder={t('decisions.rationale') + '…'} value={addValues.rationale ?? ''} onChange={e => setAddValues(v => ({ ...v, rationale: e.target.value }))} /></td>
                  )}
                  {isVis('alternatives') && (
                    <td className="py-1 pr-4"><input className={addInp} placeholder={t('decisions.alternatives') + '…'} value={addValues.alternatives ?? ''} onChange={e => setAddValues(v => ({ ...v, alternatives: e.target.value }))} /></td>
                  )}
                  {isVis('impact') && (
                    <td className="py-1 pr-4"><input className={addInp} placeholder={t('decisions.impact') + '…'} value={addValues.impact ?? ''} onChange={e => setAddValues(v => ({ ...v, impact: e.target.value }))} /></td>
                  )}
                  <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                    <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                    <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                  </div></td>
                </tr>
              )}
              {displayRows.map((d, idx) => (
                <tr key={d.id} draggable={false}
                  onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                  className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                  <td className={`${TABLE_DRAG_CELL_CLASS} text-gray-200 dark:text-slate-700 cursor-default`}><GripVertical size={14} /></td>
                  {/* code always visible */}
                  <td className="py-2 pr-4 font-mono text-gray-500 dark:text-slate-400">{d.code}</td>
                  {isVis('title') && <td className="py-2 pr-4 font-medium max-w-xs">{cell(d.id, 'title', d.title)}</td>}
                  {isVis('date') && <td className="py-2 pr-4">{dateCell(d.id, d.date)}</td>}
                  {isVis('decided_by') && <td className="py-2 pr-4">{personCell(d.id, 'decided_by', d.decided_by)}</td>}
                  {isVis('status') && (
                    <td className="py-2 pr-4">
                      {editCell?.id === d.id && editCell?.field === 'status'
                        ? selCell(d.id, 'status', d.status, STATUS_OPT)
                        : <span className={`px-1.5 py-0.5 rounded text-xs ${canWrite ? 'cursor-pointer' : ''} ${STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200'}`}
                            role="button" tabIndex={0} onKeyDown={onCellKey(() => beginEdit(d.id, 'status', d.status))}
                            onClick={() => beginEdit(d.id, 'status', d.status)}>
                            {STATUS_OPT.find(o => o.value === d.status)?.label ?? d.status}
                          </span>
                      }
                    </td>
                  )}
                  {isVis('description') && <td className="py-2 pr-4">{cell(d.id, 'description', (d as unknown as Record<string, string>).description ?? null)}</td>}
                  {isVis('rationale') && <td className="py-2 pr-4">{cell(d.id, 'rationale', (d as unknown as Record<string, string>).rationale ?? null)}</td>}
                  {isVis('alternatives') && <td className="py-2 pr-4">{cell(d.id, 'alternatives', (d as unknown as Record<string, string>).alternatives ?? null)}</td>}
                  {isVis('impact') && <td className="py-2 pr-4">{cell(d.id, 'impact', (d as unknown as Record<string, string>).impact ?? null)}</td>}
                  <td className={TABLE_ACTION_CELL_CLASS}>
                    <div className={TABLE_ACTION_GROUP_CLASS}>
                      <button onClick={e => { e.stopPropagation(); setLogEntity({ id: d.id, name: d.title }) }}
                        aria-label={t('common.log', { defaultValue: 'История' })}
                        className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                      {canWrite && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(d.id) }}
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
        {!addRow && canWrite && filteredDecisions.length > 0 && (
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setAddRow(true); setAddValues({ status: 'active' }) }}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              <Plus size={11} /> {t('decisions.add')}
            </button>
          </div>
        )}
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="decision" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
