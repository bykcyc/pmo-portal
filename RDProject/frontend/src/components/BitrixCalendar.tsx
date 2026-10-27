import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { getCalendarEvents, getCalendarAccessibility, createCalendarEvent } from '@/api/calendar'
import type { BitrixCalendarEvent } from '@/api/calendar'
import { useAuthStore } from '@/store/authStore'
import { getPersons } from '@/api/persons'
import { useToastStore } from '@/store/toastStore'
import { localIsoDate } from '@/utils/date'

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7:00 - 20:00

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const r = new Date(d)
  r.setDate(diff)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmt(d: Date): string {
  return localIsoDate(d)
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getHourFraction(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getHours() + d.getMinutes() / 60
}

interface EventBlock {
  event: BitrixCalendarEvent
  top: number
  height: number
  dayIndex: number
}

const EVENT_COLORS = [
  'bg-blue-100 dark:bg-blue-950/40 border-blue-400 text-blue-800 dark:text-blue-200',
  'bg-purple-100 dark:bg-purple-950/40 border-purple-400 text-purple-800 dark:text-purple-200',
  'bg-green-100 dark:bg-green-950/40 border-green-400 text-green-800 dark:text-green-200',
  'bg-orange-100 dark:bg-orange-950/40 border-orange-400 text-orange-800 dark:text-orange-200',
  'bg-pink-100 dark:bg-pink-950/40 border-pink-400 text-pink-800 dark:text-pink-200',
  'bg-cyan-100 dark:bg-cyan-950/40 border-cyan-400 text-cyan-800 dark:text-cyan-200',
]

function getEventColor(id: string): string {
  const idx = parseInt(id, 10) % EVENT_COLORS.length
  return EVENT_COLORS[idx] || EVENT_COLORS[0]
}

export default function BitrixCalendar({ onScheduleMeeting }: {
  onScheduleMeeting?: (date: string, time: string, attendeeIds: number[]) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const showToast = useToastStore(s => s.show)
  const bitrixUserId = user?.bitrix24_user_id

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newEvent, setNewEvent] = useState({ name: '', date: '', timeFrom: '09:00', timeTo: '10:00', location: '', description: '', attendees: [] as number[] })
  const [creating, setCreating] = useState(false)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const fromDate = fmt(weekStart)
  const toDate = fmt(addDays(weekStart, 6))

  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ['bitrix_calendar', bitrixUserId, fromDate],
    queryFn: () => bitrixUserId ? getCalendarEvents(bitrixUserId, fromDate, toDate) : Promise.resolve([]),
    enabled: !!bitrixUserId,
  })

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => getPersons(),
  })

  const bitrixPersons = useMemo(() => persons.filter(p => p.bitrix24_id), [persons])

  // Availability for selected attendees
  const attendeeIds = newEvent.attendees
  const { data: accessibility = {} } = useQuery({
    queryKey: ['bitrix_accessibility', attendeeIds, fromDate],
    queryFn: () => attendeeIds.length ? getCalendarAccessibility(attendeeIds, fromDate, toDate) : Promise.resolve({}),
    enabled: attendeeIds.length > 0 && showCreateDialog,
  })

  const eventBlocks = useMemo((): EventBlock[] => {
    const blocks: EventBlock[] = []
    for (const ev of events) {
      const evFrom = new Date(ev.DATE_FROM)
      const evTo = new Date(ev.DATE_TO)
      for (let di = 0; di < 7; di++) {
        const dayDate = weekDays[di]
        const dayStr = fmt(dayDate)
        const evFromStr = fmt(evFrom)
        const evToStr = fmt(evTo)
        if (evFromStr <= dayStr && evToStr >= dayStr) {
          const startHour = evFromStr === dayStr ? getHourFraction(ev.DATE_FROM) : 7
          const endHour = evToStr === dayStr ? getHourFraction(ev.DATE_TO) : 21
          const top = Math.max(0, (startHour - 7) * 60)
          const height = Math.max(15, (endHour - startHour) * 60)
          blocks.push({ event: ev, top, height, dayIndex: di })
        }
      }
    }
    return blocks
  }, [events, weekDays])

  // Accessibility blocks for busy times
  const busyBlocks = useMemo(() => {
    const blocks: Array<{ dayIndex: number; top: number; height: number; userId: number }> = []
    for (const [uid, slots] of Object.entries(accessibility)) {
      for (const slot of (slots as Array<{ from: string; to: string }>)) {
        const from = new Date(slot.from)
        const to = new Date(slot.to)
        for (let di = 0; di < 7; di++) {
          const dayStr = fmt(weekDays[di])
          if (fmt(from) <= dayStr && fmt(to) >= dayStr) {
            const startH = fmt(from) === dayStr ? getHourFraction(slot.from) : 7
            const endH = fmt(to) === dayStr ? getHourFraction(slot.to) : 21
            blocks.push({ dayIndex: di, top: Math.max(0, (startH - 7) * 60), height: Math.max(5, (endH - startH) * 60), userId: Number(uid) })
          }
        }
      }
    }
    return blocks
  }, [accessibility, weekDays])

  const prevWeek = () => setWeekStart(prev => addDays(prev, -7))
  const nextWeek = () => setWeekStart(prev => addDays(prev, 7))
  const goToday = () => setWeekStart(startOfWeek(new Date()))

  const handleCreate = async () => {
    if (!bitrixUserId || !newEvent.name.trim() || !newEvent.date) return
    setCreating(true)
    try {
      const fromDT = `${newEvent.date}T${newEvent.timeFrom}:00`
      const toDT = `${newEvent.date}T${newEvent.timeTo}:00`
      await createCalendarEvent({
        owner_id: bitrixUserId,
        name: newEvent.name,
        from: fromDT,
        to: toDT,
        description: newEvent.description,
        attendees: newEvent.attendees.length ? newEvent.attendees : undefined,
        location: newEvent.location,
      })
      setShowCreateDialog(false)
      setNewEvent({ name: '', date: '', timeFrom: '09:00', timeTo: '10:00', location: '', description: '', attendees: [] })
      refetchEvents()
      if (onScheduleMeeting) {
        onScheduleMeeting(newEvent.date, newEvent.timeFrom, newEvent.attendees)
      }
    } catch {
      showToast(t('meetings.calendar.createError'), 'error')
    } finally { setCreating(false) }
  }

  const toggleAttendee = (id: number) => {
    setNewEvent(prev => ({
      ...prev,
      attendees: prev.attendees.includes(id) ? prev.attendees.filter(a => a !== id) : [...prev.attendees, id],
    }))
  }

  if (!bitrixUserId) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('meetings.calendar.noUserId')}</p>
        <p className="text-xs text-gray-400 mt-1">{t('meetings.calendar.configureHint')}</p>
      </div>
    )
  }

  const todayStr = fmt(new Date())
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800"><ChevronLeft size={16} /></button>
          <button onClick={goToday} className="px-3 py-1 text-xs font-medium border border-gray-300 dark:border-slate-600 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
            {t('meetings.calendar.today')}
          </button>
          <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800"><ChevronRight size={16} /></button>
          <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">
            {weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — {weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <button onClick={() => { setNewEvent({ name: '', date: fmt(new Date()), timeFrom: '09:00', timeTo: '10:00', location: '', description: '', attendees: [] }); setShowCreateDialog(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
          <Plus size={ICON_SM} /> {t('meetings.calendar.newEvent')}
        </button>
      </div>

      {/* Create Event Dialog */}
      {showCreateDialog && (
        <div className="mb-4 p-4 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">{t('meetings.calendar.newEvent')}</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('meetings.titleField')}</label>
              <input className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" value={newEvent.name}
                onChange={e => setNewEvent(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('meetings.date')}</label>
              <input type="date" className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" value={newEvent.date}
                onChange={e => setNewEvent(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('meetings.calendar.from')}</label>
                <input type="time" className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" value={newEvent.timeFrom}
                  onChange={e => setNewEvent(p => ({ ...p, timeFrom: e.target.value }))} />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('meetings.calendar.to')}</label>
                <input type="time" className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" value={newEvent.timeTo}
                  onChange={e => setNewEvent(p => ({ ...p, timeTo: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('meetings.location')}</label>
              <input className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5" value={newEvent.location}
                onChange={e => setNewEvent(p => ({ ...p, location: e.target.value }))} />
            </div>
          </div>

          {/* Attendees picker */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
              <Users size={12} className="inline mr-1" />{t('meetings.attendees')}
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-gray-50 dark:bg-slate-800/60 rounded-md border border-gray-200 dark:border-slate-700">
              {bitrixPersons.map(p => (
                <button key={p.id} onClick={() => toggleAttendee(p.bitrix24_id!)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    newEvent.attendees.includes(p.bitrix24_id!)
                      ? 'bg-primary-100 border-primary-400 text-primary-700'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}>
                  {p.full_name}
                </button>
              ))}
              {bitrixPersons.length === 0 && <span className="text-xs text-gray-400">{t('meetings.calendar.noPersons')}</span>}
            </div>
          </div>

          {/* Busy indicator for attendees */}
          {busyBlocks.length > 0 && newEvent.date && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-950/40 rounded-md border border-red-200 dark:border-red-900">
              <p className="text-xs text-red-700 dark:text-red-300 font-medium">{t('meetings.calendar.busyWarning')}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreateDialog(false)} className="px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">{t('common.cancel')}</button>
            <button onClick={handleCreate} disabled={creating || !newEvent.name.trim() || !newEvent.date}
              className="px-3 py-1.5 text-xs bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
              {creating ? t('common.saving') : t('common.create')}
            </button>
          </div>
        </div>
      )}

      {/* Week Grid */}
      <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
        {/* Day headers */}
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
          <div className="p-2 text-xs text-gray-400" />
          {weekDays.map((d, i) => {
            const isToday = fmt(d) === todayStr
            return (
              <div key={i} className={`p-2 text-center border-l border-gray-200 dark:border-slate-700 ${isToday ? 'bg-primary-50' : ''}`}>
                <div className="text-xs text-gray-500 dark:text-slate-400">{dayLabels[i]}</div>
                <div className={`text-sm font-semibold ${isToday ? 'text-primary-600' : 'text-gray-800 dark:text-slate-200'}`}>{d.getDate()}</div>
              </div>
            )
          })}
        </div>

        {/* Time grid */}
        <div className="grid grid-cols-[56px_repeat(7,1fr)] relative" style={{ height: HOURS.length * 60 }}>
          {/* Hour labels */}
          <div className="relative">
            {HOURS.map(h => (
              <div key={h} className="absolute left-0 right-0 border-b border-gray-100 dark:border-slate-800 text-right pr-2 text-xs text-gray-400"
                style={{ top: (h - 7) * 60, height: 60, lineHeight: '16px' }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns with events */}
          {weekDays.map((d, di) => {
            const isToday = fmt(d) === todayStr
            const dayEvents = eventBlocks.filter(eb => eb.dayIndex === di)
            const dayBusy = busyBlocks.filter(bb => bb.dayIndex === di)
            return (
              <div key={di} className={`relative border-l border-gray-200 dark:border-slate-700 ${isToday ? 'bg-primary-50/30' : ''}`}>
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute left-0 right-0 border-b border-gray-100 dark:border-slate-800" style={{ top: (h - 7) * 60, height: 60 }} />
                ))}

                {/* Busy blocks (attendees) */}
                {showCreateDialog && dayBusy.map((bb, bi) => (
                  <div key={`busy-${bi}`} className="absolute left-0 right-0 bg-red-100/40 border-l-2 border-red-300 z-[1]"
                    style={{ top: bb.top, height: bb.height }} />
                ))}

                {/* Events */}
                {dayEvents.map((eb, ei) => (
                  <div key={ei}
                    className={`absolute left-1 right-1 rounded-md border-l-3 px-1.5 py-0.5 overflow-hidden cursor-default z-[2] ${getEventColor(eb.event.ID)}`}
                    style={{ top: eb.top, height: Math.max(eb.height, 20) }}
                    title={`${eb.event.NAME}\n${fmtTime(eb.event.DATE_FROM)} — ${fmtTime(eb.event.DATE_TO)}`}>
                    <div className="text-xs font-medium truncate leading-tight">{eb.event.NAME}</div>
                    {eb.height > 25 && (
                      <div className="text-[10px] opacity-70 flex items-center gap-0.5">
                        <Clock size={9} /> {fmtTime(eb.event.DATE_FROM)}–{fmtTime(eb.event.DATE_TO)}
                      </div>
                    )}
                    {eb.height > 40 && eb.event.LOCATION && (
                      <div className="text-[10px] opacity-60 flex items-center gap-0.5 truncate">
                        <MapPin size={9} /> {eb.event.LOCATION}
                      </div>
                    )}
                  </div>
                ))}

                {/* Click to create */}
                <div className="absolute inset-0 z-0"
                  onClick={() => {
                    setNewEvent(prev => ({ ...prev, date: fmt(d) }))
                    setShowCreateDialog(true)
                  }} />
              </div>
            )
          })}

          {/* Current time indicator */}
          {weekDays.some(d => fmt(d) === todayStr) && (() => {
            const now = new Date()
            const h = now.getHours() + now.getMinutes() / 60
            if (h < 7 || h > 21) return null
            const top = (h - 7) * 60
            const di = weekDays.findIndex(d => fmt(d) === todayStr)
            return (
              <div className="absolute z-[5] pointer-events-none"
                style={{ top, left: `calc(56px + ${di} * (100% - 56px) / 7)`, width: `calc((100% - 56px) / 7)` }}>
                <div className="h-0.5 bg-red-500 relative">
                  <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
