/**
 * «Разрешить помощнику доступ?» — страница, на которую портал уводит человека из ChatGPT/Claude.
 *
 * Единственное место, где рождается доступ помощника, и потому единственное, где человек обязан
 * увидеть, ЧТО он разрешает. Показываем три вещи: чем назвался клиент, куда физически уедет код
 * (имя клиент придумывает сам, адрес — нет) и от чьего имени помощник будет работать.
 *
 * Страница защищённая: если человек не вошёл, его сначала отправят на вход и вернут обратно.
 * Отдельного, более слабого входа у подключения помощника нет.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bot, ShieldCheck } from 'lucide-react'

import { Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { approveConsent, denyConsent, getConsent } from '@/api/oauth'

export default function ConsentPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const rid = params.get('rid') || ''
  const [busy, setBusy] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['oauth-consent', rid],
    queryFn: () => getConsent(rid),
    enabled: !!rid,
    retry: false,
  })

  const finish = async (approve: boolean) => {
    setBusy(true)
    try {
      // Уводим браузер туда, откуда пришли: код должен вернуться клиенту, а не остаться у нас.
      window.location.href = approve ? await approveConsent(rid) : await denyConsent(rid)
    } catch {
      setBusy(false)
    }
  }

  const detail = (error as { response?: { data?: { detail?: string } } } | undefined)?.response?.data?.detail

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] dark:bg-slate-950 p-4">
      <Surface className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
            <Bot size={20} className="text-slate-700 dark:text-slate-200" />
          </span>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('consent.title', { defaultValue: 'Разрешить доступ помощнику?' })}
          </h1>
        </div>

        {!rid || error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {detail || t('consent.broken', {
              defaultValue: 'Запрос не найден или устарел. Начните подключение заново в своём помощнике.',
            })}
          </p>
        ) : isLoading || !data ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            <dl className="mb-4 space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-3 py-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">
                  {t('consent.who', { defaultValue: 'Кто просит' })}
                </dt>
                <dd className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">
                  {data.client_name || t('consent.unnamed', { defaultValue: 'Без названия' })}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">
                  {t('consent.where', { defaultValue: 'Адрес возврата' })}
                </dt>
                <dd className="min-w-0 truncate font-mono text-xs text-slate-900 dark:text-slate-100">
                  {data.redirect_host}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">
                  {t('consent.asWhom', { defaultValue: 'От вашего имени' })}
                </dt>
                <dd className="min-w-0 truncate text-slate-900 dark:text-slate-100">{data.user_email}</dd>
              </div>
            </dl>

            <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">
              {t('consent.what', {
                defaultValue: 'Помощник сможет читать проекты, которые вы сами откроете для него, и предлагать изменения черновиком. Менять проекты сам он не может.',
              })}
            </p>
            <p className="mb-4 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              {t('consent.locked', {
                defaultValue: 'Пока вы не откроете конкретный проект помощнику, он не увидит ни одного. Отключить доступ можно в Профиле.',
              })}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { void finish(false) }} disabled={busy}>
                {t('consent.deny', { defaultValue: 'Отклонить' })}
              </Button>
              <Button onClick={() => { void finish(true) }} disabled={busy}>
                {t('consent.approve', { defaultValue: 'Разрешить' })}
              </Button>
            </div>
          </>
        )}
      </Surface>
    </div>
  )
}
