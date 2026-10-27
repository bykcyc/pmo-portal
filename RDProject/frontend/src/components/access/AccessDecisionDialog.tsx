/**
 * Решение по запросу доступа: кто просит, к какому проекту, почему — подтвердить или отклонить.
 *
 * Открывается ПО КЛИКУ НА УВЕДОМЛЕНИЕ, а не переходом в раздел проекта: раздела «запросы» не
 * существует, и уводить руководителя со страницы ради одного «да/нет» — лишний шаг. Это
 * единственный вид уведомления, по которому можно ДЕЙСТВОВАТЬ, поэтому и форма своя.
 *
 * Общая для колокольчика и виджета «Требует внимания»: два места показывают один и тот же
 * запрос, и решение в них обязано выглядеть и работать одинаково.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { decideAccessRequest } from '@/api/access'
import type { AttentionItem } from '@/api/attention'
import { ICON_SM } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { useToastStore } from '@/store/toastStore'
import { formatDate } from '@/utils/date'

export function AccessDecisionDialog({ item, onClose }: { item: AttentionItem; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const [busy, setBusy] = useState(false)

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true)
    try {
      await decideAccessRequest(String(item.request_id ?? item.id), decision)
      // Решение меняет состав доступа: обновляем и сам список запросов, и всё, что зависит
      // от прав — иначе выданный наблюдатель не увидит проект до перезагрузки страницы.
      await queryClient.invalidateQueries({ queryKey: ['attention'] })
      await queryClient.invalidateQueries({ queryKey: ['access-requests'] })
      await queryClient.invalidateQueries({ queryKey: ['project', item.project_id] })
      showToast(
        decision === 'approve'
          ? t('access.approved', { defaultValue: 'Доступ выдан' })
          : t('access.rejected', { defaultValue: 'Запрос отклонён' }),
        'success',
      )
      onClose()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
      setBusy(false)
    }
  }

  // Портал в body обязателен: диалог вызывается из колокольчика, который живёт В САЙДБАРЕ,
  // а у сайдбара свои transform/backdrop-filter — они делают его containing-block для
  // position:fixed. Без портала «по центру экрана» означало бы «по центру сайдбара», и
  // кнопка «Отклонить» уезжала за край. Тот же приём, что у гейта 2FA.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <Surface className="mx-4 w-full max-w-md p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('access.decideTitle', { defaultValue: 'Запрос доступа к проекту' })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel', { defaultValue: 'Отмена' })}
            className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X size={ICON_SM} />
          </button>
        </div>

        <dl className="mb-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-slate-600 dark:text-slate-400">
              {t('access.who', { defaultValue: 'Кто просит' })}
            </dt>
            <dd className="text-slate-800 dark:text-slate-100">{item.title || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600 dark:text-slate-400">
              {t('access.what', { defaultValue: 'К чему' })}
            </dt>
            <dd className="text-slate-800 dark:text-slate-100">
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{item.project_code}</span>{' '}
              {item.project_name || ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600 dark:text-slate-400">
              {t('access.level', { defaultValue: 'Что получит' })}
            </dt>
            <dd className="text-slate-800 dark:text-slate-100">
              {t('access.levelObserver', { defaultValue: 'Наблюдатель — только просмотр, без права правки' })}
            </dd>
          </div>
          {item.note ? (
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-400">
                {t('access.reason', { defaultValue: 'Причина' })}
              </dt>
              <dd className="whitespace-pre-wrap text-slate-800 dark:text-slate-100">{item.note}</dd>
            </div>
          ) : null}
          {item.created_at ? (
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-400">
                {t('access.asked', { defaultValue: 'Когда' })}
              </dt>
              <dd className="text-slate-800 dark:text-slate-100">{formatDate(item.created_at)}</dd>
            </div>
          ) : null}
        </dl>

        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {t('access.rejectHint', { defaultValue: 'Запрос ждёт вашего решения и сам не пропадает. Если отклоните — повторить его человек сможет через два месяца.' })}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Отмена' })}
          </Button>
          <Button variant="secondary" onClick={() => void decide('reject')} disabled={busy}>
            {t('access.reject', { defaultValue: 'Отклонить' })}
          </Button>
          <Button onClick={() => void decide('approve')} disabled={busy}>
            {t('access.approve', { defaultValue: 'Подтвердить' })}
          </Button>
        </div>
      </Surface>
    </div>,
    document.body,
  )
}

export default AccessDecisionDialog
