import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ExternalLink } from 'lucide-react'
import type { PortfolioProject } from '@/api/portfolio'
import { formatDate } from '@/utils/date'
import { Pill, PriorityBadge, StatusBadge } from '@/components/ui/badges'
import { Surface } from '@/components/ui/surface'
import MetricHelp from '@/components/portfolio/MetricHelp'
import { orderAsTree } from '@/utils/projectTree'
import { RAG_COLORS, getRagLabel, healthClasses } from '@/components/portfolio/portfolioHelpers'

export function ProjectCard({ project, onClick }: { project: PortfolioProject; onClick: () => void }) {
  const { t } = useTranslation()
  const deviationDays = project.baseline_deviation_days
  const deviationLabel = deviationDays != null && deviationDays !== 0
    ? `${deviationDays > 0 ? '+' : ''}${deviationDays}d`
    : null
  const ragLabel = project.rag_status ? getRagLabel(project.rag_status, t) : null
  const deviationColor = deviationDays != null
    ? deviationDays > 0 ? 'text-rose-700 dark:text-rose-300' : deviationDays < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-400'
    : 'text-slate-600 dark:text-slate-400'

  return (
    <Surface className={`cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md ${project.archived ? 'opacity-60' : ''}`} onClick={onClick} variant="accent">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">{project.code}</span>
            {project.archived && (
              <Pill className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{t('portfolio.archivedBadge', { defaultValue: 'Архив' })}</Pill>
            )}
            <StatusBadge status={project.status}>{t(`project.status.${project.status}`)}</StatusBadge>
            <PriorityBadge priority={project.priority}>{t(`project.priority.${project.priority}`)}</PriorityBadge>
            {project.project_kind && (
              <Pill className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                {t(`project.kind.${project.project_kind}`, { defaultValue: project.project_kind })}
              </Pill>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{project.name}</h3>
          {project.pm_name && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t('portfolio.pmPrefix')}: {project.pm_name}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {project.rag_status && <span role="img" title={ragLabel ?? undefined} aria-label={ragLabel ? `RAG: ${ragLabel}` : undefined} className={`mt-1 h-3 w-3 rounded-full ${RAG_COLORS[project.rag_status] ?? 'bg-slate-300'}`} />}
          {typeof project.health === 'number' && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthClasses(project.health)}`}>
              {t('portfolio.health', { defaultValue: 'Health' })} {project.health}
            </span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>{t('portfolio.progress')}</span>
          <span>{project.progress}% · {project.total_tasks} {t('portfolio.tasksShort', { defaultValue: 'tasks' })}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-2 rounded-full bg-blue-600" style={{ width: `${project.progress}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {project.open_risks_high_count > 0 && (
          <Pill className="bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
            {t('portfolio.highRiskCount', {
              defaultValue: '{{count}} high risk',
              count: project.open_risks_high_count,
            })}
          </Pill>
        )}
        {project.overdue_tasks_count > 0 && (
          <Pill className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            {t('portfolio.overdueCount', {
              defaultValue: '{{count}} overdue',
              count: project.overdue_tasks_count,
            })}
          </Pill>
        )}
        {project.open_risks_medium_count > 0 && (
          <Pill className="bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            {t('portfolio.mediumRiskCount', {
              defaultValue: '{{count}} medium risk',
              count: project.open_risks_medium_count,
            })}
          </Pill>
        )}
        {project.open_risks_high_count === 0 && project.overdue_tasks_count === 0 && project.open_risks_medium_count === 0 && (
          <Pill className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">{t('portfolio.onTrack')}</Pill>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
        <span>
          {project.planned_end
            ? `${t('project.fields.plannedEnd')}: ${formatDate(project.planned_end)}`
            : '-'}
        </span>
        {deviationLabel
          ? <span className={deviationColor}>{deviationLabel}</span>
          : ragLabel
            ? <span className="text-slate-600 dark:text-slate-400">{ragLabel}</span>
            : null}
      </div>
    </Surface>
  )
}

/**
 * Таблица портфеля. Клик по строке РАСКРЫВАЕТ разбор «что с проектом не так» прямо здесь —
 * переход в проект вынесен в отдельную кнопку. Так руководитель остаётся в списке: раньше
 * любопытство стоило ухода со страницы и возврата назад.
 */
/**
 * Строка таблицы — либо настоящий проект, либо «болванка» из реестра переходного периода:
 * проект, который ДОЛЖЕН вестись, но ещё не заведён. Показываем их в одном списке, иначе
 * руководитель видит половину картины и считает, что остального не существует.
 */
export type PortfolioRow = PortfolioProject & { stub?: boolean; stubPhase?: string | null }

export function ProjectTable({ projects, onOpen, expandedId, onToggle, renderExpanded, redChildren }: {
  projects: PortfolioRow[]
  onOpen: (id: string) => void
  expandedId?: string | null
  onToggle?: (id: string) => void
  renderExpanded?: (project: PortfolioRow) => ReactNode
  /** Красные подпроекты по id зонтика. Считает СТРАНИЦА — по всем проектам, до фильтров:
   *  таблица видит только свою отфильтрованную группу и посчитала бы меньше, чем есть. */
  redChildren?: Map<string, number>
}) {
  const { t } = useTranslation()
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'code', dir: 'asc' })

  // hint — короткое правило расчёта в тултипе шапки; полная версия живёт в справке
  // (/wiki/portfolio-metrics, ссылка «Как это считается» в шапке страницы).
  const cols: { key: string; label: string; num?: boolean; w?: string; hint?: string; help?: string; get: (p: PortfolioRow) => string | number }[] = [
    { key: 'code', label: t('portfolio.code'), w: '6%', get: (p) => p.code },
    { key: 'name', label: t('common.name'), w: '18%', get: (p) => p.name },
    { key: 'status', label: t('common.status'), w: '7%', get: (p) => p.status },
    { key: 'priority', label: t('project.fields.priority'), w: '6%', get: (p) => p.priority },
    { key: 'pm', label: t('portfolio.pmPrefix'), w: '9%', get: (p) => p.pm_name ?? '' },
    { key: 'planned_end', label: t('portfolio.endDate'), w: '7%', get: (p) => p.planned_end ?? '' },
    { key: 'progress', label: t('portfolio.progress'), w: '7%', hint: t('portfolio.hint.progress', { defaultValue: 'Доля выполненных задач проекта; фазы не считаются' }), get: (p) => p.progress },
    { key: 'total_tasks', label: t('portfolio.tasks', { defaultValue: 'Tasks' }), num: true, w: '4%', get: (p) => p.total_tasks },
    { key: 'overdue_tasks_count', label: t('portfolio.overdue', { defaultValue: 'Overdue' }), num: true, w: '7%', hint: t('portfolio.hint.overdue', { defaultValue: 'Незакрытые задачи, у которых плановое окончание раньше сегодняшнего дня' }), get: (p) => p.overdue_tasks_count },
    { key: 'open_risks_high_count', label: t('portfolio.highRisks'), num: true, w: '7%', hint: t('portfolio.hint.highRisks', { defaultValue: 'Открытые риски с оценкой 6 и выше (вероятность × влияние)' }), get: (p) => p.open_risks_high_count },
    { key: 'open_risks_medium_count', label: t('portfolio.mediumRisks', { defaultValue: 'Medium risks' }), num: true, w: '6%', hint: t('portfolio.hint.mediumRisks', { defaultValue: 'Открытые риски с оценкой 3–5' }), get: (p) => p.open_risks_medium_count },
    { key: 'budget_plan', label: t('portfolio.budget', { defaultValue: 'Budget' }), num: true, w: '6%', hint: t('portfolio.hint.budget', { defaultValue: 'План по расходным статьям; если статей нет — утверждённый лимит из паспорта' }), get: (p) => p.budget_plan ?? 0 },
    { key: 'baseline_deviation_days', label: t('portfolio.deviation', { defaultValue: 'Δ days' }), num: true, w: '4%', hint: t('portfolio.hint.deviation', { defaultValue: 'Сдвиг финиша против базового плана в днях; пусто, пока базовый план не зафиксирован' }), help: 'delta', get: (p) => p.baseline_deviation_days ?? 0 },
    // Health по возрастанию — худшие проекты всплывают наверх.
    { key: 'health', label: t('portfolio.health', { defaultValue: 'Health' }), num: true, w: '5%', hint: t('portfolio.hint.health', { defaultValue: '100 минус штрафы: RAG, просроченные задачи, высокие риски' }), help: 'health', get: (p) => (typeof p.health === 'number' ? p.health : Number.POSITIVE_INFINITY) },
    { key: 'rag_status', label: t('portfolio.rag'), w: '7%', hint: t('portfolio.hint.rag', { defaultValue: 'Считается по порогам просрочки и рисков из Настроек' }), help: 'rag', get: (p) => p.rag_status ?? '' },
  ]

  // Порядок с учётом дерева: зонтик, под ним его подпроекты. Тот же хелпер, что в Реестре
  // проектов, — раньше портфель раскладывал строки как придётся, и модули одной
  // программы стояли вперемешку с чужими проектами. Сортировка колонкой работает как раньше,
  // но ВНУТРИ уровня.
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]
    const cmp = (a: PortfolioRow, b: PortfolioRow) => {
      if (!!a.stub !== !!b.stub) return a.stub ? 1 : -1   // незаведённые — внизу группы
      const av = col.get(a)
      const bv = col.get(b)
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? c : -c
    }
    return orderAsTree(projects, cmp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, sort])

  // Сколько подпроектов зонтика в красной зоне. Ради этого числа портфель и открывают:
  // «где горит» — вопрос про дерево, а не про один проект. Число приходит снаружи,
  // от страницы: своя выборка у таблицы уже отфильтрована, и счётчик по ней врал бы в
  // меньшую сторону — молча и всегда в успокаивающую сторону.
  const redKids = redChildren ?? new Map<string, number>()

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  return (
    <Surface className="overflow-x-auto p-0">
      <table className="w-full table-fixed text-xs [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
            <th style={{ width: '2%' }} className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/95" />
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                style={{ width: c.w }}
                title={c.hint ? `${c.label} — ${c.hint}` : c.label}
                className={`sticky top-0 z-10 cursor-pointer select-none bg-slate-50 dark:bg-slate-800/95 px-2 py-2 align-bottom text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 ${c.num ? 'text-right' : 'text-left'}`}
              >
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                {/* Подсказка по формуле — рядом с названием: спрашивают о ней, глядя именно
                    на колонку. Клик по значку не сортирует (событие гасится в MetricHelp). */}
                {c.help && <span className="ml-1 inline-block"><MetricHelp anchor={c.help} compact /></span>}
              </th>
            ))}
            <th style={{ width: '3%' }} className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/95" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((project) => (
            <Fragment key={project.id}>
            <tr
              onClick={() => { if (!project.stub) onToggle?.(project.id) }}
              className={`border-b border-slate-100 dark:border-slate-800 ${project.stub ? 'bg-slate-50/60 dark:bg-slate-800/30' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800'} ${project.archived ? 'opacity-60' : ''} ${expandedId === project.id ? 'bg-slate-50 dark:bg-slate-800/70' : ''}`}
            >
              <td className="pl-2 pr-0 text-slate-400">
                {!project.stub && (
                  <ChevronRight size={14} className={`transition-transform ${expandedId === project.id ? 'rotate-90' : ''}`} />
                )}
              </td>
              <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  {project.stub ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {t('portfolio.notCreated', { defaultValue: 'не заведён' })}
                    </span>
                  ) : project.code}
                  {project.archived && (
                    <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-sans font-medium text-slate-600 dark:text-slate-300">{t('portfolio.archivedBadge', { defaultValue: 'Архив' })}</span>
                  )}
                </span>
              </td>
              <td title={project.name}
                className={`max-w-xs truncate px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200 ${project.depth ? 'pl-6' : ''}`}>
                {/* Метки ПЕРЕД названием: колонка узкая и обрезает хвост, а «зонтик» и «сколько
                    красных» — это то, ради чего строку и ищут глазами. Полное имя — в подсказке. */}
                {project.depth ? <span className="mr-1 text-slate-400 dark:text-slate-500" aria-hidden="true">↳</span> : null}
                {(project.subprojects_count ?? 0) > 0 && (
                  <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {t('project.umbrellaPill', { defaultValue: 'Зонтик · {{n}}', n: project.subprojects_count })}
                  </span>
                )}
                {(redKids.get(String(project.id)) ?? 0) > 0 && (
                  // Не голая цифра: рядом стоит «Зонтик · 4», и «2» читалось бы как его
                  // продолжение. Знак делает метку понятной глазами, aria-label — на слух.
                  <span
                    title={t('portfolio.redChildren', { defaultValue: 'Подпроектов в красной зоне: {{n}}', n: redKids.get(String(project.id)) })}
                    aria-label={t('portfolio.redChildren', { defaultValue: 'Подпроектов в красной зоне: {{n}}', n: redKids.get(String(project.id)) })}
                    className="mr-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                    <span aria-hidden="true">▲ {redKids.get(String(project.id))}</span>
                  </span>
                )}
                {project.name}
              </td>
              <td className="px-3 py-2.5">
                {project.stub
                  ? <span className="text-slate-500 dark:text-slate-400">{project.stubPhase || '—'}</span>
                  : <StatusBadge status={project.status}>{t(`project.status.${project.status}`)}</StatusBadge>}
              </td>
              <td className="px-3 py-2.5">
                {project.stub
                  ? <span className="text-slate-300 dark:text-slate-600">—</span>
                  : <PriorityBadge priority={project.priority}>{t(`project.priority.${project.priority}`)}</PriorityBadge>}
              </td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{project.pm_name ?? '-'}</td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{project.planned_end ? formatDate(project.planned_end) : '-'}</td>
              <td className="px-3 py-2.5">
                {project.stub ? <span className="text-slate-300 dark:text-slate-600">—</span> : (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${project.progress}%` }} /></div>
                    <span className="text-slate-600 dark:text-slate-300">{project.progress}%</span>
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 text-right text-slate-700 dark:text-slate-200">{project.stub ? '—' : project.total_tasks}</td>
              <td className={`px-3 py-2.5 text-right ${project.overdue_tasks_count ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}>{project.stub ? '—' : project.overdue_tasks_count || 0}</td>
              <td className={`px-3 py-2.5 text-right ${project.open_risks_high_count ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}>{project.stub ? '—' : project.open_risks_high_count || 0}</td>
              <td className={`px-3 py-2.5 text-right ${project.open_risks_medium_count ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400'}`}>{project.stub ? '—' : project.open_risks_medium_count || 0}</td>
              <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-300">
                <div>
                  {project.budget_plan != null
                    ? `${Math.round(project.budget_plan).toLocaleString('ru-RU')} ${project.budget_currency ?? ''}`.trim()
                    : '—'}
                </div>
                {(project.budget_actual ?? 0) > 0 && (
                  // Факт мелкой строкой; rose — перерасход относительно плана.
                  <div className={`text-[10px] ${project.budget_plan != null && (project.budget_actual ?? 0) > project.budget_plan ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}>
                    {t('portfolio.budgetActualShort', { defaultValue: 'Факт' })}: {Math.round(project.budget_actual ?? 0).toLocaleString('ru-RU')}
                  </div>
                )}
                {(project.budget_consumed ?? 0) > 0 && (
                  // Израсходованное подпроектами. В план строки НЕ входит и ни в один итог
                  // портфеля тоже: иначе деньги модуля посчитались бы и у него, и у программы.
                  // Здесь это подпись «за этой цифрой стоят модули», а не ещё одно слагаемое.
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {t('portfolio.budgetThroughSub', {
                      defaultValue: 'через подпроекты ({{n}}): {{sum}}',
                      n: project.budget_consumed_projects ?? 0,
                      sum: Math.round(project.budget_consumed ?? 0).toLocaleString('ru-RU'),
                    })}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 text-right">
                {project.baseline_deviation_days != null && project.baseline_deviation_days !== 0
                  ? <span className={project.baseline_deviation_days > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}>{project.baseline_deviation_days > 0 ? '+' : ''}{project.baseline_deviation_days}d</span>
                  : <span className="text-slate-300 dark:text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2.5 text-right">
                {typeof project.health === 'number' ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthClasses(project.health)}`}>{project.health}</span>
                ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2.5">
                {project.rag_status ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${RAG_COLORS[project.rag_status]}`} />
                    <span className="text-xs text-slate-600 dark:text-slate-300">{getRagLabel(project.rag_status, t)}</span>
                  </span>
                ) : <span className="text-slate-300 dark:text-slate-600">-</span>}
              </td>
              <td className="px-2 py-2.5 text-right">
                {/* Переход в проект — отдельной кнопкой: клик по строке теперь раскрывает разбор. */}
                {!project.stub && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpen(project.id) }}
                  aria-label={t('portfolio.openProject', { defaultValue: 'Открыть проект' })}
                  title={t('portfolio.openProject', { defaultValue: 'Открыть проект' })}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                >
                  <ExternalLink size={14} />
                </button>
                )}
              </td>
            </tr>
            {expandedId === project.id && renderExpanded && (
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <td colSpan={cols.length + 2} className="!overflow-visible !whitespace-normal px-4 py-3">{renderExpanded(project)}</td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Surface>
  )
}
