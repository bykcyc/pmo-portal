/**
 * Пороги «перегружен» — настройка руководителя портфеля.
 *
 * До этого пороги жили в переменных окружения сервера: поменять их мог только тот, у кого есть
 * доступ к машине. А решение «сколько задач считать перегрузкой» — управленческое, и принимает
 * его тот, кто смотрит портфель. Поэтому настройка здесь, рядом с порогами RAG.
 */
import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkloadThresholds } from '@/api/settings'

interface Props {
  t: TFunction
  workload: WorkloadThresholds | null
  setWorkload: Dispatch<SetStateAction<WorkloadThresholds | null>>
  handleSave: () => void
  saving: boolean
}

const inputCls =
  'mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 dark:disabled:bg-slate-800/60'

export default function WorkloadSettingsSection({ t, workload, setWorkload, handleSave, saving }: Props) {
  const field = (
    key: keyof WorkloadThresholds,
    label: string,
    hint: string,
  ) => (
    <div>
      <label className="text-xs font-medium text-gray-600 dark:text-slate-300">{label}</label>
      <input
        type="number"
        min={1}
        aria-label={label}
        value={workload?.[key] ?? ''}
        onChange={(e) => setWorkload((w) => (w ? { ...w, [key]: Number(e.target.value) } : w))}
        disabled={!workload}
        className={inputCls}
      />
      <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">{hint}</p>
    </div>
  )

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 flex items-center gap-2">
        <Users size={16} className="text-gray-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">
          {t('settings.workload.title', { defaultValue: 'Пороги перегрузки' })}
        </h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-slate-400">
        {t('settings.workload.help', {
          defaultValue: 'С какого объёма портал помечает человека «Перегружен» на графиках портфеля. Пометка — повод посмотреть, а не приговор.',
        })}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {field('tasks',
          t('settings.workload.tasks', { defaultValue: 'Исполнитель: открытых задач ≥' }),
          t('settings.workload.tasksHint', { defaultValue: 'Считаются открытые задачи по всем проектам портфеля.' }))}
        {field('hours',
          t('settings.workload.hours', { defaultValue: 'Исполнитель: часов оценки ≥' }),
          t('settings.workload.hoursHint', { defaultValue: 'Срабатывает только там, где оценка в часах заполнена.' }))}
        {field('pm_projects',
          t('settings.workload.pmProjects', { defaultValue: 'Руководитель: проектов ≥' }),
          t('settings.workload.pmProjectsHint', { defaultValue: 'Считаются незакрытые проекты и строки реестра, закреплённые за человеком.' }))}
      </div>
      <div className="mt-4">
        <Button onClick={handleSave} disabled={!workload || saving}>
          {saving ? t('common.saving', { defaultValue: 'Сохранение…' }) : t('settings.rag.save', { defaultValue: 'Сохранить' })}
        </Button>
      </div>
    </section>
  )
}
