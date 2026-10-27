import { useState, useEffect, useRef, forwardRef, useImperativeHandle, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, ChevronDown, Check } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import { STATUS_OPTIONS, PRIORITY_OPTIONS, PROJECT_KIND_OPTIONS } from '@/constants/project'
import DateInput from '@/components/ui/DateInput'
import { formatDate, parseDateStrict } from '@/utils/date'
import type { Project, ProjectFieldChange } from '@/types/project'
import ListItemEditor from '@/components/ListItemEditor'
import PersonPicker from '@/components/PersonPicker'
import HintIcon from '@/components/HintIcon'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'

/** Text input showing dd.mm.yyyy with a calendar icon that opens a native date picker. */

function parseList(val: string[] | string | null | undefined): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val
  try {
    const parsed = JSON.parse(val)
    return Array.isArray(parsed) ? parsed : [val]
  } catch {
    return [val]
  }
}

export interface PassportFormValues {
  name: string
  status: string
  priority: string
  project_kind: string
  client: string
  pm_name: string
  planned_start: string
  planned_end: string
  actual_start: string
  actual_end: string
  goal: string[]
  scope: string[]
  project_result: string[]
  key_milestones: string[]
  success_criteria: string
  description: string
  budget: string
  budget_currency: string
}

export interface PassportFormHandle {
  save: () => Promise<void>
  isDirty: () => boolean
}

/** Что показывает индикатор вместо кнопки «Сохранить». */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error' }
  /** Данные противоречивы (начало позже завершения) — писать нельзя, сервер вернёт 422. */
  | { kind: 'blocked' }

interface Props {
  initialData?: Project | null
  onSubmit: (values: PassportFormValues, changed?: ProjectFieldChange[]) => Promise<void>
  submitLabel?: string
  hideSubmitButton?: boolean
  onDirtyChange?: (dirty: boolean) => void
  /** Включает автосохранение. Выключено у читателя и на создании проекта (сохранять нечего). */
  autoSave?: boolean
  /**
   * Только просмотр: поля паспорта гасятся, набрать в них ничего нельзя.
   *
   * Отдельно от `autoSave`, а не «!autoSave»: на СОЗДАНИИ проекта автосохранения тоже нет,
   * но форма там обязана быть живой. Раньше этого различения не было — и наблюдатель (а до
   * него руководство компании) видел паспорт, в котором можно печатать, но напечатанное
   * молча пропадало: сервер отвечал 403, а форма об этом не говорила.
   */
  readOnly?: boolean
}

const inp = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded focus:outline-none focus:ring-1 focus:ring-primary-500'
const roCell = 'px-2 py-1.5 text-sm text-gray-700 dark:text-slate-200 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded truncate'
const lbl = 'block text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-0.5'
const blockTitle = 'text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2'
const block = 'border-2 border-gray-300 dark:border-slate-700 rounded-lg p-3'

// UX-05: сворачиваемый блок паспорта. По умолчанию раскрыт (вид почти как раньше),
// но длинную «простыню» можно свернуть по разделам; заголовок показывает «заполнено».
function CollapsibleBlock({
  title, open, onToggle, filled, blockRef, disabled, children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  filled: boolean
  blockRef: RefObject<HTMLDivElement>
  /** Режим «только просмотр». НЕ опционально: новый блок паспорта нельзя добавить,
   *  не ответив на вопрос, что с ним делает наблюдатель. */
  disabled: boolean
  children: ReactNode
}) {
  return (
    <div ref={blockRef} className={block}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2"
      >
        <span className={`${blockTitle} mb-0`}>{title}</span>
        {filled && <Check size={12} className="text-emerald-500" aria-hidden="true" />}
        <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      {/* Одна точка блокировки на весь блок вместо disabled на каждом поле: браузер сам гасит
          ЛЮБОЙ вложенный контрол, включая те, что появятся здесь завтра. `display: contents`
          не создаёт своей коробки — сетка внутри раскладывается ровно как раньше.
          Сворачивание блока при этом живо: кнопка-заголовок снаружи fieldset. */}
      {open && <div className="mt-2"><fieldset disabled={disabled} className="contents">{children}</fieldset></div>}
    </div>
  )
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className={`${lbl} inline-flex items-center gap-1`}>
      <span>{label}</span>
      {hint ? <HintIcon text={hint} size={11} /> : null}
    </label>
  )
}

