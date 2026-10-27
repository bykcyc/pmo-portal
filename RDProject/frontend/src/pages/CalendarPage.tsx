import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { getMyCalendar, type MyCalendarItem } from '@/api/myTasks'
import { getCalendarEvents, type BitrixCalendarEvent } from '@/api/calendar'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Surface } from '@/components/ui/surface'
import { localIsoDate } from '@/utils/date'

type View = 'month' | 'week' | 'day'

const selectCls = 'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 shadow-sm outline-none focus:border-slate-500'
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7
const startOfWeek = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -mondayIndex(d))
const pad2 = (n: number) => String(n).padStart(2, '0')
const MAX_MONTH = 3
const HOUR_H = 44 // px на час в сетке недели/дня
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
      {options.map((o, i) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${i > 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''} ${
            value === o.value ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}>{o.label}</button>
      ))}
    </div>
  )
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const bitrixUserId = user?.bitrix24_user_id
  const showBitrix = useUIStore((s) => s.calendarShowBitrix)
  const toggleBitrix = useUIStore((s) => s.toggleCalendarBitrix)

  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [projectFilter, setProjectFilter] = useState('') // '' = все проекты
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const { data: items = [], isLoading, isError, refetch } = useQuery({ queryKey: ['my-calendar'], queryFn: getMyCalendar })
  const todayKey = localIsoDate(new Date())

  const rangeDays = useMemo(() => {
    let start: Date; let count: number
    if (view === 'day') { start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()); count = 1 }
    else if (view === 'week') { start = startOfWeek(cursor); count = 7 }
    else { start = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)); count = 42 }
    return Array.from({ length: count }, (_, i) => addDays(start, i))
  }, [view, cursor])
  const fromKey = localIsoDate(rangeDays[0])
  const toKey = localIsoDate(rangeDays[rangeDays.length - 1])

  const { data: bitrixEvents = [], refetch: refetchBitrix, dataUpdatedAt: bitrixUpdatedAt, isFetching: bitrixFetching } = useQuery({
    queryKey: ['calendar-bitrix', bitrixUserId, fromKey, toKey],
    queryFn: () => (bitrixUserId ? getCalendarEvents(bitrixUserId, fromKey, toKey) : Promise.resolve([])),
    enabled: !!bitrixUserId && showBitrix,
    refetchInterval: 15 * 60 * 1000, // «актуальный календарь» из Bitrix каждые 15 минут
  })

  const projects = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>()
    items.forEach((it) => m.set(it.project_id, { code: it.project_code, name: it.project_name }))
    return [...m.entries()].map(([id, v]) => ({ id, ...v }))
  }, [items])

  // Задачи/бэклог (весь день) по дню срока
  const portalByDay = useMemo(() => {
    const map = new Map<string, { item: MyCalendarItem; overdue: boolean }[]>()
    for (const it of items) {
      if (projectFilter && it.project_id !== projectFilter) continue
      const day = (it.end ?? it.start ?? '').slice(0, 10)
      if (!day) continue
      // Закрытость считаем по словарю ТИПА элемента: у пункта бэклога свои статусы
      // (done/promoted/rejected), и без этого выполненный пункт горел бы просроченным.
      const closedSet = it.type === 'backlog'
        ? ['done', 'cancelled', 'promoted', 'rejected']
        : ['completed', 'cancelled']
      const overdue = !!(it.end && it.end.slice(0, 10) < todayKey && !closedSet.includes(it.status ?? ''))
      const b = map.get(day); if (b) b.push({ item: it, overdue }); else map.set(day, [{ item: it, overdue }])
    }
    return map
  }, [items, projectFilter, todayKey])

  // Bitrix-события (со временем) по дню начала
  const bitrixByDay = useMemo(() => {
    const map = new Map<string, BitrixCalendarEvent[]>()
    if (!showBitrix) return map
    for (const ev of bitrixEvents) {
      const dt = ev.DATE_FROM ? new Date(ev.DATE_FROM) : null
      if (!dt || Number.isNaN(dt.getTime())) continue
      const day = localIsoDate(dt); const b = map.get(day); if (b) b.push(ev); else map.set(day, [ev])
    }
    return map
    // showBitrix В ЗАВИСИМОСТЯХ обязателен: без него useMemo не пересчитывается на щелчок,
    // и события остаются на экране, хотя переключатель уже снят.
  }, [bitrixEvents, showBitrix])

  const totalShown = useMemo(() => {
    let n = 0
    for (const l of portalByDay.values()) n += l.length
    for (const l of bitrixByDay.values()) n += l.length
    return n
  }, [portalByDay, bitrixByDay])

  // Сетка недели/дня прокручивается к рабочему утру (~7:00)
  useEffect(() => {
    if (view !== 'month' && scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H
  }, [view, fromKey])

  const shift = (dir: number) => setCursor((c) => {
    if (view === 'month') return new Date(c.getFullYear(), c.getMonth() + dir, 1)
    return addDays(c, dir * (view === 'week' ? 7 : 1))
  })
  const goToday = () => setCursor(new Date())

  const rangeLabel = useMemo(() => {
    if (view === 'month') return cursor.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })
    if (view === 'day') return cursor.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return `${rangeDays[0].toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} – ${rangeDays[6].toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }, [view, cursor, rangeDays, i18n.language])

  const weekdayNames = useMemo(() => {
    const monday = new Date(2024, 0, 1)
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i).toLocaleDateString(i18n.language, { weekday: 'short' }))
  }, [i18n.language])

  const evTime = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  const portalChip = (it: MyCalendarItem, overdue: boolean) => (
    <button key={`p-${it.type}-${it.id}`} type="button" onClick={() => navigate(`/projects/${it.project_id}/${it.section}`)}
      title={`${it.project_code} · ${it.title ?? ''}`}
      className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] transition-colors ${
        overdue ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
      <span className="font-mono uppercase opacity-70">{it.project_code}</span>{' '}{it.title}
    </button>
  )

  // ── контролы ──
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={view} onChange={setView} options={[
        { value: 'month', label: t('calendar.viewMonth', { defaultValue: 'Месяц' }) },
        { value: 'week', label: t('calendar.viewWeek', { defaultValue: 'Неделя' }) },
        { value: 'day', label: t('calendar.viewDay', { defaultValue: 'День' }) },
      ]} />
      <Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => shift(-1)} aria-label={t('calendar.prev', { defaultValue: 'Назад' })} />
      <Button variant="secondary" onClick={goToday}>{t('calendar.today', { defaultValue: 'Сегодня' })}</Button>
      <Button variant="secondary" icon={<ChevronRight size={14} />} onClick={() => shift(1)} aria-label={t('calendar.next', { defaultValue: 'Вперёд' })} />
      <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectCls} aria-label={t('calendar.projects', { defaultValue: 'Проекты' })}>
        <option value="">{t('calendar.allProjects', { defaultValue: 'Все проекты' })}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select>
      {/* Показ событий Bitrix — личное предпочтение: у кого-то там весь день расписан,
          и проектные задачи в этом тонут. Выбор запоминается между заходами. */}
      {bitrixUserId ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={showBitrix}
            onChange={toggleBitrix}
            className="h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
          {t('calendar.showBitrix', { defaultValue: 'События Bitrix' })}
        </label>
      ) : null}
      {/* Синхронизация с Bitrix: авто раз в 15 минут + ручная кнопка и время последнего обновления */}
      {bitrixUserId && showBitrix ? (
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={<RefreshCw size={14} className={bitrixFetching ? 'animate-spin' : undefined} />}
            onClick={() => void refetchBitrix()} disabled={bitrixFetching}>
            {t('calendar.syncBitrix', { defaultValue: 'Синхронизировать' })}
          </Button>
          {bitrixUpdatedAt ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('calendar.lastSync', { defaultValue: 'Обновлено' })}: {new Date(bitrixUpdatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  // ── сетка недели/дня по часам ──
  const now = new Date()
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H
  const timeGrid = (
    <Surface className="overflow-hidden p-0">
      {/* заголовки дней + весь день (задачи/бэклог) */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <div className="w-14 shrink-0 px-1 py-2 text-[10px] text-slate-400">{t('calendar.allDay', { defaultValue: 'Весь день' })}</div>
        {rangeDays.map((day) => {
          const key = localIsoDate(day); const isToday = key === todayKey
          return (
            <div key={key} className="min-w-0 flex-1 border-l border-slate-200 dark:border-slate-700 p-1">
              <div className="mb-1 flex items-center gap-1.5">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? 'bg-blue-600 font-semibold text-white' : 'text-slate-700 dark:text-slate-200'}`}>{day.getDate()}</span>
                <span className="text-xs font-medium capitalize text-slate-600 dark:text-slate-400">{day.toLocaleDateString(i18n.language, { weekday: 'short' })}</span>
              </div>
              <div className="space-y-1">{(portalByDay.get(key) ?? []).map(({ item, overdue }) => portalChip(item, overdue))}</div>
            </div>
          )
        })}
      </div>
      {/* часовая сетка */}
      <div ref={scrollRef} className="max-h-[560px] overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_H }} className="relative">
                <span className="absolute -top-1.5 right-1 text-[10px] text-slate-400">{pad2(h)}:00</span>
              </div>
            ))}
          </div>
          {rangeDays.map((day) => {
            const key = localIsoDate(day); const isToday = key === todayKey
            const evs = bitrixByDay.get(key) ?? []
            return (
              <div key={key} className="relative min-w-0 flex-1 border-l border-slate-200 dark:border-slate-700">
                {HOURS.map((h) => <div key={h} style={{ top: h * HOUR_H }} className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800" />)}
                {evs.map((ev) => {
                  const s = new Date(ev.DATE_FROM); const e = new Date(ev.DATE_TO)
                  const startMin = s.getHours() * 60 + s.getMinutes()
                  let endMin = localIsoDate(e) !== localIsoDate(s) ? 24 * 60 : e.getHours() * 60 + e.getMinutes()
                  if (!(endMin > startMin)) endMin = startMin + 30
                  const top = (startMin / 60) * HOUR_H; const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_H)
                  return (
                    <div key={ev.ID} style={{ top, height }} title={`${evTime(ev.DATE_FROM)}–${evTime(ev.DATE_TO)} ${ev.NAME}`}
                      className="absolute inset-x-0.5 overflow-hidden rounded bg-indigo-100 px-1 py-0.5 text-[10px] leading-tight text-indigo-800 dark:bg-indigo-500/25 dark:text-indigo-200">
                      <span className="opacity-70">{evTime(ev.DATE_FROM)}</span> {ev.NAME}
                    </div>
                  )
                })}
                {isToday && <div style={{ top: nowTop }} className="absolute inset-x-0 z-10 border-t-2 border-red-500" />}
              </div>
            )
          })}
        </div>
      </div>
    </Surface>
  )

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('nav.calendar', { defaultValue: 'Календарь' })}
        title={<span className="capitalize">{rangeLabel}</span>}
        actions={controls}
      />

      {isLoading ? (
        <Surface className="p-4"><SkeletonRows rows={6} rowClassName="h-16" /></Surface>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle size={28} className="text-rose-500" />}
          title={t('fix.loadErrorTasks', { defaultValue: 'Не удалось загрузить задачи. Проверьте соединение.' })}
          action={<Button variant="secondary" onClick={() => void refetch()}>{t('fix.retry', { defaultValue: 'Обновить' })}</Button>}
        />
      ) : view === 'month' ? (
        <Surface className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
            {weekdayNames.map((name) => (
              <div key={name} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{name}</div>
            ))}
          </div>
          <div role="grid" aria-label={rangeLabel}>
            {Array.from({ length: 6 }, (_, week) => (
              <div role="row" key={week} className="grid grid-cols-7">
                {rangeDays.slice(week * 7, week * 7 + 7).map((day) => {
                  const key = localIsoDate(day)
                  const inMonth = day.getMonth() === cursor.getMonth()
                  const isToday = key === todayKey
                  const portal = portalByDay.get(key) ?? []
                  const evs = bitrixByDay.get(key) ?? []
                  const total = portal.length + evs.length
                  const shownPortal = portal.slice(0, MAX_MONTH)
                  const shownEvs = evs.slice(0, Math.max(0, MAX_MONTH - shownPortal.length))
                  const hidden = total - shownPortal.length - shownEvs.length
                  return (
                    <div key={key} role="gridcell"
                      className={`min-h-[104px] border-b border-r border-slate-100 p-1.5 align-top dark:border-slate-800 ${inMonth ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-800/60'}`}>
                      <div className="mb-1">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? 'bg-blue-600 font-semibold text-white' : inMonth ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-500'}`}>{day.getDate()}</span>
                      </div>
                      <div className="space-y-1">
                        {shownPortal.map(({ item, overdue }) => portalChip(item, overdue))}
                        {shownEvs.map((ev) => (
                          <div key={ev.ID} title={ev.NAME} className="block w-full truncate rounded bg-indigo-50 px-1.5 py-1 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                            <span className="opacity-70">{evTime(ev.DATE_FROM)}</span>{' '}{ev.NAME}
                          </div>
                        ))}
                        {hidden > 0 && <p className="px-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">{t('calendar.more', { defaultValue: '+{{count}} ещё', count: hidden })}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </Surface>
      ) : (
        timeGrid
      )}

      {totalShown === 0 && !isLoading && !isError && (
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          {t('calendar.empty', { defaultValue: 'Нет задач со сроками в этом периоде.' })}
        </p>
      )}
    </PageShell>
  )
}
