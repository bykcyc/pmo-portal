import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { getStakeholders, createStakeholder, updateStakeholder, deleteStakeholder, reorderStakeholders } from '@/api/team'
import type { Stakeholder } from '@/types/team'
import type { Person } from '@/types/person'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import LogPanel from '@/components/LogPanel'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideDefinition, GuideStep } from '@/components/ProcessGuide'
import { useUIStore } from '@/store/uiStore'
import { useConfirmStore } from '@/store/confirmStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import { useSectionExport } from '@/hooks/useSectionExport'
import PersonPicker from '@/components/PersonPicker'
import TruncatedCell from '@/components/ui/TruncatedCell'
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
  TABLE_SCROLL_WRAP_CLASS,
  TABLE_CELL_TEXT_CLASS,
  TABLE_FILL_HEAD_CLASS,
  TABLE_FILL_CELL_CLASS,
} from '@/components/tableStyles'

function parseScore(v: string | null): number {
  if (!v) return 0
  if (v === 'high') return 8
  if (v === 'medium') return 5
  if (v === 'low') return 2
  const n = parseInt(v)
  return isNaN(n) ? 0 : n
}

const QUADRANT_BADGE: Record<string, string> = {
  manageClosely: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  keepSatisfied: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  keepInformed: 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300',
  monitor: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200',
}

function getQuadrant(influence: string | null, interest: string | null): string | null {
  const inf = parseScore(influence)
  const int = parseScore(interest)
  if (!inf || !int) return null
  if (inf > 5.5 && int > 5.5) return 'manageClosely'
  if (inf > 5.5 && int <= 5.5) return 'keepSatisfied'
  if (inf <= 5.5 && int > 5.5) return 'keepInformed'
  return 'monitor'
}

