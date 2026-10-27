import DateInput from '@/components/ui/DateInput'
import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ArrowUpRight, Check, X, Pencil } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { useTranslation } from 'react-i18next'
import { getBacklog, createBacklogItem, updateBacklogItem, deleteBacklogItem, promoteBacklogItem, createBacklogBitrix24Task, deleteBacklogBitrix24Task } from '@/api/meetings'
import { getProject } from '@/api/projects'
import type { BacklogItem } from '@/types/meeting'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { Surface } from '@/components/ui/surface'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyValueState } from '@/components/ui/empty-state'
import BitrixTaskDialog from '@/components/BitrixTaskDialog'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { useColumnSettings, type ColDef } from '@/hooks/useColumnSettings'
import { ColTh, ColumnToggler } from '@/components/ColTh'
import PersonPicker from '@/components/PersonPicker'
import ProcessGuide from '@/components/ProcessGuide'
import type { GuideDefinition, GuideStep } from '@/components/ProcessGuide'
import { useSectionExport } from '@/hooks/useSectionExport'
import { useTableColumnLimit } from '@/hooks/useTableColumnLimit'
import { invalidateProjectTasks } from '@/utils/projectTaskQueries'
import { formatDate, isWithinDateRange } from '@/utils/date'
import { PRIORITY_VALUES, STATUS_VALUES, recalcDates } from '@/utils/backlog'
import { stripRichText } from '@/utils/richText'
import BacklogDrawer, { type BacklogDrawerTab } from '@/components/BacklogDrawer'
import {
  getManagedTableStyle,
  TABLE_ACTION_CELL_CLASS,
  TABLE_ACTION_GROUP_CLASS,
  TABLE_ACTION_HEAD_CLASS,
  TABLE_BASE_CLASS,
  TABLE_ICON_BUTTON_CLASS,
  TABLE_CELL_TEXT_CLASS,
  TABLE_SCROLL_WRAP_CLASS,
} from '@/components/tableStyles'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-amber-950/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-rose-950/40 dark:text-rose-300',
}
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200',
  in_review: 'bg-yellow-100 text-yellow-700 dark:bg-amber-950/40 dark:text-amber-300',
  approved: 'bg-green-100 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-600 dark:bg-rose-950/40 dark:text-rose-300',
  promoted: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  planning: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
}

interface EditCell { id: string; field: string }

/**
 * Пара «с — по» для одного поля даты. Два поля, а не «период»: границы задают независимо.
 *
 * Обе даты живут в ОДНОЙ рамке с подписью — иначе четыре голых `input[type=date]` в ряд
 * читаются как четыре не связанных между собой контрола: где начало, где окончание и что с
 * чем в паре, по виду не понять.
 */
