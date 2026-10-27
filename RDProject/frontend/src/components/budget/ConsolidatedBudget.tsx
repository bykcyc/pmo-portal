/**
 * Сводный бюджет по дереву: у зонтика — матрица «блок × подпроекты», у подпроекта — остаток.
 *
 * Это ответ на вопрос, ради которого затевалась связка проектов: сколько осталось по блоку
 * подрядчика. Раньше его собирали руками из вкладок всех подпроектов, и к моменту сборки цифры
 * успевали устареть.
 *
 * Привязка статьи подпроекта к блоку зонтика ОТНОСИТ, но ничего не обнуляет: свои план и факт
 * у подпроекта остаются на месте, а здесь видно, как они складываются в общую картину. Первый
 * замысел обнулял план у привязанной статьи — и «эти деньги считают в другом месте»
 * становилось неотличимо от «денег нет».
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { ConsolidatedBudget as Consolidated, ConsolidatedBlock, ConsolidatedShare } from '@/types/budget'
import { SectionCard } from '@/components/ui/surface'

const money = (v: number | null | undefined, currency?: string) =>
  v == null ? '—' : `${Math.round(v).toLocaleString('ru-RU')}${currency ? ' ' + currency : ''}`

/** Остаток — единственное число здесь, которое обязано бросаться в глаза: минус зовут подрядчику. */
const remainCls = (v: number) =>
  v < 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-gray-800 dark:text-slate-100'

export default function ConsolidatedBudgetView({ data }: { data: Consolidated }) {
  const { t } = useTranslation()
  if (!data || data.view === 'none') return null
  const cur = data.currency

  const mixedCurrencies = (data.currencies?.length ?? 0) > 1
  const warn = (text: string) => (
    <p className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  )

  if (data.view === 'subproject') {
    const blocks = (data.blocks ?? []) as ConsolidatedShare[]
    return (
      <SectionCard
        title={t('budget.fromUmbrella', { defaultValue: 'Взято из бюджета общего проекта' })}
        description={t('budget.fromUmbrellaHint', {
          defaultValue: 'Блоки проекта «{{name}}»: сколько в блоке всего, сколько уже израсходовано по всем подпроектам и сколько из этого ваше.',
          name: data.parent_name || data.parent_code || '',
        })}
      >
        {blocks.length === 0 ? (
          <p className="text-xs italic text-gray-500 dark:text-slate-400">
            {t('budget.noBlocks', { defaultValue: 'В общем проекте пока нет расходных блоков.' })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">{t('budget.block', { defaultValue: 'Блок' })}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('budget.plan')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('budget.consumedAll', { defaultValue: 'Израсходовано всего' })}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('budget.myShare', { defaultValue: 'Из них моё' })}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('budget.remaining', { defaultValue: 'Остаток' })}</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.item_id} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{b.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-slate-300">{money(b.planned, cur)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-slate-300">{money(b.consumed, cur)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-800 dark:text-slate-100">{money(b.my_actual, cur)}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${remainCls(b.remaining)}`}>{money(b.remaining, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    )
  }

  const blocks = (data.blocks ?? []) as ConsolidatedBlock[]
  const kids = Array.from(new Map(
    blocks.flatMap(b => b.by_child.map(c => [c.project_id, c] as const))).values())
  const totals = data.totals

  return (
    <SectionCard
      title={t('budget.consolidated', { defaultValue: 'Распределение по подпроектам' })}
      description={t('budget.consolidatedHint', {
        defaultValue: 'План по блокам — ваш; израсходованное подтягивается из подпроектов, отнёсших к блоку свои статьи. Остаток по блоку — это то, что ещё можно поручить подрядчику.',
      })}
    >
      {mixedCurrencies && warn(t('budget.mixedCurrencies', {
        defaultValue: 'В дереве встречаются разные валюты ({{list}}). Пересчёта в портале нет, поэтому суммы по блокам считаются только по проектам с валютой общего проекта.',
        list: (data.currencies || []).join(', '),
      }))}
      {(data.foreign_currency?.length ?? 0) > 0 && (
        <p className="mb-3 text-xs text-gray-500 dark:text-slate-400">
          {t('budget.foreignCurrency', { defaultValue: 'Считаются отдельно (другая валюта):' })}{' '}
          {data.foreign_currency!.map(f => `${f.project_code} ${Math.round(f.actual).toLocaleString('ru-RU')} ${f.currency}`).join(' · ')}
        </p>
      )}

      {blocks.length === 0 ? (
        <p className="text-xs italic text-gray-500 dark:text-slate-400">
          {t('budget.noBlocksOwn', { defaultValue: 'Расходных блоков пока нет — добавьте статьи бюджета, и подпроекты смогут относить к ним свои расходы.' })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                <th className="py-2 pr-3 font-medium">{t('budget.block', { defaultValue: 'Блок' })}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('budget.plan')}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('budget.ownActual', { defaultValue: 'Свой факт' })}</th>
                {kids.map(k => (
                  <th key={k.project_id} className="py-2 pr-3 text-right font-medium" title={k.project_name}>
                    {k.project_code || k.project_name}
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-medium">{t('budget.consumedAll', { defaultValue: 'Израсходовано всего' })}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('budget.remaining', { defaultValue: 'Остаток' })}</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map(b => {
                const byKid = new Map(b.by_child.map(c => [c.project_id, (byKidSum(b, c.project_id))]))
                return (
                  <tr key={b.item_id} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                      {b.name}
                      {b.planned_hours ? (
                        <span className="ml-1 text-gray-400 dark:text-slate-500">
                          · {b.planned_hours} {t('budget.hoursShort', { defaultValue: 'ч' })}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-slate-300">{money(b.planned, cur)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-slate-300">{money(b.own_actual, cur)}</td>
                    {kids.map(k => (
                      <td key={k.project_id} className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-slate-300">
                        {byKid.get(k.project_id) ? money(byKid.get(k.project_id), cur) : '—'}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-800 dark:text-slate-100">{money(b.consumed, cur)}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${remainCls(b.remaining)}`}>{money(b.remaining, cur)}</td>
                  </tr>
                )
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-semibold dark:border-slate-600">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-100">{t('budget.total', { defaultValue: 'Итого' })}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(totals.planned, cur)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(totals.own_actual, cur)}</td>
                  {kids.map(k => <td key={k.project_id} />)}
                  <td className="py-2 pr-3 text-right tabular-nums">{money(totals.consumed, cur)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${remainCls(totals.remaining)}`}>{money(totals.remaining, cur)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Деньги, которые никуда не отнесли, — это вопрос к людям, а не повод их спрятать. */}
      {(data.unattributed?.length ?? 0) > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          {t('budget.unattributed', { defaultValue: 'Вне блоков (собственные статьи подпроектов):' })}{' '}
          {data.unattributed!.map(u => `${u.project_code} ${money(u.actual, cur)}`).join(' · ')}
        </p>
      )}
      {(data.orphans?.length ?? 0) > 0 && warn(t('budget.orphans', {
        defaultValue: 'Есть расходы, отнесённые к блокам, которых больше нет ({{sum}}): {{list}}. Перепривяжите их или верните блок.',
        sum: money(totals?.orphan_actual, cur),
        list: data.orphans!.map(o => `${o.project_code} — ${o.item_name}`).join('; '),
      }))}
    </SectionCard>
  )
}

/** Сумма факта одного подпроекта по блоку: у него может быть НЕСКОЛЬКО статей в одном блоке. */
function byKidSum(b: ConsolidatedBlock, projectId: string): number {
  return b.by_child.filter(c => c.project_id === projectId).reduce((s, c) => s + (c.actual || 0), 0)
}
