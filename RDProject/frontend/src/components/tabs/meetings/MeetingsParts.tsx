import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plus, X, Lock, Unlock, ChevronDown, ChevronUp, Repeat, CalendarPlus, Trash2, AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { recurMeeting, updateMeeting, createMeetingBitrixEvent } from '@/api/meetings'
import { getCalendarAccessibility } from '@/api/calendar'
import { formatDate, parseDate } from '@/utils/date'
import type { Meeting } from '@/types/meeting'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import PersonPicker from '@/components/PersonPicker'
import { useAuthStore } from '@/store/authStore'
import { STATUS_COLORS, type MeetingFormData } from './meetingsConstants'
import SlotPicker from './SlotPicker'

const ACTION_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300',
  done: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-200',
}

const MEETING_TYPE_KEYS = ['kickoff', 'weeklySync', 'steeringCommittee', 'review', 'retrospective', 'adHoc'] as const

// ── Recur Dialog ───────────────────────────────────────────────────────────

export function RecurDialog({ projectId, meetingId, onClose, onDone }: {
  projectId: string; meetingId: string; onClose: () => void; onDone: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [count, setCount] = useState(4)
  const [recurrence, setRecurrence] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await recurMeeting(projectId, meetingId, count, recurrence)
      await onDone()
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('meeting.recurTitle', { defaultValue: 'Повторить встречу' })}</h3>
          <button type="button" onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"><X size={18} /></button>
        </div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('meeting.recurEvery', { defaultValue: 'Как часто' })}</label>
        <select
          value={recurrence}
          onChange={e => setRecurrence(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
          className="mb-3 w-full rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="weekly">{t('meeting.freqWeekly', { defaultValue: 'Еженедельно' })}</option>
          <option value="biweekly">{t('meeting.freqBiweekly', { defaultValue: 'Раз в 2 недели' })}</option>
          <option value="monthly">{t('meeting.freqMonthly', { defaultValue: 'Ежемесячно' })}</option>
        </select>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('meeting.recurCount', { defaultValue: 'Сколько раз' })}</label>
        <select
          value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={submit} disabled={busy} icon={<Repeat size={14} />}>
            {t('meeting.recur', { defaultValue: 'Повторить' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Bitrix event dialog (#F) — предпросмотр события + подбор слота, затем создание ─────────

export function BitrixEventDialog({ projectId, meeting, onClose, onDone }: {
  projectId: string; meeting: Meeting; onClose: () => void; onDone: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [date, setDate] = useState((meeting.meeting_date ?? '').slice(0, 10))
  const [time, setTime] = useState(meeting.meeting_time ?? '')
  // Описание события собираем из черновика: место + повестка + протокол — размеченным читаемым текстом.
  const [description, setDescription] = useState(() => {
    const lines: string[] = []
    if ((meeting.location ?? '').trim()) lines.push(`${t('meetings.location', { defaultValue: 'Место' })}: ${meeting.location}`)
    const ag = meeting.agenda_items.filter(a => (a.item ?? '').trim())
    if (ag.length) {
      lines.push('', `${t('meetings.agenda', { defaultValue: 'Повестка' })}:`)
      ag.forEach((a, i) => {
        const extra = [a.presenter, a.time_allocated].filter(x => (x ?? '').toString().trim()).join(', ')
        lines.push(`${i + 1}. ${a.item}${extra ? ` (${extra})` : ''}`)
      })
    }
    if ((meeting.minutes_content ?? '').trim()) {
      lines.push('', `${t('meetings.minutes', { defaultValue: 'Протокол' })}:`, meeting.minutes_content ?? '')
    }
    return lines.join('\n')
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // conflicts: hostBusy=true — занят сам организатор (создать нельзя, его не исключить); иначе names/ids —
  // занятые гости, которых можно не приглашать. null — конфликтов нет.
  const [conflicts, setConflicts] = useState<{ hostBusy: boolean; names: string[]; ids: number[] } | null>(null)
  const hostBx = useAuthStore(s => s.user?.bitrix24_user_id)   // bitrix-id организатора (текущий пользователь)

  const named = meeting.attendees.filter(a => (a.name || '').trim())
  const invited = named.filter(a => a.bitrix24_id)
  const notInvited = named.filter(a => !a.bitrix24_id)

  // SlotPicker читает из form только attendees + duration — остальное можно оставить пустым.
  const slotForm: MeetingFormData = {
    title: meeting.title, meeting_type: meeting.meeting_type ?? '', meeting_date: date, meeting_time: time,
    duration_minutes: meeting.duration_minutes ?? 60, location: meeting.location ?? '', minutes_content: '',
    next_meeting_date: '', next_meeting_type: '', next_meeting_participants: '', agenda_items: [],
    attendees: named.map(a => ({ name: a.name, role_dept: a.role_dept ?? '', present: a.present, comments: a.comments ?? '', person_id: a.person_id ?? null, email: a.email ?? null, bitrix24_id: a.bitrix24_id ?? null })),
    actions: [], decisions: [],
  }
  const inputCls = 'w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5'

  // Собственно создание. excludeIds — bitrix-id занятых, кого владелец решил не приглашать (они
  // остаются участниками совещания в портале, но в событие Bitrix не зовутся).
  const doCreate = async (excludeIds: number[]) => {
    setConflicts(null); setBusy(true); setError(null)
    try {
      // Дата/время из подбора попадают в черновик ТОЛЬКО при создании (merge, остальное не трогаем).
      const curDate = (meeting.meeting_date ?? '').slice(0, 10)
      if ((date || '') !== curDate || (time || '') !== (meeting.meeting_time ?? '')) {
        await updateMeeting(projectId, meeting.id, { meeting_date: date || null, meeting_time: time || null })
      }
      await createMeetingBitrixEvent(projectId, meeting.id, description, excludeIds.length ? excludeIds : undefined)
      await onDone()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || t('meetings.bitrixError', { defaultValue: 'Не удалось создать событие в Bitrix' }))
      setBusy(false)
    }
  }

  // Перед созданием проверяем занятость в выбранное время (по календарям Bitrix) — И приглашённых,
  // И самого организатора. Организатор занят → создать НЕЛЬЗЯ (его из события не исключить). Заняты
  // только гости → предлагаем создать без них (исключить из приглашения) либо отменить.
  const attemptCreate = async () => {
    setBusy(true); setError(null)
    try {
      // hostBx: number | null | undefined. Number(null)===0 (и 0 «конечен») — поэтому НЕ через Number():
      // непривязанный к Bitrix организатор (null) не должен подмешивать id 0 в проверку занятости.
      const host = typeof hostBx === 'number' && hostBx > 0 ? hostBx : NaN
      const hasHost = Number.isFinite(host)
      const guestIds = invited.map(a => Number(a.bitrix24_id)).filter(n => Number.isFinite(n))
      const allIds = Array.from(new Set([...guestIds, ...(hasHost ? [host] : [])]))
      const [hh, mm] = (time || '').split(':').map(Number)
      if (allIds.length && Number.isFinite(hh)) {
        const startMin = hh * 60 + (mm || 0)
        const endMin = startMin + (meeting.duration_minutes ?? 60)
        const acc = await getCalendarAccessibility(allIds, date, date)
        const at = (iso: string) => { const m = /(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso || ''); return m ? { day: m[1], min: +m[2] * 60 + +m[3] } : null }
        const isBusy = (id: number) => (acc[String(id)] || []).some(iv => {
          const f = at(iv.from); if (!f || f.day !== date) return false
          const e = at(iv.to); const bEnd = e && e.day === date ? e.min : 24 * 60
          return f.min < endMin && bEnd > startMin           // пересечение с окном совещания
        })
        if (hasHost && isBusy(host)) {                       // организатор занят — жёсткий стоп
          setConflicts({ hostBusy: true, names: [], ids: [] })
          setBusy(false); return
        }
        const busyGuests = invited.filter(a => isBusy(Number(a.bitrix24_id)))
        if (busyGuests.length) {
          setConflicts({ hostBusy: false, names: busyGuests.map(a => a.name), ids: busyGuests.map(a => Number(a.bitrix24_id)) })
          setBusy(false); return
        }
      }
      await doCreate([])
    } catch {
      // проверку занятости не удалось сделать (нет доступа/Bitrix) — не блокируем, создаём как есть
      await doCreate([])
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <Surface className="w-full max-w-md p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('meetings.bitrixCreate', { defaultValue: 'Создать в Bitrix' })}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"><X size={ICON_SM} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.titleField')}</p>
            <p className="text-sm font-medium text-gray-800 dark:text-slate-100">{meeting.title}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">{t('meetings.date')}</label>
              <input type="date" value={date} onChange={e => { setDate(e.target.value); setConflicts(null) }} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">{t('meetings.timeLabel')}</label>
              <input type="time" value={time} onChange={e => { setTime(e.target.value); setConflicts(null) }} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.durationLabel')}: {meeting.duration_minutes ?? 60}</span>
            <SlotPicker projectId={projectId} form={slotForm} onPick={(d, tm) => { setDate(d); setTime(tm); setConflicts(null) }} />
          </div>
          {/* Описание события — подставляется из протокола черновика, можно поправить перед созданием */}
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">{t('meetings.description', { defaultValue: 'Описание' })}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5"
              placeholder={t('meetings.descriptionHint', { defaultValue: 'Место, повестка и протокол — по умолчанию из черновика' })} />
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">{t('meetings.attendees')}</p>
            {invited.length > 0
              ? <p className="text-xs text-gray-700 dark:text-slate-200">{t('meetings.bitrixWillInvite', { defaultValue: 'Пригласим' })}: {invited.map(a => a.name).join(', ')}</p>
              : <p className="text-xs text-amber-700 dark:text-amber-300">{t('meetings.bitrixNoGuests', { defaultValue: 'Ни у кого нет профиля Bitrix — событие создастся без приглашённых.' })}</p>}
            {notInvited.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('meetings.bitrixSkip', { defaultValue: 'Без профиля Bitrix (не приглашаем)' })}: {notInvited.map(a => a.name).join(', ')}</p>
            )}
          </div>
          {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={() => void attemptCreate()} disabled={busy || !date} icon={<CalendarPlus size={14} />}>
              {busy ? t('common.saving') : t('meetings.bitrixCreate', { defaultValue: 'Создать в Bitrix' })}
            </Button>
          </div>
        </div>
        {/* Подтверждение занятости поверх диалога (свой оверлей, а не глобальный confirm: оба были бы
            z-50 и стекались; вложенный absolute inset-0 надёжнее).
            hostBusy — занят сам организатор: создать нельзя (его из события не исключить), только отмена.
            иначе — заняты гости: можно создать без них (исключаем из приглашения) либо отменить. */}
        {conflicts && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/50 p-4"
            onMouseDown={e => e.stopPropagation()}>
            <Surface className="w-full max-w-sm p-5">
              <div className="mb-3 flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
                <p className="text-sm text-slate-800 dark:text-slate-100">
                  {conflicts.hostBusy
                    ? t('meetings.bitrixHostBusy', { defaultValue: 'Вы заняты в это время — совещание нельзя создать. Выберите другое время (можно через «Подобрать время»).' })
                    : <>{t('meetings.bitrixBusyWarn', { defaultValue: 'Заняты в это время' })}: <b>{conflicts.names.join(', ')}</b>.{' '}
                        {t('meetings.bitrixBusyAsk', { defaultValue: 'Создать без них? Они не будут приглашены.' })}</>}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConflicts(null)} disabled={busy}>
                  {conflicts.hostBusy ? t('common.close', { defaultValue: 'Закрыть' }) : t('common.cancel')}
                </Button>
                {!conflicts.hostBusy && (
                  <Button size="sm" onClick={() => void doCreate(conflicts.ids)} disabled={busy} icon={<CalendarPlus size={14} />}>
                    {busy ? t('common.saving') : t('meetings.bitrixCreateAnyway', { defaultValue: 'Создать без них' })}
                  </Button>
                )}
              </div>
            </Surface>
          </div>
        )}
      </Surface>
    </div>,
    document.body,
  )
}

// ── Meeting Detail View ────────────────────────────────────────────────────

export function MeetingDetail({ meeting, onEdit, onDelete, onFinalize, onUnfinalize, onCreateBitrix, onDeleteBitrix, onRecur, onBack, saving, canWrite }: {
  meeting: Meeting; onEdit: () => void; onDelete: () => void
  onFinalize: () => void; onUnfinalize: () => void; onCreateBitrix: () => void; onDeleteBitrix: () => void
  onRecur: () => void; onBack: () => void; saving: boolean; canWrite: boolean
}) {
  const { t } = useTranslation()
  // По умолчанию все разделы РАЗВЁРНУТЫ (владелец: «свёрнуто сразу — не надо, надо развёрнуто»).
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['agenda', 'attendees', 'minutes', 'actions', 'decisions']))
  const toggle = (s: string) => setOpenSections(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-xs text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-100">{t('common.backToList')}</button>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {meeting.status !== 'final' ? (
              <>
                <button onClick={onEdit} className="px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
                  {t('common.edit')}
                </button>
                <button onClick={onFinalize} disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                  <Lock size={12} /> {t('meetings.finalize')}
                </button>
                {/* #11/#14: «Создать собрание в Битрикс» — только пока НЕ завершено и ещё не создано */}
                {!meeting.bitrix_event_id && (
                  <button onClick={onCreateBitrix} disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-50">
                    <CalendarPlus size={12} /> {t('meetings.bitrixCreate', { defaultValue: 'Создать в Bitrix' })}
                  </button>
                )}
              </>
            ) : (
              // #13: завершено — можно снять завершение, дополнить и завершить заново
              <button onClick={onUnfinalize} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50">
                <Unlock size={12} /> {t('meetings.unfinalize', { defaultValue: 'Отменить завершение' })}
              </button>
            )}
            {/* Создано в Bitrix — статус + удаление (в любом статусе) */}
            {meeting.bitrix_event_id ? (
              <span className="flex items-center gap-1 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                ✓ {t('meetings.inBitrix', { defaultValue: 'В Bitrix' })}
                <button onClick={onDeleteBitrix} disabled={saving} title={t('meetings.bitrixRemove', { defaultValue: 'Убрать из Bitrix' })}
                  className="ml-1 text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 size={12} /></button>
              </span>
            ) : null}
            <button onClick={onRecur} disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">
              <Repeat size={12} /> {t('meeting.recur', { defaultValue: 'Повторить' })}
            </button>
            <button onClick={onDelete} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md">{t('common.delete')}</button>
          </div>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{meeting.title}</h2>
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[meeting.status] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>{meeting.status}</span>
          {meeting.status === 'final' && <span className="text-xs text-green-600 flex items-center gap-1"><Lock size={11} /> {t('common.readOnly')}</span>}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-slate-300">
          <span>{formatDate(meeting.meeting_date)}{meeting.meeting_time ? ` at ${meeting.meeting_time}` : ''}</span>
          {meeting.meeting_type && <span>{meeting.meeting_type}</span>}
          {meeting.location && <span>📍 {meeting.location}</span>}
        </div>
        {meeting._distribution && (
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {t('meetings.distributedAt', { defaultValue: 'Разослано' })}: {formatDate(meeting._distribution.at.slice(0, 10))} · {t('meetings.distributedCount', { count: meeting._distribution.sent, defaultValue: 'получателей: {{count}}' })}
            {!meeting._distribution.email_live && ` · ${t('meetings.dryRunNote', { defaultValue: 'dry-run (SMTP не подключён)' })}`}
          </p>
        )}
      </div>

      <Section title={`${t('meetings.agenda')} (${meeting.agenda_items.length})`} open={openSections.has('agenda')} onToggle={() => toggle('agenda')}>
        {meeting.agenda_items.length === 0 ? <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.noAgenda')}</p> : (
          <table className="w-full table-fixed text-xs">
            <thead><tr className="border-b border-gray-100 dark:border-slate-800">
              {['#', 'Item', 'Presenter', 'Time'].map(h => <th key={h} className="text-left text-gray-500 dark:text-slate-400 py-1.5 pr-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {meeting.agenda_items.map((a, i) => (
                <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{i + 1}</td>
                  <td className="py-1.5 pr-3 text-gray-800 dark:text-slate-200">{a.item}</td>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{a.presenter ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{a.time_allocated ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`${t('meetings.attendees')} (${meeting.attendees.length})`} open={openSections.has('attendees')} onToggle={() => toggle('attendees')}>
        {meeting.attendees.length === 0 ? <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.noAttendees')}</p> : (
          <table className="w-full table-fixed text-xs">
            <thead><tr className="border-b border-gray-100 dark:border-slate-800">
              {[t('meetings.attendee', { defaultValue: 'Имя' }), t('meetings.present'), t('meetings.comments', { defaultValue: 'Комментарий' })].map(h => <th key={h} className="text-left text-gray-500 dark:text-slate-400 py-1.5 pr-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {meeting.attendees.map(a => (
                <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800">
                  <td className="py-1.5 pr-3 font-medium text-gray-800 dark:text-slate-200">{a.name}</td>
                  <td className="py-1.5 pr-3">{a.present ? '✓' : '✗'}</td>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{a.comments ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('meetings.minutes')} open={openSections.has('minutes')} onToggle={() => toggle('minutes')}>
        {meeting.minutes_content
          ? <p className="text-xs text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{meeting.minutes_content}</p>
          : <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.noMinutes')}</p>
        }
      </Section>

      <Section title={`${t('meetings.actions')} (${meeting.actions.length})`} open={openSections.has('actions')} onToggle={() => toggle('actions')}>
        {meeting.actions.length === 0 ? <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.noActions')}</p> : (
          <table className="w-full table-fixed text-xs">
            <thead><tr className="border-b border-gray-100 dark:border-slate-800">
              {[t('meetings.actionText'), t('meetings.assignee'), t('meetings.due'), t('common.status')].map(h => <th key={h} className="text-left text-gray-500 dark:text-slate-400 py-1.5 pr-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {meeting.actions.map(a => (
                <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-gray-800 dark:text-slate-200 max-w-xs">{a.action_text}</td>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{a.assignee_name ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{formatDate(a.due_date)}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${ACTION_STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                      {t(`backlog.statuses.${a.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* «Решения» — внизу: сначала повестка/участники/протокол/поручения, затем итоговые решения.
          Раздел показываем ВСЕГДА (как повестку/участников/поручения) — с 0 и пустым состоянием. */}
      <Section title={`${t('meetings.decisionsLabel', { defaultValue: 'Решения' })} (${meeting.decisions?.length ?? 0})`} open={openSections.has('decisions')} onToggle={() => toggle('decisions')}>
        {(!meeting.decisions || meeting.decisions.length === 0) ? (
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('meetings.noDecisions', { defaultValue: 'Решений пока нет' })}</p>
        ) : (
          <>
            <ul className="space-y-2">
              {meeting.decisions.map((d, i) => (
                <li key={i} className="text-xs text-gray-700 dark:text-slate-200">
                  <span className="font-medium">• {d.decision_text}</span>
                  {d.rationale && <span className="text-gray-500 dark:text-slate-400"> — {d.rationale}</span>}
                </li>
              ))}
            </ul>
            {meeting.status === 'final' && (
              <p className="mt-2 text-xs text-green-600 dark:text-emerald-400">{t('meetings.decisionsInLog', { defaultValue: 'Перенесены в Журнал решений при финализации.' })}</p>
            )}
          </>
        )}
      </Section>

      {(meeting.next_meeting_date || meeting.next_meeting_type) && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg text-xs text-blue-800 dark:text-blue-300">
          <strong>Next meeting:</strong>{' '}
          {meeting.next_meeting_date && <span>{formatDate(meeting.next_meeting_date)} </span>}
          {meeting.next_meeting_type && <span>({meeting.next_meeting_type}) </span>}
          {meeting.next_meeting_participants && <span>— {meeting.next_meeting_participants}</span>}
        </div>
      )}
    </div>
  )
}

export function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg mb-3">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800">
        {title}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ── Meeting Form ───────────────────────────────────────────────────────────

export function MeetingForm({ projectId, initialData, isEdit, isFinal, saving, onSave, onCancel }: {
  projectId: string
  initialData: MeetingFormData; isEdit: boolean; isFinal: boolean
  saving: boolean; onSave: (f: MeetingFormData) => void; onCancel: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<MeetingFormData>(initialData)
  const meetingTypes = MEETING_TYPE_KEYS.map((key) => t(`meetings.typeOptions.${key}`))

  const set = (field: keyof MeetingFormData, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }))

  const addAgenda = () => set('agenda_items', [...form.agenda_items, { item: '', presenter: '', time_allocated: '' }])
  const removeAgenda = (i: number) => set('agenda_items', form.agenda_items.filter((_, idx) => idx !== i))
  // Функциональный апдейт: при выборе человека PersonPicker шлёт onChange (имя) И onPickPerson
  // (идентичность) в один тик — стейл-замыкание form.* привело бы к тому, что второй вызов затирает
  // первый (и имя откатывалось к старому). f => ... гарантирует, что оба изменения складываются.
  const updateAgenda = (i: number, k: string, v: string) =>
    setForm(f => ({ ...f, agenda_items: f.agenda_items.map((a, idx) => idx === i ? { ...a, [k]: v } : a) }))
  /** Докладчик пункта повестки выбран из справочника → ставим его имя и АВТОМАТОМ добавляем в
   *  участники (если ещё нет), с идентичностью (id/email/bitrix24_id) — чтобы работали рассылка и слот. */
  const pickPresenter = (i: number, person: { id: string; full_name: string; email?: string | null; bitrix24_id?: number | null } | null) =>
    setForm(f => {
      const agenda_items = f.agenda_items.map((a, idx) => idx === i ? { ...a, presenter: person?.full_name ?? a.presenter } : a)
      let attendees = f.attendees
      if (person && !f.attendees.some(at => (at.name || '').trim().toLowerCase() === person.full_name.trim().toLowerCase())) {
        attendees = [...f.attendees, { name: person.full_name, role_dept: '', present: false, comments: '', person_id: person.id, email: person.email ?? null, bitrix24_id: person.bitrix24_id ?? null }]
      }
      return { ...f, agenda_items, attendees }
    })

  // present=false по умолчанию: явка проставляется ПОСЛЕ совещания, а не при планировании.
  const addAttendee = () => set('attendees', [...form.attendees, { name: '', role_dept: '', present: false, comments: '' }])
  const removeAttendee = (i: number) => set('attendees', form.attendees.filter((_, idx) => idx !== i))
  const updateAttendee = (i: number, k: string, v: string | boolean) =>
    setForm(f => ({ ...f, attendees: f.attendees.map((a, idx) => idx === i ? { ...a, [k]: v } : a) }))
  /** Выбран человек из справочника → сохраняем его идентичность целиком: без неё нельзя ни разослать
   *  протокол (нужен email), ни позвать участника в календарь Bitrix (нужен bitrix24_id).
   *  Функциональный апдейт обязателен — иначе перекрывает onChange из того же тика (см. updateAgenda). */
  const patchAttendee = (i: number, patch: Record<string, unknown>) =>
    setForm(f => ({ ...f, attendees: f.attendees.map((a, idx) => idx === i ? { ...a, ...patch } : a) }))

  const addAction = () => set('actions', [...form.actions, { action_text: '', assignee_name: '', assignee_email: '', due_date: '', status: 'open', notes: '' }])
  const removeAction = (i: number) => set('actions', form.actions.filter((_, idx) => idx !== i))
  const updateAction = (i: number, k: string, v: string) =>
    set('actions', form.actions.map((a, idx) => idx === i ? { ...a, [k]: v } : a))

  const addDecision = () => set('decisions', [...form.decisions, { decision_text: '', rationale: '', decided_by: '' }])
  const removeDecision = (i: number) => set('decisions', form.decisions.filter((_, idx) => idx !== i))
  const updateDecision = (i: number, k: string, v: string) =>
    set('decisions', form.decisions.map((d, idx) => idx === i ? { ...d, [k]: v } : d))

  if (isFinal) {
    return (
      <div className="p-4 bg-yellow-50 dark:bg-amber-950/40 border border-yellow-200 dark:border-amber-900 rounded-lg text-sm text-yellow-800 dark:text-amber-300">
        <Lock size={14} className="inline mr-1" /> {t('meetings.isReadOnly')}
        <button onClick={onCancel} className="ml-3 underline text-xs">{t('common.goBack')}</button>
      </div>
    )
  }

  // Ширину держим ради читаемости формы, но центрируем: прижатая к левому краю колонка
  // на широком экране выглядит как сбой вёрстки, а не как выбор.
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{isEdit ? t('meetings.editMeeting') : t('meetings.newMeeting')}</h3>
        <button onClick={onCancel} className="text-xs text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-100">{t('common.cancel')}</button>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.titleField') + ' *'}</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" placeholder="Meeting title" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('common.type')}</label>
          <select value={form.meeting_type} onChange={e => set('meeting_type', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2.5 py-1.5">
            <option value="">{t('common.select')}</option>
            {meetingTypes.map((meetingType) => <option key={meetingType} value={meetingType}>{meetingType}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.date') + ' *'}</label>
          {/* Нативный date-picker: форма хранит дд.мм.гггг, конвертируем в ISO для инпута и обратно. */}
          <input type="date" value={parseDate(form.meeting_date)} onChange={e => set('meeting_date', e.target.value ? formatDate(e.target.value) : '')}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.timeLabel')}</label>
          <input type="time" value={form.meeting_time} onChange={e => set('meeting_time', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" />
        </div>
        <div>
          {/* Длительность: нужна и для подбора общего свободного слота, и для события в календаре Bitrix. */}
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.durationLabel')}</label>
          <input type="number" min="15" step="15" value={form.duration_minutes ?? 60}
            onChange={e => set('duration_minutes', e.target.value === '' ? 60 : Number(e.target.value))}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.location')}</label>
          <input value={form.location} onChange={e => set('location', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" placeholder="Room / online link" />
        </div>
      </div>

      {/* Agenda */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-200">{t('meetings.agenda')}</label>
          <button onClick={addAgenda} className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:underline">
            <Plus size={11} /> {t('meetings.addItem')}
          </button>
        </div>
        <div className="space-y-1">
          {form.agenda_items.map((a, i) => (
            <div key={i} className="flex gap-2">
              <input value={a.item} onChange={e => updateAgenda(i, 'item', e.target.value)}
                placeholder="Agenda item" className="flex-1 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              {/* Докладчик — выбор человека; при выборе он автоматом попадёт в участники (#6) */}
              <PersonPicker value={a.presenter} onChange={v => updateAgenda(i, 'presenter', v)}
                onPickPerson={p => pickPresenter(i, p)}
                placeholder={t('meetings.presenter', { defaultValue: 'Докладчик' })} className="w-40 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <input value={a.time_allocated} onChange={e => updateAgenda(i, 'time_allocated', e.target.value)}
                placeholder="Time" className="w-20 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <button onClick={() => removeAgenda(i)} className="text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Attendees */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-200">{t('meetings.attendees')}</label>
          <button onClick={addAttendee} className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:underline">
            <Plus size={11} /> {t('meetings.addAttendee')}
          </button>
        </div>
        <div className="space-y-1">
          {form.attendees.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              <PersonPicker value={a.name} onChange={v => updateAttendee(i, 'name', v)}
                onPickPerson={p => patchAttendee(i, {
                  person_id: p?.id ?? null, email: p?.email ?? null, bitrix24_id: p?.bitrix24_id ?? null,
                })}
                placeholder={t('meetings.attendee', { defaultValue: 'Имя' })} className="flex-1 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">
                <input type="checkbox" checked={a.present} onChange={e => updateAttendee(i, 'present', e.target.checked)} />
                {t('meetings.present')}
              </label>
              <button onClick={() => removeAttendee(i)} className="text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Minutes */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.minutes')}</label>
        <textarea value={form.minutes_content} onChange={e => set('minutes_content', e.target.value)}
          rows={5} className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5"
          placeholder="Meeting notes, decisions, discussions…" />
      </div>

      {/* Поручения, решения и подбор общего времени — только у УЖЕ созданного совещания */}
      {!isEdit ? (
        <p className="rounded-md border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          {t('meetings.draftHint', { defaultValue: 'Поручения, решения и подбор общего времени добавите после — открыв созданное совещание на редактирование.' })}
        </p>
      ) : (
      <>
      {/* Подбор общего времени по календарям участников (Bitrix) */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">{t('meetings.slotPickerLabel', { defaultValue: 'Подобрать общее время' })}</label>
        <SlotPicker projectId={projectId} form={form}
          onPick={(date, time) => setForm(f => ({ ...f, meeting_date: formatDate(date), meeting_time: time }))} />
      </div>

      {/* Action Items — при финализации попадут в Бэклог действий */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-200">
            {t('meetings.actions')}
            <span className="ml-1 font-normal text-gray-500 dark:text-slate-400">— {t('meetings.actionsHint', { defaultValue: 'при финализации попадут в Бэклог действий' })}</span>
          </label>
          <button onClick={addAction} className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:underline">
            <Plus size={11} /> {t('meetings.addAction')}
          </button>
        </div>
        <div className="space-y-1">
          {form.actions.map((a, i) => (
            <div key={i} className="flex gap-2">
              <input value={a.action_text} onChange={e => updateAction(i, 'action_text', e.target.value)}
                placeholder={t('meetings.actionText')} className="flex-1 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <PersonPicker value={a.assignee_name} onChange={v => updateAction(i, 'assignee_name', v)}
                placeholder={t('meetings.assignee')} className="w-28 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <input type="date" value={parseDate(a.due_date)} onChange={e => updateAction(i, 'due_date', e.target.value ? formatDate(e.target.value) : '')}
                className="w-32 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <select value={a.status} onChange={e => updateAction(i, 'status', e.target.value)}
                className="w-28 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1.5">
                {['open', 'in_progress', 'done', 'cancelled'].map(s => <option key={s} value={s}>{t(`backlog.statuses.${s}`)}</option>)}
              </select>
              <button onClick={() => removeAction(i)} className="text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Decisions — при финализации автоматически попадут в Журнал решений */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-200">
            {t('meetings.decisionsLabel', { defaultValue: 'Решения' })}
            <span className="ml-1 font-normal text-gray-500 dark:text-slate-400">— {t('meetings.decisionsHint', { defaultValue: 'при финализации попадут в Журнал решений' })}</span>
          </label>
          <button onClick={addDecision} className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400 hover:underline">
            <Plus size={11} /> {t('meetings.addDecision', { defaultValue: 'Добавить решение' })}
          </button>
        </div>
        <div className="space-y-1">
          {form.decisions.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input value={d.decision_text} onChange={e => updateDecision(i, 'decision_text', e.target.value)}
                placeholder={t('meetings.decisionText', { defaultValue: 'Что решили' })} className="flex-1 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <input value={d.rationale} onChange={e => updateDecision(i, 'rationale', e.target.value)}
                placeholder={t('meetings.decisionRationale', { defaultValue: 'Обоснование' })} className="w-48 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1.5" />
              <button onClick={() => removeDecision(i)} className="text-gray-300 hover:text-red-500"><X size={ICON_SM} /></button>
            </div>
          ))}
        </div>
      </div>
      </>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.title || !form.meeting_date}
          className="px-4 py-2 text-sm font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
          {saving ? t('common.saving') : isEdit ? t('meetings.saveChanges') : t('meetings.createMeeting')}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
