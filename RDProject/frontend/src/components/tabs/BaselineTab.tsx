import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { useTranslation } from 'react-i18next'
import { formatDate, formatDateTime, localIsoDate } from '@/utils/date'
import { getBaselines, createBaseline, deleteBaseline } from '@/api/baselines'
import { getTasks } from '@/api/tasks'
import type { Baseline } from '@/types/baseline'
import type { Task } from '@/types/task'
import { useConfirmStore } from '@/store/confirmStore'
import { useCanWrite } from '@/contexts/ProjectPermission'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideStep } from '@/components/ProcessGuide'
import { useSectionExport } from '@/hooks/useSectionExport'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(a), db = new Date(b)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

function deviationColor(days: number | null): string {
  if (days === null) return 'text-gray-500 dark:text-slate-400'
  if (days > 7) return 'text-red-600 dark:text-rose-300 font-semibold'
  if (days > 0) return 'text-yellow-600 dark:text-amber-300'
  if (days < 0) return 'text-green-600 dark:text-emerald-300'
  return 'text-gray-600 dark:text-slate-300'
}

export default function BaselineTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const showConfirm = useConfirmStore(s => s.show)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string>('')  // '' = сравнивать с текущим планом; иначе — с другим снимком
  const [creating, setCreating] = useState(false)
  const [factFilter, setFactFilter] = useState<'all' | 'overdue' | 'changed'>('all')
  // Единственная вкладка проекта, где этой проверки не было: читателю (наблюдатель,
  // руководство, анонимная ссылка) предлагались «Сохранить базовый план» и «Зафиксировать
  // текущий план», и обе отвечали 403. Остальные 14 вкладок спрашивают то же самое.
  const canWrite = useCanWrite()

  const { data: baselines = [], isLoading: blLoading, isError: blError, refetch: refetchBaselines } = useQuery({
    queryKey: ['baselines', projectId], queryFn: () => getBaselines(projectId),
  })
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', projectId], queryFn: () => getTasks(projectId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['baselines', projectId] })

  // Авто-выбор свежего снимка: раньше при заходе справа была пустота «Выберите…» —
  // непонятно, зачем раздел. Теперь сразу видна таблица отклонений.
  useEffect(() => {
    if (!selectedId && baselines.length > 0) {
      const latest = [...baselines].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
      setSelectedId(latest.id)
    }
  }, [baselines, selectedId])

  // Экспорт секции — в меню «Ещё» шапки проекта
  const exportRows = useMemo(() => baselines.map((b) => ({
    name: b.name, created_at: b.created_at, tasks_count: b.tasks.length,
  })), [baselines])
  useSectionExport('baselines', exportRows)

  // Открыть форму с предзаполненным именем «План от <дата>» — не заставляем придумывать название
  const openCreate = () => {
    if (!newName.trim()) {
      setNewName(t('adopt.baselineDefaultName', {
        defaultValue: 'План от {{date}}',
        date: formatDate(localIsoDate()),
      }))
    }
    setShowCreate(true)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    await createBaseline(projectId, newName.trim())
    await invalidate(); setShowCreate(false); setNewName(''); setCreating(false)
  }

  const handleDelete = (id: string) => {
    showConfirm(t('baseline.deleteConfirm'), async () => {
      await deleteBaseline(projectId, id); await invalidate()
      if (selectedId === id) setSelectedId(null)
    })
  }

  const selectedBaseline = baselines.find((b) => b.id === selectedId)
  const compareBaseline = compareId ? baselines.find((b) => b.id === compareId) : undefined
  const comparing = !!compareBaseline  // сравниваем два снимка, а не снимок с текущим планом

  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]))
  // При сравнении двух снимков «текущая» сторона берётся из снимка B (только даты, без статуса/%).
  const cmpMap = compareBaseline
    ? new Map(compareBaseline.tasks.map((bt) => [String(bt.task_id ?? (bt as { id?: string }).id ?? ''), bt]))
    : null

  const todayIso = localIsoDate()
  const btKey = (bt: { task_id?: string; id?: string }) => bt.task_id ?? bt.id ?? ''
  const deviationRows = selectedBaseline
    ? selectedBaseline.tasks.map((bt) => {
        const key = btKey(bt)
        const baseEnd = bt.planned_end
        if (cmpMap) {
          // сравнение снимок A ↔ снимок B по task_id (только плановые даты)
          const c = cmpMap.get(String(key))
          if (!c) return null
          return {
            task: { id: key, wbs_code: '', title: bt.task_title ?? key, status: undefined, progress: undefined } as unknown as Task,
            baseStart: bt.planned_start, baseEnd, currentStart: c.planned_start, currentEnd: c.planned_end,
            deviation: daysBetween(baseEnd, c.planned_end), overdueDays: 0,
          }
        }
        // снимок A ↔ текущий план (со статусом/просрочкой относительно сегодня)
        const current = taskMap.get(key)
        if (!current) return null
        const currentEnd = current.planned_end
        const deviation = daysBetween(baseEnd, currentEnd)
        const done = current.status === 'completed' || current.status === 'cancelled'
        const overdueDays = !done && currentEnd && currentEnd < todayIso
          ? (daysBetween(currentEnd, todayIso) ?? 0)
          : 0
        return { task: current, baseStart: bt.planned_start, baseEnd, currentStart: current.planned_start, currentEnd, deviation, overdueDays }
      }).filter(Boolean)
    : []

  const rows = deviationRows as NonNullable<typeof deviationRows[0]>[]
  const overdueCount = rows.filter((r) => r.overdueDays > 0).length
  const changedCount = rows.filter((r) => (r.deviation ?? 0) !== 0).length
  const visibleRows = factFilter === 'overdue'
    ? rows.filter((r) => r.overdueDays > 0)
    : factFilter === 'changed'
      ? rows.filter((r) => (r.deviation ?? 0) !== 0)
      : rows

  const guideSteps: GuideStep[] = [
    { title: t('baseline.guide.s1'), desc: t('baseline.guide.s1d') },
    { title: t('baseline.guide.s2'), desc: t('baseline.guide.s2d') },
    { title: t('baseline.guide.s3'), desc: t('baseline.guide.s3d') },
    { title: t('baseline.guide.s4'), desc: t('baseline.guide.s4d') },
    { title: t('baseline.guide.s5'), desc: t('baseline.guide.s5d') },
  ]

  if (blLoading) return <SkeletonRows rows={6} />
  if (blError) {
    return (
      <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">
        <p className="mb-3">{t('common.error')}</p>
        <Button variant="secondary" onClick={() => void refetchBaselines()}>{t('common.retry')}</Button>
      </Surface>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Left: baseline list */}
      <div className="col-span-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('baseline.title')} ({baselines.length})</h3>
            <ProcessGuide steps={guideSteps} />
          </div>
          {canWrite && (
            <button onClick={openCreate}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover">
              <Plus size={12} /> {t('baseline.save')}
            </button>
          )}
        </div>

        {showCreate && (
          <div className="mb-3 p-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg">
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder={t('baseline.savePlaceholder')}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 mb-2" />
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={creating}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
                <Save size={12} />{creating ? t('baseline.savingLabel') : t('baseline.save')}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-md">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {baselines.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('baseline.noBaselinesHint')}</p>
        ) : (
          <div className="space-y-2">
            {baselines.map((b) => (
              <div key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedId === b.id ? 'border-primary-400 dark:border-slate-600 bg-primary-50 dark:bg-slate-800/70' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{b.name}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{formatDateTime(b.created_at)} · {b.tasks.length} {t('baseline.tasksLabel')}</p>
                  </div>
                  {canWrite && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(b.id) }} aria-label={t('common.delete')} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-800"><Trash2 size={ICON_SM} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: deviation table */}
      <div className="col-span-2">
        {!selectedBaseline ? (
          baselines.length === 0 ? (
            /* Объяснение «что это и зачем» вместо пустоты — раздел должен объяснять себя сам */
            <div className="flex h-full items-center justify-center">
              <div className="max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5">
                <p className="mb-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                  {t('adopt.baselineWhat', { defaultValue: 'Базовый план — это «снимок» сроков, которые вы пообещали. Проект живёт, даты сдвигаются, а снимок остаётся. Так на любой статус-встрече видно: что обещали → что стало → на сколько дней уехало и по каким задачам.' })}
                </p>
                <ol className="mb-4 ml-4 list-decimal space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-400">
                  <li>{t('adopt.baselineStep1', { defaultValue: 'Согласуйте план работ (WBS) и даты.' })}</li>
                  <li>{t('adopt.baselineStep2', { defaultValue: 'Зафиксируйте его кнопкой ниже — даты всех задач сохранятся как базовый план.' })}</li>
                  <li>{t('adopt.baselineStep3', { defaultValue: 'Когда сроки поедут — здесь появится отклонение по каждой задаче, а на Ганте базовый план будет виден серой полоской под задачей.' })}</li>
                </ol>
                {canWrite && (
                  <button onClick={openCreate}
                    className="flex items-center gap-1.5 rounded-md bg-btn-primary px-3 py-1.5 text-xs font-medium text-btn-primary-fg hover:bg-btn-primary-hover">
                    <Save size={12} /> {t('adopt.baselineCta', { defaultValue: 'Зафиксировать текущий план' })}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-slate-400">
              {t('baseline.selectToCompare')}
            </div>
          )
        ) : (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('baseline.deviationFrom')} "{selectedBaseline.name}"</h4>
              <label className="ml-auto flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('baseline.compareWith', { defaultValue: 'Сравнить с' })}:
                <select value={compareId} onChange={(e) => setCompareId(e.target.value)}
                  className="text-xs border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-slate-100 rounded px-2 py-1">
                  <option value="">{t('baseline.compareCurrent', { defaultValue: 'Текущий план' })}</option>
                  {baselines.filter((b) => b.id !== selectedId).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {/* Подсказка: сравнение снимка A с B возможно только при ≥2 снимках */}
            <p className="mb-3 text-xs text-gray-500 dark:text-slate-400">
              {comparing
                ? t('baseline.compareHintTwo', { defaultValue: 'Сравниваются два снимка: слева — «{{a}}», справа — «{{b}}» (по плановым датам).', a: selectedBaseline.name, b: compareBaseline?.name })
                : baselines.length < 2
                  ? t('baseline.compareHintNeedTwo', { defaultValue: 'Сейчас снимок сравнивается с текущим планом. Чтобы сравнить два плана между собой — сохраните ещё один снимок кнопкой «Сохранить базовый план».' })
                  : t('baseline.compareHintPick', { defaultValue: 'Снимок сравнивается с текущим планом. Выберите другой снимок в «Сравнить с», чтобы сравнить два плана между собой.' })}
            </p>
            {/* Сводка: «отклонение плана» ≠ «просрочка». План мог не меняться со снимка (0 дней),
                но задачи реально просрочены относительно СЕГОДНЯ — раньше писали «В срок», это враньё. */}
            {/* Чипы-фильтры: клик оставляет в таблице только соответствующие строки */}
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <button type="button" onClick={() => setFactFilter('all')}
                className={`rounded-full px-2.5 py-1 transition-shadow bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 ${factFilter === 'all' ? 'ring-2 ring-blue-500' : ''}`}>
                {t('baseline.sumAll', { defaultValue: 'Все задачи: {{count}}', count: rows.length })}
              </button>
              <button type="button" onClick={() => setFactFilter(factFilter === 'overdue' ? 'all' : 'overdue')}
                className={`rounded-full px-2.5 py-1 transition-shadow ${overdueCount > 0
                  ? 'bg-red-50 text-red-700 dark:bg-rose-950/40 dark:text-rose-300'
                  : 'bg-green-50 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300'} ${factFilter === 'overdue' ? 'ring-2 ring-blue-500' : ''}`}>
                {t('baseline.sumOverdue', { defaultValue: 'Просрочено сейчас: {{count}}', count: overdueCount })}
              </button>
              <button type="button" onClick={() => setFactFilter(factFilter === 'changed' ? 'all' : 'changed')}
                className={`rounded-full px-2.5 py-1 transition-shadow bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 ${factFilter === 'changed' ? 'ring-2 ring-blue-500' : ''}`}>
                {t('baseline.sumChanged', { defaultValue: 'План менялся после снимка: {{count}}', count: changedCount })}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    {[t('baseline.task'),
                      t('baseline.baselineStart', { defaultValue: 'Базовое начало' }),
                      t('baseline.baselineEnd'),
                      t('baseline.currentStart', { defaultValue: 'Текущее начало' }),
                      t('baseline.current'),
                      t('baseline.colPlanDelta', { defaultValue: 'Отклонение плана (дни)' }),
                      '%',
                      t('baseline.colNow', { defaultValue: 'Статус сейчас' })].map(h => (
                      <th key={h} className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.task.id} className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-2 pr-4 text-gray-800 dark:text-slate-200">{row.task.wbs_code} {row.task.title}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-slate-300">{row.baseStart ?? '—'}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-slate-300">{row.baseEnd ?? '—'}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-slate-300">{row.currentStart ?? '—'}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-slate-300">{row.currentEnd ?? '—'}</td>
                      <td className={`py-2 pr-4 ${deviationColor(row.deviation)}`}>
                        {row.deviation === null
                          ? '—'
                          : row.deviation === 0
                            ? t('baseline.planUnchanged', { defaultValue: 'Без изменений' })
                            : `${row.deviation > 0 ? '+' : ''}${row.deviation} ${t('common.days')}`}
                      </td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-slate-300">{comparing ? '—' : `${row.task.progress ?? 0}%`}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {comparing ? (
                          <span className="text-gray-500 dark:text-slate-400">—</span>
                        ) : (
                          <>
                            {/* всегда показываем статус задачи; просрочка — красным довеском */}
                            <span className={row.task.status === 'completed'
                              ? 'text-green-600 dark:text-emerald-300'
                              : row.task.status === 'cancelled'
                                ? 'text-gray-500 dark:text-slate-400'
                                : 'text-gray-500 dark:text-slate-400'}>
                              {t(`wbs.statuses.${row.task.status}`, { defaultValue: row.task.status })}
                            </span>
                            {row.overdueDays > 0 && (
                              <span className="ml-1.5 font-semibold text-red-600 dark:text-rose-300">
                                {t('baseline.factOverdue', { defaultValue: 'Просрочена на {{count}} дн.', count: row.overdueDays })}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
