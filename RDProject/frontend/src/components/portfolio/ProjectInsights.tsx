/**
 * «Что с проектом» — разбор, ради которого строка в портфеле раскрывается.
 *
 * Жил внутри PortfolioDashboard и потому был доступен только там: вкладка «Подпроекты»
 * зонтика рисовала свою таблицу без разбора, хотя вопрос у человека один и тот же — «почему
 * этот модуль красный». Вынесен сюда целиком, вместе с раскладкой «Требует внимания» по
 * проектам: два места, считающие одно и то же по-разному, на этом проекте уже расходились.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { PortfolioProject } from '@/api/portfolio'
import type { AttentionGroupKey, AttentionItem, AttentionResponse } from '@/api/attention'
import { formatDate } from '@/utils/date'
import { Pill } from '@/components/ui/badges'
import { Button } from '@/components/ui/button'
import { getRagLabel } from '@/components/portfolio/portfolioHelpers'

/** Группы колокольчика, попадающие в разбор. Запросы доступа и ответы на них сюда не входят
 *  намеренно: разбор отвечает «что не так с ПРОЕКТОМ», а запрос доступа с проектом ничего не
 *  делает — его решают в колокольчике. */
export const ATTENTION_GROUPS: AttentionGroupKey[] = ['overdue', 'due_soon', 'stalled', 'actions', 'meetings']

export type AttentionByProject = Map<string, Partial<Record<AttentionGroupKey, AttentionItem[]>>>

/** Разложить ответ /attention по проектам: раскрытая строка показывает только своё. */
export function groupAttentionByProject(attention: AttentionResponse | undefined): AttentionByProject {
  const map: AttentionByProject = new Map()
  for (const group of ATTENTION_GROUPS) {
    for (const item of attention?.data?.[group] ?? []) {
      const pid = String(item.project_id)
      const bucket = map.get(pid) ?? {}
      bucket[group] = [...(bucket[group] ?? []), item]
      map.set(pid, bucket)
    }
  }
  return map
}

export default function ProjectInsights({ project: p, attention: att = {} }: {
  project: PortfolioProject
  attention?: Partial<Record<AttentionGroupKey, AttentionItem[]>>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const reasons = useMemo(() => {
    const out: { key: string; text: string; tone: 'red' | 'amber' }[] = []
    if (p.rag_status === 'red') {
      out.push({ key: 'rag', tone: 'red', text: t('portfolio.insight.red', { defaultValue: 'Красный статус — нужна эскалация' }) })
    }
    if (p.overdue_tasks_count > 0) {
      out.push({ key: 'overdue', tone: 'red', text: t('portfolio.insight.overdue', { defaultValue: 'Просроченных задач: {{count}}', count: p.overdue_tasks_count }) })
    }
    if (p.open_risks_high_count > 0) {
      out.push({ key: 'risks', tone: 'red', text: t('portfolio.insight.highRisks', { defaultValue: 'Высоких открытых рисков: {{count}}', count: p.open_risks_high_count }) })
    }
    if (p.open_risks_medium_count > 0) {
      out.push({ key: 'risksM', tone: 'amber', text: t('portfolio.insight.mediumRisks', { defaultValue: 'Средних открытых рисков: {{count}}', count: p.open_risks_medium_count }) })
    }
    if ((p.baseline_deviation_days ?? 0) > 0) {
      out.push({ key: 'baseline', tone: 'amber', text: t('portfolio.insight.baseline', { defaultValue: 'Сдвиг против базового плана: {{days}} дн.', days: p.baseline_deviation_days }) })
    }
    if (p.budget_plan != null && (p.budget_actual ?? 0) > p.budget_plan) {
      out.push({ key: 'budget', tone: 'red', text: t('portfolio.insight.budget', { defaultValue: 'Факт бюджета больше плана' }) })
    }
    return out
  }, [p, t])

  const groupTitle: Partial<Record<AttentionGroupKey, string>> = {
    overdue: t('attention.groups.overdue', { defaultValue: 'Просрочено' }),
    due_soon: t('attention.groups.due_soon', { defaultValue: 'Ближайшие сроки' }),
    stalled: t('attention.groups.stalled', { defaultValue: 'Застопорилось' }),
    actions: t('attention.groups.actions', { defaultValue: 'Поручения' }),
    meetings: t('attention.groups.meetings', { defaultValue: 'Совещания' }),
    no_dates: t('attention.groups.no_dates', { defaultValue: 'Без дат' }),
  }

  return (
    // Ширину разбора ограничиваем: таблица шире экрана и скроллится вбок, а разбор должен
    // читаться на месте, без горизонтальной прокрутки.
    <div className="grid max-w-[1100px] gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('portfolio.insight.title', { defaultValue: 'Что с проектом' })}
        </p>
        {reasons.length === 0 ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            {t('portfolio.insight.ok', { defaultValue: 'Отклонений нет: просрочки, высоких рисков и перерасхода не видно.' })}
          </p>
        ) : (
          <ul className="space-y-1">
            {reasons.map((r) => (
              <li key={r.key} className="flex items-start gap-2 text-xs">
                <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${r.tone === 'red' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                <span className="text-slate-700 dark:text-slate-200">{r.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {t('portfolio.progress')}: {p.progress}%
          </Pill>
          {p.planned_end && (
            <Pill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {t('portfolio.endDate')}: {formatDate(p.planned_end)}
            </Pill>
          )}
          {p.rag_status && (
            <Pill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {t('portfolio.ragLabel', { defaultValue: 'RAG' })}: {getRagLabel(p.rag_status, t)}
            </Pill>
          )}
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${p.id}/passport`)}>
            {t('portfolio.openProject', { defaultValue: 'Открыть проект' })}
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('attention.title', { defaultValue: 'Требует внимания' })}
        </p>
        {ATTENTION_GROUPS.every((g) => !(att[g] ?? []).length) ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('portfolio.insight.noAttention', { defaultValue: 'Ничего не требует внимания на ближайшую неделю.' })}
          </p>
        ) : (
          <div className="space-y-2">
            {ATTENTION_GROUPS.filter((g) => (att[g] ?? []).length > 0).map((g) => (
              <div key={g}>
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  {groupTitle[g] ?? g} · {(att[g] ?? []).length}
                </p>
                {/* Показываем ВСЁ: «…ещё 10» заставляет открывать проект ради списка,
                    ради ухода от которого разбор и делался. */}
                <ul className="mt-0.5 space-y-0.5">
                  {(att[g] ?? []).map((item) => (
                    <li key={`${g}-${item.id}`} className="text-xs text-slate-600 dark:text-slate-400">
                      · {item.title || '—'}
                      {item.planned_end || item.due_date || item.date
                        ? ` — ${formatDate((item.planned_end || item.due_date || item.date) as string)}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
