import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, GripVertical, Check, MessageSquare, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRisks, createRisk, updateRisk, deleteRisk } from '@/api/risks'
import type { Risk } from '@/types/risk'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import LogPanel from '@/components/LogPanel'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { ICON_SM } from '@/constants/ui'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import PersonPicker from '@/components/PersonPicker'
import TruncatedCell from '@/components/ui/TruncatedCell'
import RiskDrawer from '@/components/RiskDrawer'
import { ACTION_COLORS, HIL, HIL_NUM, SCORE_COLOR, getRiskAction } from '@/utils/riskScore'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideDefinition, GuideStep } from '@/components/ProcessGuide'
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
  TABLE_CELL_TEXT_CLASS,
  TABLE_SCROLL_WRAP_CLASS,
} from '@/components/tableStyles'

function RiskMatrix({ risks, codes }: { risks: Risk[]; codes: Map<string, string> }) {
  const { t } = useTranslation()
  return (
    <div className="mt-6">
      <h4 className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-2">{t('risks.matrix')}</h4>
      {/* растянутая сетка: ячейки минимум 140px и выше — раньше матрица сжималась и не вмещала риски */}
      <div className="grid gap-1 w-full max-w-3xl" style={{ gridTemplateColumns: 'auto repeat(3, minmax(140px, 1fr))' }}>
        <div />
        {[t('risks.levels.high'), t('risks.levels.medium'), t('risks.levels.low')].map(l => (
          <div key={l} className="text-center text-xs text-gray-500 dark:text-slate-400 font-medium py-1">{l}</div>
        ))}
        {HIL.map(prob => (
          <>
            <div key={`label-${prob}`} className="text-xs text-gray-500 dark:text-slate-400 font-medium flex items-center justify-end pr-2 capitalize min-h-[76px]">
              {t(`risks.levels.${prob}`)}
            </div>
            {HIL.map(imp => {
              const score = HIL_NUM[prob] * HIL_NUM[imp]
              const cellRisks = risks.filter(r => r.probability === prob && r.impact === imp)
              const bg = score >= 7 ? 'bg-red-100 border-red-200 dark:bg-rose-950/40 dark:border-rose-900' : score >= 4 ? 'bg-yellow-100 border-yellow-200 dark:bg-amber-950/40 dark:border-amber-900' : 'bg-green-100 border-green-200 dark:bg-emerald-950/40 dark:border-emerald-900'
              return (
                <div key={`${prob}-${imp}`} className={`border rounded min-h-[76px] flex flex-wrap gap-1 content-start p-1.5 ${bg}`}>
                  {cellRisks.map(r => (
                    <span key={r.id} title={`${codes.get(r.id) ?? ''} ${r.title}`.trim()} className="text-xs font-mono bg-white dark:bg-slate-900 dark:text-slate-200 rounded px-1.5 py-0.5 shadow-sm max-w-full truncate">
                      {codes.get(r.id) ?? r.title.slice(0, 6)}
                    </span>
                  ))}
                </div>
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}

export default function RisksTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const showToast = useToastStore(s => s.show)

  const [localRows, setLocalRows] = useState<Risk[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [logRiskId, setLogRiskId] = useState<string | null>(null)
  const [cardRiskId, setCardRiskId] = useState<string | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})

  const STATUS_OPT = [
    { value: 'open', label: t('risks.statuses.open') },
    { value: 'mitigated', label: t('risks.statuses.mitigated') },
    { value: 'accepted', label: t('risks.statuses.accepted') },
    { value: 'closed', label: t('risks.statuses.closed') },
    { value: 'occurred', label: t('risks.statuses.occurred') },
  ]
  const HIL_OPT = HIL.map(v => ({ value: v, label: t(`risks.levels.${v}`) }))
  const CAT_OPT = ['technical', 'financial', 'operational', 'external', 'personnel'].map(v => ({ value: v, label: t(`risks.categories.${v}`) }))

  const COLS: ColDef[] = [
    { key: 'title', label: t('risks.titleCol'), defaultWidth: 180, required: true, hint: t('risks.hints.title') },
    { key: 'category', label: t('risks.category'), defaultWidth: 100, hint: t('risks.hints.category') },
    { key: 'probability', label: t('risks.probability'), defaultWidth: 90, hint: t('risks.hints.probability') },
    { key: 'impact', label: t('risks.impact'), defaultWidth: 80, hint: t('risks.hints.impact') },
    { key: 'action', label: t('risks.action'), defaultWidth: 120 },
    { key: 'status', label: t('common.status'), defaultWidth: 90, hint: t('risks.hints.status') },
    { key: 'owner', label: t('risks.owner'), defaultWidth: 110, hint: t('risks.hints.owner') },
    { key: 'description', label: t('risks.description'), defaultWidth: 160, hint: t('risks.hints.description') },
    { key: 'mitigation', label: t('risks.mitigation'), defaultWidth: 160, hint: t('risks.hints.mitigation') },
    { key: 'contingency', label: t('risks.contingencyPlan'), defaultWidth: 140, hint: t('risks.hints.contingency') },
  ]
  const guideSteps: GuideStep[] = [
    { title: t('risks.guide.s1'), desc: t('risks.guide.s1d') },
    { title: t('risks.guide.s2'), desc: t('risks.guide.s2d') },
    { title: t('risks.guide.s3'), desc: t('risks.guide.s3d') },
    { title: t('risks.guide.s4'), desc: t('risks.guide.s4d') },
    { title: t('risks.guide.s5'), desc: t('risks.guide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('risks.guideDefinitions.probabilityImpact'), desc: t('risks.guideDefinitions.probabilityImpactDesc') },
    { term: t('risks.guideDefinitions.action'), desc: t('risks.guideDefinitions.actionDesc') },
    { term: t('risks.guideDefinitions.open'), desc: t('risks.guideDefinitions.openDesc') },
    { term: t('risks.guideDefinitions.closed'), desc: t('risks.guideDefinitions.closedDesc') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(152)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('risks', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 152)

  const { data: risks = EMPTY_ARRAY, isLoading, isError } = useQuery({
    queryKey: ['risks', projectId],
    queryFn: () => getRisks(projectId),
  })

  useEffect(() => { setLocalRows(risks) }, [risks])

  // Отображаемый код: настоящий r.code, а старым рискам без кода (до авто-нумерации
  // на бэкенде) — стабильный fallback R-NN по порядку создания.
  const codeById = useMemo(() => {
    const sorted = [...risks].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    const used = new Set(sorted.map(r => r.code).filter(Boolean) as string[])
    const map = new Map<string, string>()
    let n = 1
    for (const r of sorted) {
      if (r.code) { map.set(r.id, r.code); continue }
      let c = `R-${String(n).padStart(2, '0')}`
      while (used.has(c)) { n += 1; c = `R-${String(n).padStart(2, '0')}` }
      used.add(c)
      map.set(r.id, c)
    }
    return map
  }, [risks])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => risks.map((r) => ({
    code: codeById.get(r.id) ?? r.code, title: r.title, category: r.category,
    probability: r.probability, impact: r.impact, score: r.score,
    status: r.status, owner: r.owner, mitigation_plan: r.mitigation_plan,
  })), [risks, codeById])
  useSectionExport('risks', exportRows)

  const logRisk = risks.find(r => r.id === logRiskId) ?? null
  const cardRisk = risks.find(r => r.id === cardRiskId) ?? null

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

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['risks', projectId] }),
    qc.invalidateQueries({ queryKey: ['risks_summary', projectId] }),  // сводка рисков в статус-отчётах
    qc.invalidateQueries({ queryKey: ['attention'] }),                 // риски влияют на «Требует внимания»
  ])

  const commitEdit = async (overrideValue?: string) => {
    if (!editCell) return
    const { id, field } = editCell
    setEditCell(null)
    const val = overrideValue ?? editValue
    await updateRisk(projectId, id, { [field]: val || null })
    await invalidate()
  }

  const handleDelete = (id: string) => {
    showConfirm(t('risks.deleteConfirm'), async () => {
      // Снимок риска до удаления — для undo (восстановленный риск получит новый id и code).
      // Только существующие/непустые безопасные поля.
      const deleted = risks.find(r => r.id === id)
      const restorePayload: Partial<Risk> | null = deleted
        ? {
            title: deleted.title,
            status: deleted.status,
            ...(deleted.description ? { description: deleted.description } : {}),
            ...(deleted.category ? { category: deleted.category } : {}),
            ...(deleted.probability ? { probability: deleted.probability } : {}),
            ...(deleted.impact ? { impact: deleted.impact } : {}),
            ...(deleted.owner ? { owner: deleted.owner } : {}),
            ...(deleted.mitigation_plan ? { mitigation_plan: deleted.mitigation_plan } : {}),
            ...(deleted.contingency_plan ? { contingency_plan: deleted.contingency_plan } : {}),
            ...(deleted.related_task_id ? { related_task_id: deleted.related_task_id } : {}),
          }
        : null
      await deleteRisk(projectId, id, { silentToast: true })
      await invalidate()
      if (logRiskId === id) setLogRiskId(null)
      if (restorePayload) {
        showToast(t('common.deleted', { defaultValue: 'Удалено' }), 'success', {
          action: {
            label: t('common.undo', { defaultValue: 'Отменить' }),
            onClick: async () => {
              await createRisk(projectId, restorePayload)
              await invalidate()
            },
          },
        })
      } else {
        showToast(t('common.deleted', { defaultValue: 'Удалено' }), 'success')
      }
    })
  }

  const handleSaveAdd = async () => {
    if (!addValues.title?.trim()) return
    await createRisk(projectId, { ...addValues, status: addValues.status || 'open' } as Partial<Risk>); await invalidate()
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

  // Длинные тексты (описание, планы) в таблице обрезаны двумя строками — читать их надо в карточке.
  // Нативная подсказка по наведению — дешёвый мостик к полному тексту, пока карточка не открыта.
  const cellTrunc = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <input autoFocus className={inp} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }} />
      : <TruncatedCell className={spanTrunc} text={value} onActivate={() => beginEdit(id, field, value)} />

  const personCell = (id: string, field: string, value: string | null) =>
    editCell?.id === id && editCell?.field === field
      ? <PersonPicker autoFocus className={inp} value={editValue}
          onChange={v => setEditValue(v)} onSelect={v => commitEdit(v)} />
      : <TruncatedCell className={span} text={value} onActivate={() => beginEdit(id, field, value)} />

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
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('project.sections.risks')} ({risks.length})</h3>
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </div>

        <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
          <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className={TABLE_DRAG_HEAD_CLASS} />
                {/* code/score — фикс-ширина (table-fixed берёт ширину из шапки): иначе они
                    «съедали» слак и делали ресайз соседних колонок дёрганым. */}
                <th style={{ width: 64 }} className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-3 whitespace-nowrap">{t('risks.code')}</th>
                <th style={{ width: 52 }} className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-3 whitespace-nowrap">{t('risks.score')}</th>
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
                  {/* code */}
                  <td className="py-1 pr-3 text-xs text-gray-500 dark:text-slate-400 italic">{t('common.auto')}</td>
                  {/* score */}
                  <td />
                  {isVis('title') && (
                    <td className="py-1 pr-3"><input autoFocus className={addInp} value={addValues.title ?? ''} placeholder={t('risks.titleCol') + '…'} onChange={e => setAddValues(v => ({ ...v, title: e.target.value }))} /></td>
                  )}
                  {isVis('category') && (
                    <td className="py-1 pr-3">
                      <select className={addInp} value={addValues.category ?? ''} onChange={e => setAddValues(v => ({ ...v, category: e.target.value }))}>
                        <option value="">—</option>
                        {CAT_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {isVis('probability') && (
                    <td className="py-1 pr-3">
                      <select className={addInp} value={addValues.probability ?? ''} onChange={e => setAddValues(v => ({ ...v, probability: e.target.value }))}>
                        <option value="">—</option>
                        {HIL_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {isVis('impact') && (
                    <td className="py-1 pr-3">
                      <select className={addInp} value={addValues.impact ?? ''} onChange={e => setAddValues(v => ({ ...v, impact: e.target.value }))}>
                        <option value="">—</option>
                        {HIL_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {isVis('action') && <td />}
                  {isVis('status') && (
                    <td className="py-1 pr-3">
                      <select className={addInp} value={addValues.status ?? 'open'} onChange={e => setAddValues(v => ({ ...v, status: e.target.value }))}>
                        {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {isVis('owner') && (
                    <td className="py-1 pr-3"><PersonPicker className={addInp} value={addValues.owner ?? ''} placeholder={t('risks.owner') + '…'} onChange={v => setAddValues(prev => ({ ...prev, owner: v }))} /></td>
                  )}
                  {/* Поля были пустыми ячейками: описание, план снижения и план на случай
                    наступления можно было ввести только ПОСЛЕ сохранения риска. Имена полей —
                    api-шные (mitigation_plan/contingency_plan), а не ключи колонок: строка
                    добавления уходит на сервер как есть. */}
                {isVis('description') && (
                  <td className="py-1 pr-3">
                    <input className={addInp} placeholder={t('risks.description')}
                      value={addValues.description ?? ''}
                      onChange={e => setAddValues(v => ({ ...v, description: e.target.value }))} />
                  </td>
                )}
                  {isVis('mitigation') && (
                  <td className="py-1 pr-3">
                    <input className={addInp} placeholder={t('risks.mitigation')}
                      value={addValues.mitigation_plan ?? ''}
                      onChange={e => setAddValues(v => ({ ...v, mitigation_plan: e.target.value }))} />
                  </td>
                )}
                  {isVis('contingency') && (
                  <td className="py-1 pr-3">
                    <input className={addInp} placeholder={t('risks.contingencyPlan')}
                      value={addValues.contingency_plan ?? ''}
                      onChange={e => setAddValues(v => ({ ...v, contingency_plan: e.target.value }))} />
                  </td>
                )}
                  <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                    <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                    <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                  </div></td>
                </tr>
              )}
              {displayRows.map((r, idx) => {
                const action = getRiskAction(r.probability, r.impact)
                return (
                  <tr key={r.id} draggable={false}
                    onDrop={() => onDrop(idx)} onDragEnd={onDragEnd}
                    className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${dragOverIdx === idx ? 'bg-blue-50 border-t-2 border-primary-500' : ''}`}>
                    <td className={`${TABLE_DRAG_CELL_CLASS} text-gray-200 dark:text-slate-700 cursor-default`}><GripVertical size={14} /></td>
                    {/* code always shown */}
                    <td className="py-1 pr-3 font-mono text-gray-500 dark:text-slate-400">{codeById.get(r.id) ?? r.code ?? '—'}</td>
                    {/* score always shown */}
                    <td className="py-1 pr-3"><span className={`px-1.5 py-0.5 rounded text-xs ${SCORE_COLOR(r.score)}`}>{r.score ?? '—'}</span></td>
                    {isVis('title') && <td className="py-1 pr-3 font-medium max-w-[140px]">{cell(r.id, 'title', r.title)}</td>}
                    {isVis('category') && <td className="py-1 pr-3">{selCell(r.id, 'category', r.category, CAT_OPT)}</td>}
                    {isVis('probability') && <td className="py-1 pr-3">{selCell(r.id, 'probability', r.probability, HIL_OPT)}</td>}
                    {isVis('impact') && <td className="py-1 pr-3">{selCell(r.id, 'impact', r.impact, HIL_OPT)}</td>}
                    {isVis('action') && (
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {action ? (
                          <span className={`inline-block whitespace-nowrap text-xs px-1.5 py-0.5 rounded font-medium ${ACTION_COLORS[action]}`}>
                            {t(`risks.actions.${action}`)}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                    {isVis('status') && <td className="py-1 pr-3">{selCell(r.id, 'status', r.status, STATUS_OPT)}</td>}
                    {isVis('owner') && <td className="py-1 pr-3">{personCell(r.id, 'owner', r.owner)}</td>}
                    {isVis('description') && <td className="py-1 pr-3 overflow-hidden">{cellTrunc(r.id, 'description', r.description)}</td>}
                    {isVis('mitigation') && <td className="py-1 pr-3 overflow-hidden">{cellTrunc(r.id, 'mitigation_plan', r.mitigation_plan)}</td>}
                    {isVis('contingency') && <td className="py-1 pr-3 overflow-hidden">{cellTrunc(r.id, 'contingency_plan', r.contingency_plan)}</td>}
                    <td className={TABLE_ACTION_CELL_CLASS}>
                      <div className={TABLE_ACTION_GROUP_CLASS}>
                        <button onClick={e => { e.stopPropagation(); setCardRiskId(r.id) }}
                          aria-label={t('risks.editRisk')}
                          className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-600`}><Pencil size={ICON_SM} /></button>
                        <button onClick={e => { e.stopPropagation(); setLogRiskId(r.id) }}
                          aria-label={t('common.log', { defaultValue: 'История' })}
                          className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                        {canWrite && (
                          <button onClick={e => { e.stopPropagation(); handleDelete(r.id) }}
                            aria-label={t('common.delete')}
                            className={`${TABLE_ICON_BUTTON_CLASS} hover:text-red-500`}><X size={ICON_SM} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {displayRows.length === 0 && !addRow && (
                <tr>
                  <td colSpan={visibleCols.length + 4}>
                    <EmptyValueState
                      inline
                      message={t('adopt.empty.risks', { defaultValue: 'Запишите, что может пойти не так, — и неприятный сюрприз встретит вас уже с готовым планом действий.' })}
                      actionLabel={canWrite ? t('risks.add') : undefined}
                      onAction={canWrite ? () => { setAddRow(true); setAddValues({ status: 'open' }) } : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!addRow && canWrite && displayRows.length > 0 && (
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setAddRow(true); setAddValues({ status: 'open' }) }}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              <Plus size={11} /> {t('risks.add')}
            </button>
          </div>
        )}

        <RiskMatrix risks={risks} codes={codeById} />
      </div>

      {logRisk && (
        <LogPanel projectId={projectId} isRisk={true} riskId={logRisk.id}
          updates={logRisk.updates} title={logRisk.title} onClose={() => setLogRiskId(null)} />
      )}

      <RiskDrawer
        risk={cardRisk}
        code={cardRisk ? codeById.get(cardRisk.id) : undefined}
        onClose={() => setCardRiskId(null)}
        onSave={async (id, data) => { await updateRisk(projectId, id, data); await invalidate() }}
      />
    </div>
  )
}
