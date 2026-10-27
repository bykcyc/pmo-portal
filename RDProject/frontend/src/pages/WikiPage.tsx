import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUp, BookOpen, Search } from 'lucide-react'
import { getGroupTitles, getWikiPages, findWikiPage, searchWikiPages } from '@/content/wiki'
import { WIKI_GROUP_ORDER, type WikiGroup, type WikiPage } from '@/content/wiki/types'
import WikiRenderer from '@/components/wiki/WikiRenderer'
import { PageHeader, PageShell } from '@/components/ui/layout'
import { SectionCard, Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'

function GroupedList({ pages, activeSlug, groupTitles }: {
  pages: WikiPage[]
  activeSlug?: string
  groupTitles: Record<WikiGroup, string>
}) {
  return (
    <nav className="space-y-4">
      {WIKI_GROUP_ORDER.map((group: WikiGroup) => {
        const inGroup = pages.filter(p => p.group === group)
        if (!inGroup.length) return null
        return (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {groupTitles[group]}
            </p>
            <ul className="space-y-0.5">
              {inGroup.map(p => (
                <li key={p.slug}>
                  <Link
                    to={`/wiki/${p.slug}`}
                    className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                      p.slug === activeSlug
                        ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                    }`}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

export default function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { t, i18n } = useTranslation()
  // Справка идёт на языке интерфейса. Если страницы на этом языке ещё нет, реестр сам
  // подставит русскую — оглавление остаётся полным.
  const lang = i18n.language
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchWikiPages(query, lang), [query, lang])
  const groupTitles = useMemo(() => getGroupTitles(lang), [lang])
  const page = slug ? findWikiPage(slug, lang) : undefined

  // Неизвестный адрес: не роняем страницу 404-й, а показываем оглавление — так человек
  // из старой ссылки всё равно попадает в справку.
  if (slug && !page) {
    return (
      <PageShell>
        <PageHeader title={t('wiki.title')} />
        <Surface className="p-6 text-sm text-slate-600 dark:text-slate-400">
          {t('wiki.notFound')}
          <div className="mt-4"><GroupedList pages={getWikiPages(lang)} groupTitles={groupTitles} /></div>
        </Surface>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title={page ? page.title : t('wiki.title')} description={page?.summary ?? t('wiki.intro')} />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-64 lg:shrink-0">
          <Surface className="p-4 lg:sticky lg:top-20">
            <label className="relative mb-3 block">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('wiki.searchPlaceholder')}
                aria-label={t('wiki.searchPlaceholder')}
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </label>
            {found.length === 0
              ? <p className="px-1 text-sm text-slate-500 dark:text-slate-400">{t('wiki.nothingFound')}</p>
              : <GroupedList pages={found} activeSlug={page?.slug} groupTitles={groupTitles} />}
          </Surface>
        </aside>

        <div className="min-w-0 flex-1">
          {page ? (
            <SectionCard
              title={page.title}
              description={page.summary}
              actions={page.appRoute && !page.appRoute().includes('/undefined/') ? (
                <Link to={page.appRoute()}>
                  <Button variant="secondary" size="sm">{t('wiki.openSection')}</Button>
                </Link>
              ) : undefined}
            >
              <WikiRenderer sections={page.sections} />
              <div className="mt-8 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowUp size={14} />}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  {t('wiki.toTop')}
                </Button>
              </div>
            </SectionCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {found.map(p => (
                <Link key={p.slug} to={`/wiki/${p.slug}`} className="block">
                  <Surface className="h-full p-4 transition-shadow hover:shadow-md">
                    <div className="mb-1.5 flex items-center gap-2">
                      <BookOpen size={15} className="text-slate-400" aria-hidden />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.title}</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{p.summary}</p>
                  </Surface>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
