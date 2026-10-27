/**
 * Сводка по подпроектам зонтика — ради неё вся фаза и затевалась: открыть общий проект и одним
 * взглядом увидеть, что происходит в каждом модуле.
 *
 * Строки приходят с сервера в форме портфеля (`_portfolio_row`), поэтому цифры здесь и в
 * «Портфеле» считаны ОДНИМ кодом. Считать прогресс и просрочку заново в браузере значило бы
 * завести вторую формулу, которая рано или поздно разойдётся с первой.
 */
import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { getSubprojects } from '@/api/projects'
import { getAttention } from '@/api/attention'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { ProgressBar } from '@/components/ui/badges'
import { Button } from '@/components/ui/button'
import ProjectInsights, { groupAttentionByProject } from '@/components/portfolio/ProjectInsights'

const RAG_DOT: Record<string, string> = {
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
}

export default function SubprojectsTab({ projectId, canManage = false }: {
  projectId: string
  /** Может ли этот человек привязывать подпроекты — то же право, что у диалога «Подпроекты». */
  canManage?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['subprojects', projectId],
    queryFn: () => getSubprojects(projectId),
  })
  // «Что с проектом» — тот же разбор и та же раскладка, что в Портфеле. Вкладка рисовала
  // только цифры, и на вопрос «почему этот модуль красный» приходилось открывать проект.
  const { data: attention } = useQuery({ queryKey: ['attention', 7], queryFn: () => getAttention(7) })
  const attentionByProject = useMemo(() => groupAttentionByProject(attention), [attention])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const totals = useMemo(() => rows.reduce((a, r) => ({
    tasks: a.tasks + (r.total_tasks ?? 0),
    overdue: a.overdue + (r.overdue_tasks_count ?? 0),
    risks: a.risks + (r.open_risks_high_count ?? 0),
    plan: a.plan + (r.budget_plan ?? 0),
    actual: a.actual + (r.budget_actual ?? 0),
    red: a.red + (r.rag_status === 'red' ? 1 : 0),
  }), { tasks: 0, overdue: 0, risks: 0, plan: 0, actual: 0, red: 0 }), [rows])

  if (isLoading) return <SkeletonRows rows={4} />
  if (isError) return <Surface className="p-4 text-sm text-rose-600 dark:text-rose-400">{t('common.error')}</Surface>
  const newSubproject = (
    <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/new?parent=${projectId}`)}>
      {t('project.subprojectCreate', { defaultValue: 'Создать подпроект' })}
    </Button>
  )

  if (rows.length === 0) {
    return (
      <Surface variant="muted" className="space-y-3 p-5 text-sm leading-6 text-slate-700 dark:text-slate-200">
        <p>{t('project.subprojectsEmptyTab', { defaultValue: 'Подпроектов пока нет. Привяжите существующие проекты через меню «Ещё» → «Подпроекты» — и здесь появится их общая картина: прогресс, просрочка, риски и бюджет по каждому.' })}</p>
        {canManage && newSubproject}
      </Surface>
    )
  }

  const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { k: 'count', label: t('project.subprojectsCount', { defaultValue: 'Подпроектов' }), v: String(rows.length) },
          { k: 'red', label: t('project.subprojectsRed', { defaultValue: 'Требуют внимания' }), v: String(totals.red) },
          { k: 'overdue', label: t('portfolio.overdue', { defaultValue: 'Просрочено' }), v: String(totals.overdue) },
          { k: 'risks', label: t('reports.highPriority', { defaultValue: 'Высокие риски' }), v: String(totals.risks) },
          { k: 'budget', label: t('budget.title', { defaultValue: 'Бюджет' }), v: `${money(totals.actual)} / ${money(totals.plan)}` },
        ].map((c) => (
          <Surface key={c.k} className="px-3 py-2">
            <p className="text-lg font-semibold leading-tight text-slate-900 dark:text-slate-100">{c.v}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{c.label}</p>
          </Surface>
        ))}
      </div>

      {canManage && <div className="flex justify-end">{newSubproject}</div>}

      <Surface className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs text-slate-500 dark:text-slate-400">
                <th className="w-6 px-2 py-2" />
                <th className="px-4 py-2 font-medium">{t('project.fields.name')}</th>
                <th className="px-4 py-2 font-medium">{t('portfolio.pmPrefix')}</th>
                <th className="px-4 py-2 font-medium">{t('portfolio.progress', { defaultValue: 'Прогресс' })}</th>
                <th className="px-4 py-2 font-medium">{t('portfolio.overdue', { defaultValue: 'Просрочено' })}</th>
                <th className="px-4 py-2 font-medium">{t('reports.highPriority', { defaultValue: 'Высокие риски' })}</th>
                <th className="px-4 py-2 font-medium">{t('budget.title', { defaultValue: 'Бюджет' })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                <tr
                  onClick={() => setExpandedId((id) => (id === String(r.id) ? null : String(r.id)))}
                  className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${expandedId === String(r.id) ? 'bg-slate-50 dark:bg-slate-800/70' : ''}`}>
                  <td className="pl-2 pr-0 text-slate-400">
                    <ChevronRight size={14} className={`transition-transform ${expandedId === String(r.id) ? 'rotate-90' : ''}`} />
                  </td>
                  <td className="px-4 py-2">
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${RAG_DOT[r.rag_status ?? ''] ?? 'bg-slate-300'}`} aria-hidden="true" />
                    <Link to={`/projects/${r.id}`} onClick={(e) => e.stopPropagation()}
                      className="text-slate-800 dark:text-slate-100 hover:underline">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.code}</span> {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{r.pm_name ?? '—'}</td>
                  <td className="px-4 py-2 w-32"><ProgressBar value={r.progress ?? 0} /></td>
                  <td className={`px-4 py-2 ${(r.overdue_tasks_count ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
                    {r.overdue_tasks_count ?? 0}
                  </td>
                  <td className={`px-4 py-2 ${(r.open_risks_high_count ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
                    {r.open_risks_high_count ?? 0}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {r.budget_plan ? `${money(r.budget_actual ?? 0)} / ${money(r.budget_plan)}` : '—'}
                  </td>
                </tr>
                {expandedId === String(r.id) && (
                  <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td colSpan={7} className="bg-slate-50/60 px-4 py-3 dark:bg-slate-800/40">
                      <ProjectInsights project={r} attention={attentionByProject.get(String(r.id))} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  )
}
