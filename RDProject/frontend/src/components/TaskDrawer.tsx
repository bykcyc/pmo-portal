import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Save, ExternalLink, Plus, Link2 } from 'lucide-react'
import type { Task } from '@/types/task'
import DateInput from '@/components/ui/DateInput'
import { getGanttData, createDependency, deleteDependency } from '@/api/gantt'
import { useCanWrite } from '@/contexts/ProjectPermission'
import PersonPicker from '@/components/PersonPicker'
import ActivityPanel from '@/components/ActivityPanel'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import RichTextEditor from '@/components/ui/RichTextEditor'

const BITRIX_DOMAIN = 'bitrix.example.com'
const TITLE_ID = 'task-drawer-title'

interface Props {
  task: Task | null
  onClose: () => void
  onSave: (id: string, data: Partial<Task>) => Promise<void>
  projectId?: string
}

const STATUS_OPTIONS = ['not_started', 'in_progress', 'completed', 'cancelled', 'on_hold']
const TYPE_OPTIONS = ['phase', 'task']  // веху убрали — только фаза и задача
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low']

export default function TaskDrawer({ task, onClose, onSave, projectId }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState<Partial<Task>>({})
  const [saving, setSaving] = useState(false)
  /** Сервер отказал в записи: карточка остаётся открытой с целыми правками, а второе нажатие
   *  на закрытие выпускает без сохранения — иначе выхода из неё нет вовсе. */
  const [saveFailed, setSaveFailed] = useState(false)
  const [tab, setTab] = useState<'details' | 'description' | 'files' | 'history'>('details')
  // Право писать читаем и здесь: раньше его спрашивал только блок зависимостей ниже.
  const canWrite = useCanWrite()
  const pid = projectId ?? task?.project_id
  const dialogRef = useRef<HTMLDivElement>(null)
  /** Что человек тронул. Наружу уходят ТОЛЬКО эти поля — приём взят у карточки пункта бэклога.
   *  Снимок целиком отправлять нельзя: карточку держат открытой минутами, а `status`,
   *  `actual_start` и исполнителя за это время пишет ещё и синхронизация Bitrix24. Раз закрытие
   *  теперь сохраняет, полный снимок откатывал бы чужие правки просто по факту закрытия. */
  const dirty = useRef<Set<keyof Task>>(new Set())

  useEffect(() => {
    if (task) { setForm({ ...task }); dirty.current = new Set() }
  }, [task])

  // Модалка: закрытие по Escape. Через ref — requestClose пересоздаётся каждый рендер.
  const closeRef = useRef<() => void>(onClose)
  useEffect(() => {
    if (!task) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [task])

  useFocusTrap(dialogRef, !!task)

  if (!task) return null

  const set = (key: keyof Task, val: string | number | null) => {
    dirty.current.add(key)
    setForm((f) => ({ ...f, [key]: val }))
  }

  const save = async () => {
    const patch: Partial<Task> = {}
    for (const k of dirty.current) (patch as Record<string, unknown>)[k] = form[k] ?? null
    // Пустое название сервер заменяет на «Новая задача» — то есть закрытие карточки молча
    // переименовало бы задачу тому, кто стёр заголовок и передумал. Название оставляем прежним,
    // остальные правки уносим (так же поступает карточка пункта бэклога).
    if (!String(form.title ?? '').trim()) delete patch.title
    if (!Object.keys(patch).length) return
    setSaving(true)
    try {
      await onSave(task.id, patch)
      // Снимаем только отправленное: пока шёл запрос, могли поправить ещё одно поле.
      for (const k of Object.keys(patch)) dirty.current.delete(k as keyof Task)
      setSaveFailed(false)
    } catch (e) {
      setSaveFailed(true)
      throw e
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => { await save().catch(() => {}) }

  /** Закрыть — значит сохранить: подложка, Escape и крестик раньше просто выбрасывали карточку
   *  вместе с набранным описанием. Описание здесь правят минутами, а уходило оно на сервер
   *  только по кнопке. */
  const requestClose = async () => {
    // Второе нажатие после отказа сервера выпускает без записи: иначе пропавшая связь
    // превращает карточку в ловушку — не работает ни один из трёх выходов.
    if (saveFailed) { onClose(); return }
    if (!canWrite || !dirty.current.size) { onClose(); return }
    try {
      await save()
      onClose()
    } catch {
      // Сервер не принял — карточку НЕ закрываем: набранное на экране цело, можно повторить.
    }
  }
  closeRef.current = requestClose

  // Подсказка часов из дат: раб. дни (пн–пт) × 8ч. Показывается плейсхолдером,
  // пока поле пустое; «Факт, ч» бэкенд заполняет сам при завершении задачи.
  const workdays = (s?: string | null, e?: string | null): number => {
    if (!s || !e) return 0
    const sd = new Date(`${String(s).slice(0, 10)}T00:00:00`)
    const ed = new Date(`${String(e).slice(0, 10)}T00:00:00`)
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime()) || ed < sd) return 0
    let n = 0
    for (const d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay()
      if (wd !== 0 && wd !== 6) n += 1
    }
    return n
  }
  /** Длительность в календарных днях, включая обе границы — так же, как в плане работ. */
  const calendarDays = (st?: string | null, en?: string | null): number | null => {
    if (!st || !en) return null
    const sd = new Date(`${String(st).slice(0, 10)}T00:00:00`)
    const ed = new Date(`${String(en).slice(0, 10)}T00:00:00`)
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime()) || ed < sd) return null
    return Math.round((ed.getTime() - sd.getTime()) / 86_400_000) + 1
  }
  const daysHint = calendarDays(form.planned_start, form.planned_end)

  const plannedHoursHint = workdays(form.planned_start, form.planned_end) * 8 || null
  const actualHoursHint = workdays(form.actual_start, form.actual_end) * 8 || null

  const inp = 'w-full text-sm border border-gray-300 dark:border-slate-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500'
  const sel = inp

  // Описание — своя вкладка: в «Деталях» оно стояло предпоследним полем на четыре строки,
  // и длинный текст приходилось читать в щёлочку, прокручивая всю форму.
  const tabs: Array<{ id: 'details' | 'description' | 'files' | 'history'; label: string }> = [
    { id: 'details', label: t('taskDrawer.tabDetails', { defaultValue: 'Детали' }) },
    { id: 'description', label: t('taskDrawer.tabDescription', { defaultValue: 'Описание' }) },
    { id: 'files', label: t('taskDrawer.tabFiles', { defaultValue: 'Вложения' }) },
    { id: 'history', label: t('taskDrawer.tabHistory', { defaultValue: 'История' }) },
  ]

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // mousedown, а не click, — как в остальных двух десятках диалогов портала. С `click`
      // карточка закрывалась, когда текст описания выделяли мышью и отпускали кнопку за краем
      // панели: браузер отдаёт click общему предку, то есть подложке.
      onMouseDown={requestClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
    >
    <div
      // 672 px было тесно: поля в один столбец, и половина формы уходила за нижний край.
      // 1024 px + две колонки вмещают форму целиком на ноутбучном экране.
      className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-4 py-3">
        <div>
          <span className="text-xs text-gray-400">{task.wbs_code ?? '—'}</span>
          <p id={TITLE_ID} className="truncate text-sm font-semibold text-gray-800 dark:text-slate-200">{task.title}</p>
        </div>
        <button onClick={requestClose} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
          <X size={18} />
        </button>
      </div>

      <div className="flex border-b border-gray-200 dark:border-slate-700 px-2">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === tb.id
                ? 'border-b-2 border-blue-600 text-blue-700'
                : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {tab === 'details' && (
        // Две колонки на широком экране: в один столбец форма уходила за нижний край, и
        // «Сохранить» приходилось искать прокруткой. Поля, которым нужна вся ширина
        // (название, исполнитель, зависимости, Bitrix), занимают обе колонки.
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-5">
        <div className="lg:col-span-2">
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-title">{t('taskDrawer.title')}</label>
          <input id="task-title" className={inp} value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-type">{t('common.type')}</label>
            <select id="task-type" className={sel} value={form.task_type ?? 'task'} onChange={(e) => set('task_type', e.target.value)}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(`wbs.types.${o}`, { defaultValue: o })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-status">{t('common.status')}</label>
            <select id="task-status" className={sel} value={form.status ?? 'not_started'} onChange={(e) => set('status', e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(`wbs.statuses.${o}`, { defaultValue: o })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-priority">{t('project.fields.priority')}</label>
            <select id="task-priority" className={sel} value={form.priority ?? 'medium'} onChange={(e) => set('priority', e.target.value)}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(`project.priority.${o}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-progress">{t('taskDrawer.progress')}</label>
            <input
              id="task-progress"
              type="number"
              className={inp}
              min={0}
              max={100}
              value={form.progress ?? 0}
              onChange={(e) => set('progress', parseInt(e.target.value, 10) || 0)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Даты — общим полем портала, а не голым input с parseDate: тот отдавал наружу
              недобранный текст как есть («15.0»), и в форме оказывался мусор. Пока закрытие
              ничего не писало, он просто выбрасывался; теперь он уехал бы на сервер — плановые
              даты ответили бы 500, а фактические (колонки TEXT) молча приняли бы «15.0».
              DateInput отдаёт ТОЛЬКО полную дату или явную очистку. */}
          {([
            ['planned_start', 'project.fields.plannedStart'],
            ['planned_end', 'project.fields.plannedEnd'],
            ['actual_start', 'project.fields.actualStart'],
            ['actual_end', 'project.fields.actualEnd'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <span className="text-xs font-medium text-gray-600 dark:text-slate-300">{t(label)}</span>
              <DateInput
                value={(form[key] as string) ?? ''}
                className={inp}
                ariaLabel={t(label)}
                onChange={(iso) => set(key, iso || null)}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* Дни спрашивают чаще, чем часы: «сколько это займёт» люди считают днями.
              Пусто — берём из дат (обе границы включительно), как в плане работ. */}
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-duration-days">{t('taskDrawer.durationDays', { defaultValue: 'Длительность, дней' })}</label>
            <input
              id="task-duration-days"
              type="number"
              min={0}
              step="1"
              className={inp}
              value={form.duration_days ?? ''}
              placeholder={daysHint ? String(daysHint) : undefined}
              title={t('taskDrawer.durationHint', { defaultValue: 'Считается из плановых дат (обе границы включительно). Можно задать своё значение.' })}
              onChange={(e) => set('duration_days', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-estimated-hours">{t('taskDrawer.estimatedHours', { defaultValue: 'Оценка, ч' })}</label>
            <input
              id="task-estimated-hours"
              type="number"
              min={0}
              step="0.5"
              className={inp}
              value={form.estimated_hours ?? ''}
              placeholder={plannedHoursHint ? `≈ ${plannedHoursHint}` : undefined}
              title={plannedHoursHint ? t('taskDrawer.hoursHint', { defaultValue: 'Подсказка из дат: раб. дни × 8ч. Введите своё значение при необходимости.' }) : undefined}
              onChange={(e) => set('estimated_hours', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-actual-hours">{t('taskDrawer.actualHours', { defaultValue: 'Факт, ч' })}</label>
            <input
              id="task-actual-hours"
              type="number"
              min={0}
              step="0.5"
              className={inp}
              value={form.actual_hours ?? ''}
              placeholder={actualHoursHint ? `≈ ${actualHoursHint}` : undefined}
              title={t('taskDrawer.actualHoursHint', { defaultValue: 'Заполнится само при завершении задачи (раб. дни × 8ч из факт-дат) — или введите своё значение.' })}
              onChange={(e) => set('actual_hours', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </div>

        {/* Раньше здесь были ДВА несвязанных поля: PersonPicker (имя) и сырой input (email), который
            никто не заполнял — из-за этого не работали ни письма исполнителю, ни ответственный в Bitrix.
            Теперь человек выбирается один раз, а email и идентичность приходят вместе с ним. */}
        <div className="lg:col-span-2">
          {/* Не <label htmlFor>: поле человека рисует свой input со своим id внутри, и снаружи
              до него не дотянуться — имя ему задаётся пропом, как в карточке бэклога. */}
          <span className="text-xs font-medium text-gray-600 dark:text-slate-300">{t('taskDrawer.assigneeName')}</span>
          <PersonPicker
            className={inp}
            ariaLabel={t('taskDrawer.assigneeName')}
            value={form.assignee_name ?? ''}
            onChange={(v) => set('assignee_name', v || null)}
            onPickPerson={(p) => {
              set('assignee_person_id', p?.id ?? null)
              set('assignee_email', p?.email ?? null)
            }}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {!form.assignee_name
              ? t('taskDrawer.assigneeHint')
              : form.assignee_person_id
                ? (form.assignee_email || t('taskDrawer.assigneeNoEmail'))
                : t('taskDrawer.assigneeFreeText')}
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="task-bar-color">{t('taskDrawer.barColor')}</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="task-bar-color"
              type="color"
              className="h-8 w-10 cursor-pointer rounded border border-gray-300 dark:border-slate-600 p-0.5"
              value={form.bar_color ?? '#3b82f6'}
              onChange={(e) => set('bar_color', e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'].map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => set('bar_color', c)}
                  className={`h-5 w-5 rounded-full border-2 ${form.bar_color === c ? 'border-gray-800' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                type="button"
                title={t('taskDrawer.resetBarColor')}
                onClick={() => set('bar_color', null)}
                className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-dashed border-gray-400 text-[9px] text-gray-400"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Зависимости (предшественники) */}
        {pid && task.task_type !== 'phase' && (
          <div className="lg:col-span-2"><DependenciesSection projectId={pid} taskId={task.id} /></div>
        )}

        {/* Bitrix-задача: номер + ссылка на открытие */}
        <div className="lg:col-span-2"><BitrixField task={task} /></div>
        </div>
        )}

        {tab === 'description' && (
          <RichTextEditor
            value={form.description ?? ''}
            onChange={(v) => set('description', v || null)}
            rows={16}
            disabled={!canWrite}
            docKey={task.id}
            ariaLabel={t('common.description')}
          />
        )}

        {tab === 'files' && task.project_id && <AttachmentsPanel projectId={task.project_id} wpId={task.id} />}
        {tab === 'history' && task.project_id && <ActivityPanel projectId={task.project_id} wpId={task.id} />}
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3">
        {saveFailed && (
          <p role="status" className="mb-2 text-xs text-red-600 dark:text-red-400">{t('taskDrawer.saveFailedClose')}</p>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary-fg hover:bg-btn-primary-hover disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? t('common.saving') : t('taskDrawer.saveChanges')}
        </button>
      </div>
    </div>
    </div>
  )
}

// Bitrix-задача: показываем номер и ссылку «открыть» (создание/привязка — в строке WBS).
function BitrixField({ task }: { task: Task }) {
  const { t } = useTranslation()
  const bid = task.bitrix24_task_id
  return (
    <div>
      {/* Не <label>: под подписью не поле, а ссылка или строка текста. */}
      <span className="text-xs font-medium text-gray-600 dark:text-slate-300">{t('bitrix24Task.column', { defaultValue: 'Bitrix24' })}</span>
      {bid ? (
        <a href={`https://${BITRIX_DOMAIN}/company/personal/user/0/tasks/task/view/${bid}/`} target="_blank" rel="noopener noreferrer"
          className="mt-1 flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <ExternalLink size={14} /> {t('bitrix24Task.open', { defaultValue: 'Открыть задачу' })} #{bid}
        </a>
      ) : (
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          {t('bitrix24Task.notSent', { defaultValue: 'Не отправлена в Bitrix (кнопка Bitrix24 в строке задачи)' })}
        </p>
      )}
    </div>
  )
}

// Предшественники задачи: просмотр + добавление/удаление (переиспользует gantt-data links).
function DependenciesSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const [addId, setAddId] = useState('')
  const { data } = useQuery({ queryKey: ['gantt', projectId], queryFn: () => getGanttData(projectId) })
  const tasks = data?.tasks ?? []
  const links = data?.links ?? []
  const byId = new Map(tasks.map((x) => [String(x.id), x]))
  const predLinks = links.filter((l) => String(l.target) === String(taskId))
  const predIds = new Set(predLinks.map((l) => String(l.source)))
  const candidates = tasks.filter((x) => String(x.id) !== String(taskId) && x.type !== 'project' && !predIds.has(String(x.id)))
  const refresh = () => {
    void invalidateProjectTasks(qc, projectId)
  }
  const add = async () => {
    if (!addId) return
    await createDependency(projectId, taskId, addId, 'finish_to_start')
    setAddId(''); refresh()
  }
  const remove = async (linkId: string) => { await deleteDependency(projectId, linkId); refresh() }
  const label = (id: string) => {
    const t2 = byId.get(String(id))
    return t2 ? `${t2.wbs ? t2.wbs + ' ' : ''}${t2.text}` : id
  }
  return (
    <div>
      {/* Не <label>: это заголовок всего раздела — списка предшественников и выбора ниже,
          а не подпись одного поля. Выбору имя задаётся своим aria-label. */}
      <span className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        <Link2 size={12} /> {t('taskDrawer.dependsOn', { defaultValue: 'Зависит от (предшественники)' })}
      </span>
      {predLinks.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{t('taskDrawer.noDeps', { defaultValue: 'Нет зависимостей' })}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {predLinks.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
              <span className="truncate">{label(l.source)}</span>
              {canWrite && (
                <button onClick={() => remove(l.id)} className="ml-auto text-gray-300 hover:text-red-500" aria-label={t('common.delete')}>
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && candidates.length > 0 && (
        <div className="mt-1.5 flex gap-1.5">
          <select value={addId} onChange={(e) => setAddId(e.target.value)}
            aria-label={t('taskDrawer.addDep', { defaultValue: 'Добавить предшественника…' })}
            className="flex-1 text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1">
            <option value="">{t('taskDrawer.addDep', { defaultValue: 'Добавить предшественника…' })}</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.wbs ? c.wbs + ' ' : ''}{c.text}</option>)}
          </select>
          <button onClick={add} disabled={!addId}
            className="inline-flex items-center gap-1 rounded bg-btn-primary px-2 py-1 text-xs text-btn-primary-fg hover:bg-btn-primary-hover disabled:opacity-50">
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
