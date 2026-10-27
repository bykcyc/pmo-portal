import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Save, ExternalLink } from 'lucide-react'
import type { BacklogItem } from '@/types/meeting'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import PersonPicker from '@/components/PersonPicker'
import DateInput from '@/components/ui/DateInput'
import RichTextEditor from '@/components/ui/RichTextEditor'
import { PRIORITY_VALUES, STATUS_VALUES, recalcDates, type DateTriple } from '@/utils/backlog'

const BITRIX_DOMAIN = 'bitrix.example.com'
const TITLE_ID = 'backlog-drawer-title'

export type BacklogDrawerTab = 'details' | 'description'

interface Props {
  item: BacklogItem | null
  onClose: () => void
  onSave: (id: string, patch: Partial<BacklogItem>) => Promise<void>
  initialTab?: BacklogDrawerTab
}

/**
 * Карточка элемента бэклога — та же рама, что у карточки задачи (TaskDrawer).
 *
 * Зачем: в таблице описание правилось однострочным `input`, а браузер по спецификации вырезает
 * из значения такого поля переводы строк. Достаточно было кликнуть в ячейку и уйти мимо, чтобы
 * описание из протокола совещания молча схлопнулось в одну строку. Здесь описание живёт на своей
 * вкладке во весь размер окна и знает лёгкую разметку — ту же, что в плане работ.
 *
 * Рама действительно скопирована с TaskDrawer, а не вынесена в общий компонент. Выносить пока
 * не на что опереться: у карточки задачи нет ни одного юнит-теста, e2e и визуальные снимки
 * модалок не открывают, — зелёный прогон не отличил бы работающую карточку от нерисующейся.
 * Тест этой карточки и есть та самая опора для будущего выноса.
 */
