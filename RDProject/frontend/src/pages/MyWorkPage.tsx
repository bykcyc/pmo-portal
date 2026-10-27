import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Contact, FolderOpen,
  Clock, Inbox, Lightbulb, ListChecks, Lock, Megaphone, Scale, Target, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getMyItems, type MyItem, type MyItemType, type MyProjectItems } from '@/api/myTasks'
import { getAccessRequests, type AccessRequest } from '@/api/access'
import RequestAccessDialog from '@/components/access/RequestAccessDialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { FilterBar, PageHeader, PageShell } from '@/components/ui/layout'
import { StatusBadge } from '@/components/ui/badges'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'

const selectCls = 'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 shadow-sm outline-none focus:border-slate-500'

const TYPE_ORDER: MyItemType[] = ['task', 'backlog', 'risk', 'decision', 'assumption', 'comm', 'kpi', 'team', 'stakeholder', 'meeting']
const TYPE_ICON: Record<MyItemType, LucideIcon> = {
  task: ListChecks, backlog: Inbox, risk: AlertTriangle, decision: Scale,
  assumption: Lightbulb, comm: Megaphone, kpi: Target, team: Users,
  stakeholder: Contact, meeting: CalendarClock,
}
// Единая палитра деталей: цвет несёт тип элемента (иконка-квадрат слева + чип-тумблер сверху)
const TYPE_STYLE: Record<MyItemType, string> = {
  task: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  backlog: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  risk: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  decision: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  assumption: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  comm: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  kpi: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  team: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  stakeholder: 'bg-slate-200 text-slate-700 dark:bg-slate-600/40 dark:text-slate-200',
  meeting: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
}
// Пространство статусов зависит от типа элемента (у team/stakeholder/comm статуса нет)
const STATUS_NS: Partial<Record<MyItemType, string>> = {
  task: 'wbs.statuses', backlog: 'backlog.statuses', risk: 'risks.statuses',
  decision: 'decisions.statuses', assumption: 'assumptions.statuses', kpi: 'kpis.statuses',
  meeting: 'meetings.statuses',
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${i > 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''} ${
            value === o.value
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Состояние доступа к проекту, в который меня не пускают: попросить, ждать или узнать об отказе.
 *
 * Три состояния вместо одной кнопки. Кнопка, нажатая второй раз, вернула бы «запрос уже
 * отправлен» — человек решил бы, что портал сломан. Отказ показываем прямо здесь: молчание
 * после просьбы читается как «меня не заметили», и человек просит снова.
 */
function AccessAction({
  group, request, onAsk,
}: {
  group: MyProjectItems
  request?: AccessRequest
  onAsk: () => void
}) {
  const { t } = useTranslation()
  if (request?.status === 'open') {
    return (
      <span
        title={t('access.pendingHint', { defaultValue: 'Запрос ждёт решения руководителя проекта и не истекает.' })}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      >
        <Clock size={12} />
        {t('access.pending', { defaultValue: 'Запрос отправлен' })}
      </span>
    )
  }
  if (request?.status === 'rejected') {
    return (
      <span
        title={t('access.rejectedHint', { defaultValue: 'Руководитель отклонил запрос. Повторить можно через два месяца.' })}
        className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      >
        <Lock size={12} />
        {t('access.rejectedShort', { defaultValue: 'Отклонён' })}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      title={t('myWork.cantOpen', { defaultValue: 'Вы участник этого проекта, но не его руководитель — открыть проект нельзя.' })}
      aria-label={t('access.request', { defaultValue: 'Запросить доступ' }) + ': ' + group.project_name}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
    >
      <Lock size={12} />
      {t('access.request', { defaultValue: 'Запросить доступ' })}
    </button>
  )
}

export default function MyWorkPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [itemScope, setItemScope] = useState<'open' | 'closed' | 'all'>('open')
  const [projScope, setProjScope] = useState<'active' | 'all'>('active')
  const [hidden, setHidden] = useState<Set<MyItemType>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [asking, setAsking] = useState<MyProjectItems | null>(null)

  const { data: groups = [], isLoading, isError, refetch } = useQuery({ queryKey: ['my-items'], queryFn: getMyItems })
  // Свои запросы доступа — чтобы кнопка не предлагала попросить ещё раз то, что уже ждёт
  // решения, и чтобы отказ не выглядел как «ничего не произошло».
  const { data: access } = useQuery({ queryKey: ['access-requests'], queryFn: getAccessRequests })
  const myRequests = useMemo(() => {
    const byProject = new Map<string, AccessRequest>()
    // Список отсортирован свежими вперёд — первая запись по проекту и есть последняя.
    ;(access?.outgoing ?? []).forEach((r) => {
      if (!byProject.has(String(r.project_id))) byProject.set(String(r.project_id), r)
    })
    return byProject
  }, [access])

  const typeLabel = (ty: MyItemType) => t(`myWork.types.${ty}`, { defaultValue: ty })
  const statusLabel = (it: MyItem) => {
    if (!it.status) return null
    const ns = STATUS_NS[it.type]
    return ns ? t(`${ns}.${it.status}`, { defaultValue: it.status }) : it.status
  }
  const toggleType = (ty: MyItemType) =>
    setHidden((prev) => { const n = new Set(prev); n.has(ty) ? n.delete(ty) : n.add(ty); return n })
  const toggleGroup = (pid: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n })

  // Типы, реально присутствующие в данных (стабильно, без учёта фильтров) — для тумблеров
  const presentTypes = useMemo(() => {
    const s = new Set<MyItemType>()
    groups.forEach((g) => g.items.forEach((it) => s.add(it.type)))
    return TYPE_ORDER.filter((ty) => s.has(ty))
  }, [groups])

  const filteredGroups = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return groups
      .filter((g) => projScope === 'all' || g.project_active)
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (hidden.has(it.type)) return false
          if (itemScope === 'open' && it.closed) return false
          if (itemScope === 'closed' && !it.closed) return false
          if (ql && !((it.title ?? '').toLowerCase().includes(ql) || (it.subtitle ?? '').toLowerCase().includes(ql))) return false
          return true
        }),
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, q, itemScope, projScope, hidden])

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0)
  const shownItems = filteredGroups.reduce((n, g) => n + g.items.length, 0)

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('nav.myWork', { defaultValue: 'My work' })}
        title={t('myWork.title', { defaultValue: 'My tasks' })}
      />

      <FilterBar>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('common.search', { defaultValue: 'Search…' })}
          className={selectCls}
        />
        <Segmented
          value={itemScope}
          onChange={setItemScope}
          options={[
            { value: 'open', label: t('myWork.scope.open', { defaultValue: 'Актуальные' }) },
            { value: 'closed', label: t('myWork.scope.closed', { defaultValue: 'Завершённые' }) },
            { value: 'all', label: t('myWork.scope.all', { defaultValue: 'Все' }) },
          ]}
        />
        <Segmented
          value={projScope}
          onChange={setProjScope}
          options={[
            { value: 'active', label: t('myWork.proj.active', { defaultValue: 'Активные проекты' }) },
            { value: 'all', label: t('myWork.proj.all', { defaultValue: 'Все проекты' }) },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => setCollapsed(new Set())}>{t('myWork.expandAll', { defaultValue: 'Развернуть всё' })}</Button>
          <Button variant="ghost" onClick={() => setCollapsed(new Set(filteredGroups.map((g) => g.project_id)))}>{t('myWork.collapseAll', { defaultValue: 'Свернуть всё' })}</Button>
          <span className="text-sm text-slate-600 dark:text-slate-400">{shownItems} / {totalItems}</span>
        </div>
      </FilterBar>

      {presentTypes.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-2">
          {presentTypes.map((ty) => {
            const Icon = TYPE_ICON[ty]
            const on = !hidden.has(ty)
            return (
              <button
                key={ty}
                type="button"
                onClick={() => toggleType(ty)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on ? `${TYPE_STYLE[ty]} border-transparent` : 'border-slate-300 text-slate-400 line-through dark:border-slate-600 dark:text-slate-500'
                }`}
              >
                <Icon size={13} />{typeLabel(ty)}
              </button>
            )
          })}
        </div>
      )}

      {isLoading ? (
        <Surface className="p-4">
          <SkeletonRows rows={6} rowClassName="h-10" />
        </Surface>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle size={28} className="text-rose-500" />}
          title={t('fix.loadErrorTasks', { defaultValue: 'Не удалось загрузить задачи. Проверьте соединение.' })}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              {t('fix.retry', { defaultValue: 'Обновить' })}
            </Button>
          }
        />
      ) : filteredGroups.length === 0 ? (
        totalItems === 0 ? (
          <EmptyState
            title={t('myWork.title', { defaultValue: 'My tasks' })}
            description={t('adopt.myWorkEmpty', { defaultValue: 'Здесь соберутся ваши задачи из всех проектов. Добавьте задачи в план работ.' })}
          />
        ) : (
          <EmptyState title={t('myWork.empty', { defaultValue: 'No tasks match your filters.' })} description="" />
        )
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((g) => {
            const isCollapsed = collapsed.has(g.project_id)
            return (
              <Surface key={g.project_id} className="overflow-hidden p-0">
                {/* Подсветка — на ВСЕЙ строке, а не только на кнопке сворачивания: иначе при
                    наведении половина шапки (имя РП и кнопка) оставалась неподсвеченной, и
                    строка визуально разваливалась надвое. */}
                <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.project_id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left"
                  >
                    {isCollapsed ? <ChevronRight size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
                    {/* Колонка кода фиксирована и ОБРЕЗАЕТСЯ. Раньше стояло min-w: длинный код
                        (PRJ-VERY-LONG-CODE) раздвигал её, и названия соседних проектов начинались
                        с разного места — список читался лесенкой. */}
                    <span title={g.project_code}
                      className="w-32 shrink-0 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                      {g.project_code}
                    </span>
                    <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{g.project_name}</span>
                    {/* Имя РП — сразу за названием, а не у правого края: это ответ на вопрос
                        «чей это проект», и читается он вместе с названием. */}
                    {g.pm_name ? (
                      <span className="hidden shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:inline">
                        · {t('myWork.pm', { defaultValue: 'РП' })} {g.pm_name}
                      </span>
                    ) : null}
                    {!g.project_active && (
                      <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                        {t('myWork.inactive', { defaultValue: 'неактивен' })}
                      </span>
                    )}
                    {/* ml-auto: счётчик у всех строк в одной точке, а не следом за названием. */}
                    <span className="ml-auto shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">{g.items.length}</span>
                  </button>
                  {/* Колонка действия фиксированной ширины — кнопки выстраиваются в столбик. */}
                  <span className="mr-2 flex w-44 shrink-0 justify-end">
                    {g.can_open ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/projects/${g.project_id}`)}
                        title={t('myWork.openProject', { defaultValue: 'Открыть проект' })}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                      >
                        <FolderOpen size={16} />
                      </button>
                    ) : (
                      <AccessAction group={g} request={myRequests.get(g.project_id)} onAsk={() => setAsking(g)} />
                    )}
                  </span>
                </div>
                {!isCollapsed && (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {g.items.map((it) => {
                      const Icon = TYPE_ICON[it.type]
                      const clickable = g.can_open
                      return (
                        <li
                          key={`${it.type}-${it.id}`}
                          onClick={clickable ? () => navigate(`/projects/${g.project_id}/${it.section}`) : undefined}
                          className={`flex items-center gap-3 px-4 py-2.5 ${clickable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'cursor-default'}`}
                        >
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TYPE_STYLE[it.type]}`} title={typeLabel(it.type)}>
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm ${it.closed ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>{it.title || '—'}</span>
                            {/* Тип элемента СЛОВОМ, а не только цветным значком. У стейкхолдера
                                заголовок — собственное имя человека, и без подписи строка читалась
                                как «я» и картинка: что это за пункт, понять было нельзя. */}
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                              {typeLabel(it.type)}{it.subtitle ? ' \u00b7 ' + it.subtitle : ''}
                            </span>
                          </span>
                          {it.status ? (
                            <StatusBadge status={it.status}>{statusLabel(it)}</StatusBadge>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Surface>
            )
          })}
        </div>
      )}

      {asking && (
        <RequestAccessDialog
          projectId={asking.project_id}
          projectCode={asking.project_code}
          projectName={asking.project_name}
          pmName={asking.pm_name}
          onClose={() => setAsking(null)}
        />
      )}
    </PageShell>
  )
}
