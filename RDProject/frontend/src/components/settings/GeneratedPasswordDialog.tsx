import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { copyToClipboard } from '@/utils/clipboard'
import { useToastStore } from '@/store/toastStore'

export interface GeneratedCreds {
  fullName: string
  email: string
  password: string
}

/** Показ сгенерированного пароля — единственный момент, когда он вообще виден.
 *  Нигде не сохраняется: ни в кэше запросов, ни в localStorage, ни в URL. Закрыли — забыли,
 *  дальше только сброс пароля. Поэтому в тексте прямо сказано, что показ разовый. */
export default function GeneratedPasswordDialog({ creds, onClose }: { creds: GeneratedCreds; onClose: () => void }) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const showToast = useToastStore(s => s.show)
  useFocusTrap(dialogRef, true)

  const copy = async () => {
    const ok = await copyToClipboard(`${creds.email}\n${creds.password}`)
    showToast(ok ? t('settings.users.credsCopied') : t('common.error'), ok ? 'success' : 'error')
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.users.credsTitle')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <Surface className="w-full max-w-md p-6">
        <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('settings.users.credsTitle')}
        </h3>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">{creds.fullName}</p>

        <dl className="mb-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('settings.users.email')}</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 break-all">{creds.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('settings.users.password')}</dt>
            <dd className="font-mono text-base tracking-wide text-slate-900 dark:text-slate-100 break-all">
              {creds.password}
            </dd>
          </div>
        </dl>

        <p className="mb-5 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {t('settings.users.credsOnce')}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" icon={<Copy size={14} />} onClick={copy}>
            {t('common.copy')}
          </Button>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </div>
      </Surface>
    </div>,
    document.body,
  )
}