export default function StakeholdersTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { theme } = useUIStore()
  const isDark = theme === 'dark'
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)

  const [localRows, setLocalRows] = useState<Stakeholder[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const SCORE_OPTIONS = [1,2,3,4,5,6,7,8,9,10].map(n => ({ value: String(n), label: String(n) }))
  const TYPE_OPTIONS = [
    { value: 'internal', label: t('stakeholders.internal') },
    { value: 'external', label: t('stakeholders.external') },
  ]

  const COLS: ColDef[] = [
    { key: 'name', label: t('stakeholders.name'), defaultWidth: 150, required: true, hint: t('stakeholders.hints.name') },
    { key: 'role', label: t('stakeholders.role'), defaultWidth: 130, hint: t('stakeholders.hints.role') },
    { key: 'type', label: t('stakeholders.type'), defaultWidth: 80, hint: t('stakeholders.hints.type') },
    { key: 'influence', label: t('stakeholders.influence'), defaultWidth: 80, hint: t('stakeholders.hints.influence') },
    { key: 'interest', label: t('stakeholders.interest'), defaultWidth: 80, hint: t('stakeholders.hints.interest') },
    { key: 'phone', label: t('stakeholders.phone'), defaultWidth: 110, hint: t('stakeholders.hints.phone') },
    { key: 'email', label: t('team.email'), defaultWidth: 140, hint: t('stakeholders.hints.email') },
    { key: 'engagement', label: t('stakeholders.engagementStrategy'), defaultWidth: 150, hint: t('stakeholders.hints.engagementStrategy') },
    { key: 'notes', label: t('stakeholders.notes'), defaultWidth: 130, hint: t('stakeholders.hints.notes') },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('stakeholders.guide.s1'), desc: t('stakeholders.guide.s1d') },
    { title: t('stakeholders.guide.s2'), desc: t('stakeholders.guide.s2d') },
    { title: t('stakeholders.guide.s3'), desc: t('stakeholders.guide.s3d') },
    { title: t('stakeholders.guide.s4'), desc: t('stakeholders.guide.s4d') },
    { title: t('stakeholders.guide.s5'), desc: t('stakeholders.guide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('stakeholders.guideDefinitions.engagementStrategy'), desc: t('stakeholders.guideDefinitions.engagementStrategyDesc') },
    { term: t('stakeholders.guideDefinitions.manageClosely'), desc: t('stakeholders.guideDefinitions.manageCloselyDesc') },
    { term: t('stakeholders.guideDefinitions.keepSatisfied'), desc: t('stakeholders.guideDefinitions.keepSatisfiedDesc') },
    { term: t('stakeholders.guideDefinitions.keepInformed'), desc: t('stakeholders.guideDefinitions.keepInformedDesc') },
    { term: t('stakeholders.guideDefinitions.monitor'), desc: t('stakeholders.guideDefinitions.monitorDesc') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(200)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('stakeholders', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 200)

  const { data: stakeholders = EMPTY_ARRAY, isLoading, isError } = useQuery({
    queryKey: ['stakeholders', projectId],
    queryFn: () => getStakeholders(projectId),
  })

  useEffect(() => { setLocalRows(stakeholders) }, [stakeholders])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => stakeholders as unknown as Record<string, unknown>[], [stakeholders])
  useSectionExport('stakeholders', exportRows)

  const displayRows = [...localRows].sort((a, b) => {
    if (!sort) return 0
    let av: string, bv: string
    if (sort.field === 'quadrant') {
      av = getQuadrant(a.influence, a.interest) ?? ''
      bv = getQuadrant(b.influence, b.interest) ?? ''
    } else {
      av = String((a as unknown as Record<string, unknown>)[sort.field] ?? '').toLowerCase()
      bv = String((b as unknown as Record<string, unknown>)[sort.field] ?? '').toLowerCase()
    }
    const cmp = av.localeCompare(bv)
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
      await reorderStakeholders(projectId, toSortOrderPayload(nextRows))
      await invalidate()
    } catch {
      setLocalRows(stakeholders)
    }
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['stakeholders', projectId] })

  const commitEdit = async (overrideValue?: string) => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    const val = overrideValue ?? editValue
    await updateStakeholder(projectId, id, { [field]: val || null })
    await invalidate()
  }

  // Выбор человека из СПРАВОЧНИКА тянет за собой email и телефон одной записью — как в «Команде».
  // Свободный текст (человек не из реестра) сюда не попадает: там onPickPerson отдаёт null.
  // setEditCell(null) гасит последующий commitEdit по blur/Enter (он выйдет по `if (!editCell)`).
  const commitPerson = async (id: string, person: Person) => {
    setEditCell(null)
    await updateStakeholder(projectId, id, {
      name: person.full_name,
      email: person.email ?? null,
      phone: person.phone ?? null,
    })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('stakeholders.deleteConfirm'), async () => {
      await deleteStakeholder(projectId, id); await invalidate()
      if (logEntity?.id === id) setLogEntity(null)
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.name?.trim()) return
    await createStakeholder(projectId, addValues); await invalidate()
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

  const cell = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <input autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }} />
      : <TruncatedCell className={span} text={value} onActivate={() => beginEdit(id, field, value)} />

  const personCell = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <PersonPicker autoFocus className={inp} value={editValue}
          onChange={v => setEditValue(v)} onSelect={v => commitEdit(v)}
          onPickPerson={p => { if (p) commitPerson(id, p) }} />
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

  const matrixData = stakeholders
    .map(s => ({ x: parseScore(s.interest), y: parseScore(s.influence), name: s.name, id: s.id }))
    .filter(d => d.x > 0 && d.y > 0)

  const qFill = {
    keepSatisfied: isDark ? 'rgb(var(--c-blue-900) / 0.45)' : 'rgb(var(--c-blue-100) / 0.9)',
    manageClosely: isDark ? 'rgba(20,83,45,0.45)'  : 'rgba(187,247,208,0.9)',
    monitor:       isDark ? 'rgb(var(--c-slate-800) / 0.4)' : 'rgb(var(--c-gray-200) / 0.9)',
    keepInformed:  isDark ? 'rgb(var(--c-yellow-900) / 0.45)' : 'rgb(var(--c-yellow-200) / 0.9)',
  }

  // Deduplicate scatter data: one entry per unique coordinate, with grouped names
  const { uniqueMatrixData, coordNames } = useMemo(() => {
    const nameMap = new Map<string, string[]>()
    const seen = new Set<string>()
    const unique: typeof matrixData = []
    for (const d of matrixData) {
      const key = `${d.x}-${d.y}`
      const arr = nameMap.get(key) || []
      arr.push(d.name)
      nameMap.set(key, arr)
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(d)
      }
    }
    return { uniqueMatrixData: unique, coordNames: nameMap }
  }, [matrixData])

  const renderDot = (props: unknown) => {
    const p = props as { cx?: number; cy?: number; payload?: { name: string; x: number; y: number } }
    const cx = p.cx ?? 0; const cy = p.cy ?? 0
    const x = p.payload?.x ?? 0; const y = p.payload?.y ?? 0
    const key = `${x}-${y}`
    const names = coordNames.get(key) || [p.payload?.name ?? '']
    return (
      <g key={`dot-${key}`}>
        <circle cx={cx} cy={cy} r={5} fill="#6366f1" opacity={0.9} />
        {names.map((name, i) => (
          <text key={i} x={cx} y={cy - 8 - (names.length - 1 - i) * 11} textAnchor="middle" fontSize={9} fill={isDark ? 'rgb(var(--c-slate-300))' : 'rgb(var(--c-gray-700))'}>{name}</text>
        ))}
      </g>
    )
  }

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('stakeholders.title')} ({stakeholders.length})</h3>
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        {stakeholders.length === 0 && !addRow && (
          <EmptyValueState
            message={t('adopt.empty.stakeholders', { defaultValue: 'Запишите, кто влияет на проект, — и перед каждым разговором у вас будет шпаргалка: с кем, о чём и как часто.' })}
            actionLabel={canWrite ? t('stakeholders.add') : undefined}
            onAction={canWrite ? () => { setAddRow(true); setAddValues({ type: 'internal' }) } : undefined}
          />
        )}

        {(stakeholders.length > 0 || addRow) && (<>
            <div ref={tableContainerRef} className={`mb-2 ${TABLE_SCROLL_WRAP_CLASS}`}>
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
                    {/* quadrant is always shown, computed, not in COLS */}
                    <th className={`text-left font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap ${TABLE_FILL_HEAD_CLASS}`}>{t('stakeholders.quadrant')}</th>
                    <th className={TABLE_ACTION_HEAD_CLASS} />
                  </tr>
                </thead>
                <tbody>
                  {addRow && canWrite && (
                    <tr className="border-b border-primary-200 dark:border-slate-600 bg-primary-50 dark:bg-slate-800/70">
                      <td className={TABLE_FILL_CELL_CLASS} />
                      {isVis('name') && (
                        <td className="py-1 pr-3"><PersonPicker autoFocus className={addInp} placeholder={t('stakeholders.name') + '…'} value={addValues.name ?? ''} onChange={v => setAddValues(prev => ({ ...prev, name: v }))} onPickPerson={p => { if (p) setAddValues(v => ({ ...v, name: p.full_name, email: p.email ?? '', phone: p.phone ?? '' })) }} /></td>
                      )}
                      {isVis('role') && (
                        <td className="py-1 pr-3"><input className={addInp} placeholder={t('stakeholders.role') + '…'} value={addValues.role ?? ''} onChange={e => setAddValues(v => ({ ...v, role: e.target.value }))} /></td>
                      )}
                      {isVis('type') && (
                        <td className="py-1 pr-3">
                          <select className={addInp} value={addValues.type ?? 'internal'} onChange={e => setAddValues(v => ({ ...v, type: e.target.value }))}>
                            <option value="internal">{t('stakeholders.internal')}</option>
                            <option value="external">{t('stakeholders.external')}</option>
                          </select>
                        </td>
                      )}
                      {isVis('influence') && (
                        <td className="py-1 pr-3">
                          <select className={addInp} value={addValues.influence ?? ''} onChange={e => setAddValues(v => ({ ...v, influence: e.target.value }))}>
                            <option value="">—</option>
                            {SCORE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      )}
                      {isVis('interest') && (
                        <td className="py-1 pr-3">
                          <select className={addInp} value={addValues.interest ?? ''} onChange={e => setAddValues(v => ({ ...v, interest: e.target.value }))}>
                            <option value="">—</option>
                            {SCORE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      )}
                      {isVis('phone') && <td className="py-1 pr-3"><input className={addInp} placeholder={t('stakeholders.phone') + '…'} value={addValues.phone ?? ''} onChange={e => setAddValues(v => ({ ...v, phone: e.target.value }))} /></td>}
                      {isVis('email') && <td className="py-1 pr-3"><input className={addInp} type="email" placeholder={t('team.email') + '…'} value={addValues.email ?? ''} onChange={e => setAddValues(v => ({ ...v, email: e.target.value }))} /></td>}
                      {isVis('engagement') && <td className="py-1 pr-3"><input className={addInp} placeholder={t('stakeholders.engagementStrategy') + '…'} value={addValues.engagement_strategy ?? ''} onChange={e => setAddValues(v => ({ ...v, engagement_strategy: e.target.value }))} /></td>}
                      {isVis('notes') && <td className="py-1 pr-3"><input className={addInp} placeholder={t('stakeholders.notes') + '…'} value={addValues.notes ?? ''} onChange={e => setAddValues(v => ({ ...v, notes: e.target.value }))} /></td>}
                      {/* quadrant placeholder */}
                      <td />
                      <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                        <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                        <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                      </div></td>
                    </tr>
                  )}
                  {displayRows.map((s, idx) => {
                    const quadrant = getQuadrant(s.influence, s.interest)
                    return (
                      <tr key={s.id} draggable={dragEnabled} onDragStart={() => onDragStart(idx)} onDragOver={e => dragEnabled && onDragOver(e, idx)}
                        onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                        className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                        <td className={`${TABLE_DRAG_CELL_CLASS} ${dragEnabled ? 'text-gray-300 dark:text-slate-600 cursor-grab' : 'text-gray-200 dark:text-slate-700 cursor-default'}`}><GripVertical size={14} /></td>
                        {isVis('name') && <td className="py-1 pr-3 overflow-hidden font-medium">{personCell(s.id, 'name', s.name)}</td>}
                        {isVis('role') && <td className="py-1 pr-3 overflow-hidden">{cell(s.id, 'role', s.role)}</td>}
                        {isVis('type') && <td className="py-1 pr-3">{selCell(s.id, 'type', s.type, TYPE_OPTIONS)}</td>}
                        {isVis('influence') && <td className="py-1 pr-3 text-center">{selCell(s.id, 'influence', s.influence, SCORE_OPTIONS)}</td>}
                        {isVis('interest') && <td className="py-1 pr-3 text-center">{selCell(s.id, 'interest', s.interest, SCORE_OPTIONS)}</td>}
                        {isVis('phone') && <td className="py-1 pr-3 overflow-hidden">{cell(s.id, 'phone', s.phone)}</td>}
                        {isVis('email') && <td className="py-1 pr-3 overflow-hidden">{cell(s.id, 'email', s.email)}</td>}
                        {isVis('engagement') && <td className="py-1 pr-3 overflow-hidden">{cellTrunc(s.id, 'engagement_strategy', s.engagement_strategy)}</td>}
                        {isVis('notes') && <td className="py-1 pr-3 overflow-hidden">{cellTrunc(s.id, 'notes', s.notes)}</td>}
                        {/* quadrant always shown */}
                        <td className={TABLE_FILL_CELL_CLASS}>
                          {quadrant ? (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium leading-tight inline-block ${QUADRANT_BADGE[quadrant]}`}>
                              {t(`stakeholders.${quadrant}`)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className={TABLE_ACTION_CELL_CLASS}>
                          <div className={TABLE_ACTION_GROUP_CLASS}>
                            <button onClick={e => { e.stopPropagation(); setLogEntity({ id: s.id, name: s.name }) }}
                              aria-label={t('common.log', { defaultValue: 'История' })}
                              className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                            {canWrite && (
                              <button onClick={e => { e.stopPropagation(); handleDelete(s.id) }}
                                aria-label={t('common.delete')}
                                className={`${TABLE_ICON_BUTTON_CLASS} hover:text-red-500`}><X size={ICON_SM} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {!addRow && canWrite && (
              <div className="flex justify-end mt-1.5 mb-4">
                <button onClick={() => { setAddRow(true); setAddValues({ type: 'internal' }) }}
                  className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
                  <Plus size={11} /> {t('stakeholders.add')}
                </button>
              </div>
            )}

            {matrixData.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2 uppercase tracking-wide">{t('stakeholders.matrix')}</h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-slate-400 mb-1 pl-12">
                  <span className="text-center">{t('stakeholders.lowInterest')}</span>
                  <span className="text-center">{t('stakeholders.highInterest')}</span>
                </div>
                <div className="flex">
                  <div className="flex flex-col justify-between text-xs text-gray-500 dark:text-slate-400 pr-2 py-2 w-16 text-right">
                    <span className="leading-tight">{t('stakeholders.highInfluence')}</span>
                    <span className="leading-tight">{t('stakeholders.lowInfluence')}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 10, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <ReferenceArea x1={0.5} x2={5.5} y1={5.5} y2={10.5} fill={qFill.keepSatisfied} />
                      <ReferenceArea x1={5.5} x2={10.5} y1={5.5} y2={10.5} fill={qFill.manageClosely} />
                      <ReferenceArea x1={0.5} x2={5.5} y1={0.5} y2={5.5} fill={qFill.monitor} />
                      <ReferenceArea x1={5.5} x2={10.5} y1={0.5} y2={5.5} fill={qFill.keepInformed} />
                      <XAxis type="number" dataKey="x" domain={[0.5, 10.5]} ticks={[1,2,3,4,5,6,7,8,9,10]} />
                      <YAxis type="number" dataKey="y" domain={[0.5, 10.5]} ticks={[1,2,3,4,5,6,7,8,9,10]} />
                      <ReferenceLine x={5.5} stroke="rgb(var(--c-gray-500))" strokeDasharray="4 2" />
                      <ReferenceLine y={5.5} stroke="rgb(var(--c-gray-500))" strokeDasharray="4 2" />
                      <Tooltip content={({ payload }) => payload?.[0] ? (
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded px-2 py-1 text-xs shadow">
                          {(payload[0].payload as { name: string }).name}
                        </div>
                      ) : null} />
                      <Scatter data={uniqueMatrixData} fill="#6366f1" shape={renderDot} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-1 pl-12">
                  <div className="rounded p-1 text-center text-blue-700" style={{ background: 'rgba(219,234,254,0.9)' }}>{t('stakeholders.keepSatisfied')}</div>
                  <div className="rounded p-1 text-center text-green-700" style={{ background: 'rgba(187,247,208,0.9)' }}>{t('stakeholders.manageClosely')}</div>
                  <div className="rounded p-1 text-center text-gray-600" style={{ background: 'rgba(229,231,235,0.9)' }}>{t('stakeholders.monitor')}</div>
                  <div className="rounded p-1 text-center text-yellow-700" style={{ background: 'rgba(254,240,138,0.9)' }}>{t('stakeholders.keepInformed')}</div>
                </div>
              </div>
            )}
        </>)}
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="stakeholder" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
