/**
 * Черновики от помощника: список и экран согласования.
 *
 * Главное правило экрана — галочки ПОЭЛЕМЕНТНО, а не «принять всё или ничего». Одна кривая
 * задача не должна отправлять в корзину девять нормальных: иначе человек будет отклонять
 * целиком и вернётся к ручному вводу, ради ухода от которого всё и затевалось.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Square, Loader2, FileText } from 'lucide-react'

import { PageShell, PageHeader } from '@/components/ui/layout'
import { SectionCard, Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/badges'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/feedback'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import {
  acceptDraft, getDraft, getDrafts, patchDraft, rejectDraft,
  type Draft, type DraftItem, type DraftOp,
} from '@/api/drafts'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime } from '@/utils/date'
import { stripRichText } from '@/utils/richText'

/** Цвет пометки. Держим рядом с экраном: по-табные палитры в проекте намеренно не централизованы. */
const OP_CLASS: Record<DraftOp, string> = {
  add: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  edit: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  delete: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  skip: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  clash: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
}

function opLabel(t: (k: string, o?: Record<string, unknown>) => string, op: DraftOp): string {
  const dflt: Record<DraftOp, string> = {
    add: 'добавить', edit: 'изменить', delete: 'удалить', skip: 'повтор', clash: 'расходится',
  }
  return t(`drafts.op.${op}`, { defaultValue: dflt[op] })
}

/** Разделы черновика названы по-серверному; в интерфейсе у четырёх из них другие имена. */
const SECTION_KEY: Record<string, string> = {
  tasks: 'wbs', 'communication-plan': 'comm-plan', 'budget-items': 'budget', 'status-reports': 'reports',
}

/** Название элемента: у разных разделов оно лежит в разных полях. */
function itemTitle(it: DraftItem): string {
  const d = (it.data || {}) as Record<string, unknown>
  for (const k of ['title', 'name', 'full_name', 'question', 'article']) {
    const v = d[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  // Для изменения и удаления название подставляет сервер — помощник шлёт только правки.
  if (it.target_title) return it.target_title
  return it.target_id ? `#${it.target_id}` : '—'
}

/** Человеческие подписи полей. Список короткий намеренно: сюда попадает то, что помощник
 *  меняет чаще всего; для остального остаётся имя поля — это лучше, чем пустая строка. */
const FIELD_LABELS: Record<string, string> = {
  planned_start: 'начало', planned_end: 'срок', actual_start: 'факт. начало', actual_end: 'факт. конец',
  status: 'статус', assignee_person_id: 'исполнитель', description: 'описание', role: 'роль',
  probability: 'вероятность', impact: 'влияние', owner_name: 'владелец', mitigation: 'митигация',
  email: 'почта', phone: 'телефон', position: 'должность', priority: 'приоритет',
  progress: 'прогресс', amount: 'сумма', rationale: 'обоснование',
}

/** Значение в одну строку подписи. Описание приходит оформленным и многострочным: значки
 *  разметки тут не нарисовать, а переводы строк в подписи всё равно схлопнутся — поэтому
 *  снимаем маркеры и заменяем переносы точкой с запятой. Иначе человек принимает предложение,
 *  глядя на «## Что сделать - **собрать**…». */
function hintValue(v: unknown): string {
  return stripRichText(String(v ?? '')).replace(/\s*\n+\s*/g, '; ').trim()
}

/** Подпись под названием: для изменения показываем «было → стало», для пропуска — причину. */
function itemHint(t: (k: string, o?: Record<string, unknown>) => string, it: DraftItem): string {
  if (it.note) return it.note
  const d = (it.data || {}) as Record<string, unknown>
  const was = (it.was || {}) as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (k === 'title' || k === 'name') continue
    const label = FIELD_LABELS[k] ? t(`drafts.field.${k}`, { defaultValue: FIELD_LABELS[k] }) : k
    const before = was[k]
    if (before !== undefined && String(before) !== String(v)) parts.push(`${label}: ${hintValue(before)} → ${hintValue(v)}`)
    else if (before === undefined && v !== null && v !== '') parts.push(`${label}: ${hintValue(v)}`)
    if (parts.length >= 3) break
  }
  return parts.join(' · ')
}

/** Цвет пометки решения: принят/отклонён. Держим рядом с OP_CLASS — тот же принцип. */
const DECISION_CLASS: Record<'accepted' | 'rejected', string> = {
  accepted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
}

/** Один пункт отчёта: созданное/изменённое/удалённое (без `item`) либо не применившееся (с ним). */
type ReportEntry = { section?: string; id?: string | null; item?: string | null; title?: string | null; why?: string }

/** Строка отчёта о применении: та же пометка и та же вёрстка, что и в предпросмотре черновика —
 *  разница только в источнике данных (результат приёма, а не предложение). */
function ReportRow({ t, op, entry }: {
  t: (k: string, o?: Record<string, unknown>) => string
  op: DraftOp | 'failed'
  entry: ReportEntry
}) {
  const title = entry.title
  const label = typeof title === 'string' && title.trim()
    ? title
    : (entry.id || entry.item ? `#${entry.id ?? entry.item}` : '—')
  const sectionLabel = entry.section
    ? t(`project.sections.${SECTION_KEY[entry.section] || entry.section}`, { defaultValue: entry.section })
    : ''
  const pillClass = op === 'failed' ? OP_CLASS.clash : OP_CLASS[op]
  const pillLabel = op === 'failed' ? t('drafts.notApplied', { defaultValue: 'не удалось' }) : opLabel(t, op)
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Pill className={cn('shrink-0', pillClass)}>{pillLabel}</Pill>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {(sectionLabel || entry.why) && (
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {sectionLabel}{sectionLabel && entry.why ? ' · ' : ''}{entry.why}
          </div>
        )}
      </div>
    </div>
  )
}

