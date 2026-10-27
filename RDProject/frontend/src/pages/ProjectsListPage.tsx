import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderOpen, FileUp, Trash2, LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/utils/date'
import { deleteProject, getProjects } from '@/api/projects'
import { getUsers } from '@/api/users'
import { STATUS_OPTIONS, PRIORITY_OPTIONS, PROJECT_KIND_OPTIONS } from '@/constants/project'
import type { ProjectFilters } from '@/api/projects'
import { parseExcelFile, type ParsedProject } from '@/utils/excelImport'
import ExcelImportModal from '@/components/ExcelImportModal'
import { useConfirmStore } from '@/store/confirmStore'
import { useAuthStore } from '@/store/authStore'
import { PageHeader, PageShell, FilterBar } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Pill, PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui/badges'
import { Surface } from '@/components/ui/surface'
import { canCreateProject } from '@/lib/roles'
import { orderAsTree } from '@/utils/projectTree'
import { projectRoleLabelKey, projectRoleOf } from '@/lib/projectRole'

const selectCls = 'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 shadow-sm outline-none transition-colors focus:border-slate-500'

function KindBadge({ kind }: { kind?: string | null }) {
  const { t } = useTranslation()
  if (!kind) return null
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
      {t(`project.kind.${kind}`, { defaultValue: kind })}
    </span>
  )
}


