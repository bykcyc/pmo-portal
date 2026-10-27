import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, X } from 'lucide-react'
import { getAgentAccess, setAgentAccess } from '@/api/agent'
import { getShare, setShare } from '@/api/share'
import { getProjectSections } from '@/constants/projectSections'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { ICON_SM } from '@/constants/ui'
import { useToastStore } from '@/store/toastStore'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { copyToClipboard } from '@/utils/clipboard'

const TITLE_ID = 'share-dialog-title'

export default function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const sections = getProjectSections(t)
  const dialogRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data: share, isLoading } = useQuery({
    queryKey: ['share', projectId],
    queryFn: () => getShare(projectId),
  })

  // Диалог монтируется только когда открыт, поэтому отдельного enabled не нужно.
  const { data: agent } = useQuery({
    queryKey: ['agent-access', projectId],
    queryFn: () => getAgentAccess(projectId),
  })

  const [tab, setTab] = useState<'link' | 'agent'>('link')
  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)

  // Состояние замка НЕ дублируем в локальную переменную: показываем то, что реально
  // сохранено на сервере. Иначе между щелчком и сохранением существует третье состояние —
  // «на экране закрыто, на деле открыто», — а для настройки доступа это худший из отказов.
  const agentEnabled = !!agent?.enabled

  // Гидрируем локальное состояние из ответа сервера (и после каждого refetch),
  // чтобы повторное открытие диалога отражало сохранённые настройки.
  useEffect(() => {
    if (share) {
      setEnabled(share.enabled)
      setSelected(new Set(share.sections))
    }
  }, [share])

  // Модалка: закрытие по Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useFocusTrap(dialogRef, true)

  const toggleSection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const publicUrl = share?.token ? `${window.location.origin}/public/${share.token}` : ''
  // Адрес один на весь портал: помощник подключается к порталу, а не к отдельному проекту.
  const mcpUrl = `${window.location.origin}/mcp`

  const copyValue = async (value: string) => {
    if (!value) return
    // copyToClipboard сам выберет secure-API или execCommand-фолбэк (нужен в незащищённом контексте, по обычному HTTP).
    if (await copyToClipboard(value)) {
      showToast(t('share.copied', { defaultValue: 'Ссылка скопирована' }), 'success')
    } else {
      showToast(t('common.error', { defaultValue: 'Ошибка' }), 'error')
    }
  }
  const handleCopy = () => copyValue(publicUrl)
  const handleCopyMcp = () => copyValue(mcpUrl)

  /**
   * Замок применяется СРАЗУ по щелчку, а не по кнопке «Сохранить».
   *
   * Так он и читается человеком — как выключатель. Пока он ехал вместе с публичной ссылкой,
   * существовало состояние «галочка снята, но не сохранена», и живой случай показал, чем это
   * кончается: человек снял доступ, увидел «Сохранено» и ушёл, а доступ остался открытым.
   * Для настройки доступа такое молчание опаснее любой ошибки.
   */
  const setLock = async (nextEnabled: boolean) => {
    setLockBusy(true)
    try {
      // Одна галочка = весь проект: сервер всё равно выводит доступ к деньгам и решениям
      // из самого факта открытия, но посылаем явно — чтобы данные читались без сносок.
      const acc = await setAgentAccess(projectId, { enabled: nextEnabled, sensitive: nextEnabled })
      queryClient.setQueryData(['agent-access', projectId], acc)
      showToast(
        acc.enabled
          ? t('share.agentOpened', { defaultValue: 'Проект открыт помощнику' })
          : t('share.agentClosed', { defaultValue: 'Проект закрыт для помощника' }),
        'success',
      )
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setLockBusy(false)
    }
  }

  /** Публичная ссылка сохраняется кнопкой: разделы выбирают в несколько щелчков. Кнопка
   *  неактивна, пока менять нечего, — «Сохранено» без единого запроса вводило бы в заблуждение. */
  const sameSections = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    const x = [...a].sort()
    const y = [...b].sort()
    return x.every((v, i) => v === y[i])
  }
  const shareDirty = enabled !== !!share?.enabled || !sameSections([...selected], share?.sections ?? [])

  const handleSave = async () => {
    setBusy(true)
    try {
      // Сразу кладём результат в кэш — токен создаётся на сервере при первом сохранении,
      // и ссылка должна появиться мгновенно, не дожидаясь рефетча.
      queryClient.setQueryData(['share', projectId], await setShare(projectId, { enabled, sections: [...selected] }))
      showToast(t('common.saved', { defaultValue: 'Сохранено' }), 'success')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <Surface
        className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 id={TITLE_ID} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('share.accessTitle', { defaultValue: 'Доступ к проекту' })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <X size={ICON_SM} />
          </button>
        </div>

        {/* Две вкладки, а не один список: публичная ссылка и помощник отвечают на разные
            вопросы («кому показать» против «чем работать»), и настраиваются по-разному —
            ссылка кнопкой «Сохранить», доступ помощника сразу по щелчку. В одной колонке это
            читалось как один набор галочек с одной кнопкой, чего здесь нет. */}
        <div role="tablist" aria-label={t('share.accessTitle', { defaultValue: 'Доступ к проекту' })}
          className="mb-3 mt-2 flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {([
            ['link', t('share.tabLink', { defaultValue: 'Публичная ссылка' })],
            ['agent', t('share.tabAgent', { defaultValue: 'Помощник (MCP)' })],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                tab === id
                  ? 'border-blue-600 text-slate-900 dark:border-blue-400 dark:text-slate-100'
                  : 'border-transparent text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
        ) : tab === 'agent' ? (
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {/* Одна галочка открывает проект целиком, включая бюджет и решения (решение
                владельца). Раздельное согласие было лишним вопросом: человек,
                пускающий помощника в проект, пускает его в проект. */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-3 py-2.5">
              <input
                type="checkbox"
                checked={agentEnabled}
                disabled={lockBusy}
                onChange={(e) => { void setLock(e.target.checked) }}
                className="h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {t('share.agentEnable', { defaultValue: 'Открыть проект помощнику' })}
              </span>
            </label>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('share.agentHint', {
                defaultValue: 'Помощник в вашем ChatGPT или Claude сможет читать весь проект — включая бюджет, решения и оценки стейкхолдеров — и предлагать изменения черновиком. Менять проект сам он не может: вы принимаете черновик в портале.',
              })}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('share.agentInstant', { defaultValue: 'Переключатель применяется сразу — кнопка «Сохранить» здесь не нужна.' })}
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('share.agentAddress', { defaultValue: 'Адрес подключения' })}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={mcpUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
                />
                <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={handleCopyMcp}>
                  {t('share.copy', { defaultValue: 'Копировать' })}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => { onClose(); navigate('/wiki/assistant') }}
                className="mt-2 text-xs text-blue-700 underline hover:no-underline dark:text-blue-300"
              >
                {t('share.agentHelp', { defaultValue: 'Как подключить помощника — в справке' })}
              </button>
            </div>
          </div>
        ) : (
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {/* Мастер-переключатель */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-3 py-2.5">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {t('share.enable', { defaultValue: 'Открыть доступ по ссылке' })}
              </span>
            </label>

            {/* Публичная ссылка. Показываем, как только есть токен (после первого «Сохранить»),
                даже если доступ временно выключен — с пометкой. */}
            {publicUrl ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('share.publicUrl', { defaultValue: 'Публичная ссылка' })}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
                  />
                  <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={handleCopy}>
                    {t('share.copy', { defaultValue: 'Копировать' })}
                  </Button>
                </div>
                {!enabled && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {t('share.disabledNote', { defaultValue: 'Доступ выключен — включите переключатель выше, чтобы ссылка открывалась.' })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t('share.noLinkYet', { defaultValue: 'Включите доступ, выберите разделы и нажмите «Сохранить» — здесь появится ссылка для отправки.' })}
              </p>
            )}

            {/* Выбор разделов */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('share.sectionsLabel', { defaultValue: 'Какие разделы показывать' })}
              </p>
              <ul className="space-y-1">
                {sections.map((sectionMeta) => (
                  <li key={sectionMeta.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <input
                        type="checkbox"
                        checked={selected.has(sectionMeta.id)}
                        onChange={() => toggleSection(sectionMeta.id)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">
                        {sectionMeta.displayName}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 pt-4">
          <Button variant="ghost" onClick={onClose}>
            {tab === 'agent' ? t('common.close', { defaultValue: 'Закрыть' }) : t('common.cancel')}
          </Button>
          {/* «Сохранить» относится только к публичной ссылке: доступ помощника применяется
              сразу по щелчку, и кнопка рядом с ним означала бы, что он ещё не применён. */}
          {tab === 'link' && (
            <Button onClick={handleSave} disabled={busy || isLoading || !shareDirty}>
              {t('share.save', { defaultValue: 'Сохранить' })}
            </Button>
          )}
        </div>
      </Surface>
    </div>
  )
}
