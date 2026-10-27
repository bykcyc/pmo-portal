import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Megaphone } from 'lucide-react'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { Surface } from '@/components/ui/surface'
import { ContentBlocks } from '@/components/wiki/WikiRenderer'
import { getNews, getNewsSeen, latestNewsDate, markNewsSeen } from '@/content/news'

/** Дата новости в формате языка интерфейса: 4 сентября 2026 / 2026. gada 4. septembris. */
function useDateFormat() {
  const { i18n } = useTranslation()
  const lang = (i18n.language || 'ru').slice(0, 2)
  return useMemo(() => {
    const locale = { ru: 'ru-RU', lv: 'lv-LV', en: 'en-GB' }[lang] ?? 'ru-RU'
    const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    return (iso: string) => {
      const d = new Date(iso + 'T00:00:00')
      return Number.isNaN(d.getTime()) ? iso : fmt.format(d)
    }
  }, [lang])
}

export default function NewsPage() {
  const { t, i18n } = useTranslation()
  const items = getNews(i18n.language)
  const formatDate = useDateFormat()
  // Что было непрочитано на момент ОТКРЫТИЯ страницы. Считаем один раз: иначе отметка
  // ниже сразу же погасила бы плашки «Новое» прямо под курсором.
  const seenOnEntry = useMemo(() => getNewsSeen(), [])

  useEffect(() => {
    const latest = latestNewsDate()
    if (latest) markNewsSeen(latest)
  }, [])

  return (
    <PageShell className="max-w-3xl mx-auto gap-4">
      <PageHeader
        title={t('news.title', { defaultValue: 'Новости' })}
        description={t('news.subtitle', {
          defaultValue: 'Что изменилось в портале и что теперь можно делать',
        })}
      />

      {items.length === 0 ? (
        <Surface className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">
          {t('news.empty', { defaultValue: 'Пока новостей нет' })}
        </Surface>
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const isNew = !seenOnEntry || seenOnEntry < item.date
            return (
              <Surface key={item.id} className="p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <time
                    dateTime={item.date}
                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  >
                    {formatDate(item.date)}
                  </time>
                  {isNew && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                      {t('news.badge', { defaultValue: 'Новое' })}
                    </span>
                  )}
                </div>
                <h2 className="mt-1.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {item.title}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.summary}</p>
                <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <ContentBlocks blocks={item.blocks} />
                </div>
              </Surface>
            )
          })}
        </div>
      )}

      <p className="flex items-center justify-center gap-2 pb-4 pt-1 text-xs text-slate-500 dark:text-slate-400">
        <Megaphone size={14} />
        {t('news.footer', {
          defaultValue: 'Здесь появляется всё, что меняется в портале и влияет на вашу работу',
        })}
      </p>
    </PageShell>
  )
}