export default function ProjectsListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const currentUser = useAuthStore((state) => state.user)
  const showConfirm = useConfirmStore((state) => state.show)
  const [filters, setFilters] = useState<ProjectFilters>({ page: 1, per_page: 50 })
  const [importData, setImportData] = useState<ParsedProject | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'card' | 'row'>(
    () => (localStorage.getItem('pm-projects-view') === 'row' ? 'row' : 'card')
  )
  const setView = (m: 'card' | 'row') => { setViewMode(m); localStorage.setItem('pm-projects-view', m) }
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportError(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const parsed = await parseExcelFile(ev.target!.result as ArrayBuffer, file.name)
        setImportData(parsed)
      } catch {
        setImportError(t('import.parseError'))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects', filters],
    queryFn: () => getProjects(filters),
  })

  // Сортировка списочного вида по колонкам (клиентская, по текущей странице) — тот же паттерн,
  // что в портфеле (PortfolioCards → ProjectTable). Бэкенд-параметра сортировки нет; проектов немного,
  // страница одна (per_page 50) — клиентской достаточно.
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })
  // Со-РП (CoPM) в паспорте/списке хранятся как id пользователей — резолвим в имена по справочнику.
  // Возвращаем СПИСОК (их может быть несколько) — показываем в столбик, а не через запятую.
  const coPmList = (p: NonNullable<typeof data>['data'][number]): string[] =>
    (p.editors ?? []).map((id) => usersData?.find((u) => u.id === id)?.full_name ?? id)
  // Наблюдатели — та же форма хранения, что у со-РП (список id), но другие права.
  const observerList = (p: NonNullable<typeof data>['data'][number]): string[] =>
    (p.observers ?? []).map((id) => usersData?.find((u) => u.id === id)?.full_name ?? id)
  const roleLabel = (p: NonNullable<typeof data>['data'][number]): string => {
    const key = projectRoleLabelKey(projectRoleOf(currentUser, p))
    return key ? t(key) : ''
  }
  const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

  const [rowSort, setRowSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'code', dir: 'asc' })
  const rowCols: { key: string; label: string; num?: boolean; get: (p: NonNullable<typeof data>['data'][number]) => string | number }[] = [
    { key: 'code', label: t('project.fields.code'), get: (p) => p.code ?? '' },
    { key: 'name', label: t('project.fields.name'), get: (p) => p.name ?? '' },
    { key: 'status', label: t('common.status'), get: (p) => p.status ?? '' },
    { key: 'priority', label: t('project.fields.priority', { defaultValue: 'Приоритет' }), num: true, get: (p) => PRIORITY_RANK[p.priority] ?? 0 },
    { key: 'project_kind', label: t('project.fields.kind', { defaultValue: 'Вид' }), get: (p) => p.project_kind ?? '' },
    { key: 'pm_name', label: t('portfolio.pmPrefix'), get: (p) => p.pm_name ?? '' },
    { key: 'copm', label: t('project.fields.coPm', { defaultValue: 'Со-РП' }), get: (p) => coPmList(p).join(', ') },
    { key: 'observers', label: t('project.observers', { defaultValue: 'Наблюдатели' }), get: (p) => observerList(p).join(', ') },
    // «Моя роль» отвечает на вопрос, который возник вместе с деревом: почему я вообще вижу этот
    // проект. Без неё унаследованный доступ выглядел бы как необъяснимо чужая строка в списке.
    { key: 'myrole', label: t('project.myRole', { defaultValue: 'Моя роль' }), get: (p) => roleLabel(p) },
    { key: 'progress', label: t('portfolio.progress', { defaultValue: 'Прогресс' }), num: true, get: (p) => p.progress ?? 0 },
    { key: 'planned_end', label: t('project.fields.plannedEnd'), get: (p) => p.planned_end ?? '' },
  ]
  const sortedRows = useMemo(() => {
    const rows = data?.data ?? []
    const col = rowCols.find((c) => c.key === rowSort.key) ?? rowCols[0]
    const cmp = (a: typeof rows[number], b: typeof rows[number]) => {
      const av = col.get(a); const bv = col.get(b)
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return rowSort.dir === 'asc' ? c : -c
    }
    // Подпроекты идут под своим зонтиком, а не по общей сортировке: иначе модули «Внедрения ERP»
    // рассыпались бы по всему списку. Внутри уровня порядок слушается выбранной колонки.
    // Тот же хелпер использует портфель — правило дерева живёт в одном месте.
    return orderAsTree(rows, cmp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rowSort])
  const onRowSort = (key: string) =>
    setRowSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const setFilter = (key: keyof ProjectFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined, page: 1 }))
  }

  const handleDeleteProject = (projectId: string, projectName: string, subprojects = 0) => {
    // Удаление зонтика НЕ уносит подпроекты: связь снимается (ON DELETE SET NULL), проекты
    // остаются. Сказать это заранее важнее, чем потом объяснять — «удалить программу»
    // звучит так, будто вместе с ней исчезнут и все её модули.
    const text = subprojects > 0
      ? t('project.deleteConfirmUmbrella', {
          defaultValue: 'Удалить проект «{{name}}»? Это действие необратимо. Его подпроекты ({{n}}) НЕ удалятся — они станут самостоятельными.',
          name: projectName, n: subprojects,
        })
      : t('project.deleteConfirm', { defaultValue: `Delete project "${projectName}"? This cannot be undone.` }).replace('%s', projectName)
    showConfirm(text, async () => {
      // Удаление в OpenProject медленное (5–10с). Убираем карточку из кэша сразу (оптимистично),
      // с откатом при ошибке — иначе проект «висит» до завершения долгого DELETE.
      const snapshot = queryClient.getQueriesData({ queryKey: ['projects'] })
      queryClient.setQueriesData({ queryKey: ['projects'] }, (old: unknown) => {
        const o = old as { data?: { id: string }[]; total?: number } | undefined
        if (!o?.data) return old
        return { ...o, data: o.data.filter((p) => p.id !== projectId), total: Math.max(0, (o.total ?? o.data.length) - 1) }
      })
      try {
        await deleteProject(projectId)
        void queryClient.invalidateQueries({ queryKey: ['portfolio'] })
        // НЕ инвалидируем ['projects'] сразу: удаление в OpenProject ОТЛОЖЕННОЕ (204, но строка
        // ещё 5–10с «жива») — немедленный рефетч вернул бы удалённую карточку назад (её и видел
        // пользователь: пропадала и появлялась, убиралась только по refresh). Оптимистичного
        // снятия достаточно; список сверится при следующем естественном рефетче.
      } catch {
        snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data))  // откат при ошибке
        void queryClient.invalidateQueries({ queryKey: ['projects'] })  // вернуть истинное состояние
      }
    })
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('nav.projects')}
        title={t('project.list.title')}
        description={data
          ? t('project.list.summary', { count: data.total })
          : t('project.list.loading')}
        actions={
          <>
            {canCreateProject(currentUser) && (
              <>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                <Button icon={<FileUp size={16} />} variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {t('import.button')}
                </Button>
                <Button icon={<Plus size={16} />} onClick={() => navigate('/projects/new')}>
                  {t('project.list.newProject')}
                </Button>
              </>
            )}
          </>
        }
      />

      <FilterBar>
        <select aria-label={t('project.list.filterStatus')} className={selectCls} value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">{t('project.list.filterStatus')}</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(`project.status.${o.value}`)}</option>
          ))}
        </select>
        <select aria-label={t('project.list.filterPriority')} className={selectCls} value={filters.priority ?? ''} onChange={(e) => setFilter('priority', e.target.value)}>
          <option value="">{t('project.list.filterPriority')}</option>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(`project.priority.${o.value}`)}</option>
          ))}
        </select>
        <select aria-label={t('project.list.filterKind', { defaultValue: 'Все виды' })} className={selectCls} value={filters.project_kind ?? ''} onChange={(e) => setFilter('project_kind', e.target.value)}>
          <option value="">{t('project.list.filterKind', { defaultValue: 'Все виды' })}</option>
          {PROJECT_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>{t(`project.kind.${k}`)}</option>
          ))}
        </select>
        <select aria-label={t('project.list.filterPm')} className={selectCls} value={filters.pm_id ?? ''} onChange={(e) => setFilter('pm_id', e.target.value)}>
          <option value="">{t('project.list.filterPm')}</option>
          {usersData?.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
          <button type="button" onClick={() => setView('card')} aria-label={t('project.list.viewCards', { defaultValue: 'Карточки' })}
            className={`inline-flex h-9 w-9 items-center justify-center ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300'}`}>
            <LayoutGrid size={16} />
          </button>
          <button type="button" onClick={() => setView('row')} aria-label={t('project.list.viewRows', { defaultValue: 'Список' })}
            className={`inline-flex h-9 w-9 items-center justify-center ${viewMode === 'row' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300'}`}>
            <List size={16} />
          </button>
        </div>
      </FilterBar>

      {isLoading && (
        <Surface className="flex min-h-48 items-center justify-center p-8 text-sm text-slate-600 dark:text-slate-400">
          {t('project.list.loading')}
        </Surface>
      )}
      {isError && (
        <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {t('common.error')}
        </Surface>
      )}

      {data && data.data.length === 0 && (
        <EmptyState
          icon={<FolderOpen size={28} />}
          title={t('project.list.noProjects')}
          description={t('project.list.emptyStateDescription')}
          action={canCreateProject(currentUser) ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button icon={<Plus size={16} />} onClick={() => navigate('/projects/new')}>
                  {t('project.list.newProject')}
                </Button>
                <Button icon={<FileUp size={16} />} variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {t('adopt.importExcel', { defaultValue: 'Импортировать из Excel' })}
                </Button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t('adopt.importHint', { defaultValue: 'Ваш существующий Excel-шаблон (паспорт, WBS, риски…) затянется за один клик.' })}
              </p>
            </div>
          ) : undefined}
        />
      )}

      {importError && (
        <Surface className="border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{importError}</Surface>
      )}

      {data && data.data.length > 0 && viewMode === 'card' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.data.map((project) => (
            <Surface
              key={project.id}
              className="group cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              onClick={() => navigate(`/projects/${project.id}/passport`)}
              variant="accent"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-mono uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">{project.code}</span>
                  <h3 className="mt-1 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">{project.name}</h3>
                </div>
                <PriorityBadge priority={project.priority}>
                  {t(`project.priority.${project.priority}`)}
                </PriorityBadge>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <StatusBadge status={project.status}>
                  {t(`project.status.${project.status}`)}
                </StatusBadge>
                <KindBadge kind={project.project_kind} />
                {canCreateProject(currentUser) && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDeleteProject(project.id, project.name, project.subprojects_count ?? 0)
                    }}
                    className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 dark:border-rose-700 bg-white dark:bg-slate-900 text-rose-500 dark:text-rose-400 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 hover:text-rose-600"
                    aria-label={t('project.delete')}
                    title={t('project.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                {project.pm_name && (
                  <p>{t('portfolio.pmPrefix') + ':'} <span className="font-medium text-slate-700 dark:text-slate-200">{project.pm_name}</span></p>
                )}
                {coPmList(project).length > 0 && (
                  <div>
                    <span>{t('project.fields.coPm', { defaultValue: 'Со-РП' }) + ':'}</span>
                    {coPmList(project).map((n, i) => (
                      <span key={i} className="block pl-1 font-medium text-slate-700 dark:text-slate-200">{n}</span>
                    ))}
                  </div>
                )}
                {observerList(project).length > 0 && (
                  <div>
                    <span>{t('project.observers', { defaultValue: 'Наблюдатели' }) + ':'}</span>
                    {observerList(project).map((n, i) => (
                      <span key={i} className="block pl-1 font-medium text-slate-700 dark:text-slate-200">{n}</span>
                    ))}
                  </div>
                )}
                {/* Роль — ответ на вопрос, который появился вместе с деревом: почему я вижу
                    этот проект. В карточках он нужен не меньше, чем в таблице: список по
                    умолчанию открывается именно карточками. */}
                {roleLabel(project) && (
                  <p>{t('project.myRole', { defaultValue: 'Моя роль' }) + ':'} <span className="font-medium text-slate-700 dark:text-slate-200">{roleLabel(project)}</span></p>
                )}
                {project.parent_code && (
                  <p>{t('project.partOf', { defaultValue: 'Часть проекта' }) + ':'} <span className="text-slate-700 dark:text-slate-200">{project.parent_code} {project.parent_name}</span></p>
                )}
                {project.planned_end && (
                  <p>{t('project.fields.plannedEnd') + ':'} <span className="text-slate-700 dark:text-slate-200">{formatDate(project.planned_end)}</span></p>
                )}
                <ProgressBar value={project.progress ?? 0} />
              </div>
            </Surface>
          ))}
        </div>
      )}

      {data && data.data.length > 0 && viewMode === 'row' && (
        <Surface className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {rowCols.map((c) => (
                  <th key={c.key} onClick={() => onRowSort(c.key)}
                    className={`px-4 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-slate-700 dark:hover:text-slate-100 ${c.key === 'progress' ? 'w-40' : ''}`}>
                    {c.label}{rowSort.key === c.key ? (rowSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((project) => (
                <tr key={project.id}
                  className="group cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  onClick={() => navigate(`/projects/${project.id}/passport`)}>
                  <td className="px-4 py-2 font-mono text-xs uppercase text-slate-600 dark:text-slate-400 whitespace-nowrap">{project.code}</td>
                  <td className={`px-4 py-2 font-medium text-slate-800 dark:text-slate-100 ${project.depth ? 'pl-10' : ''}`}>
                    {project.depth ? <span className="mr-1 text-slate-400 dark:text-slate-500" aria-hidden="true">↳</span> : null}
                    {project.name}
                    {(project.subprojects_count ?? 0) > 0 && (
                      <Pill className="ml-2 align-middle">
                        {t('project.umbrellaPill', { defaultValue: 'Зонтик · {{n}}', n: project.subprojects_count })}
                      </Pill>
                    )}
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={project.status}>{t(`project.status.${project.status}`)}</StatusBadge></td>
                  <td className="px-4 py-2"><PriorityBadge priority={project.priority}>{t(`project.priority.${project.priority}`)}</PriorityBadge></td>
                  <td className="px-4 py-2"><KindBadge kind={project.project_kind} /></td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{project.pm_name ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {coPmList(project).length
                      ? coPmList(project).map((n, i) => <div key={i} className="whitespace-nowrap">{n}</div>)
                      : '—'}
                  </td>
                  {/* Порядок ячеек обязан совпадать с rowCols — заголовок строится из него. */}
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {observerList(project).length
                      ? observerList(project).map((n, i) => <div key={i} className="whitespace-nowrap">{n}</div>)
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{roleLabel(project) || '—'}</td>
                  <td className="px-4 py-2"><ProgressBar value={project.progress ?? 0} /></td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{project.planned_end ? formatDate(project.planned_end) : '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {canCreateProject(currentUser) && (
                      <button type="button"
                        onClick={(event) => { event.stopPropagation(); handleDeleteProject(project.id, project.name, project.subprojects_count ?? 0) }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-rose-500 dark:text-rose-400 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 hover:text-rose-600"
                        aria-label={t('project.delete')} title={t('project.delete')}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}
      {importData && (
        <ExcelImportModal data={importData} onClose={() => setImportData(null)} />
      )}
    </PageShell>
  )
}
