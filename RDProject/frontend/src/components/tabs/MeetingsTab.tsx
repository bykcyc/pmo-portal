import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, X, MessageSquare } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import LogPanel from '@/components/LogPanel'
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, finalizeMeeting, unfinalizeMeeting, deleteMeetingBitrixEvent } from '@/api/meetings'
import { formatDate, parseDateStrict } from '@/utils/date'
import { buildMeetingPayload, meetingToForm } from './meetings/meetingsPayload'
import type { Meeting, AgendaItem, Attendee, ActionItem } from '@/types/meeting'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import { useSectionExport } from '@/hooks/useSectionExport'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import {
  getManagedTableStyle,
  TABLE_ACTION_CELL_CLASS,
  TABLE_ACTION_GROUP_CLASS,
  TABLE_ACTION_HEAD_CLASS,
  TABLE_BADGE_CLASS,
  TABLE_BASE_CLASS,
  TABLE_FILL_CELL_CLASS,
  TABLE_FILL_HEAD_CLASS,
  TABLE_ICON_BUTTON_CLASS,
  TABLE_SCROLL_WRAP_CLASS,
} from '@/components/tableStyles'
import { STATUS_COLORS, type MeetingFormData } from './meetings/meetingsConstants'
import { RecurDialog, MeetingDetail, MeetingForm, BitrixEventDialog } from './meetings/MeetingsParts'

type View = 'list' | 'form' | 'detail'

const emptyForm = (): MeetingFormData => ({
  title: '', meeting_type: '', meeting_date: '', meeting_time: '', duration_minutes: 60,
  location: '', minutes_content: '', next_meeting_date: '',
  next_meeting_type: '', next_meeting_participants: '',
  agenda_items: [], attendees: [], actions: [], decisions: [],
})

