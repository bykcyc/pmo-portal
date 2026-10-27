import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getProjectActionLog, type ActionLogEntry } from '@/api/projects'
import { formatDateTime } from '@/utils/date'
import ActionDetail from '@/components/ActionDetail'

// Раздел проекта → префиксы действий его журнала (имена действий задаёт бэкенд:
// task.*, risk.*, team.* и т.д.). По умолчанию панель показывает только действия
// текущего раздела; тумблер «Все» раскрывает весь журнал проекта.
const SECTION_ACTION_PREFIX: Record<string, string[]> = {
  passport: ['project.'],
  wbs: ['task.'],
  gantt: ['task.'],
  kanban: ['task.'],
  risks: ['risk.'],
  team: ['team.'],
  stakeholders: ['stakeholders.'],
  assumptions: ['assumptions.'],
  'comm-plan': ['communication-plan.'],
  kpis: ['kpis.'],
  decisions: ['decisions.'],
  meetings: ['meetings.'],
  budget: ['budget-items.'],
  backlog: ['backlog.'],
  reports: ['status-reports.'],
}

// Префикс действия → ключ project.sectionMeta.* для человекочитаемого названия раздела
const PREFIX_SECTION_META: Record<string, string> = {
  task: 'wbs',
  risk: 'risks',
  team: 'team',
  stakeholders: 'stakeholders',
  assumptions: 'assumptions',
  'communication-plan': 'commPlan',
  kpis: 'kpis',
  decisions: 'decisions',
  meetings: 'meetings',
  'budget-items': 'budget',
  'status-reports': 'reports',
  backlog: 'backlog',
}

function ActionLabel({ action }: { action: string }) {
  const { t } = useTranslation()
  // 1) явный ключ (project.transfer и т.п.); 2) собранная метка «Глагол · Раздел»;
  // 3) сырое имя действия как последний фолбэк.
  const dot = action.lastIndexOf('.')
  const prefix = dot > 0 ? action.slice(0, dot) : action
  const verb = dot > 0 ? action.slice(dot + 1) : ''
  const verbLabel = verb ? t(`actionLog.verb.${verb}`, { defaultValue: '' }) : ''
  const metaKey = PREFIX_SECTION_META[prefix]
  const humanized = verbLabel && metaKey
    ? `${verbLabel} · ${t(`project.sectionMeta.${metaKey}.displayName`, { defaultValue: prefix })}`
    : action
  const label = t(`actionLog.actions.${action}`, { defaultValue: humanized })
  return <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
}

function EntryRow({ entry }: { entry: ActionLogEntry }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{entry.user_name ?? '—'}</span>
        <span className="text-[10px] text-gray-500 dark:text-slate-400 whitespace-nowrap">{formatDateTime(entry.at)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
        <ActionLabel action={entry.action} />
        {entry.detail && (
          <>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <span className="min-w-0 break-words"><ActionDetail detail={entry.detail} /></span>
          </>
        )}
      </div>
    </div>
  )
}

export default function ActionLogPanel({ projectId, section, onClose }: {
  projectId: string
  section?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const { data: entries = [], isLoading } = useQuery<ActionLogEntry[]>({
    queryKey: ['action_log', projectId],
    queryFn: () => getProjectActionLog(projectId),
    staleTime: 10000,
  })

  const prefixes = section ? SECTION_ACTION_PREFIX[section] : undefined
  const filtered = useMemo(
    () => (!prefixes || showAll)
      ? entries
      : entries.filter((e) => prefixes.some((p) => (e.action || '').startsWith(p))),
    [entries, prefixes, showAll],
  )

  return (
    <div className="flex max-h-[80vh] w-80 flex-shrink-0 flex-col border-l border-gray-200 dark:border-slate-700 pl-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary-700">
          {t('actionLog.title', { defaultValue: 'Журнал действий' })}
        </span>
        <div className="flex items-center gap-2">
          {prefixes && (
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-gray-500 dark:text-slate-400">
              <input type="checkbox" className="accent-blue-600" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              {t('actionLog.showAll', { defaultValue: 'Все' })}
            </label>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
      </div>

      {isLoading && <p className="py-4 text-center text-xs text-gray-400">{t('common.loading')}</p>}

      {!isLoading && filtered.length === 0 && (
        <p className="py-4 text-center text-xs italic text-gray-400">
          {prefixes && !showAll
            ? t('actionLog.emptySection', { defaultValue: 'В этом разделе действий пока нет' })
            : t('actionLog.empty', { defaultValue: 'Действий пока нет' })}
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto">
        {filtered.map((entry, index) => (
          <EntryRow key={`${entry.at}-${index}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}