const EMPTY: PassportFormValues = {
  name: '', status: 'planning', priority: 'medium', project_kind: '',
  client: '', pm_name: '',
  planned_start: '', planned_end: '', actual_start: '', actual_end: '',
  goal: [], scope: [], project_result: [], key_milestones: [],
  success_criteria: '', description: '', budget: '', budget_currency: 'EUR',
}

/** Пауза после последнего нажатия перед записью. Полторы секунды — компромисс: короче даёт
 *  запрос почти на каждое слово, длиннее заметно как «портал думает». */
const AUTOSAVE_DELAY_MS = 1500

/** ЧЧ:ММ по локали браузера — в индикаторе нужна только точка во времени, не дата. */
const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const STR_KEYS: (keyof PassportFormValues)[] = [
  'name', 'status', 'priority', 'project_kind', 'client', 'pm_name',
  'planned_start', 'planned_end', 'actual_start', 'actual_end',
  'success_criteria', 'description', 'budget', 'budget_currency',
]
const ARR_KEYS: (keyof PassportFormValues)[] = ['goal', 'scope', 'project_result', 'key_milestones']

const PassportForm = forwardRef<PassportFormHandle, Props>(function PassportForm(
  { initialData, onSubmit, submitLabel = 'Save', hideSubmitButton = false, onDirtyChange, autoSave = false,
    readOnly = false },
  ref
) {
  const { t } = useTranslation()
  const showToast = useToastStore((s) => s.show)
  const isEdit = !!initialData
  // На создании префиллим РП текущим пользователем (поле остаётся редактируемым, dirty не трогаем).
  const [form, setForm] = useState<PassportFormValues>(() =>
    initialData ? EMPTY : { ...EMPTY, pm_name: useAuthStore.getState().user?.full_name ?? '' }
  )
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  // Смена руководителя проекта = передача проекта (сервер двигает pm_id вместе с именем), поэтому
  // право то же, что у кнопки «Передать РП»: владелец портфеля или ОСНОВНОЙ РП этого проекта
  // (зеркало main._apply_pm_change).
  //
  // На СОЗДАНИИ поле только для чтения, и это починка: раньше его давали заполнить, а сервер всё
  // равно записывал проект на создателя (projects_routes: pm_id/pm_name перетираются). То есть
  // человек вписывал коллегу, жал «Создать» — и получал проект на себя, без единого слова.
  const userRole = useAuthStore((s) => s.user?.role)
  const userId = useAuthStore((s) => s.user?.id)
  const canTransfer = isEdit
    && (userRole === 'owner' || (!!initialData?.pm_id && initialData.pm_id === userId))

  // UX-05: сворачиваемые блоки + прыжки по разделам (только в режиме редактирования).
  const [openBlocks, setOpenBlocks] = useState({ b1: true, b2: true, b3: true })
  const b1Ref = useRef<HTMLDivElement>(null)
  const b2Ref = useRef<HTMLDivElement>(null)
  const b3Ref = useRef<HTMLDivElement>(null)
  const blockRefs = { b1: b1Ref, b2: b2Ref, b3: b3Ref } as const
  const toggleBlock = (id: keyof typeof openBlocks) => setOpenBlocks((o) => ({ ...o, [id]: !o[id] }))
  const jumpToBlock = (id: keyof typeof openBlocks) => {
    setOpenBlocks((o) => ({ ...o, [id]: true }))
    blockRefs[id].current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const dirtyRef = useRef(false)
  const snapshotRef = useRef<PassportFormValues | null>(null)
  const formRef = useRef<PassportFormValues>(EMPTY)
  useEffect(() => { formRef.current = form }, [form])

  /** Какой проект сейчас загружен в форму. Нужен, чтобы отличать «пришли свежие данные того же
   *  проекта» от «человек переключился на другой проект»: во втором случае форму обязаны
   *  перезалить в любом случае, иначе на новом проекте останется паспорт старого. */
  const loadedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!initialData) return
    const switched = loadedIdRef.current !== null && loadedIdRef.current !== initialData.id
    // Тот же проект и на экране есть несохранённое — НЕ перезаписываем. Раньше любой
    // перезапрос ['project', id] молча стирал набранный текст и гасил флаг «есть
    // несохранённое»: кнопка «Синхр. с Bitrix» инвалидирует проект всегда (ей нужно обновить
    // дату синхронизации), и человек, нажавший её с недописанным паспортом, терял правки
    // без единого признака — он даже не уходил со страницы, чтобы его о чём-то спросили.
    // Пока правки живы, побеждают они: серверные данные подтянутся после сохранения либо
    // после «уйти без сохранения».
    if (!switched && dirtyRef.current) return
    loadedIdRef.current = initialData.id
    dirtyRef.current = false
    setDirty(false)
    const newForm: PassportFormValues = {
      name: initialData.name ?? '',
      status: initialData.status ?? 'planning',
      priority: initialData.priority ?? 'medium',
      project_kind: initialData.project_kind ?? '',
      client: initialData.client ?? '',
      pm_name: initialData.pm_name ?? '',
      planned_start: initialData.planned_start ?? '',
      planned_end: initialData.planned_end ?? '',
      actual_start: initialData.actual_start ?? '',
      actual_end: initialData.actual_end ?? '',
      goal: parseList(initialData.goal),
      scope: parseList(initialData.scope),
      project_result: parseList(initialData.project_result),
      key_milestones: parseList(initialData.key_milestones),
      success_criteria: initialData.success_criteria ?? '',
      description: initialData.description ?? '',
      budget: initialData.budget != null ? String(initialData.budget) : '',
      budget_currency: initialData.budget_currency ?? 'EUR',
    }
    setForm(newForm)
    // formRef обновляется ЭФФЕКТОМ после рендера, а snapshotRef — прямо здесь. Пока они
    // расходятся, computeChanged() честно сообщает «изменилось всё: с данных проекта на пустую
    // форму». С кнопкой это никого не трогало — никто не сохранял в этот миг. Автосохранение
    // в это окно успевало записать ПУСТОЙ паспорт поверх проекта (проверено живьём: PUT ушёл
    // с name:"" и обнулил цель, объём, заказчика, РП и даты). Синхронизируем оба разом.
    formRef.current = newForm
    snapshotRef.current = newForm
    onDirtyChange?.(false)
  }, [initialData]) // eslint-disable-line react-hooks/exhaustive-deps

  const computeChanged = (): ProjectFieldChange[] => {
    if (!snapshotRef.current) return []
    const snap = snapshotRef.current
    const cur = formRef.current
    const changed: ProjectFieldChange[] = []
    for (const k of STR_KEYS) {
      const ov = String(snap[k] ?? ''), nv = String(cur[k] ?? '')
      if (ov !== nv) changed.push({ field: k, old_value: ov, new_value: nv })
    }
    for (const k of ARR_KEYS) {
      const ov = snap[k], nv = cur[k]
      if (JSON.stringify(ov) !== JSON.stringify(nv)) {
        changed.push({ field: k, old_value: ov, new_value: nv })
      }
    }
    return changed
  }

  /** Данные противоречивы — сервер вернёт 422, писать бессмысленно. */
  const datesConflict = () => {
    const { planned_start: ps, planned_end: pe } = formRef.current
    return !!(ps && pe && ps > pe)
  }

  const saveInternal = async () => {
    // Читателю запись недоступна в принципе. Гашения полей мало: `save()` торчит наружу через ref,
    // и вызвавший его экран получил бы от сервера 403 вместо тихого «нечего сохранять».
    if (readOnly) return
    // Валидация порядка дат до отправки (бэкенд тоже вернёт 422, но предупреждаем заранее).
    if (datesConflict()) {
      setSaveState({ kind: 'blocked' })
      showToast(t('fix.dateOrder', { defaultValue: 'Начало не может быть позже завершения' }), 'error')
      // БРОСАЕМ, а не return: для вызывающего единственный признак «сохранение не состоялось» —
      // исключение. С тихим return промис резолвился успешно, и «Сохранить и уйти» уводило со
      // страницы, выбросив паспорт: кнопка обещала сохранить и вместо этого теряла правки.
      throw new Error('passport: planned_start > planned_end')
    }
    setSaving(true)
    setSaveState({ kind: 'saving' })
    try {
      const changed = computeChanged()
      // Фиксируем ровно то, что отправляем. Раньше снимок брался с ТЕКУЩЕЙ формы уже ПОСЛЕ
      // ответа сервера: если человек печатал, пока летел запрос, эти буквы попадали в снимок,
      // но не на сервер — форма считала их сохранёнными и больше к ним не возвращалась.
      // С кнопкой окно было в доли секунды и почти незаметно; при автосохранении оно
      // открывается на каждом сохранении, а быстро печатающий в него попадает всегда.
      const sent = { ...formRef.current }
      await onSubmit(sent, changed)
      dirtyRef.current = false
      setDirty(false)
      snapshotRef.current = sent
      onDirtyChange?.(false)
      setSaveState({ kind: 'saved', at: Date.now() })
    } catch (err) {
      setSaveState({ kind: 'error' })
      throw err
    } finally {
      setSaving(false)
    }
  }

  /* ── АВТОСОХРАНЕНИЕ ───────────────────────────────────────────────────────────────────
   * Пишем сами, через паузу после последнего нажатия. Кнопки «Сохранить» больше нет, а с ней
   * ушло и состояние «изменено, но не сохранено» — вместе со всеми вопросами при уходе.
   *
   * Триггер — computeChanged(), а НЕ флаг dirty: флаг липкий (взводится на первой правке и не
   * гаснет, если значение вернули как было), а честное сравнение со снимком отдаёт пусто и
   * лишнего запроса не будет.
   *
   * Гонок не допускаем: пока запрос в полёте, новый не стартует — доедет следующим тиком
   * эффекта, потому что form к тому моменту уже изменится. */
  const autoTimer = useRef<number | null>(null)
  const flushRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!autoSave || saving) return
    if (snapshotRef.current === null) return          // данные ещё не загрузились
    if (computeChanged().length === 0) return         // правок нет либо их откатили
    // ВТОРОЙ РУБЕЖ. Автосохранение пишет само, поэтому любая рассинхронизация формы и снимка
    // тут же уезжает в базу. Один раз это уже случилось: формы ещё не было, снимок уже был —
    // и PUT ушёл с пустым паспортом, обнулив цель, объём, заказчика, РП и даты. Название
    // спасло только то, что сервер игнорирует пустое имя.
    // Инвариант простой: у проекта, который уже загрузился, НЕ МОЖЕТ вдруг исчезнуть название.
    // Такую «правку» человек руками не сделает — поле обязательное.
    if (!formRef.current.name && snapshotRef.current.name) return
    if (datesConflict()) { setSaveState({ kind: 'blocked' }); return }
    autoTimer.current = window.setTimeout(() => {
      void saveInternal().catch(() => {})             // ошибку показывает индикатор
    }, AUTOSAVE_DELAY_MS)
    return () => { if (autoTimer.current) window.clearTimeout(autoTimer.current) }
  }, [form, autoSave, saving])   // eslint-disable-line react-hooks/exhaustive-deps

  // Уходим со страницы с недописанным в очереди — дописываем немедленно, не дожидаясь паузы.
  useEffect(() => { flushRef.current = () => { if (autoSave && computeChanged().length) void saveInternal().catch(() => {}) } })
  useEffect(() => () => flushRef.current(), [])

  useImperativeHandle(ref, () => ({
    save: saveInternal,
    isDirty: () => dirtyRef.current,
  }))

  const set = (k: keyof PassportFormValues, v: string | string[]) => {
    if (!dirtyRef.current) {
      dirtyRef.current = true
      onDirtyChange?.(true)
      setDirty(true)
    }
    setForm(f => ({ ...f, [k]: v }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    // Отправка формы (Enter в поле): ошибку уже показал тост, здесь она никому не нужна —
    // гасим, чтобы не сыпать unhandled rejection в консоль.
    await saveInternal().catch(() => {})
  }

  // Вид проекта — опциональный классификатор паспорта (enum бэкенда, может быть пустым).
  const kindField = (
    <div>
      <FieldLabel label={t('project.fields.kind')} />
      <select aria-label={t('project.fields.kind')} className={inp} value={form.project_kind} onChange={e => set('project_kind', e.target.value)}>
        <option value="">—</option>
        {PROJECT_KIND_OPTIONS.map(k => <option key={k} value={k}>{t(`project.kind.${k}`)}</option>)}
      </select>
    </div>
  )

  const b2Filled = form.name.trim().length > 0
  // key_milestones в галочку блока не входит: этапы теперь берутся из Плана работ, и требовать
  // их здесь значило бы держать галочку серой у проекта, где всё заполнено правильно.
  const b3Filled = form.goal.length + form.scope.length + form.project_result.length > 0
  const navItems: { id: keyof typeof openBlocks; title: string; filled: boolean }[] = [
    { id: 'b1', title: t('project.fields.passportBlock1'), filled: true },
    { id: 'b2', title: t('project.fields.passportBlock2'), filled: b2Filled },
    { id: 'b3', title: t('project.fields.passportBlock3'), filled: b3Filled },
  ]

  const saveBadge = ((): { text: string; tone: string } => {
    const warn = 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
    const ok = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
    const bad = 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
    if (!autoSave) {
      // Создание проекта и режим чтения: автосохранения нет, показываем прежний смысл.
      return dirty
        ? { text: t('project.unsavedShort', { defaultValue: 'Есть несохранённое' }), tone: warn }
        : { text: t('project.savedShort', { defaultValue: 'Сохранено' }), tone: ok }
    }
    switch (saveState.kind) {
      case 'saving':
        return { text: t('project.autosaveSaving', { defaultValue: 'Сохранение…' }), tone: warn }
      case 'saved':
        return { text: t('project.autosaveSavedAt', { defaultValue: 'Сохранено в {{time}}', time: formatTime(saveState.at) }), tone: ok }
      case 'error':
        return { text: t('project.autosaveError', { defaultValue: 'Не сохранено — повторяем' }), tone: bad }
      case 'blocked':
        return { text: t('project.autosaveBlocked', { defaultValue: 'Не сохраняется: начало позже завершения' }), tone: bad }
      default:
        return { text: t('project.savedShort', { defaultValue: 'Сохранено' }), tone: ok }
    }
  })()

  return (
    <form onSubmit={handleSave} className="space-y-3">

      {/* UX-05: липкая навигация по разделам паспорта + статус сохранения */}
      {isEdit && (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--app-surface)]/95 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-[var(--app-surface)]/80">
          {navItems.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => jumpToBlock(it.id)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {it.filled && <Check size={11} className="text-emerald-500" aria-hidden="true" />}
              {it.title}
            </button>
          ))}
          {/* Индикатор вместо кнопки «Сохранить»: тихая запись без обратной связи людей нервирует,
              особенно тех, кто привык жать кнопку. aria-live — чтобы смену состояния услышал и
              скринридер, а не только глаз. */}
          <span
            aria-live="polite"
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${saveBadge.tone}`}
          >
            {saveBadge.text}
          </span>
        </div>
      )}

      {/* Block 1: Identity */}
      <CollapsibleBlock title={t('project.fields.passportBlock1')} open={openBlocks.b1} onToggle={() => toggleBlock('b1')} filled blockRef={b1Ref} disabled={readOnly}>
        {isEdit ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div><FieldLabel label={t('project.fields.code')} hint={t('project.fields.codeHint')} /><div className={roCell}>{initialData?.code ?? '—'}</div></div>
            <div><FieldLabel label={t('project.fields.version')} hint={t('project.fields.versionHint')} /><div className={roCell}>{initialData?.version ?? '—'}</div></div>
            <div><FieldLabel label={t('project.fields.versionDate')} hint={t('project.fields.versionDateHint')} /><div className={roCell}>{formatDate(initialData?.version_date)}</div></div>
            <div>
              <FieldLabel label={t('project.fields.status')} hint={t('project.fields.statusHint')} />
              <select aria-label={t('project.fields.status')} className={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`project.status.${o.value}`)}</option>)}
              </select>
            </div>
            {kindField}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel label={t('project.fields.status')} hint={t('project.fields.statusHint')} />
              <select aria-label={t('project.fields.status')} className={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`project.status.${o.value}`)}</option>)}
              </select>
            </div>
            {kindField}
          </div>
        )}
      </CollapsibleBlock>

      {/* Block 2: Main Data */}
      <CollapsibleBlock title={t('project.fields.passportBlock2')} open={openBlocks.b2} onToggle={() => toggleBlock('b2')} filled={b2Filled} blockRef={b2Ref} disabled={readOnly}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><FieldLabel label={`${t('project.fields.name')} *`} hint={t('project.fields.nameHint')} />
              <input required maxLength={255} aria-label={t('project.fields.name')} className={inp} value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><FieldLabel label={t('project.fields.plannedStart')} hint={t('project.fields.plannedStartHint')} />
              <DateInput ariaLabel={t('project.fields.plannedStart')} className={inp} value={form.planned_start} onChange={v => set('planned_start', v)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><FieldLabel label={t('project.fields.client')} hint={t('project.fields.clientHint')} />
              <PersonPicker className={inp} value={form.client} onChange={v => set('client', v)} /></div>
            <div><FieldLabel label={t('project.fields.plannedEnd')} hint={t('project.fields.plannedEndHint')} />
              <DateInput ariaLabel={t('project.fields.plannedEnd')} className={inp} value={form.planned_end} onChange={v => set('planned_end', v)} /></div>
          </div>
          {/* Фактические даты — отчётные поля: на создании проекта они не нужны, показываем только на редактировании */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Руководитель проекта — это ВЛАДЕЛЕЦ, а не подпись: сервер меняет pm_id вместе с именем
                и требует то же право, что у передачи проекта. Поэтому всем, кроме руководителя
                портфеля, поле показывается только для чтения — иначе автосохранение паспорта
                упиралось бы в 403 на каждой правке. */}
            <div><FieldLabel label={t('project.fields.pm')} hint={canTransfer ? t('project.fields.pmHint')
              : t(isEdit ? 'project.fields.pmHintLocked' : 'project.fields.pmHintOnCreate')} />
              {canTransfer
                ? <PersonPicker className={inp} ariaLabel={t('project.fields.pm')} value={form.pm_name} onChange={v => set('pm_name', v)} />
                : <div className={roCell}>{form.pm_name || '—'}</div>}</div>
            {isEdit ? (
              <div><FieldLabel label={t('project.fields.actualStart')} hint={t('project.fields.actualStartHint')} />
                <DateInput ariaLabel={t('project.fields.actualStart')} className={inp} value={form.actual_start} onChange={v => set('actual_start', v)} /></div>
            ) : (
              <div><FieldLabel label={t('project.fields.priority')} hint={t('project.fields.priorityHint')} />
                <select aria-label={t('project.fields.priority')} className={inp} value={form.priority} onChange={e => set('priority', e.target.value)}>
                  {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`project.priority.${o.value}`)}</option>)}
                </select></div>
            )}
          </div>
          {isEdit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><FieldLabel label={t('project.fields.priority')} hint={t('project.fields.priorityHint')} />
                <select aria-label={t('project.fields.priority')} className={inp} value={form.priority} onChange={e => set('priority', e.target.value)}>
                  {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`project.priority.${o.value}`)}</option>)}
                </select></div>
              <div><FieldLabel label={t('project.fields.actualEnd')} hint={t('project.fields.actualEndHint')} />
                <DateInput ariaLabel={t('project.fields.actualEnd')} className={inp} value={form.actual_end} onChange={v => set('actual_end', v)} /></div>
            </div>
          )}
        </div>
      </CollapsibleBlock>

      {/* Block 3: Content */}
      <CollapsibleBlock title={t('project.fields.passportBlock3')} open={openBlocks.b3} onToggle={() => toggleBlock('b3')} filled={b3Filled} blockRef={b3Ref} disabled={readOnly}>
        <div className="space-y-3">
          <ListItemEditor label={t('project.fields.goal')} hint={t('project.fields.goalHint')} items={form.goal} onChange={v => set('goal', v)} />
          <ListItemEditor label={t('project.fields.scope')} hint={t('project.fields.scopeHint')} items={form.scope} onChange={v => set('scope', v)} />
          <ListItemEditor label={t('project.fields.result')} hint={t('project.fields.resultHint')} items={form.project_result} onChange={v => set('project_result', v)} />
          {/* «Основные этапы» руками больше не набираются: это был дубликат верхнего уровня Плана
              работ, и два списка одного и того же неминуемо расходились. Этапы показываются в
              паспорте read-only — фазами из WBS. Само поле key_milestones живо в данных и payload:
              на нём держатся импорт из Excel и журнал версий, а старые значения не должны пропасть. */}
        </div>
      </CollapsibleBlock>

      {!hideSubmitButton && (
        <div className="pt-2 flex justify-end">
          <button type="submit" disabled={saving}
            className="px-5 py-2 bg-btn-primary hover:bg-btn-primary-hover disabled:opacity-50 text-btn-primary-fg text-sm font-semibold rounded-md">
            {saving ? t('common.saving') : submitLabel}
          </button>
        </div>
      )}
    </form>
  )
})

export default PassportForm