/** Экран закрытого черновика: принят или отклонён. Кнопок согласования тут нет — решение уже
 *  принято, и повторное «Принять» сервер отклонит («Черновик уже закрыт»). Вместо кнопок — что
 *  случилось: кто решил, когда, и (для принятого) отчёт о применении с названиями изменённого
 *  и удалённого. Отчёт — единственное место в интерфейсе, где удалённое названо поимённо: в
 *  журнале действий проекта об этом только число. */
function DraftClosedView({ draft }: { draft: Draft }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const status = draft.status as 'accepted' | 'rejected'
  const report = draft.result
  const rows: Array<{ op: DraftOp | 'failed'; entry: ReportEntry }> = report
    ? [
        ...report.created.map(entry => ({ op: 'add' as const, entry })),
        ...report.updated.map(entry => ({ op: 'edit' as const, entry })),
        ...report.deleted.map(entry => ({ op: 'delete' as const, entry })),
        ...report.failed.map(entry => ({ op: 'failed' as const, entry })),
      ]
    : []

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('drafts.eyebrow', { defaultValue: 'Помощник' })}
        title={draft.title}
        description={`${t('drafts.source', { defaultValue: 'Источник' })}: ${draft.source}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/drafts')}>
            {t('drafts.backToList', { defaultValue: 'К списку черновиков' })}
          </Button>
        }
      />

      <SectionCard title={t('drafts.decisionTitle', { defaultValue: 'Решение' })}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill className={DECISION_CLASS[status]}>
            {status === 'accepted'
              ? t('drafts.statusAccepted', { defaultValue: 'Принят' })
              : t('drafts.statusRejected', { defaultValue: 'Отклонён' })}
          </Pill>
          <span className="text-slate-600 dark:text-slate-400">
            {t('drafts.decidedLine', {
              defaultValue: '{{by}} · {{when}}',
              by: draft.decided_by || '—',
              when: formatDateTime(draft.decided_at),
            })}
          </span>
        </div>
      </SectionCard>

      {report && (
        <SectionCard
          title={t('drafts.reportTitle', { defaultValue: 'Отчёт о применении' })}
          description={t('drafts.reportHint', {
            defaultValue: 'Что именно создано, изменено и удалено — включая названия удалённого.',
          })}
        >
          {rows.length ? (
            <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row, i) => <ReportRow key={i} t={t} op={row.op} entry={row.entry} />)}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('drafts.reportEmpty', { defaultValue: 'Отчёт пуст — ничего не изменилось.' })}
            </p>
          )}
        </SectionCard>
      )}

      {/* Сдвиг по цепочке зависимостей человек не заказывал: он просто следует из новых дат.
          Без этого списка о нём узнают, только сверив План работ построчно. */}
      {!!report?.cascaded?.length && (
        <SectionCard
          title={t('drafts.cascadedTitle', { defaultValue: 'Сдвинуто по связям' })}
          description={t('drafts.cascadedHint', {
            defaultValue: 'Эти задачи черновик не называл — они поехали следом за новыми сроками '
              + 'своих предшественников.',
          })}
        >
          <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {report.cascaded.map(row => (
              <div key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
                <span className="text-sm font-medium">{row.title || `#${row.id}`}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(row.planned_start)} — {formatDate(row.planned_end)}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </PageShell>
  )
}

