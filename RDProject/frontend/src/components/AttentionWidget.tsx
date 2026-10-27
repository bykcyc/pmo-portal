import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import { getAttention, type AttentionGroupKey, type AttentionItem } from '@/api/attention'
import { SectionCard } from '@/components/ui/surface'
import { Pill } from '@/components/ui/badges'
import { formatDate } from '@/utils/date'
import AccessDecisionDialog from './access/AccessDecisionDialog'

const GROUP_META: Record<AttentionGroupKey, { def: string; color: string }> = {
  access: { def: 'Access requests', color: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' },
  access_decided: { def: 'Your access requests', color: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' },
  problem_resolved: { def: 'Resolved problems', color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  overdue: { def: 'Overdue', color: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' },
  due_soon: { def: 'Due soon', color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  stalled: { def: 'Stalled', color: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300' },
  actions: { def: 'Action items', color: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' },
  meetings: { def: 'Upcoming meetings', color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
  no_dates: { def: 'No dates', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
}
const ORDER: AttentionGroupKey[] = ['access', 'access_decided', 'problem_resolved',
  'overdue', 'due_soon', 'stalled', 'actions', 'meetings', 'no_dates']

function dateOf(it: AttentionItem): string {
  const d = it.planned_end || it.due_date || it.date || it.created_at
  return d ? formatDate(d) : ''
}

export default function AttentionWidget() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data } = useQuery({ queryKey: ['attention'], queryFn: () => getAttention(7) })
  // Тот же диалог, что у колокольчика: один и тот же запрос виден в двух местах, и решать
  // его должно быть одинаково — иначе одно из двух мест рано или поздно отстанет.
  const [deciding, setDeciding] = useState<AttentionItem | null>(null)
  if (!data) return null
  const total = data.counts.total
  const nonEmpty = ORDER.filter((k) => data.data[k]?.length)

  return (
    <SectionCard
      title={t('attention.title', { defaultValue: 'Needs attention' })}
      description={total ? t('attention.subtitle', { defaultValue: 'Overdue, upcoming and stalled items across your projects.' }) : undefined}
    >
      {total === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 size={16} /> {t('attention.allClear', { defaultValue: 'All clear — nothing needs attention right now.' })}
        </div>
      ) : (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {nonEmpty.map((k) => {
            const meta = GROUP_META[k]
            const items = data.data[k]
            return (
              <div key={k}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">
                    {t(`attention.${k}`, { defaultValue: meta.def })}
                  </span>
                  <Pill className={meta.color}>{items.length}</Pill>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.slice(0, 6).map((it) => (
                    <li key={`${k}-${it.id}`}>
                      <button
                        onClick={() => {
                          if (it.kind === 'access_request') return setDeciding(it)
                          // Ответ на свой запрос и «проблема решена» — читаются, а не открываются:
                          // раздела, куда вести, у них нет.
                          if (it.kind === 'access_decision') {
                            if (it.status === 'approved' && it.project_id) navigate(`/projects/${it.project_id}`)
                            return
                          }
                          if (it.kind === 'problem_resolved') return
                          navigate(`/projects/${it.project_id}/${it.section}`)
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded px-1 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-[10px] uppercase text-slate-600 dark:text-slate-400">{it.project_code}</span>
                          <span className="truncate text-sm text-slate-700 dark:text-slate-200">{it.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{dateOf(it)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {items.length > 6 && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">+{items.length - 6}…</p>}
              </div>
            )
          })}
        </div>
      )}
      {deciding && <AccessDecisionDialog item={deciding} onClose={() => setDeciding(null)} />}
    </SectionCard>
  )
}
