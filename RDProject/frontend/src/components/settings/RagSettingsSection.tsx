import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RagThresholds } from '@/api/settings'

interface RagSettingsSectionProps {
  t: TFunction
  rag: RagThresholds | null
  setRag: Dispatch<SetStateAction<RagThresholds | null>>
  handleSaveRag: () => void
  ragSaving: boolean
}

export default function RagSettingsSection({ t, rag, setRag, handleSaveRag, ragSaving }: RagSettingsSectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal size={16} className="text-gray-500 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{t('settings.rag.title', { defaultValue: 'Пороги RAG' })}</h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{t('settings.rag.help', { defaultValue: 'Пороги для автоматического расчёта RAG-статуса проектов.' })}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300">{t('settings.rag.redHigh', { defaultValue: 'Красный: высоких рисков ≥' })}</label>
              <input
                type="number"
                min={0}
                aria-label={t('settings.rag.redHigh', { defaultValue: 'Красный: высоких рисков ≥' })}
                value={rag?.red_high ?? ''}
                onChange={(e) => setRag((r) => (r ? { ...r, red_high: Number(e.target.value) } : r))}
                disabled={!rag}
                className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 dark:disabled:bg-slate-800/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300">{t('settings.rag.redOverdue', { defaultValue: 'Красный: просроченных задач ≥' })}</label>
              <input
                type="number"
                min={0}
                aria-label={t('settings.rag.redOverdue', { defaultValue: 'Красный: просроченных задач ≥' })}
                value={rag?.red_overdue ?? ''}
                onChange={(e) => setRag((r) => (r ? { ...r, red_overdue: Number(e.target.value) } : r))}
                disabled={!rag}
                className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 dark:disabled:bg-slate-800/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300">{t('settings.rag.amberMedium', { defaultValue: 'Жёлтый: средних рисков ≥' })}</label>
              <input
                type="number"
                min={0}
                aria-label={t('settings.rag.amberMedium', { defaultValue: 'Жёлтый: средних рисков ≥' })}
                value={rag?.amber_medium ?? ''}
                onChange={(e) => setRag((r) => (r ? { ...r, amber_medium: Number(e.target.value) } : r))}
                disabled={!rag}
                className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 dark:disabled:bg-slate-800/60"
              />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveRag} disabled={!rag || ragSaving}>
              {ragSaving ? t('common.saving', { defaultValue: 'Сохранение…' }) : t('settings.rag.save', { defaultValue: 'Сохранить' })}
            </Button>
          </div>
        </section>
  )
}
