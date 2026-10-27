import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Save } from 'lucide-react'
import { ICON_SM } from '@/constants/ui'
import PersonPicker from '@/components/PersonPicker'

export interface FieldDef {
  key: string
  label: string
  /** 'number' — только цифры (запятая приводится к точке), выравнивание вправо. */
  type?: 'text' | 'email' | 'select' | 'textarea' | 'person' | 'number'
  options?: { value: string; label: string }[]
  required?: boolean
}

/** Разрешаем только цифры и один десятичный разделитель. */
const digitsOnly = (raw: string): string => {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const i = cleaned.indexOf('.')
  return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '')
}

interface RowFormProps {
  fields: FieldDef[]
  initialValues?: Record<string, string>
  onSave: (values: Record<string, string>) => Promise<void>
  onCancel: () => void
  title: string
}

export default function RowForm({ fields, initialValues = {}, onSave, onCancel, title }: RowFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, initialValues[f.key] ?? '']))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, val: string) => setValues((v) => ({ ...v, [key]: val }))

  const handleSave = async () => {
    const missing = fields.filter((f) => f.required && !values[f.key]?.trim())
    if (missing.length) { setError(t('common.requiredFields', { fields: missing.map((f) => f.label).join(', ') })); return }
    setSaving(true); setError(null)
    try { await onSave(values) } catch { setError(t('common.saveFailed')) } finally { setSaving(false) }
  }

  return (
    <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{title}</span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"><X size={16} /></button>
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
              {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {f.type === 'select' ? (
              <select
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('common.selectPlaceholder')}</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                rows={3}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            ) : f.type === 'number' ? (
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={values[f.key]}
                onChange={(e) => set(f.key, digitsOnly(e.target.value))}
                className="w-full text-right text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            ) : f.type === 'person' ? (
              <PersonPicker
                value={values[f.key]}
                onChange={(v) => set(f.key, v)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            ) : (
              <input
                type={f.type ?? 'text'}
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50"
        >
          <Save size={ICON_SM} />{saving ? t('common.saving') : t('common.save')}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
