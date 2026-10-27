import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { Surface } from '@/components/ui/surface'
import { useAuthStore } from '@/store/authStore'
import { canCreateProject } from '@/lib/roles'

const STEP_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const

const STEP_DEFAULTS: Record<(typeof STEP_KEYS)[number], { title: string; desc: string }> = {
  s1: { title: 'Паспорт', desc: 'Без него нет проекта: цель, владелец, сроки — 5 минут' },
  s2: { title: 'Команда и Риски', desc: 'Кто делает и что может пойти не так — два коротких списка' },
  s3: { title: 'План работ + Гант', desc: 'Перечислите задачи — Гант нарисуется и будет сдвигаться сам' },
  s4: { title: 'KPI и Коммуникации', desc: 'Как поймёте, что успех, и кого держать в курсе' },
  s5: { title: 'Бюджет', desc: 'Если есть деньги — план/факт по месяцам' },
  s6: { title: 'Бэклог', desc: 'Идеи и хотелки, до которых дойдут руки позже' },
  s7: { title: 'Встречи', desc: 'Повестка, решения, поручения — ничего не забывается' },
  s8: { title: 'Статус-отчёт', desc: '10 минут в неделю — правление в курсе без звонков' },
}

// Шаги 1 и 3 — «достаточный минимум» методологии, выделяем их визуально.
const CORE_STEPS: ReadonlyArray<(typeof STEP_KEYS)[number]> = ['s1', 's3']

export default function HowToPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  // WP2: проект создают оба руководителя (РПП и РП). Кому нельзя — /projects/new молча
  // переадресует в список — поэтому им показываем прямую ссылку «К проектам».
  const canCreate = canCreateProject(useAuthStore((s) => s.user))

  return (
    <PageShell className="max-w-4xl mx-auto gap-4">
      <PageHeader
        eyebrow={t('project.launchChecklist', { defaultValue: 'Рекомендуемый путь запуска' })}
        title={t('howto.title', { defaultValue: 'Как вести проект здесь' })}
      />

      <Surface variant="accent" className="px-4 py-3 text-sm font-medium text-sky-900 dark:text-sky-200">
        {t('howto.intro', { defaultValue: 'Для старта достаточно шагов 1 и 3. Остальное — когда понадобится.' })}
      </Surface>

      <div className="grid gap-3 sm:grid-cols-2">
        {STEP_KEYS.map((key, i) => {
          const core = CORE_STEPS.includes(key)
          return (
            <Surface key={key} variant={core ? 'accent' : 'default'} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                {t('project.stepPrefix', { defaultValue: 'Шаг {{index}}', index: i + 1 })}
              </p>
              <h2 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t(`howto.${key}`, { defaultValue: STEP_DEFAULTS[key].title })}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t(`howto.${key}d`, { defaultValue: STEP_DEFAULTS[key].desc })}
              </p>
            </Surface>
          )
        })}
      </div>

      <div className="flex justify-center pb-4 pt-2">
        {canCreate ? (
          <Button icon={<Plus size={16} />} onClick={() => navigate('/projects/new')}>
            {t('howto.cta', { defaultValue: 'Создать проект' })}
          </Button>
        ) : (
          <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => navigate('/projects')}>
            {t('common.toProjects', { defaultValue: 'К проектам' })}
          </Button>
        )}
      </div>
    </PageShell>
  )
}