export default function BacklogDrawer({ item, onClose, onSave, initialTab }: Props) {
  const { t } = useTranslation()
  const canWrite = useCanWrite()
  const [form, setForm] = useState<Partial<BacklogItem>>({})
  const [tab, setTab] = useState<BacklogDrawerTab>(initialTab ?? 'details')
  const [saving, setSaving] = useState(false)
  /** Сервер отказал в записи. Тогда карточка остаётся открытой с целыми правками, а второе
   *  нажатие на закрытие выпускает без сохранения — иначе выхода нет вовсе. */
  const [saveFailed, setSaveFailed] = useState(false)
  /** Текст в поле «кол-во дней», пока его набирают. Каскад срабатывает по завершении ввода. */
  const [daysRaw, setDaysRaw] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  /** Что человек тронул. Наружу уходят только эти поля: карточка живёт минутами, а `status`
   *  пункта пишет на сервере ещё и вебхук Bitrix24 — отправь мы весь снимок, «Выполнено»
   *  откатилось бы в «Новый» просто потому, что карточку держали открытой. */
  const dirty = useRef<Set<keyof BacklogItem>>(new Set())

  const id = item?.id
  useEffect(() => {
    if (item) { setForm({ ...item }); dirty.current = new Set(); setDaysRaw(item.estimated_days != null ? String(item.estimated_days) : '') }
    setTab(initialTab ?? 'details')
    // Зависимость СТРОГО по id: объект приходит из свежего списка react-query и меняет
    // идентичность на каждом рефетче — сид по объекту стирал бы незаконченные правки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, initialTab])

  /** Все три выхода из карточки — подложка, Escape и крестик — ведут в одну функцию (requestClose
   *  ниже). Через ref, потому что обработчик Escape вешается один раз на открытие, а requestClose
   *  пересоздаётся каждый рендер и видит свежую форму. */
  const closeRef = useRef<() => void>(onClose)
  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [item])

  useFocusTrap(dialogRef, !!item)

  /** Поле «дней» — теневая копия form.estimated_days, и копия обязана следовать за оригиналом.
   *  Каскад по датам меняет estimated_days сам (правка «Окончания» — всегда), а в поле оставался
   *  старый ввод: при закрытии он ПЕРЕСЧИТЫВАЛ даты от себя и откатывал только что выставленное
   *  окончание. Пока человек набирает в самом поле, estimated_days не меняется — этот эффект
   *  ввод не трогает. */
  useEffect(() => {
    setDaysRaw(form.estimated_days != null ? String(form.estimated_days) : '')
  }, [form.estimated_days])

  if (!item) return null

  /** Все апдейтеры функциональные: PersonPicker шлёт onChange и onPickPerson в один тик,
   *  и с обычным setForm имя терялось — ловили это уже не раз. */
  const set = (key: keyof BacklogItem, val: unknown) => {
    dirty.current.add(key)
    setForm(f => ({ ...f, [key]: val }))
  }

  /** Срок правится тремя полями, а пересчитывает их одна функция — общая с таблицей.
   *
   *  Грязным помечаем ТОЛЬКО то, что действительно изменилось: иначе правка «дней» уносила
   *  наверх и начало — то самое, которое человек не трогал, а сосед мог сдвинуть, пока
   *  карточка открыта. */
  const setDate = (key: 'planned_start' | 'planned_end' | 'estimated_days', val: string | number | null) => {
    dirty.current.add(key)
    setForm(f => {
      const next = { ...f, [key]: val }
      const r = recalcDates({
        planned_start: (next.planned_start ?? null) as string | null,
        planned_end: (next.planned_end ?? null) as string | null,
        estimated_days: (next.estimated_days ?? null) as number | null,
      }, key)
      for (const k of ['planned_start', 'planned_end', 'estimated_days'] as const) {
        if ((r[k] ?? null) !== (next[k] ?? null)) dirty.current.add(k)
      }
      return { ...next, ...r }
    })
  }

  const parseDays = (): number | null => {
    const raw = daysRaw.trim()
    return raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0)
  }

  /** Набранные «дни» + каскад по датам — ОДНА функция и для ухода из поля, и для закрытия
   *  карточки: закрыть можно, не покидая поля, и тогда набранное ещё лежит в `daysRaw`, а не
   *  в форме. Два отдельных расчёта здесь разошлись бы на первой же правке. */
  const daysPatch = (): DateTriple | null => {
    const next = parseDays()
    if (next === ((form.estimated_days ?? null) as number | null)) return null
    return recalcDates({
      planned_start: (form.planned_start ?? null) as string | null,
      planned_end: (form.planned_end ?? null) as string | null,
      estimated_days: next,
    }, 'estimated_days')
  }

  /** Ввод «дней» закончен: применяем каскад одним разом, как это делает ячейка таблицы. */
  const commitDays = () => {
    const next = parseDays()
    setDaysRaw(next == null ? '' : String(next))
    const p = daysPatch()
    if (!p) return
    for (const k of ['planned_start', 'planned_end', 'estimated_days'] as const) {
      if ((p[k] ?? null) !== ((form[k] ?? null) as unknown)) dirty.current.add(k)
    }
    setForm(f => ({ ...f, ...p }))
  }

  const title = String(form.title ?? '').trim()

  /** Наружу уходит только тронутое (плюс незавершённый ввод «дней» при закрытии).
   *
   *  Из каскада берём ТОЛЬКО реально изменившиеся поля: recalcDates возвращает всю тройку, и
   *  «начало», которого человек не касался, уехало бы наверх в том виде, в каком было на момент
   *  открытия карточки, — затирая сдвиг, сделанный за это время соседом. */
  const buildPatch = (extra?: DateTriple | null): Partial<BacklogItem> => {
    const patch: Partial<BacklogItem> = {}
    for (const k of dirty.current) (patch as Record<string, unknown>)[k] = form[k] ?? null
    if (extra) {
      for (const k of ['planned_start', 'planned_end', 'estimated_days'] as const) {
        if ((extra[k] ?? null) !== ((form[k] ?? null) as unknown)) (patch as Record<string, unknown>)[k] = extra[k] ?? null
      }
    }
    return patch
  }

  const save = async (patch: Partial<BacklogItem>) => {
    if (!Object.keys(patch).length) return
    setSaving(true)
    try {
      await onSave(item.id, patch)
      // Снимаем ТОЛЬКО отправленное: пока шёл запрос, человек мог поправить ещё одно поле,
      // и полная очистка молча выбрасывала эту правку.
      for (const k of Object.keys(patch)) dirty.current.delete(k as keyof BacklogItem)
      setSaveFailed(false)
    } catch (e) {
      setSaveFailed(true)
      throw e
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!title) return
    await save(buildPatch())
  }

  /** Закрыть — значит сохранить. Раньше подложка, Escape и крестик просто выбрасывали карточку
   *  вместе с набранным: поля уходят на сервер только по кнопке, а описание правят минутами.
   *  Приём для этого в портале уже выбран — паспорт проекта сохраняется сам, а вопрос
   *  «сохранить или уйти без сохранения?» владелец в своё время отверг. */
  const requestClose = async () => {
    // Второе нажатие после отказа сервера выпускает без записи. Без этого карточка становится
    // ловушкой: пропала связь — и ни крестик, ни Escape, ни подложка не работают, пока сервер
    // не ответит. Рядом с кнопкой при этом висит объяснение (см. ниже saveFailed).
    if (saveFailed) { onClose(); return }
    const patch = canWrite ? buildPatch(daysPatch()) : {}
    // Пустое название сохранить нельзя — кнопка «Сохранить» при нём выключена. Но терять
    // из-за него описание незачем: уносим всё остальное, название остаётся прежним.
    if (!title) delete patch.title
    // Нечего сохранять — закрываем СИНХРОННО, как и раньше: лишний тик здесь виден глазом.
    if (!Object.keys(patch).length) { onClose(); return }
    try {
      await save(patch)
      onClose()
    } catch {
      // Сервер не принял — карточку НЕ закрываем: набранное на экране цело, можно повторить.
    }
  }
  closeRef.current = requestClose

  const inp = 'w-full text-sm border border-gray-300 dark:border-slate-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/60'
  const lbl = 'text-xs font-medium text-gray-600 dark:text-slate-300'

  const tabs: Array<{ id: BacklogDrawerTab; label: string }> = [
    { id: 'details', label: t('taskDrawer.tabDetails', { defaultValue: 'Детали' }) },
    { id: 'description', label: t('taskDrawer.tabDescription', { defaultValue: 'Описание' }) },
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
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-4 py-3">
          <div className="min-w-0">
            <span className="text-xs text-gray-400">{item.code ?? '—'}</span>
            <p id={TITLE_ID} className="truncate text-sm font-semibold text-gray-800 dark:text-slate-200">{item.title}</p>
          </div>
          <button onClick={requestClose} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div role="tablist" className="flex border-b border-gray-200 dark:border-slate-700 px-2">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
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
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-5">
              <div className="lg:col-span-2">
                <label className={lbl} htmlFor="bl-title">{t('decisions.titleField')}</label>
                <input id="bl-title" className={inp} disabled={!canWrite}
                  aria-invalid={!title} aria-describedby={!title ? 'bl-title-err' : undefined}
                  value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} />
                {/* Пустое название не стережёт ни сервер, ни таблица, а строка без имени при
                    скрытой колонке «Код» опознанию не поддаётся. */}
                {!title && (
                  <p id="bl-title-err" role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {t('backlog.titleRequired', { defaultValue: 'Название не может быть пустым' })}
                  </p>
                )}
              </div>

              <div>
                <label className={lbl} htmlFor="bl-priority">{t('backlog.priority')}</label>
                <select id="bl-priority" className={inp} disabled={!canWrite}
                  value={form.priority ?? 'medium'} onChange={(e) => set('priority', e.target.value)}>
                  {PRIORITY_VALUES.map(o => <option key={o} value={o}>{t(`project.priority.${o}`)}</option>)}
                </select>
              </div>

              <div>
                <label className={lbl} htmlFor="bl-status">{t('common.status')}</label>
                <select id="bl-status" className={inp} disabled={!canWrite}
                  value={form.status ?? 'new'} onChange={(e) => set('status', e.target.value)}>
                  {STATUS_VALUES.map(o => <option key={o} value={o}>{t(`backlog.statuses.${o}`)}</option>)}
                </select>
              </div>

              <div>
                <span className={lbl}>{t('backlog.plannedStart', { defaultValue: 'Начало' })}</span>
                <DateInput value={(form.planned_start as string) ?? ''} className={inp} disabled={!canWrite}
                  ariaLabel={t('backlog.plannedStart', { defaultValue: 'Начало' })}
                  onChange={(iso) => setDate('planned_start', iso || null)} />
              </div>

              <div>
                <span className={lbl}>{t('backlog.plannedEnd', { defaultValue: 'Окончание' })}</span>
                <DateInput value={(form.planned_end as string) ?? ''} className={inp} disabled={!canWrite}
                  ariaLabel={t('backlog.plannedEnd', { defaultValue: 'Окончание' })}
                  onChange={(iso) => setDate('planned_end', iso || null)} />
              </div>

              <div>
                <label className={lbl} htmlFor="bl-days">{t('backlog.estimatedDays')}</label>
                {/* Каскад — по завершении ввода, как в таблице (там пересчёт живёт в commitEdit
                    по blur/Enter). На каждое нажатие он не годится: набрал «7» в поле, где было
                    «30», передумал и стёр — окончание уже уехало на 7 дней и назад не вернётся,
                    потому что пустое значение ничего не пересчитывает. */}
                <input id="bl-days" type="number" min={0} className={inp} disabled={!canWrite}
                  value={daysRaw}
                  onChange={(e) => setDaysRaw(e.target.value)}
                  onBlur={() => commitDays()}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDays() } }} />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  {t('backlog.hints.estimatedDays')}
                </p>
              </div>

              <div className="lg:col-span-2">
                <span className={lbl}>{t('backlog.assignee', { defaultValue: 'Ответственный' })}</span>
                {/* onSelect НЕ передаём намеренно: в паре с onPickPerson он даёт второй вызов
                    сохранения, и тот обнуляет person_id — из-за чего эскалация в план работ
                    теряла исполнителя. Здесь достаточно onPickPerson + onChange. */}
                <PersonPicker
                  className={inp}
                  disabled={!canWrite}
                  ariaLabel={t('backlog.assignee', { defaultValue: 'Ответственный' })}
                  value={form.assignee_name ?? ''}
                  onChange={(v) => { set('assignee_name', v || null); if (!v) set('assignee_person_id', null) }}
                  onPickPerson={(p) => {
                    set('assignee_person_id', p?.id ?? null)
                    if (p) set('assignee_name', p.full_name)
                  }}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  {form.assignee_name && !form.assignee_person_id
                    ? t('backlog.assigneeFreeText', { defaultValue: 'Имя набрано руками: в план работ такой исполнитель не перенесётся — выберите человека из справочника.' })
                    : t('backlog.hints.assignee', { defaultValue: 'Исполнитель задачи. Переносится в Bitrix и при эскалации в План работ.' })}
                </p>
              </div>

              <div className="lg:col-span-2">
                <span className={lbl}>{t('backlog.requestedBy')}</span>
                {/* Парного person_id у «Запросил» в модели нет — берём только имя. */}
                <PersonPicker
                  className={inp}
                  disabled={!canWrite}
                  ariaLabel={t('backlog.requestedBy')}
                  value={form.requested_by ?? ''}
                  onChange={(v) => set('requested_by', v || null)}
                />
              </div>

              <div className="lg:col-span-2">
                <span className={lbl}>{t('bitrix24Task.column', { defaultValue: 'Bitrix24' })}</span>
                {item.bitrix24_task_id ? (
                  <a href={`https://${BITRIX_DOMAIN}/company/personal/user/0/tasks/task/view/${item.bitrix24_task_id}/`}
                    target="_blank" rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                    <ExternalLink size={14} /> {t('bitrix24Task.open', { defaultValue: 'Открыть задачу' })} #{item.bitrix24_task_id}
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    {t('backlog.bitrixInRow', { defaultValue: 'Задача в Bitrix не создана — это делается из строки таблицы.' })}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'description' && (
            <RichTextEditor
              value={form.description ?? ''}
              onChange={(v) => set('description', v || null)}
              rows={16}
              disabled={!canWrite}
              docKey={item.id}
              ariaLabel={t('common.description')}
              placeholder={t('backlog.descriptionPlaceholder', { defaultValue: 'Опишите запрос: в чём суть, зачем нужно, как поймём, что готово. **жирный**, *курсив*, «- » для списка.' })}
            />
          )}
        </div>

        {canWrite && (
          <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3">
            {saveFailed && (
              <p role="status" className="mb-2 text-xs text-red-600 dark:text-red-400">{t('taskDrawer.saveFailedClose')}</p>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !title}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary-fg hover:bg-btn-primary-hover disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? t('common.saving') : t('taskDrawer.saveChanges')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
