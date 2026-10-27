import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getVersionLog } from '@/api/projects'
import { formatDate, formatDateTime } from '@/utils/date'
import type { ProjectFieldChange, ProjectVersionLogEntry } from '@/types/project'
import { formatProjectChangeValue, normalizeProjectChanges } from '@/utils/projectPayload'

function displayValue(field: string, value: unknown): string {
  if (typeof value === 'string' && (field.includes('_start') || field.includes('_end'))) {
    return value ? formatDate(value) : '-'
  }
  return formatProjectChangeValue(field, value)
}

function EntryRow({ entry }: { entry: ProjectVersionLogEntry }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const changes = normalizeProjectChanges(entry.changed_fields)
  const fieldLabels: Record<string, string> = {
    name: t('common.name'),
    status: t('common.status'),
    priority: t('project.fields.priority'),
    client: t('project.fields.client'),
    pm_name: t('project.fields.pm'),
    planned_start: t('project.fields.plannedStart'),
    planned_end: t('project.fields.plannedEnd'),
    actual_start: t('project.fields.actualStart'),
    actual_end: t('project.fields.actualEnd'),
    success_criteria: t('project.fields.successCriteria'),
    description: t('common.description'),
    budget: t('project.fields.budget'),
    budget_currency: t('project.fields.currency'),
    goal: t('project.fields.goal'),
    scope: t('project.fields.scope'),
    project_result: t('project.fields.result'),
    key_milestones: t('project.fields.keyMilestones'),
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-800"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-primary-700">v{entry.version}</span>
          <span className="text-[10px] text-gray-400">{formatDateTime(entry.created_at)}</span>
          {entry.author_name && <span className="text-[10px] text-gray-500 dark:text-slate-400">{entry.author_name}</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">{t('versionLog.fieldsChanged', { count: changes.length })}</span>
          {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
        </div>
      </button>

      {open && changes.length > 0 && (
        <div className="divide-y divide-gray-100 dark:divide-slate-800">
          {changes.map((change: ProjectFieldChange, index) => (
            <div key={`${change.field}-${index}`} className="px-3 py-1.5 text-[11px]">
              <span className="font-medium text-gray-600 dark:text-slate-300">{fieldLabels[change.field] ?? change.field}:</span>
              <div className="mt-0.5 flex items-start gap-1">
                <span className="min-w-0 flex-1 break-words text-red-500 dark:text-red-300 line-through">
                  {displayValue(change.field, change.old_value)}
                </span>
                <span className="shrink-0 text-gray-400">{'->'}</span>
                <span className="min-w-0 flex-1 break-words text-green-700 dark:text-green-300">
                  {displayValue(change.field, change.new_value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && changes.length === 0 && (
        <p className="px-3 py-2 text-[11px] italic text-gray-400">{t('versionLog.noFieldChanges')}</p>
      )}
    </div>
  )
}

export default function VersionLogPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: entries = [], isLoading } = useQuery<ProjectVersionLogEntry[]>({
    queryKey: ['version_log', projectId],
    queryFn: () => getVersionLog(projectId),
    staleTime: 10000,
  })

  return (
    <div className="flex max-h-[80vh] w-80 flex-shrink-0 flex-col border-l border-gray-200 dark:border-slate-700 pl-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary-700">{t('common.log')}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
          <X size={14} />
        </button>
      </div>

      {isLoading && <p className="py-4 text-center text-xs text-gray-400">{t('common.loading')}</p>}

      {!isLoading && entries.length === 0 && (
        <p className="py-4 text-center text-xs italic text-gray-400">{t('project.noVersionHistory')}</p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
