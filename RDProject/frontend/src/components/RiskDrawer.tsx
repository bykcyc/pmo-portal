import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Save } from 'lucide-react'
import type { Risk } from '@/types/risk'
import PersonPicker from '@/components/PersonPicker'
import { useCanWrite } from '@/contexts/ProjectPermission'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ACTION_COLORS, HIL, SCORE_COLOR, getRiskAction, riskScore } from '@/utils/riskScore'

const TITLE_ID = 'risk-drawer-title'
const STATUS_OPTIONS = ['open', 'mitigated', 'accepted', 'closed', 'occurred']
const CATEGORY_OPTIONS = ['technical', 'financial', 'operational', 'external', 'personnel']

interface Props {
  risk: Risk | null
  code?: string
  onClose: () => void
  onSave: (id: string, data: Partial<Risk>) => Promise<void>
}

/**
 * Карточка риска — по образцу карточки задачи (TaskDrawer).
 *
 * Зачем она вообще: в реестре план митигации редактировался ОДНОСТРОЧНЫМ полем шириной 160px,
 * а в таблице любая текстовая ячейка обрезана двумя строками (line-clamp-2). То есть самое важное
 * в риске — что мы намерены делать — нельзя было ни прочитать, ни толком написать. Раздвигать
 * колонки бесполезно: их сумма ограничена шириной контейнера. Здесь три полноценных textarea.
 */
