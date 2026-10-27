import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getStakeholders, getAssumptions, getTeam } from '@/api/team'
import { getRisks } from '@/api/risks'
import { getCommPlan, getKPIs } from '@/api/kpi'
import { getTasks } from '@/api/tasks'
import { formatDate } from '@/utils/date'
import { planMilestones } from '@/utils/milestones'
import { useCanWrite } from '@/contexts/ProjectPermission'

const sectionTitle = 'text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider'
const block = 'border-2 border-gray-300 dark:border-slate-700 rounded-lg p-3'

/** Максимум строк в компактном превью секции; остальные записи сворачиваются в «+ ещё N». */
const MAX_PREVIEW_ROWS = 4

interface PreviewRow {
  id: string
  /** Главное поле записи (имя/название/цель/описание). */
  primary: ReactNode
  /** Один короткий вторичный атрибут (роль/тип/статус/частота). */
  secondary: ReactNode
}

/**
 * Единый компактный шаблон read-only секции паспорта: заголовок + счётчик,
 * ссылка «Открыть →» и до MAX_PREVIEW_ROWS строк «основное … вторичное».
 * Никаких таблиц — одинаковая типографика и отступы во всех секциях.
 */
function SectionPreview({ title, count, rows, onOpen }: {
  title: string
  count: number
  rows: PreviewRow[]
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const collapsible = rows.length > MAX_PREVIEW_ROWS
  const visible = expanded ? rows : rows.slice(0, MAX_PREVIEW_ROWS)
  // Свёрнутые строки видны в печати (паспорт-PDF полный). Развернули на экране — печатный
  // дубликат не нужен, иначе в PDF те же записи выйдут дважды.
  const hidden = expanded ? [] : rows.slice(MAX_PREVIEW_ROWS)
  const rest = hidden.length

  const renderRow = (r: PreviewRow) => (
    <div key={r.id} className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-slate-200">{r.primary}</span>
      <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{r.secondary}</span>
    </div>
  )

  return (
    <div className={block}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className={`${sectionTitle} min-w-0 truncate`}>
          {title}
          <span className="ml-1.5 normal-case tracking-normal text-gray-500 dark:text-slate-400">· {count}</span>
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="print-hide shrink-0 rounded text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {t('common.open', { defaultValue: 'Открыть' })} →
        </button>
      </div>
      <div className="space-y-1">
        {visible.map(renderRow)}
        {/* остальные строки: скрыты на экране, показаны при печати — паспорт-PDF полный */}
        {hidden.length > 0 && <div className="hidden space-y-1 print:block">{hidden.map(renderRow)}</div>}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="print-hide pt-0.5 text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            {expanded
              ? t('passport.collapseItems', { defaultValue: 'Свернуть' })
              : t('passport.moreItems', { count: rest, defaultValue: '+ ещё {{count}}' })}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * `only` — белый список ключей секций (для публичной страницы: показывать и ГРУЗИТЬ только
 * опубликованные, иначе их эндпоинты вернут 401). `onOpenSection` — переопределение перехода
 * (публичная страница переключает вкладку вместо навигации в приватный роут).
 */
export default function PassportReadOnlySections({ projectId, only, onOpenSection }: {
  projectId: string
  only?: string[]
  onOpenSection?: (key: string) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const allowed = (key: string) => !only || only.includes(key)
  const open = (key: string) => (onOpenSection ? onOpenSection(key) : navigate(`/projects/${projectId}/${key}`))

  const { data: team = [] } = useQuery({
    queryKey: ['team', projectId],
    queryFn: () => getTeam(projectId),
    enabled: allowed('team'),
  })
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['stakeholders', projectId],
    queryFn: () => getStakeholders(projectId),
    enabled: allowed('stakeholders'),
  })
  const { data: assumptions = [] } = useQuery({
    queryKey: ['assumptions', projectId],
    queryFn: () => getAssumptions(projectId),
    enabled: allowed('assumptions'),
  })
  const { data: risks = [] } = useQuery({
    queryKey: ['risks', projectId],
    queryFn: () => getRisks(projectId),
    enabled: allowed('risks'),
  })
  const { data: commPlan = [] } = useQuery({
    queryKey: ['commPlan', projectId],
    queryFn: () => getCommPlan(projectId),
    enabled: allowed('comm-plan'),
  })
  const { data: kpis = [] } = useQuery({
    queryKey: ['kpis', projectId],
    queryFn: () => getKPIs(projectId),
    enabled: allowed('kpis'),
  })
  // Опорные точки проекта — это План работ, и только он. Ключ секции 'wbs' — значит, на
  // публичной странице раздел сам отвалится, если План работ не опубликован (запроса тоже
  // не будет). Правило выбора и отметку выполнения держит planMilestones.
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => getTasks(projectId),
    enabled: allowed('wbs'),
  })
  const milestones = planMilestones(tasks)

  // Один формат данных на все секции: основное поле + один короткий вторичный атрибут.
  const sections: { key: string; title: string; count: number; rows: PreviewRow[] }[] = [
    {
      key: 'wbs',
      title: t('project.fields.keyMilestones'),
      count: milestones.length,
      rows: milestones.map(m => ({
        id: m.id,
        primary: m.state === 'done'
          ? <span className="text-slate-500 line-through dark:text-slate-400">{m.title}</span>
          : m.title,
        // Отметка выполнения — по СТАТУСУ в Плане работ, а не по проценту: наполовину
        // сделанная точка отчёта не наступила. Значок дублируется словом для чтения с экрана.
        secondary: m.state === 'done' ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            <span aria-hidden="true">✓</span>
            <span className="sr-only">{t('project.milestoneDone', { defaultValue: 'Выполнена' })}</span>
            {m.date ? ` ${formatDate(m.date)}` : ''}
          </span>
        ) : m.state === 'cancelled' ? (
          <span className="text-slate-500 dark:text-slate-400">
            {t('project.milestoneCancelled', { defaultValue: 'Отменена' })}
          </span>
        ) : (m.date ? formatDate(m.date) : '—'),
      })),
    },
    {
      key: 'team',
      title: t('project.sections.team'),
      count: team.length,
      rows: team.map(m => ({ id: m.id, primary: m.full_name, secondary: m.project_role ?? m.position ?? '—' })),
    },
    {
      key: 'stakeholders',
      title: t('stakeholders.title'),
      count: stakeholders.length,
      rows: stakeholders.map(s => ({ id: s.id, primary: s.name, secondary: s.type ? t(`stakeholders.${s.type}`) : '—' })),
    },
    {
      key: 'assumptions',
      title: t('assumptions.title'),
      count: assumptions.length,
      rows: assumptions.map(a => ({ id: a.id, primary: a.description, secondary: a.status ? t(`assumptions.statuses.${a.status}`) : '—' })),
    },
    {
      key: 'risks',
      title: t('project.sections.risks'),
      count: risks.length,
      rows: risks.map(r => ({ id: r.id, primary: r.title, secondary: r.status ? t(`risks.statuses.${r.status}`) : '—' })),
    },
    {
      key: 'comm-plan',
      title: t('project.sections.comm-plan'),
      count: commPlan.length,
      rows: commPlan.map(c => ({ id: c.id, primary: c.goal, secondary: c.frequency ?? '—' })),
    },
    {
      key: 'kpis',
      title: t('project.sections.kpis'),
      count: kpis.length,
      rows: kpis.map(k => ({ id: k.id, primary: k.name, secondary: k.status ? t(`kpis.statuses.${k.status}`) : '—' })),
    },
  ]

  // Пустые секции не рендерим стеной заглушек — сворачиваем в компактные строки-ссылки.
  // `only` отсекает неопубликованные секции целиком (их данные мы даже не запрашивали).
  const visibleSections = sections.filter(section => allowed(section.key))
  const filledSections = visibleSections.filter(section => section.count > 0)
  const emptySections = visibleSections.filter(section => section.count === 0)

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 dark:border-slate-800 pt-4">

      {filledSections.map(section => (
        <SectionPreview
          key={section.key}
          title={section.title}
          count={section.count}
          rows={section.rows}
          onOpen={() => open(section.key)}
        />
      ))}

      {/* Пустые секции: одна компактная строка на каждую. Кнопка «Добавить →» — только тем,
          кто может писать (публичный зритель не должен уходить в приватный роут). */}
      {emptySections.length > 0 && (
        <div className="space-y-1.5">
          {canWrite && (
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {t('project.startHint', { defaultValue: 'Для старта достаточно Паспорта и Плана работ. Остальное добавите позже.' })}
            </p>
          )}
          {emptySections.map((section) => {
            const label = (
              <span className="min-w-0 truncate">
                <span className="font-medium text-gray-600 dark:text-slate-300">{section.title}</span>
                {' — '}
                {t('project.emptyYet', { defaultValue: 'пока пусто' })}
              </span>
            )
            const rowCls = 'flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 dark:border-slate-700 px-3 py-2 text-left text-xs text-gray-500 dark:text-slate-400'
            return canWrite ? (
              <button
                key={section.key}
                type="button"
                onClick={() => open(section.key)}
                className={`${rowCls} transition-colors hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
              >
                {label}
                <span className="whitespace-nowrap text-blue-600 dark:text-blue-400">{t('common.add')} →</span>
              </button>
            ) : (
              <div key={section.key} className={rowCls}>{label}</div>
            )
          })}
        </div>
      )}

    </div>
  )
}