function DateRange({ label, from, to, onFrom, onTo }: {
  label: string
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  const on = Boolean(from || to)
  // Общее поле даты портала, а не голый `<input type="date">`: тот рисует маску по локали
  // БРАУЗЕРА, и у части РП фильтр показывал MM/DD/YYYY, пока соседняя форма — дд.мм.гггг.
  // Ровно эту жалобу закрывали в паспорте; здесь она оставалась.
  const inp = 'w-[7.5rem] bg-transparent px-1.5 py-1 text-xs text-gray-700 outline-none dark:text-slate-100'
  return (
    <span className={`inline-flex items-center rounded-md border ${on
      ? 'border-primary-400 bg-primary-50/40 dark:border-primary-500 dark:bg-primary-950/20'
      : 'border-gray-300 dark:border-slate-600'}`}>
      <span className="whitespace-nowrap pl-2.5 pr-1 text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <DateInput value={from} onChange={onFrom} className={inp} ariaLabel={`${label} — с`} />
      <span className="text-xs text-gray-400 dark:text-slate-500">–</span>
      <DateInput value={to} onChange={onTo} className={`${inp} pr-1.5`} ariaLabel={`${label} — по`} />
    </span>
  )
}

export default function BacklogTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const showConfirm = useConfirmStore(s => s.show)
  const showToast = useToastStore(s => s.show)
  const [filterStatus, setFilterStatus] = useState('')
  // Диапазоны по датам — отдельно по началу и по окончанию. Одного «периода» мало: «что
  // начинается в марте» и «что должно закончиться до апреля» — разные вопросы, и в плане
  // на квартал их задают оба.
  const [dates, setDates] = useState({ startFrom: '', startTo: '', endFrom: '', endTo: '' })
  const [promoting, setPromoting] = useState<string | null>(null)
  const [addRow, setAddRow] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, string>>({})
  const [bitrixItem, setBitrixItem] = useState<BacklogItem | null>(null)
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [editValue, setEditValue] = useState('')
  // Карточку держим по id, а объект берём из СВЕЖЕГО списка: так она не застывает после
  // обновления данных, а после эскалации или удаления (сервер убирает пункт) сама закрывается —
  // ни призрака на экране, ни 404 при следующем сохранении.
  const [cardId, setCardId] = useState<string | null>(null)
  const [cardTab, setCardTab] = useState<BacklogDrawerTab>('details')
  // Кого выбрали в справочнике прямо сейчас. PersonPicker зовёт onPickPerson и onSelect подряд;
  // без этой памяти оба вызова уходили на сервер, и второй затирал person_id — из-за чего
  // эскалация в план работ молча теряла исполнителя.
  const pickedRef = useRef<{ name: string; id: string } | null>(null)

  const STATUS_OPT = STATUS_VALUES.map(v => ({ value: v, label: t(`backlog.statuses.${v}`) }))

  const PRIORITY_OPT = [
    { value: 'low', label: t('project.priority.low') },
    { value: 'medium', label: t('project.priority.medium') },
    { value: 'high', label: t('project.priority.high') },
    { value: 'critical', label: t('project.priority.critical') },
  ]

  const COLS: ColDef[] = [
    { key: 'code', label: t('backlog.code', { defaultValue: 'Код' }), defaultWidth: 70 },
    { key: 'title', label: t('decisions.titleField'), defaultWidth: 180, required: true, hint: t('backlog.hints.titleField') },
    { key: 'description', label: t('common.description'), defaultWidth: 200, hint: t('backlog.hints.description') },
    { key: 'priority', label: t('backlog.priority'), defaultWidth: 80, hint: t('backlog.hints.priority') },
    { key: 'status', label: t('common.status'), defaultWidth: 90, hint: t('backlog.hints.status') },
    { key: 'planned_start', label: t('backlog.plannedStart', { defaultValue: 'Начало' }), defaultWidth: 110, hint: t('backlog.hints.plannedStart', { defaultValue: 'Планируемая дата начала. С «кол-вом дней» или «окончанием» второе поле считается само.' }) },
    { key: 'estimated_days', label: t('backlog.estimatedDays'), defaultWidth: 70, hint: t('backlog.hints.estimatedDays') },
    { key: 'planned_end', label: t('backlog.plannedEnd', { defaultValue: 'Окончание' }), defaultWidth: 110, hint: t('backlog.hints.plannedEnd', { defaultValue: 'Планируемая дата окончания. Пересчитывается из начала и кол-ва дней (и наоборот).' }) },
    { key: 'assignee', label: t('backlog.assignee', { defaultValue: 'Ответственный' }), defaultWidth: 120, hint: t('backlog.hints.assignee', { defaultValue: 'Исполнитель задачи. Переносится в Bitrix и при эскалации в План работ.' }) },
    { key: 'requested_by', label: t('backlog.requestedBy'), defaultWidth: 120, hint: t('backlog.hints.requestedBy') },
    { key: 'bitrix24_task_id', label: t('bitrix24Task.column'), defaultWidth: 80 },
  ]

  const guideSteps: GuideStep[] = [
    { title: t('backlog.guide.s1'), desc: t('backlog.guide.s1d') },
    { title: t('backlog.guide.s2'), desc: t('backlog.guide.s2d') },
    { title: t('backlog.guide.s3'), desc: t('backlog.guide.s3d') },
    { title: t('backlog.guide.s4'), desc: t('backlog.guide.s4d') },
    { title: t('backlog.guide.s5'), desc: t('backlog.guide.s5d') },
  ]
  const guideDefinitions: GuideDefinition[] = [
    { term: t('backlog.guideDefinitions.new'), desc: t('backlog.guideDefinitions.newDesc') },
    { term: t('backlog.guideDefinitions.inReview'), desc: t('backlog.guideDefinitions.inReviewDesc') },
    { term: t('backlog.guideDefinitions.approved'), desc: t('backlog.guideDefinitions.approvedDesc') },
    { term: t('backlog.guideDefinitions.rejected'), desc: t('backlog.guideDefinitions.rejectedDesc') },
    { term: t('backlog.guideDefinitions.promoted'), desc: t('backlog.guideDefinitions.promotedDesc') },
    { term: t('backlog.guideDefinitions.inProgress'), desc: t('backlog.guideDefinitions.inProgressDesc') },
    { term: t('backlog.guideDefinitions.done'), desc: t('backlog.guideDefinitions.doneDesc') },
    { term: t('backlog.guideDefinitions.cancelled'), desc: t('backlog.guideDefinitions.cancelledDesc') },
  ]

  const { tableContainerRef, maxColumnWidthTotal } = useTableColumnLimit(84)
  const { visibleCols, isVis, toggleCol, getW, startResize, sort, setSort, hidden, nVisible } = useColumnSettings('backlog', COLS, { maxTotalWidth: maxColumnWidthTotal })
  const tableStyle = getManagedTableStyle(COLS, isVis, getW, 84)

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['backlog', projectId],
    queryFn: () => getBacklog(projectId),
  })

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['backlog', projectId] })

  // Экспорт секции — в меню «Ещё» шапки проекта
  // Описание в выгрузку идёт без маркеров разметки — ровно то, что человек видит на экране.
  const exportRows = useMemo(
    () => items.map(i => ({ ...i, description: i.description ? stripRichText(i.description) : i.description })) as unknown as Record<string, unknown>[],
    [items])
  useSectionExport('backlog', exportRows)

  // ── Inline editing ──
  const startEdit = (id: string, field: string, value: string | number | null) => {
    if (!canWrite) return
    pickedRef.current = null
    setEditCell({ id, field })
    setEditValue(value != null ? String(value) : '')
  }
  const cellKeyDown = (id: string, field: string, value: string | number | null) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(id, field, value) }
  }
  const cancelEdit = () => setEditCell(null)

  const basePayload = (item: BacklogItem): Record<string, string | number | null> => ({
    title: item.title,
    description: item.description ?? null,
    priority: item.priority,
    status: item.status,
    estimated_days: item.estimated_days ?? null,
    requested_by: item.requested_by ?? null,
    assignee_person_id: item.assignee_person_id ?? null,
    assignee_name: item.assignee_name ?? null,
    planned_start: item.planned_start ?? null,
    planned_end: item.planned_end ?? null,
  })

  const commitEdit = async (item: BacklogItem, overrideValue?: string) => {
    if (!editCell || editCell.id !== item.id) return
    const { field } = editCell
    setEditCell(null)
    const ev = overrideValue ?? editValue

    const payload = basePayload(item)
    if (field === 'estimated_days') {
      payload.estimated_days = ev ? Math.max(0, parseInt(ev)) : null
    } else {
      payload[field] = ev || null
    }

    // Правка начала/окончания/кол-ва дней — пересчитать зависимое поле (3-связь).
    if (field === 'planned_start' || field === 'planned_end' || field === 'estimated_days') {
      const rec = recalcDates({
        planned_start: payload.planned_start as string | null,
        planned_end: payload.planned_end as string | null,
        estimated_days: payload.estimated_days as number | null,
      }, field)
      payload.planned_start = rec.planned_start
      payload.planned_end = rec.planned_end
      payload.estimated_days = rec.estimated_days
    }

    await updateBacklogItem(projectId, item.id, payload)
    await invalidate()
  }

  // Ответственный: выбор из справочника пишет person_id (стабильная идентичность) + имя (для показа);
  // свободный текст — только имя, person_id сбрасываем. setEditCell(null) гасит commitEdit по blur.
  const commitAssignee = async (item: BacklogItem, name: string, personId: string | null) => {
    setEditCell(null)
    await updateBacklogItem(projectId, item.id, { ...basePayload(item), assignee_name: name || null, assignee_person_id: personId })
    await invalidate()
  }

  const editing = (id: string, field: string) => editCell?.id === id && editCell?.field === field

  const cardItem = items.find(i => i.id === cardId) ?? null

  /** Открыть карточку, ДОПИСАВ незавершённую правку ячейки.
   *
   *  Без этого шага порядок событий такой: mousedown снимает фокус с ячейки → onBlur коммитит
   *  её старый снимок УЖЕ за спиной открытой карточки → «Сохранить» из карточки уходит поверх.
   *  Поэтому же у каждой точки входа onMouseDown с preventDefault: фокус не должен уезжать
   *  раньше, чем мы успеем закрыть правку. */
  const openCard = async (item: BacklogItem, tab: BacklogDrawerTab = 'details') => {
    if (editCell) {
      const pending = items.find(i => i.id === editCell.id)
      if (!pending) setEditCell(null)
      else if (editCell.field === 'assignee') {
        // У ячейки исполнителя ключ колонки («assignee») НЕ совпадает с полями модели
        // (assignee_name + assignee_person_id), и общий commitEdit записал бы мусорное поле,
        // потеряв набранное имя. У неё свой коммит — им и закрываем.
        const picked = pickedRef.current
        pickedRef.current = null
        await commitAssignee(pending, editValue, picked && picked.name === editValue ? picked.id : null)
      } else await commitEdit(pending)
    }
    setCardTab(tab)
    setCardId(item.id)
  }

  /** Сохранение из карточки. Конвенция записи у таба одна — полный набор полей из basePayload,
   *  — но снимок берём СВЕЖИЙ: ячейка живёт секунды, а карточка минуты, и за это время статус
   *  пункта мог поменять вебхук Bitrix24. Сохранение из устаревшего снимка откатило бы
   *  «Выполнено» обратно в «Новый». */
  const handleCardSave = async (id: string, patch: Partial<BacklogItem>) => {
    const fresh = await qc.fetchQuery({ queryKey: ['backlog', projectId], queryFn: () => getBacklog(projectId) })
    const cur = fresh.find(i => i.id === id)
    if (!cur) {
      // Пункт исчез, пока карточка была открыта: его эскалировали в план работ или удалили —
      // сервер в обоих случаях убирает запись. Молча закрыть карточку нельзя: человек решит,
      // что текст сохранён, а его больше нет нигде.
      setCardId(null)
      showToast(t('backlog.itemGone', { defaultValue: 'Пункт уже перенесён или удалён — правка не сохранена.' }), 'error')
      throw new Error('backlog item gone')
    }
    await updateBacklogItem(projectId, id, { ...basePayload(cur), ...patch })
    await invalidate()
  }

  // ── Add / Delete / Promote ──
  const handleSaveAdd = async () => {
    if (!addValues.title?.trim()) return
    const rec = recalcDates(
      {
        planned_start: addValues.planned_start || null,
        planned_end: addValues.planned_end || null,
        estimated_days: addValues.estimated_days ? Math.max(0, parseInt(addValues.estimated_days)) : null,
      },
      addValues.planned_end ? 'planned_end' : addValues.estimated_days ? 'estimated_days' : 'planned_start',
    )
    const payload = {
      title: addValues.title,
      description: addValues.description || null,
      priority: addValues.priority || 'medium',
      status: addValues.status || 'new',
      estimated_days: rec.estimated_days,
      planned_start: rec.planned_start,
      planned_end: rec.planned_end,
      assignee_person_id: addValues.assignee_person_id || null,
      assignee_name: addValues.assignee_name || null,
      requested_by: addValues.requested_by || null,
    }
    await createBacklogItem(projectId, payload)
    await invalidate()
    setAddRow(false); setAddValues({})
  }

  const handleDelete = (id: string) => {
    showConfirm(t('backlog.deleteConfirm'), async () => {
      await deleteBacklogItem(projectId, id)
      await invalidate()
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
    })
  }

  const handlePromote = (id: string) => {
    showConfirm(t('backlog.promoteConfirm'), async () => {
      setPromoting(id)
      try {
        await promoteBacklogItem(projectId, id)
        await invalidate()
        await invalidateProjectTasks(qc, projectId)
      } finally {
        setPromoting(null)
      }
    }, { confirmLabel: t('backlog.promoteAction'), variant: 'primary' })
  }

  const anyFilter = Boolean(filterStatus) || Object.values(dates).some(Boolean)
  const filtered = items.filter(i => {
    if (filterStatus && i.status !== filterStatus) return false
    if (!isWithinDateRange(i.planned_start, dates.startFrom, dates.startTo)) return false
    if (!isWithinDateRange(i.planned_end, dates.endFrom, dates.endTo)) return false
    return true
  })

  const displayRows = [...filtered].sort((a, b) => {
    if (!sort) return 0
    const av = a[sort.field as keyof typeof a] ?? ''
    const bv = b[sort.field as keyof typeof b] ?? ''
    const cmp = String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const inpCls = 'w-full text-xs border border-blue-400 rounded px-1 py-0 outline-none bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'
  const addInp = 'text-xs border border-gray-300 rounded px-1 py-0.5 w-full focus:outline-none focus:border-blue-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500'
  const cellCls = TABLE_CELL_TEXT_CLASS

  const makeInput = (item: BacklogItem, type = 'text') => (
    <input autoFocus type={type} className={inpCls} value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={() => commitEdit(item)}
      onKeyDown={e => { if (e.key === 'Enter') { void commitEdit(item) } if (e.key === 'Escape') cancelEdit() }} />
  )
  const makeSelect = (item: BacklogItem, options: string[]) => (
    <select autoFocus className={inpCls} value={editValue}
      aria-label={options === PRIORITY_VALUES ? t('backlog.priority') : t('common.status')}
      onChange={e => { setEditValue(e.target.value); }}
      onBlur={() => commitEdit(item)}>
      {options.map(o => (
        <option key={o} value={o}>
          {PRIORITY_VALUES.includes(o)
            ? t(`project.priority.${o}`)
            : t(`backlog.statuses.${o}`)}
        </option>
      ))}
    </select>
  )
  const makePersonInput = (item: BacklogItem) => (
    <PersonPicker autoFocus className={inpCls} value={editValue}
      onChange={v => setEditValue(v)} onSelect={(v) => { void commitEdit(item, v) }} />
  )
  // Выбор человека в PersonPicker поднимает onPickPerson, а следом onSelect. Обе ручки раньше
  // сохраняли — уходили ДВА запроса, и последний ставил assignee_person_id: null. Снять onSelect
  // нельзя: свободный текст («отдел контента») коммитится только через него. Поэтому выбранного
  // запоминаем, а пишем один раз — в onSelect.
  const makeAssigneeInput = (item: BacklogItem) => (
    <PersonPicker autoFocus className={inpCls} value={editValue}
      onChange={v => setEditValue(v)}
      onSelect={(v) => {
        const picked = pickedRef.current
        pickedRef.current = null
        void commitAssignee(item, v, picked && picked.name === v ? picked.id : null)
      }}
      onPickPerson={(p) => { pickedRef.current = p ? { name: p.full_name, id: p.id } : null }} />
  )

  if (isLoading) return <SkeletonRows rows={6} />
  if (isError) return <Surface className="border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{t('common.error')}</Surface>

  return (
    <div>
      {/* Одна строка вместо двух: слева — чем отбираем, справа — сколько получилось и
          инструменты. Раньше счётчик с шестерёнкой стояли отдельной строкой под фильтрами и
          начинались от левого края, отчего панель выглядела составленной из кусков. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Имя обязательно: подписи рядом нет, и без aria-label поле читается как «список» —
            это критическое замечание axe, которое до сих пор никто не видел, потому что
            раздел не был под гейтом доступности. */}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          aria-label={t('backlog.allStatuses')}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          <option value="">{t('backlog.allStatuses')}</option>
          {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <DateRange label={t('backlog.plannedStart', { defaultValue: 'Начало' })}
          from={dates.startFrom} to={dates.startTo}
          onFrom={v => setDates(d => ({ ...d, startFrom: v }))}
          onTo={v => setDates(d => ({ ...d, startTo: v }))} />
        <DateRange label={t('backlog.plannedEnd', { defaultValue: 'Окончание' })}
          from={dates.endFrom} to={dates.endTo}
          onFrom={v => setDates(d => ({ ...d, endFrom: v }))}
          onTo={v => setDates(d => ({ ...d, endTo: v }))} />
        {anyFilter && (
          <button type="button"
            onClick={() => { setFilterStatus(''); setDates({ startFrom: '', startTo: '', endFrom: '', endTo: '' }) }}
            className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100">
            {t('common.reset', { defaultValue: 'Сбросить' })}
          </button>
        )}
        {/* Счётчик показываем ВСЕГДА, а под фильтром — со «всего»: элемент без даты в заданный
            отрезок не попадает, и без этой пары чисел исчезновение строк выглядит как пропажа. */}
        {/* Счётчик и инструменты — ОДНОЙ группой: по отдельности они переносились на вторую
            строку вразнобой (подсказка у левого края, шестерёнка у правого). */}
        <span className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-gray-500 dark:text-slate-400">
            {anyFilter
              ? `${filtered.length} / ${items.length}`
              : t('backlog.itemsVisible', { count: filtered.length })}
          </span>
          <ProcessGuide steps={guideSteps} definitions={guideDefinitions} />
          <ColumnToggler cols={COLS} hidden={hidden} onToggle={toggleCol} />
        </span>
      </div>

      <div ref={tableContainerRef} className={TABLE_SCROLL_WRAP_CLASS}>
        <table className={`${TABLE_BASE_CLASS} text-xs`} style={tableStyle}>
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {visibleCols.map((col, index) => (
                <ColTh
                  key={col.key}
                  col={col}
                  sort={sort}
                  onSort={setSort}
                  width={getW(col.key)}
                  onResize={startResize(col.key)}
                  onResizePrev={index > 0 ? startResize(visibleCols[index - 1].key) : undefined}
                />
              ))}
              <th className={TABLE_ACTION_HEAD_CLASS} />
            </tr>
          </thead>
          <tbody>
            {addRow && canWrite && (
              <tr className="border-b border-primary-200 dark:border-slate-600 bg-primary-50 dark:bg-slate-800/70">
                {isVis('code') && <td className="py-1 pr-3 text-gray-500 dark:text-slate-400 italic text-xs">auto</td>}
                {isVis('title') && (
                  <td className="py-1 pr-3">
                    <input autoFocus className={addInp} placeholder={t('decisions.titleField') + '…'}
                      value={addValues.title ?? ''} onChange={e => setAddValues(v => ({ ...v, title: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveAdd(); if (e.key === 'Escape') { setAddRow(false); setAddValues({}) } }} />
                  </td>
                )}
                {isVis('description') && (
                  <td className="py-1 pr-3">
                    <input className={addInp} placeholder={t('common.description') + '…'}
                      value={addValues.description ?? ''} onChange={e => setAddValues(v => ({ ...v, description: e.target.value }))} />
                  </td>
                )}
                {isVis('priority') && (
                  <td className="py-1 pr-3">
                    <select className={addInp} aria-label={t('backlog.priority')}
                      value={addValues.priority ?? 'medium'} onChange={e => setAddValues(v => ({ ...v, priority: e.target.value }))}>
                      {PRIORITY_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                )}
                {isVis('status') && (
                  <td className="py-1 pr-3">
                    <select className={addInp} aria-label={t('common.status')}
                      value={addValues.status ?? 'new'} onChange={e => setAddValues(v => ({ ...v, status: e.target.value }))}>
                      {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                )}
                {isVis('planned_start') && (
                  <td className="py-1 pr-3">
                    {/* Портальное поле даты, а не голый input[type=date]: тот рисует маску по
                        локали БРАУЗЕРА, и человек создавал пункт в MM/DD/YYYY, а открывал в
                        дд.мм.гггг. В фильтре и в карточке формат уже наш. */}
                    <DateInput className={addInp} value={addValues.planned_start ?? ''}
                      ariaLabel={t('backlog.plannedStart', { defaultValue: 'Начало' })}
                      onChange={iso => setAddValues(v => ({ ...v, planned_start: iso }))} />
                  </td>
                )}
                {isVis('estimated_days') && (
                  <td className="py-1 pr-3">
                    <input className={addInp} type="number" min="0" placeholder="0"
                      value={addValues.estimated_days ?? ''} onChange={e => setAddValues(v => ({ ...v, estimated_days: e.target.value }))} />
                  </td>
                )}
                {isVis('planned_end') && (
                  <td className="py-1 pr-3">
                    <DateInput className={addInp} value={addValues.planned_end ?? ''}
                      ariaLabel={t('backlog.plannedEnd', { defaultValue: 'Окончание' })}
                      onChange={iso => setAddValues(v => ({ ...v, planned_end: iso }))} />
                  </td>
                )}
                {isVis('assignee') && (
                  <td className="py-1 pr-3">
                    <PersonPicker className={addInp} placeholder={t('backlog.assignee', { defaultValue: 'Ответственный' }) + '…'}
                      value={addValues.assignee_name ?? ''}
                      onChange={v => setAddValues(prev => ({ ...prev, assignee_name: v, assignee_person_id: '' }))}
                      onPickPerson={p => { if (p) setAddValues(prev => ({ ...prev, assignee_name: p.full_name, assignee_person_id: p.id })) }} />
                  </td>
                )}
                {isVis('requested_by') && (
                  <td className="py-1 pr-3">
                    <PersonPicker className={addInp} placeholder={t('backlog.requestedBy') + '…'}
                      value={addValues.requested_by ?? ''} onChange={v => setAddValues(prev => ({ ...prev, requested_by: v }))} />
                  </td>
                )}
                {isVis('bitrix24_task_id') && <td className="py-1 pr-3" />}
                <td className={TABLE_ACTION_CELL_CLASS}><div className={TABLE_ACTION_GROUP_CLASS}>
                  <button onClick={handleSaveAdd} aria-label={t('common.save')} className={`${TABLE_ICON_BUTTON_CLASS} text-green-600 hover:text-green-800`}><Check size={ICON_SM} /></button>
                  <button onClick={() => { setAddRow(false); setAddValues({}) }} aria-label={t('common.cancel')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={ICON_SM} /></button>
                </div></td>
              </tr>
            )}
            {displayRows.map(item => (
              <tr key={item.id} className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 group ${item.status === 'promoted' ? 'opacity-60' : ''}`}>
                {isVis('code') && (
                  <td className="py-2 pr-3 whitespace-nowrap" style={{ width: getW('code') }}>
                    {/* Главная точка входа: код — единственная ячейка строки без правки, поэтому
                        конфликта «клик правит / клик открывает» здесь нет. Цвет и шрифт в покое
                        те же, что были: подсветка только на наведении и фокусе. */}
                    <button type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => void openCard(item)}
                      title={t('backlog.openCard', { defaultValue: 'Открыть карточку' })}
                      aria-label={`${t('backlog.openCard', { defaultValue: 'Открыть карточку' })} ${item.code ?? ''}`}
                      className="font-mono text-xs text-gray-500 dark:text-slate-400 hover:text-primary-600 hover:underline focus-visible:underline">
                      {item.code ?? '—'}
                    </button>
                  </td>
                )}
                {isVis('title') && (
                  <td className="relative py-2 pr-3 font-medium text-gray-800 dark:text-slate-200" style={{ width: getW('title') }}>
                    {editing(item.id, 'title')
                      ? makeInput(item)
                      : <>
                          <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'title', item.title)} onClick={() => startEdit(item.id, 'title', item.title)}>
                            {item.title}
                            {item.promoted_to_task_id && (
                              <span className="text-purple-600 text-xs ml-1">({t('backlog.promotedToTask')})</span>
                            )}
                          </span>
                          {/* Привычная по Плану работ мишень. Абсолютом — чтобы не сдвинуть ни
                              одного пикселя раскладки; focus-visible обязателен, иначе табом
                              попадаешь на невидимую кнопку. */}
                          <button type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => void openCard(item)}
                            title={t('backlog.openCard', { defaultValue: 'Открыть карточку' })}
                            aria-label={`${t('backlog.openCard', { defaultValue: 'Открыть карточку' })}: ${item.title}`}
                            className="absolute right-0 top-1.5 p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-primary-500 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-600">
                            <Pencil size={12} />
                          </button>
                        </>
                    }
                  </td>
                )}
                {isVis('description') && (
                  <td className="py-2 pr-3 text-gray-500 dark:text-slate-300" style={{ width: getW('description') }}>
                    {/* Правку описания из ячейки убрали намеренно: это был input[type=text], а
                        браузер вырезает из его значения переводы строк — достаточно кликнуть и
                        уйти мимо, чтобы многострочное описание схлопнулось в строку и уехало на
                        сервер. Теперь клик открывает карточку сразу на вкладке «Описание», а в
                        ячейке текст показывается без служебных значков разметки. */}
                    <span className={cellCls} role="button" tabIndex={0}
                      aria-label={`${t('backlog.descriptionInCard', { defaultValue: 'Описание правится в карточке — нажмите, чтобы открыть' })}: ${item.title}`}
                      title={t('backlog.descriptionInCard', { defaultValue: 'Описание правится в карточке — нажмите, чтобы открыть' })}
                      onMouseDown={e => e.preventDefault()}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openCard(item, 'description') } }}
                      onClick={() => void openCard(item, 'description')}>
                      {item.description ? stripRichText(item.description) : '—'}
                    </span>
                  </td>
                )}
                {isVis('priority') && (
                  <td className="py-2 pr-3" style={{ width: getW('priority') }}>
                    {editing(item.id, 'priority')
                      ? makeSelect(item, PRIORITY_VALUES)
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'priority', item.priority)} onClick={() => startEdit(item.id, 'priority', item.priority)}>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[item.priority] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                            {t(`project.priority.${item.priority}`)}
                          </span>
                        </span>
                    }
                  </td>
                )}
                {isVis('status') && (
                  <td className="py-2 pr-3" style={{ width: getW('status') }}>
                    {editing(item.id, 'status')
                      ? makeSelect(item, STATUS_VALUES)
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'status', item.status)} onClick={() => startEdit(item.id, 'status', item.status)}>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                            {t(`backlog.statuses.${item.status}`)}
                          </span>
                        </span>
                    }
                  </td>
                )}
                {isVis('planned_start') && (
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-300 whitespace-nowrap" style={{ width: getW('planned_start') }}>
                    {editing(item.id, 'planned_start')
                      ? makeInput(item, 'date')
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'planned_start', item.planned_start ?? null)} onClick={() => startEdit(item.id, 'planned_start', item.planned_start ?? null)}>{item.planned_start ? formatDate(item.planned_start) : '—'}</span>
                    }
                  </td>
                )}
                {isVis('estimated_days') && (
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-300" style={{ width: getW('estimated_days') }}>
                    {editing(item.id, 'estimated_days')
                      ? makeInput(item, 'number')
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'estimated_days', item.estimated_days ?? null)} onClick={() => startEdit(item.id, 'estimated_days', item.estimated_days ?? null)}>{item.estimated_days ?? '—'}</span>
                    }
                  </td>
                )}
                {isVis('planned_end') && (
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-300 whitespace-nowrap" style={{ width: getW('planned_end') }}>
                    {editing(item.id, 'planned_end')
                      ? makeInput(item, 'date')
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'planned_end', item.planned_end ?? null)} onClick={() => startEdit(item.id, 'planned_end', item.planned_end ?? null)}>{item.planned_end ? formatDate(item.planned_end) : '—'}</span>
                    }
                  </td>
                )}
                {isVis('assignee') && (
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-300" style={{ width: getW('assignee') }}>
                    {editing(item.id, 'assignee')
                      ? makeAssigneeInput(item)
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'assignee', item.assignee_name ?? null)} onClick={() => startEdit(item.id, 'assignee', item.assignee_name ?? null)}>{item.assignee_name ?? '—'}</span>
                    }
                  </td>
                )}
                {isVis('requested_by') && (
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-300" style={{ width: getW('requested_by') }}>
                    {editing(item.id, 'requested_by')
                      ? makePersonInput(item)
                      : <span className={cellCls} role="button" tabIndex={0} onKeyDown={cellKeyDown(item.id, 'requested_by', item.requested_by ?? null)} onClick={() => startEdit(item.id, 'requested_by', item.requested_by ?? null)}>{item.requested_by ?? '—'}</span>
                    }
                  </td>
                )}
                {isVis('bitrix24_task_id') && (
                  <td className="py-2 pr-3 text-xs" style={{ width: getW('bitrix24_task_id') }}>
                    {item.bitrix24_task_id ? (
                      canWrite ? (
                        <button onClick={() => setBitrixItem(item)} className="text-primary-600 dark:text-blue-400 hover:text-primary-800 font-mono font-medium">
                          {item.bitrix24_task_id}
                        </button>
                      ) : (
                        <span className="text-primary-600 font-mono font-medium">{item.bitrix24_task_id}</span>
                      )
                    ) : (
                      canWrite ? (
                        <button onClick={() => setBitrixItem(item)} className="text-gray-500 dark:text-slate-400 hover:text-primary-600">
                          {t('bitrix24Task.create')}
                        </button>
                      ) : <span className="text-gray-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                )}
                {/* focus-within обязателен: без него фокус с клавиатуры уезжает на невидимые
                    кнопки, и человек не понимает, где он находится. */}
                <td className={TABLE_ACTION_CELL_CLASS}>{canWrite && (<div className={`${TABLE_ACTION_GROUP_CLASS} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}>
                  {item.status !== 'promoted' && (
                    <button onClick={() => handlePromote(item.id)} disabled={promoting === item.id}
                      title={t('backlog.promoteToWbs')}
                      aria-label={t('backlog.promoteToWbs')}
                      className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-purple-600 disabled:opacity-50`}>
                      <ArrowUpRight size={ICON_SM} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(item.id)} aria-label={t('common.delete')} className={`${TABLE_ICON_BUTTON_CLASS} text-gray-500 dark:text-slate-400 hover:text-red-500`}>
                    <Trash2 size={ICON_SM} />
                  </button>
                </div>)}</td>
              </tr>
            ))}
            {displayRows.length === 0 && !addRow && (
              <tr>
                <td colSpan={nVisible + 1}>
                  <EmptyValueState
                    message={t('adopt.empty.backlog', { defaultValue: 'Складывайте сюда все идеи и запросы — ничего не потеряется, а нужное превратится в задачу одним кликом.' })}
                    actionLabel={canWrite ? t('backlog.add') : undefined}
                    onAction={canWrite ? () => { setAddRow(true); setAddValues({ priority: 'medium', status: 'new' }) } : undefined}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!addRow && canWrite && displayRows.length > 0 && (
        <div className="flex justify-end mt-1.5">
          <button onClick={() => { setAddRow(true); setAddValues({ priority: 'medium', status: 'new' }) }}
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
            <Plus size={11} /> {t('backlog.add')}
          </button>
        </div>
      )}

      {cardItem && (
        <BacklogDrawer
          item={cardItem}
          initialTab={cardTab}
          onClose={() => setCardId(null)}
          onSave={handleCardSave}
        />
      )}

      {bitrixItem && (
        <BitrixTaskDialog
          open
          onClose={() => setBitrixItem(null)}
          projectId={projectId}
          entityType="backlog"
          entityId={bitrixItem.id}
          bitrix24TaskId={bitrixItem.bitrix24_task_id ?? null}
          prefill={{
            title: bitrixItem.title,
            // Без наших значков: сервер всё равно снимет разметку перед отправкой
            // (bx_create_task → _plain_text), и человек должен видеть в диалоге ровно то,
            // что уедет в Bitrix, а не «**важно**».
            description: bitrixItem.description ? stripRichText(bitrixItem.description) : null,
            assigneeName: bitrixItem.assignee_name ?? bitrixItem.requested_by ?? null,
            pmName: project?.pm_name ?? null,
            deadline: bitrixItem.planned_end ?? null,
          }}
          onCreateTask={async (payload) => {
            await createBacklogBitrix24Task(projectId, bitrixItem.id, payload)
            await invalidate()
          }}
          onDeleteTask={async () => {
            await deleteBacklogBitrix24Task(projectId, bitrixItem.id)
            await invalidate()
          }}
        />
      )}
    </div>
  )
}
