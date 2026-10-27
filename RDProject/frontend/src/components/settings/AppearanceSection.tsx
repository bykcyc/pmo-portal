import { useTranslation } from 'react-i18next'
import { Check, Palette } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { SectionCard } from '@/components/ui/surface'

/**
 * Выбор темы оформления (Warm / Classic) — доступно ВСЕМ ролям (в отличие от
 * «Настроек», они у owner). Светлый/тёмный вариант переключается отдельно в сайдбаре.
 * Превью показывают фиксированные цвета каждой темы независимо от активной.
 */

type SkinKey = 'rd' | 'classic'

// Мини-мокап цветов темы (жёстко заданные hex — превью не зависит от текущей темы).
const PREVIEWS: Record<SkinKey, { bg: string; surface: string; text: string; muted: string; accent: string; accentFg: string; border: string }> = {
  rd: { bg: '#FAF8F3', surface: '#ffffff', text: '#2F3033', muted: '#6E6F74', accent: '#F9D21D', accentFg: '#2F3033', border: '#E6E4DF' },
  classic: { bg: '#f5f7fa', surface: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#2563eb', accentFg: '#ffffff', border: '#e6eaf0' },
}

function ThemePreview({ skinKey }: { skinKey: SkinKey }) {
  const p = PREVIEWS[skinKey]
  return (
    <div className="pointer-events-none w-full overflow-hidden rounded-lg border" style={{ background: p.bg, borderColor: p.border }}>
      <div className="flex gap-2 p-3">
        <div className="flex-1 rounded-md p-2" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
          <div className="mb-1.5 h-1.5 w-10 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
          <div className="mb-2 h-1 w-16 rounded-full" style={{ background: p.muted, opacity: 0.7 }} />
          <div className="inline-flex h-4 items-center rounded px-2 text-[8px] font-semibold" style={{ background: p.accent, color: p.accentFg }}>Aa</div>
        </div>
        <div className="flex w-10 flex-col gap-1 rounded-md p-1.5" style={{ background: p.text }}>
          <div className="h-1 w-full rounded-full" style={{ background: p.accent }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: p.muted }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: p.muted }} />
        </div>
      </div>
    </div>
  )
}

export default function AppearanceSection() {
  const { t } = useTranslation()
  const skin = useUIStore((s) => s.skin)
  const setSkin = useUIStore((s) => s.setSkin)

  const OPTIONS: { key: SkinKey; name: string; desc: string }[] = [
    { key: 'rd', name: t('appearance.rdstyle', { defaultValue: 'Warm' }), desc: t('appearance.rdstyleDesc', { defaultValue: 'Тёплая тема' }) },
    { key: 'classic', name: t('appearance.classic', { defaultValue: 'Classic' }), desc: t('appearance.classicDesc', { defaultValue: 'Исходное оформление портала' }) },
  ]

  return (
    <SectionCard
      title={<span className="inline-flex items-center gap-2"><Palette size={16} />{t('appearance.title', { defaultValue: 'Оформление' })}</span>}
      description={t('appearance.hint', { defaultValue: 'Тема применяется сразу и запоминается. Светлый/тёмный режим переключается в нижнем меню слева.' })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = skin === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setSkin(o.key)}
              aria-pressed={active}
              className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                active
                  ? 'border-blue-500 ring-2 ring-blue-500/40 dark:border-blue-400'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <ThemePreview skinKey={o.key} />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{o.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{o.desc}</div>
                </div>
                {active && (
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Check size={14} />
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </SectionCard>
  )
}
