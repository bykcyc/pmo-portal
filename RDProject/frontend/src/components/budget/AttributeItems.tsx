/**
 * «Отнести мои статьи к блокам общего проекта» — экран подпроекта.
 *
 * Отдельный блок, а не колонка в таблице статей: привязка ставится не обычной правкой, а своим
 * маршрутом (это ссылка в ЧУЖОЙ проект, и проверить её — существует ли блок, тот ли зонтик,
 * совпадают ли валюты — можно только на сервере). Сделать её ячейкой таблицы значило бы
 * притвориться, что это такое же поле, как «Сумма», и получить отказ там, где человек ждёт
 * обычного сохранения.
 *
 * Отнесение НЕ меняет числа подпроекта: его план и факт остаются его. Оно лишь говорит, в
 * какой блок общего проекта эти расходы попадут в сводке.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { linkBudgetItem, unlinkBudgetItem } from '@/api/budget'
import type { BudgetItem, ConsolidatedShare } from '@/types/budget'
import { SectionCard } from '@/components/ui/surface'
import { useToastStore } from '@/store/toastStore'

export default function AttributeItems({ projectId, items, blocks, canWrite, parentName }: {
  projectId: string
  items: BudgetItem[]
  blocks: ConsolidatedShare[]
  canWrite: boolean
  parentName?: string | null
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const showToast = useToastStore(s => s.show)
  const [busy, setBusy] = useState<string | null>(null)

  const expenses = items.filter(i => (i.kind ?? (i.category === 'revenue' ? 'income' : 'expense')) === 'expense')
  if (expenses.length === 0 || blocks.length === 0) return null

  const change = async (item: BudgetItem, blockId: string) => {
    setBusy(item.id)
    try {
      if (blockId) await linkBudgetItem(projectId, item.id, blockId)
      else await unlinkBudgetItem(projectId, item.id)
      await qc.invalidateQueries({ queryKey: ['budget', projectId] })
      await qc.invalidateQueries({ queryKey: ['budget_consolidated', projectId] })
    } catch (err) {
      // Отказы сервера здесь по делу («Валюты не совпадают», «только к расходному блоку») —
      // общее «ошибка» не подскажет, что поправить.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SectionCard
      title={t('budget.attribute', { defaultValue: 'Отнести расходы к блокам общего проекта' })}
      description={t('budget.attributeHint', {
        defaultValue: 'Ваши суммы остаются вашими — отнесение лишь показывает руководителю проекта «{{name}}», из какого блока эти расходы.',
        name: parentName || '',
      })}
    >
      <ul className="space-y-1.5">
        {expenses.map(i => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-slate-200">{i.name}</span>
            <select
              value={i.parent_item_id ?? ''}
              disabled={!canWrite || busy === i.id}
              onChange={e => void change(i, e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t('budget.ownItem', { defaultValue: '— своя статья —' })}</option>
              {blocks.map(b => (
                <option key={b.item_id} value={b.item_id}>
                  {b.name} · {t('budget.remaining', { defaultValue: 'Остаток' })} {Math.round(b.remaining).toLocaleString('ru-RU')}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