export default function MeetingsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const MEETING_TYPES = [
    t('meetings.typeOptions.kickoff'),
    t('meetings.typeOptions.weeklySync'),
    t('meetings.typeOptions.steeringCommittee'),
    t('meetings.typeOptions.review'),
    t('meetings.typeOptions.retrospective'),
    t('meetings.typeOptions.adHoc'),
  ]
  const [view, setView] = useState<View>('list')
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null)
  const [recurMeetingTarget, setRecurMeetingTarget] = useState<Meeting | null>(null)
  // Дата/время, пришедшие из календаря Bitrix: новая форма открывается уже заполненной.
  const [prefill, setPrefill] = useState<Partial<MeetingFormData> | null>(null)
  const [logEntity, setLogEntity] = useState<{ id: string; name: string } | null>(null)
  const [bitrixDialog, setBitrixDialog] = useState<Meeting | null>(null)
  const [saving, setSaving] = useState(false)

  const COLS: ColDef[] = [
    { key: 'title', label: t('meetings.title') ?? 'Title', defaultWidth: 200, required: true, hint: t('meetings.hints.title') },
    { key: 'date', label: t('meetings.date'), defaultWidth: 100, hint: t('meetings.hints.date') },
    // 130, а не 90: «Финализировано» занимает 113px, и колонка по умолчанию обязана его вмещать.
    // Обрезание с многоточием — страховка на случай, когда человек сузил колонку сам.
    { key: 'status', label: t('common.status'), defaultWidth: 130, hint: t('meetings.hints.status') },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('meetings.guide.s1'), desc: t('meetings.guide.s1d') },
    { title: t('meetings.guide.s2'), desc: t('meetings.guide.s2d') },
    { title: t('meetings.guide.s3'), desc: t('meetings.guide.s3d') },
    { title: t('meetings.guide.s4'), desc: t('meetings.guide.s4d') },
    { title: t('meetings.guide.s5'), desc: t('meetings.guide.s5d') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(220)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('meetings', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 220)

  const { data: meetings = [], isLoading, isError } = useQuery({
    queryKey: ['meetings', projectId],
    queryFn: () => getMeetings(projectId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['meetings', projectId] })

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => meetings.map((m) => ({
    title: m.title, meeting_type: m.meeting_type, meeting_date: m.meeting_date, status: m.status,
  })), [meetings])
  useSectionExport('meetings', exportRows)

  const openCreate = () => { setEditingMeeting(null); setView('form') }
  const openEdit = (m: Meeting) => { setEditingMeeting(m); setView('form') }
  const openDetail = (m: Meeting) => { setSelectedMeeting(m); setView('detail') }

  const handleDelete = (id: string) => {
    showConfirm(t('meetings.deleteConfirm'), async () => {
      await deleteMeeting(projectId, id); await invalidate()
      if (view === 'detail') setView('list')
    })
  }

  const showToast = useToastStore(s => s.show)

  const handleFinalize = (m: Meeting) => {
    showConfirm(t('meetings.finalizeConfirm'), async () => {
      setSaving(true)
      try {
        // финализация: решения → Журнал решений, поручения → Бэклог действий (бэкенд)
        const res = await finalizeMeeting(projectId, m.id)
        await invalidate()
        await qc.invalidateQueries({ queryKey: ['decisions', projectId] })
        await qc.invalidateQueries({ queryKey: ['backlog', projectId] })
        const refreshed = (await getMeetings(projectId)).find(x => x.id === m.id) ?? null
        setSelectedMeeting(refreshed)
        const parts: string[] = []
        if (res.decisions_added > 0) parts.push(t('meetings.decisionsMoved', { count: res.decisions_added, defaultValue: 'решений в журнал: {{count}}' }))
        if (res.actions_added > 0) parts.push(t('meetings.actionsMoved', { count: res.actions_added, defaultValue: 'поручений в бэклог: {{count}}' }))
        if (parts.length) showToast(parts.join(' · '), 'success')
      } finally { setSaving(false) }
    }, { confirmLabel: t('meetings.finalize'), variant: 'primary' })
  }

  const refreshSelected = async (id: string) => {
    setSelectedMeeting((await getMeetings(projectId)).find(x => x.id === id) ?? null)
  }

  // #11/#F «Создать собрание в Битрикс» — открывает форму (предпросмотр + подбор слота), см. BitrixEventDialog
  const handleDeleteBitrix = (m: Meeting) => {
    showConfirm(t('meetings.bitrixDeleteConfirm', { defaultValue: 'Удалить событие этого совещания в Bitrix?' }), async () => {
      setSaving(true)
      try {
        await deleteMeetingBitrixEvent(projectId, m.id)
        await invalidate(); await refreshSelected(m.id)
        showToast(t('meetings.bitrixDeleted', { defaultValue: 'Событие в Bitrix удалено' }), 'success')
      } catch (err) {
        // Bitrix не дал удалить и не подтвердил, что события нет. Раньше человек застревал:
        // отметка «✓ Bitrix» не снимается, а кнопка создания под ней спрятана — ни отвязать,
        // ни создать заново. Предлагаем снять отметку у нас, честно сказав, что это значит.
        //
        // ТОЛЬКО на 502 — это код «Bitrix отказал». На 403 (не ваш проект) и 404 (совещание
        // исчезло) предлагать «снять принудительно» бессмысленно: там отказал портал, и
        // повтор с force упрётся ровно в то же самое.
        if ((err as { response?: { status?: number } })?.response?.status !== 502) throw err
        showConfirm(t('meetings.bitrixUnlinkForce', {
          defaultValue: 'Bitrix не отвечает или отказал. Снять отметку «в Bitrix» только в портале? Событие в календаре, если оно ещё существует, останется — удалите его там вручную.',
        }), async () => {
          setSaving(true)
          try {
            await deleteMeetingBitrixEvent(projectId, m.id, true)
            await invalidate(); await refreshSelected(m.id)
            showToast(t('meetings.bitrixUnlinked', { defaultValue: 'Отметка снята' }), 'success')
          } finally { setSaving(false) }
        }, { confirmLabel: t('meetings.bitrixRemove', { defaultValue: 'Убрать из Bitrix' }), variant: 'danger' })
      } finally { setSaving(false) }
    }, { confirmLabel: t('common.delete'), variant: 'danger' })
  }
  // #13 отмена завершения — можно дополнить и завершить заново (без дублей на бэке)
  const handleUnfinalize = (m: Meeting) => {
    showConfirm(t('meetings.unfinalizeConfirm', { defaultValue: 'Отменить завершение, чтобы дополнить совещание? Уже перенесённые поручения и решения останутся — повторное завершение не создаст дублей.' }), async () => {
      setSaving(true)
      try {
        await unfinalizeMeeting(projectId, m.id)
        await invalidate(); await refreshSelected(m.id)
      } finally { setSaving(false) }
    }, { confirmLabel: t('meetings.unfinalize', { defaultValue: 'Отменить завершение' }), variant: 'primary' })
  }

  const handleRecur = (m: Meeting) => setRecurMeetingTarget(m)

  const handleSave = async (form: MeetingFormData) => {
    setSaving(true)
    try {
      const payload = buildMeetingPayload(form, { status: editingMeeting?.status ?? 'draft' })
      setPrefill(null)   // дата/время из календаря уже применены — не тянуть их в следующую форму
      if (editingMeeting) {
        const updated = await updateMeeting(projectId, editingMeeting.id, payload)
        await invalidate(); setSelectedMeeting(updated); setView('detail')
      } else {
        await createMeeting(projectId, payload); await invalidate(); setView('list')
      }
    } finally { setSaving(false) }
  }

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  if (view === 'form') {
    return <MeetingForm projectId={projectId}
      initialData={editingMeeting ? meetingToForm(editingMeeting) : { ...emptyForm(), ...(prefill ?? {}) }}
      isEdit={!!editingMeeting} isFinal={editingMeeting?.status === 'final'}
      saving={saving} onSave={handleSave}
      onCancel={() => { setPrefill(null); setView(editingMeeting ? 'detail' : 'list') }} />
  }

  if (view === 'detail' && selectedMeeting) {
    return (
      <>
        <MeetingDetail meeting={selectedMeeting} onEdit={() => openEdit(selectedMeeting)}
          onDelete={() => handleDelete(selectedMeeting.id)}
          onFinalize={() => handleFinalize(selectedMeeting)}
          onUnfinalize={() => handleUnfinalize(selectedMeeting)}
          onCreateBitrix={() => setBitrixDialog(selectedMeeting)}
          onDeleteBitrix={() => handleDeleteBitrix(selectedMeeting)}
          onRecur={() => handleRecur(selectedMeeting)}
          onBack={() => setView('list')} saving={saving} canWrite={canWrite} />
        {recurMeetingTarget && (
          <RecurDialog projectId={projectId} meetingId={recurMeetingTarget.id}
            onClose={() => setRecurMeetingTarget(null)} onDone={invalidate} />
        )}
        {bitrixDialog && (
          <BitrixEventDialog projectId={projectId} meeting={bitrixDialog}
            onClose={() => setBitrixDialog(null)}
            onDone={async () => {
              await invalidate(); await refreshSelected(bitrixDialog.id)
              showToast(t('meetings.bitrixCreated', { defaultValue: 'Событие создано в Bitrix' }), 'success')
              setBitrixDialog(null)
            }} />
        )}
      </>
    )
  }

  const displayRows = [...meetings].sort((a, b) => {
    if (!sort) return 0
    let av: string, bv: string
    if (sort.field === 'date') {
      av = a.meeting_date ?? ''
      bv = b.meeting_date ?? ''
    } else if (sort.field === 'title') {
      av = a.title ?? ''
      bv = b.title ?? ''
    } else {
      av = String((a as unknown as Record<string, unknown>)[sort.field] ?? '')
      bv = String((b as unknown as Record<string, unknown>)[sort.field] ?? '')
    }
    const cmp = av.localeCompare(bv)
    return sort.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('meetings.title')} ({meetings.length})</h3>
          <ProcessGuide steps={guideSteps} />
        </div>
        <div className="flex items-center gap-2">
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
          {canWrite && (
            <button onClick={openCreate}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
              <Plus size={ICON_SM} /> {t('meetings.newMeeting')}
            </button>
          )}
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-slate-300">
            {t('followups.meetingsEmptyValue', { defaultValue: 'Повестка, решения и поручения каждой встречи — в одном месте. Ничего не потеряется.' })}
          </p>
          {canWrite && (
            <button onClick={openCreate}
              className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
              <Plus size={ICON_SM} /> {t('meetings.newMeeting')}
            </button>
          )}
        </div>
      ) : (
        <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
          <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                {visibleCols.map((col, index) => (
                  <ColTh key={col.key} col={col} sort={sort} onSort={setSort} width={getW(col.key)} onResize={startResize(col.key)}
                    onResizePrev={index > 0 ? startResize(visibleCols[index - 1].key) : undefined} />
                ))}
                {/* extra info column always shown */}
                <th className={`text-left font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap ${TABLE_FILL_HEAD_CLASS}`}>{t('meetings.attendeesLabel')} / {t('meetings.actionsLabel')}</th>
                <th className={TABLE_ACTION_HEAD_CLASS} />
              </tr>
            </thead>
            <tbody>
              {displayRows.map(m => (
                <tr key={m.id} onClick={() => openDetail(m)}
                  className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                  {isVis('title') && (
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-800 dark:text-slate-200 whitespace-normal break-words">{m.title}</div>
                      {m.meeting_type && <span className="text-xs text-gray-500 dark:text-slate-300">{m.meeting_type}</span>}
                      {m.location && <p className="text-xs text-gray-500 dark:text-slate-400">{m.location}</p>}
                    </td>
                  )}
                  {isVis('date') && (
                    <td className="py-2 pr-3 text-gray-500 dark:text-slate-300 font-mono whitespace-nowrap">{formatDate(m.meeting_date)}</td>
                  )}
                  {isVis('status') && (
                    // min-w-0: без него ячейка `table-fixed` не даёт содержимому ужаться,
                    // и truncate внутри не срабатывает.
                    <td className="min-w-0 py-2 pr-3">
                      {(() => {
                        const label = m.status === 'final' ? t('meetings.finalStatus') : t('meetings.draft')
                        return (
                          <span title={label}
                            className={`${TABLE_BADGE_CLASS} ${STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                            {label}
                          </span>
                        )
                      })()}
                    </td>
                  )}
                  {/* extra info always shown */}
                  <td className={`${TABLE_FILL_CELL_CLASS} text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap`}>
                    {m.attendees.length} {t('meetings.attendeesLabel')} · {m.actions.length} {t('meetings.actionsLabel')}
                    {m.bitrix_event_id
                      ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓ Bitrix</span>
                      : <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-gray-400 dark:bg-slate-800 dark:text-slate-500">{t('meetings.notInBitrix', { defaultValue: 'не в Bitrix' })}</span>}
                  </td>
                  <td className={TABLE_ACTION_CELL_CLASS}>
                    <div className={TABLE_ACTION_GROUP_CLASS}>
                      <button onClick={e => { e.stopPropagation(); setLogEntity({ id: m.id, name: m.title }) }}
                        aria-label={t('meetings.comments', { defaultValue: 'Комментарии' })}
                        title={t('meetings.comments', { defaultValue: 'Комментарии' })}
                        className={`${TABLE_ICON_BUTTON_CLASS} hover:text-primary-500`}><MessageSquare size={ICON_SM} /></button>
                      {canWrite && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(m.id) }}
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
      </div>

      {logEntity && (
        <LogPanel projectId={projectId} entityType="meeting" entityId={logEntity.id}
          title={logEntity.name} onClose={() => setLogEntity(null)} />
      )}
    </div>
  )
}
