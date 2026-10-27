/**
 * Загрузка руководителей проектов: у кого сколько проектов и сколько из них красных.
 *
 * Соседний график «Загрузка по исполнителям» отвечает на вопрос «кто завален задачами».
 * Этот — на вопрос руководства: «кто сколько ВЕДЁТ и кто не тянет». Разные вопросы, разные
 * единицы измерения, поэтому и графика два.
 *
 * Перегрузка считается по проектам, а не по задачам: у РП больше порога проектов ИЛИ есть
 * красный. Порог намеренно мягкий — это повод для разговора, а не приговор.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { PortfolioProject } from '@/api/portfolio'
import { getPortfolioThresholds } from '@/api/portfolio'
import { SectionCard } from '@/components/ui/surface'
import { Pill } from '@/components/ui/badges'
import MetricHelp from '@/components/portfolio/MetricHelp'

/** Запасное значение: пока настройка не загрузилась или сервер её не отдал. */
const OVERLOAD_PROJECTS_FALLBACK = 4

interface Row {
  pm: string
  total: number
  planned: number   // из реестра: проект за человеком закреплён, но ещё не заведён
  red: number
  redLive: number  // красные среди ЗАВЕДЁННЫХ — только они говорят о перегрузке
  amber: number
  overdue: number
  overloaded: boolean
}

/** `stubs` — строки реестра: проекты, которые человек ДОЛЖЕН вести. Считаем их вместе
 *  с заведёнными, потому что вопрос графика — «кто сколько ведёт», а не «кто успел завести»:
 *  без них у руководителя с восемью проектами в плане видно два, и разговор не состоится.
 *  В полосе они отдельным светлым куском, в цифрах — отдельным «ещё не заведены». */
export default function PortfolioManagers({ projects, stubs = [] }: { projects: PortfolioProject[]; stubs?: PortfolioProject[] }) {
  const { t } = useTranslation()
  const { data: limits } = useQuery({ queryKey: ['pf-thresholds'], queryFn: getPortfolioThresholds, staleTime: 300_000 })
  const overloadProjects = limits?.pm_projects || OVERLOAD_PROJECTS_FALLBACK

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>()
    const blank = (pm: string): Row => ({ pm, total: 0, planned: 0, red: 0, redLive: 0, amber: 0, overdue: 0, overloaded: false })
    for (const p of projects) {
      // Закрытые проекты не нагружают руководителя — иначе «ведёт 12» у того, кто ведёт два.
      if (p.status === 'completed' || p.status === 'cancelled') continue
      const pm = p.pm_name || t('portfolio.noPm', { defaultValue: 'Без руководителя' })
      const r = by.get(pm) ?? blank(pm)
      r.total += 1
      if (p.rag_status === 'red') { r.red += 1; r.redLive += 1 }
      if (p.rag_status === 'amber') r.amber += 1
      r.overdue += p.overdue_tasks_count || 0
      by.set(pm, r)
    }
    for (const s of stubs) {
      const pm = s.pm_name || t('portfolio.noPm', { defaultValue: 'Без руководителя' })
      const r = by.get(pm) ?? blank(pm)
      r.total += 1
      r.planned += 1
      // RAG-оценку владелец ставит и незаведённым — она осмысленна и здесь.
      if (s.rag_status === 'red') r.red += 1
      if (s.rag_status === 'amber') r.amber += 1
      by.set(pm, r)
    }
    return [...by.values()]
      // Красный НЕЗАВЕДЁННЫЙ проект — это оценка «будет тяжело», а не перегрузка сегодня:
      // иначе пометка загоралась у человека с одним проектом, которого ещё нет.
      .map((r) => ({ ...r, overloaded: r.total >= overloadProjects || r.redLive > 0 }))
      .sort((a, b) => b.red - a.red || b.total - a.total)
  }, [projects, stubs, overloadProjects, t])

  const max = Math.max(1, ...rows.map((r) => r.total))

  return (
    <SectionCard
      title={t('portfolio.managers.title', { defaultValue: 'Загрузка руководителей проектов' })}
      actions={<MetricHelp anchor="overload" />}
      description={t('portfolio.managers.desc', { defaultValue: 'Сколько проектов ведёт каждый и сколько из них красных.' })}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">{t('common.noResults', { defaultValue: 'Нет данных' })}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.pm} className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${r.overloaded ? 'bg-rose-50 dark:bg-rose-950/40' : ''}`}>
              <span className="w-40 shrink-0 truncate text-slate-700 dark:text-slate-200" title={r.pm}>{r.pm}</span>
              <span className="w-20 shrink-0">
                {r.overloaded && (
                  <Pill className="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    {t('portfolio.overloaded', { defaultValue: 'Перегружен' })}
                  </Pill>
                )}
              </span>
              {/* Составной столбик: сначала красные проекты, потом жёлтые, потом остальные. */}
              <div className="flex h-4 min-w-[110px] flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className="h-full bg-rose-500/80" style={{ width: `${(r.red / max) * 100}%` }} />
                <div className="h-full bg-amber-500/80" style={{ width: `${(r.amber / max) * 100}%` }} />
                <div className="h-full bg-blue-500/80" style={{ width: `${((r.total - r.red - r.amber - r.planned) / max) * 100}%` }} />
                {/* Незаведённые — светлым: видно, сколько из нагрузки ещё даже не начато. */}
                <div className="h-full bg-slate-400/50" style={{ width: `${(r.planned / max) * 100}%` }} />
              </div>
              {/* Общее число проектов; сколько из них ещё не заведено — в подсказке, отдельной
                  колонкой это съедало полосу. */}
              <span
                className="w-10 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300"
                title={r.planned > 0
                  ? t('portfolio.managers.planned', { defaultValue: 'ведёт {{live}}, ещё не заведены: {{count}}', live: r.total - r.planned, count: r.planned })
                  : undefined}
              >
                {r.total - r.planned}
                {/* slate-600/400: приглушённее основного числа, но контраста хватает —
                    slate-400 гейт доступности заворачивает (A11Y-02). */}
                {r.planned > 0 && <span className="text-slate-600 dark:text-slate-400"> +{r.planned}</span>}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-rose-700 dark:text-rose-300">
                {r.red > 0 ? t('portfolio.managers.red', { defaultValue: 'красных: {{count}}', count: r.red }) : ''}
              </span>
              <span className="w-24 shrink-0 truncate text-right tabular-nums text-slate-600 dark:text-slate-400">
                {r.overdue > 0 ? t('portfolio.managers.overdue', { defaultValue: 'просрочено: {{count}}', count: r.overdue }) : ''}
              </span>
            </div>
          ))}
          {/* «3 +2» = ведёт три, ещё два должен завести. */}
          <p className="pt-1 text-[10px] text-slate-600 dark:text-slate-400">
            {t('portfolio.managers.legend', {
              defaultValue: 'длина полосы — сколько проектов ведёт; красная и жёлтая части — проекты с таким статусом, серая — ещё не заведённые из реестра',
            })}
          </p>
        </div>
      )}
    </SectionCard>
  )
}