export default function DraftsPage() {
  const { id } = useParams<{ id: string }>()
  return id ? <DraftReview id={id} /> : <DraftList />
}

function DraftList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['drafts'], queryFn: getDrafts })

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('drafts.eyebrow', { defaultValue: 'Помощник' })}
        title={t('drafts.title', { defaultValue: 'Черновики' })}
        description={t('drafts.subtitle', {
          defaultValue: 'Предложения помощника. В проекте ничего не меняется, пока вы не приняли.',
        })}
      />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState
          icon={<FileText size={20} />}
          title={t('drafts.emptyTitle', { defaultValue: 'Черновиков нет' })}
          description={t('drafts.emptyText', {
            defaultValue: 'Когда помощник предложит изменения, они появятся здесь и будут ждать вашего решения.',
          })}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map(d => (
            <Surface key={d.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{d.title}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {d.source} · {d.author}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Pill className={OP_CLASS.add}>+{d.counts.add}</Pill>
                <Pill className={OP_CLASS.edit}>~{d.counts.edit}</Pill>
                {d.counts.clash > 0 && <Pill className={OP_CLASS.clash}>!{d.counts.clash}</Pill>}
                <Button size="sm" onClick={() => navigate(`/drafts/${d.id}`)}>
                  {t('drafts.open', { defaultValue: 'Открыть' })}
                </Button>
              </div>
            </Surface>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function DraftReview({ id }: { id: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const showConfirm = useConfirmStore(s => s.show)
  const showToast = useToastStore(s => s.show)

  const { data: draft, isLoading } = useQuery({ queryKey: ['draft', id], queryFn: () => getDraft(id) })
  const [items, setItems] = useState<DraftItem[]>([])
  const [section, setSection] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (draft?.items) {
      setItems(draft.items)
      setSection(prev => prev || draft.items[0]?.section || '')
    }
  }, [draft])

  /** Разделы с числом элементов — левая колонка. */
  const sections = useMemo(() => {
    const map = new Map<string, { total: number; selected: number }>()
    for (const it of items) {
      const cur = map.get(it.section) || { total: 0, selected: 0 }
      cur.total += 1
      if (it.selected) cur.selected += 1
      map.set(it.section, cur)
    }
    return [...map.entries()]
  }, [items])

  const shown = items.filter(it => it.section === section)
  const selectedCount = items.filter(it => it.selected).length
  const applicable = items.filter(it => it.op === 'add' || it.op === 'edit' || it.op === 'delete').length

  const toggle = (itemId: string) => {
    setItems(prev => prev.map(it => (it.id === itemId ? { ...it, selected: !it.selected } : it)))
  }

  const toggleSection = (sec: string, on: boolean) => {
    setItems(prev => prev.map(it => (it.section === sec && it.op !== 'skip' && it.op !== 'clash'
      ? { ...it, selected: on } : it)))
  }

  const save = async () => {
    await patchDraft(id, items.map(it => ({ id: it.id, selected: it.selected })))
    await qc.invalidateQueries({ queryKey: ['draft', id] })
  }

  const accept = async () => {
    setBusy(true)
    try {
      await save()
      const res = await acceptDraft(id)
      await qc.invalidateQueries({ queryKey: ['drafts'] })
      if (draft?.project_id) {
        await qc.invalidateQueries({ queryKey: ['project', draft.project_id] })
        await qc.invalidateQueries({ queryKey: ['tasks', draft.project_id] })
        await qc.invalidateQueries({ queryKey: ['risks', draft.project_id] })
      }
      // Отчёт о приёме сервер считает честно — и его обязан увидеть человек. Молчание здесь
      // означало бы, что часть предложений тихо не применилась, а он уверен, что применилось всё.
      const failed = res.report.failed?.length || 0
      const applied = (res.report.created?.length || 0) + (res.report.updated?.length || 0)
                    + (res.report.deleted?.length || 0)
      if (failed) {
        showToast(t('drafts.acceptedPartly', {
          defaultValue: 'Применено {{n}}, не удалось {{failed}} — посмотрите разделы проекта',
          n: applied, failed,
        }), 'error')
      } else {
        showToast(t('drafts.accepted', { defaultValue: 'Применено: {{n}}', n: applied }), 'success')
      }
      navigate(draft?.project_id ? `/projects/${draft.project_id}` : '/drafts')
    } finally {
      setBusy(false)
    }
  }

  const reject = () => {
    showConfirm(
      t('drafts.rejectConfirm', { defaultValue: 'Отклонить черновик целиком? Вернуть его будет нельзя.' }),
      async () => {
        await rejectDraft(id)
        await qc.invalidateQueries({ queryKey: ['drafts'] })
        navigate('/drafts')
      },
      { variant: 'danger' },
    )
  }

  if (isLoading) return <PageShell><SkeletonRows rows={6} /></PageShell>
  if (!draft) {
    return (
      <PageShell>
        <EmptyState
          title={t('drafts.notFound', { defaultValue: 'Черновик не найден' })}
          description={t('drafts.notFoundText', { defaultValue: 'Возможно, его уже приняли или отклонили.' })}
        />
      </PageShell>
    )
  }
  // Черновик уже закрыт (принят автоматически или вручную, либо отклонён) — кнопки согласования
  // тут неуместны: сервер вернёт «Черновик уже закрыт» на попытку принять. Показываем решение
  // и, если применяли, отчёт с названиями изменённого и удалённого.
  if (draft.status !== 'open') {
    return <DraftClosedView draft={draft} />
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('drafts.eyebrow', { defaultValue: 'Помощник' })}
        title={draft.title}
        description={`${t('drafts.source', { defaultValue: 'Источник' })}: ${draft.source}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={reject}>
              {t('drafts.reject', { defaultValue: 'Отклонить' })}
            </Button>
            <Button variant="secondary" onClick={() => { void save().then(() => navigate('/drafts')) }}>
              {t('drafts.later', { defaultValue: 'Сохранить и вернуться позже' })}
            </Button>
            <Button onClick={() => { void accept() }} disabled={busy || selectedCount === 0}
                    icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              {t('drafts.accept', { defaultValue: 'Принять отмеченное' })}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SectionCard title={t('drafts.composition', { defaultValue: 'Состав черновика' })}>
          <div className="flex flex-col">
            {/* Галочка и выбор раздела — СОСЕДИ, не вложенные кнопки: вложенный интерактив
                axe считает серьёзным нарушением, а гейт доступности падает на serious. */}
            {sections.map(([sec, c]) => {
              const label = t(`project.sections.${SECTION_KEY[sec] || sec}`, { defaultValue: sec })
              return (
                <div
                  key={sec}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1 text-sm',
                    sec === section ? 'bg-primary-50 dark:bg-primary-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={c.selected === c.total}
                    aria-label={t('drafts.toggleSection', { defaultValue: 'Отметить весь раздел: {{name}}', name: label })}
                    onClick={() => toggleSection(sec, c.selected < c.total)}
                    className="shrink-0 py-1"
                  >
                    {c.selected > 0
                      ? <CheckSquare size={16} className="text-primary-600 dark:text-primary-400" />
                      : <Square size={16} className="text-slate-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection(sec)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {c.selected}/{c.total}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard
          title={t('drafts.preview', { defaultValue: 'Предпросмотр' })}
          description={t('drafts.previewHint', {
            defaultValue: 'Снимите галочку с лишнего. Повторы и расхождения не применяются вовсе.',
          })}
        >
          <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map(it => {
              const applies = it.op === 'add' || it.op === 'edit' || it.op === 'delete'
              return (
                <div key={it.id} className="flex items-start gap-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => applies && toggle(it.id)}
                    disabled={!applies}
                    aria-label={t('drafts.toggleItem', { defaultValue: 'Включить в приём' })}
                    className="mt-0.5 shrink-0 disabled:opacity-40"
                  >
                    {it.selected
                      ? <CheckSquare size={16} className="text-primary-600 dark:text-primary-400" />
                      : <Square size={16} className="text-slate-400" />}
                  </button>
                  <Pill className={cn('shrink-0', OP_CLASS[it.op])}>{opLabel(t, it.op)}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{itemTitle(it)}</div>
                    {itemHint(t, it) && (
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{itemHint(t, it)}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('drafts.footer', {
          defaultValue: 'Отмечено {{n}} из {{total}} применимых. Пропуски и расхождения не применяются.',
          n: selectedCount, total: applicable,
        })}
      </p>
    </PageShell>
  )
}
