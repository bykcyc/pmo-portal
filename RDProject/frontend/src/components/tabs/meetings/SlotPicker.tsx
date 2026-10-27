import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarSearch, X, AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { suggestMeetingSlots, type SlotResponse } from '@/api/calendar'
import type { MeetingFormData } from './meetingsConstants'

/**
 * «Подобрать время» — главная сложность продукта: у всех участников свои занятые окна.
 * Занятость берём из календарей Bitrix; сервер отдаёт ТОЛЬКО интервалы, без названий
 * чужих встреч. Если полностью свободного окна нет, показываем компромиссы честно:
 * «свободны 3 из 4» — а не пустой список, который ничем не помогает.
 */
export default function SlotPicker({ projectId, form, onPick }: {
  projectId: string
  form: MeetingFormData
  onPick: (date: string, time: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<SlotResponse | null>(null)

  const attendees = form.attendees.filter(a => (a.name || '').trim())

  const run = async () => {
    setOpen(true); setBusy(true); setError(null); setRes(null)
    try {
      setRes(await suggestMeetingSlots(
        projectId,
        attendees.map(a => ({ person_id: a.person_id, email: a.email, name: a.name })),
        form.duration_minutes || 60,
        30,
        form.meeting_date || undefined,   // подбираем от даты совещания (если она в будущем)
      ))
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || t('common.error', { defaultValue: 'Ошибка' }))
    } finally {
      setBusy(false)
    }
  }

  const pick = (iso: string) => {
    // iso вида «2026-07-15T12:00:00+03:00» — время уже в зоне портала (Europe/Riga). Берём его
    // ПРЯМО из строки: new Date().getHours() пересчитал бы в зону браузера, и у РП в другом
    // поясе в форму записалось бы не то время, что показал подбор.
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
    if (m) {
      onPick(m[1], m[2])
      setOpen(false)
    }
  }

  const fmtSlot = (iso: string) => {
    // Тоже из строки, а не через Date: подбор оперирует временем Риги, и показать надо его же.
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/)
    if (!m) return iso
    const [, y, mo, day, hm] = m
    const wd = new Date(Number(y), Number(mo) - 1, Number(day)).toLocaleDateString(undefined, { weekday: 'short' })
    return `${wd} ${day}.${mo} ${hm}`
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        icon={<CalendarSearch size={ICON_SM} />}
        disabled={attendees.length === 0}
        title={attendees.length === 0 ? t('meetings.slots.needAttendees') : undefined}
        onClick={() => void run()}
      >
        {t('meetings.slots.find')}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={() => setOpen(false)}>
          <Surface className="mx-4 w-full max-w-md p-5" onMouseDown={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('meetings.slots.title')}
              </h3>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('common.cancel')}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100">
                <X size={ICON_SM} />
              </button>
            </div>

            {busy && <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">{t('common.loading')}</p>}
            {error && <p className="py-3 text-sm text-rose-600 dark:text-rose-300">{error}</p>}

            {res && !busy && (
              <div className="space-y-3">
                {/* Участники без Bitrix: их календарь нам не виден. Молчать об этом нельзя —
                    иначе «все свободны» окажется неправдой ровно про них. */}
                {res.unresolved.length > 0 && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {t('meetings.slots.unresolved', { names: res.unresolved.join(', ') })}
                  </p>
                )}

                {res.slots.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">
                    {t('meetings.slots.none')}
                  </p>
                ) : (
                  <>
                    {!res.conflict_free && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">{t('meetings.slots.compromise')}</p>
                    )}
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                      {res.slots.map(s => (
                        <li key={s.from}>
                          <button
                            type="button"
                            onClick={() => pick(s.from)}
                            className="flex w-full items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-left text-sm transition-colors hover:border-blue-400 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
                          >
                            <span className="text-slate-800 dark:text-slate-100">{fmtSlot(s.from)}</span>
                            <span className={s.conflicts === 0
                              ? 'text-xs font-medium text-emerald-700 dark:text-emerald-300'
                              : 'text-xs font-medium text-amber-700 dark:text-amber-300'}>
                              {t('meetings.slots.free', { free: s.free_count, total: s.total_count })}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </Surface>
        </div>
      )}
    </>
  )
}