export default function RiskDrawer({ risk, code, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const canWrite = useCanWrite()
  const [form, setForm] = useState<Partial<Risk>>({})
  const [saving, setSaving] = useState(false)
  /** Сервер отказал: карточка остаётся открытой с целыми правками, а второе нажатие на
   *  закрытие выпускает без сохранения — иначе выхода из неё нет вовсе. */
  const [saveFailed, setSaveFailed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  /** Что человек тронул — наружу уходит только это (приём карточки пункта бэклога). Раз закрытие
   *  теперь сохраняет, снимок целиком откатывал бы чужие правки одним фактом закрытия. */
  const dirty = useRef<Set<keyof Risk>>(new Set())

  useEffect(() => {
    if (risk) { setForm({ ...risk }); dirty.current = new Set() }
  }, [risk])

  // Через ref — requestClose пересоздаётся каждый рендер, а обработчик вешается один раз.
  const closeRef = useRef<() => void>(onClose)
  useEffect(() => {
    if (!risk) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [risk])

  useFocusTrap(dialogRef, !!risk)

  if (!risk) return null

  const set = (key: keyof Risk, val: string | null) => {
    dirty.current.add(key)
    setForm(f => ({ ...f, [key]: val }))
  }

  const save = async () => {
    const patch: Partial<Risk> = {}
    for (const k of dirty.current) (patch as Record<string, unknown>)[k] = form[k] ?? null
    // Пустое название сервер запишет пустой строкой — в реестре появилась бы безымянная строка.
    // Название оставляем прежним, остальные правки уносим (как в карточке пункта бэклога).
    if (!String(form.title ?? '').trim()) delete patch.title
    if (!Object.keys(patch).length) return
    setSaving(true)
    try {
      await onSave(risk.id, patch)
      for (const k of Object.keys(patch)) dirty.current.delete(k as keyof Risk)
      setSaveFailed(false)
    } catch (e) {
      setSaveFailed(true)
      throw e
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    try {
      await save()
    } catch {
      return   // отказ сервера — карточку не закрываем, правки на экране целы
    }
    onClose()
  }

  /** Закрыть — значит сохранить. Здесь теряли самое дорогое: план митигации и план на случай —
   *  три полноразмерных поля, ради которых карточка и заводилась. */
  const requestClose = async () => {
    // Второе нажатие после отказа сервера выпускает без записи: иначе карточка становится
    // ловушкой — не работает ни крестик, ни Escape, ни подложка.
    if (saveFailed) { onClose(); return }
    if (!canWrite || !dirty.current.size) { onClose(); return }
    try {
      await save()
      onClose()
    } catch {
      // Сервер не принял — карточку НЕ закрываем: набранное на экране цело.
    }
  }
  closeRef.current = requestClose

  // Балл и действие пересчитываем на лету: сервер посчитает то же самое при сохранении,
  // но человек должен видеть последствия своего выбора сразу, а не после «Сохранить».
  const score = riskScore(form.probability, form.impact)
  const action = getRiskAction(form.probability, form.impact)

  const inp = 'w-full text-sm border border-gray-300 dark:border-slate-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-slate-900'
  const lbl = 'text-xs font-medium text-gray-600 dark:text-slate-300'

  const hilOptions = HIL.map(v => ({ value: v, label: t(`risks.levels.${v}`) }))

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // mousedown, а не click: с `click` карточка закрывалась, когда текст плана выделяли мышью
      // и отпускали кнопку за краем панели — браузер отдаёт click общему предку, подложке.
      onMouseDown={requestClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-4 py-3">
          <div className="min-w-0">
            <span className="font-mono text-xs text-gray-400">{code ?? risk.code ?? '—'}</span>
            <p id={TITLE_ID} className="truncate text-sm font-semibold text-gray-800 dark:text-slate-200">{risk.title}</p>
          </div>
          <button onClick={requestClose} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <label className={lbl} htmlFor="risk-title">{t('risks.titleCol')}</label>
            <input id="risk-title" className={inp} disabled={!canWrite}
              value={form.title ?? ''} onChange={e => set('title', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} htmlFor="risk-category">{t('risks.category')}</label>
              <select id="risk-category" className={inp} disabled={!canWrite}
                value={form.category ?? ''} onChange={e => set('category', e.target.value || null)}>
                <option value="">—</option>
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{t(`risks.categories.${o}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="risk-status">{t('common.status')}</label>
              <select id="risk-status" className={inp} disabled={!canWrite}
                value={form.status ?? 'open'} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{t(`risks.statuses.${o}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="risk-probability">{t('risks.probability')}</label>
              <select id="risk-probability" className={inp} disabled={!canWrite}
                value={form.probability ?? ''} onChange={e => set('probability', e.target.value || null)}>
                <option value="">—</option>
                {hilOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="risk-impact">{t('risks.impact')}</label>
              <select id="risk-impact" className={inp} disabled={!canWrite}
                value={form.impact ?? ''} onChange={e => set('impact', e.target.value || null)}>
                <option value="">—</option>
                {hilOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Следствие выбора: балл и рекомендуемое действие — их считает та же формула, что и сервер */}
          <div className="flex items-center gap-4 rounded-md bg-gray-50 dark:bg-slate-800/60 px-3 py-2">
            <span className="text-xs text-gray-500 dark:text-slate-400">{t('risks.score')}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${SCORE_COLOR(score)}`}>{score ?? '—'}</span>
            <span className="text-xs text-gray-500 dark:text-slate-400">{t('risks.action')}</span>
            {action ? (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_COLORS[action]}`}>
                {t(`risks.actions.${action}`)}
              </span>
            ) : <span className="text-xs text-gray-400">—</span>}
          </div>

          <div>
            <label className={lbl}>{t('risks.owner')}</label>
            <PersonPicker
              className={inp}
              value={form.owner ?? ''}
              onChange={v => set('owner', v || null)}
              onSelect={v => set('owner', v || null)}
            />
          </div>

          <div>
            <label className={lbl} htmlFor="risk-description">{t('risks.description')}</label>
            <textarea id="risk-description" rows={3} className={inp} disabled={!canWrite}
              value={form.description ?? ''} onChange={e => set('description', e.target.value || null)} />
          </div>

          <div>
            <label className={lbl} htmlFor="risk-mitigation">{t('risks.mitigation')}</label>
            <textarea id="risk-mitigation" rows={4} className={inp} disabled={!canWrite}
              value={form.mitigation_plan ?? ''} onChange={e => set('mitigation_plan', e.target.value || null)} />
          </div>

          <div>
            <label className={lbl} htmlFor="risk-contingency">{t('risks.contingencyPlan')}</label>
            <textarea id="risk-contingency" rows={3} className={inp} disabled={!canWrite}
              value={form.contingency_plan ?? ''} onChange={e => set('contingency_plan', e.target.value || null)} />
          </div>
        </div>

        {canWrite && (
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
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
