import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, Copy, Download, Eye, FileStack, MoreHorizontal, Network, Users, X } from 'lucide-react'
import {
  addProjectEditor, addProjectObserver, archiveProject, cloneProject, getProject,
  getProjectEditors, getProjectObservers, getTransferCandidates, removeProjectEditor,
  removeProjectObserver, setProjectTemplate, transferProject, unarchiveProject,
} from '@/api/projects'
import { getUsers } from '@/api/users'
import { ICON_SM, ICON_XS } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { useToastStore } from '@/store/toastStore'
import { useConfirmStore } from '@/store/confirmStore'
import { useExportStore } from '@/store/exportStore'
import { exportRowsToXlsx } from '@/utils/exportXlsx'
import { canBeProjectManager } from '@/lib/roles'

export function TransferDialog({
  projectId,
  staysCoPm,
  onClose,
}: {
  /** Отдаёт проект его же основной РП — значит он останется со-РП, и об этом надо сказать
   *  ДО нажатия: иначе «Передать» выглядит как «потерять проект насовсем». */
  staysCoPm?: boolean
  projectId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const [selectedId, setSelectedId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Кому можно отдать — решает сервер (активен, умеет писать, не нынешний РП). Раньше здесь
  // висел /admin/users: маршрут владельца портфеля, у РП он отдаёт 403 — список был бы пуст.
  const { data: pms = [], isLoading } = useQuery({
    queryKey: ['transfer_candidates', projectId],
    queryFn: () => getTransferCandidates(projectId),
  })

  const handleTransfer = async () => {
    const selected = pms.find((u) => u.id === selectedId)
    if (!selected) return
    setSubmitting(true)
    try {
      await transferProject(projectId, { pm_id: selected.id, pm_name: selected.full_name })
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      showToast(t('project.transferred', { defaultValue: 'Проект передан' }), 'success')
      onClose()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Окном это окно объявляется только теперь: раньше его видел один человек на портал,
    // а с этой правки — все руководители проектов.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={onClose} role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title">
      <Surface className="mx-4 w-full max-w-sm p-6" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="transfer-dialog-title" className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('project.transferTitle', { defaultValue: 'Передать проект другому РП' })}
        </h3>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {t('project.transferPick', { defaultValue: 'Выберите руководителя проекта' })}
        </p>
        {staysCoPm && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {t('project.transferKeepsAccess')}
          </p>
        )}
        {isLoading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <select
            aria-label={t('project.transferPick', { defaultValue: 'Выберите руководителя проекта' })}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
          >
            <option value="">—</option>
            {pms.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">{t('common.cancel')}</Button>
          <Button onClick={handleTransfer} disabled={!selectedId || submitting}>
            {submitting ? t('common.saving', { defaultValue: 'Сохранение…' }) : t('project.transferAction', { defaultValue: 'Передать' })}
          </Button>
        </div>
      </Surface>
    </div>
  )
}

/** Роль доступа к проекту. Со-РП правит наравне с РП, наблюдатель только смотрит.
 *  Разделяет их сервер; здесь — подписи, обработчики и ключ кэша. */
export type AccessKind = 'editor' | 'observer'

/**
 * Управление доступом к проекту. ОДИН диалог на обе роли намеренно: со-РП и наблюдатель
 * отличаются только правами на сервере и подписями, а список, добавление и снятие у них
 * одинаковые. Копия компонента на вторую роль неминуемо разъехалась бы с первой.
 */
export function CoEditorsDialog({
  projectId,
  pmId,
  kind = 'editor',
  onClose,
}: {
  projectId: string
  pmId: string | null
  kind?: AccessKind
  onClose: () => void
}) {
  const isObs = kind === 'observer'

  const api = isObs
    ? { list: getProjectObservers, add: addProjectObserver, remove: removeProjectObserver }
    : { list: getProjectEditors, add: addProjectEditor, remove: removeProjectEditor }
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)

  const cacheKey = isObs ? 'project-observers' : 'project-editors'
  const { data: editors = [], isLoading } = useQuery({
    queryKey: [cacheKey, projectId],
    queryFn: () => api.list(projectId),
  })
  const { data: allUsers = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  // Вторая роль тоже нужна: сервер отказывает назначить наблюдателем действующего со-РП
  // (понижение прав делается осознанно, а не выбором из списка). Не зная этого списка,
  // диалог предлагал бы имя, на котором клик заканчивается ошибкой.
  const { data: coEditors = [] } = useQuery({
    queryKey: ['project-editors', projectId],
    queryFn: () => getProjectEditors(projectId),
    enabled: isObs,
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: [cacheKey, projectId] })
    // Повышение наблюдателя до со-РП снимает его с наблюдения на сервере — значит
    // обновить надо ОБА списка, иначе второй показывает вчерашнюю правду.
    await queryClient.invalidateQueries({ queryKey: ['project-editors', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['project-observers', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const handleError = (err: unknown) => {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
  }

  // Кандидаты: все, кроме основного РП и уже добавленных в ЭТОТ список.
  // (У role в UserListItem нет — показываем всех; фильтр по pm сделает бэкенд/оргпроцесс.)
  // Для наблюдателей вычитаем ещё и со-РП: сервер их не примет. Обратное не нужно —
  // назначить со-РП наблюдателя можно, сервер переведёт его из одной роли в другую.
  const editorIds = new Set(editors.map((e) => e.id))
  const blockedIds = isObs ? new Set(coEditors.map((e) => e.id)) : new Set<string>()
  const candidates = allUsers.filter(
    (u) => u.id !== pmId && !editorIds.has(u.id) && !blockedIds.has(u.id))

  const pickLabel = isObs
    ? t('project.observerPick', { defaultValue: 'Выберите наблюдателя' })
    : t('project.coEditorPick', { defaultValue: 'Выберите со-руководителя' })

  const handleAdd = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api.add(projectId, selectedId)
      await invalidate()
      setSelectedId('')
      showToast(isObs
        ? t('project.observerAdded', { defaultValue: 'Наблюдатель добавлен' })
        : t('project.coEditorAdded', { defaultValue: 'Со-руководитель добавлен' }), 'success')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (uid: string) => {
    setBusy(true)
    try {
      await api.remove(projectId, uid)
      await invalidate()
      showToast(isObs
        ? t('project.observerRemoved', { defaultValue: 'Наблюдатель убран' })
        : t('project.coEditorRemoved', { defaultValue: 'Со-руководитель убран' }), 'success')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <Surface className="mx-4 w-full max-w-md p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isObs
              ? t('project.observersManage', { defaultValue: 'Наблюдатели проекта' })
              : t('project.coEditorsManage', { defaultValue: 'Со-руководители проекта' })}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100">
            <X size={ICON_SM} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {isObs
            ? t('project.observersHint', { defaultValue: 'Наблюдатель видит проект целиком, но не может ничего изменить.' })
            : t('project.coEditorsHint', { defaultValue: 'Со-руководитель (заместитель) может редактировать проект наравне с РП.' })}
        </p>

        {isLoading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
        ) : editors.length === 0 ? (
          <p className="mb-4 text-xs italic text-slate-600 dark:text-slate-400">
            {isObs
              ? t('project.observersEmpty', { defaultValue: 'Наблюдателей пока нет.' })
              : t('project.coEditorsEmpty', { defaultValue: 'Со-руководителей пока нет.' })}
          </p>
        ) : (
          <ul className="mb-4 space-y-1.5">
            {editors.map((editor) => (
              <li key={editor.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200" title={editor.email}>{editor.full_name}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(editor.id)}
                  disabled={busy}
                  aria-label={t('common.delete')}
                  className="shrink-0 rounded p-1 text-slate-600 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-500 disabled:opacity-50"
                >
                  <X size={ICON_XS} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          {isObs
            ? t('project.addObserver', { defaultValue: 'Добавить наблюдателя' })
            : t('project.addCoEditor', { defaultValue: 'Добавить со-руководителя' })}
        </label>
        <div className="flex gap-2">
          <select
            aria-label={pickLabel}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
          >
            <option value="">{pickLabel}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
          <Button onClick={handleAdd} disabled={!selectedId || busy}>
            {t('common.add', { defaultValue: 'Добавить' })}
          </Button>
        </div>
      </Surface>
    </div>
  )
}

export function ProjectActionsMenu({ project, canArchive, canClone, canManageCoEditors, onCoEditors, onObservers,
                                     onSubprojects, isSubproject }: {
  project: Awaited<ReturnType<typeof getProject>>
  canArchive: boolean
  canClone: boolean
  canManageCoEditors: boolean
  onCoEditors: () => void
  onObservers: () => void
  onSubprojects: () => void
  /** У подпроекта своих подпроектов быть не может — уровень ровно один. */
  isSubproject: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const showConfirm = useConfirmStore((s) => s.show)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project', project.id] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    await queryClient.invalidateQueries({ queryKey: ['portfolio'] })
  }

  const handleError = (err: unknown) => {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
  }

  const runArchiveToggle = async () => {
    setBusy(true)
    try {
      if (project.archived) {
        await unarchiveProject(project.id)
        await invalidate()
        showToast(t('project.unarchived', { defaultValue: 'Проект разархивирован' }), 'success')
      } else {
        await archiveProject(project.id)
        await invalidate()
        showToast(t('project.archived', { defaultValue: 'Проект в архиве' }), 'success')
        navigate('/portfolio')
      }
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  /** Архивация и клонирование уводят с экрана — значит им нужен тот же вопрос про несохранённое,
   *  что и пунктам меню. Порядок вопросов важен: СНАЧАЛА подтверждение самого действия, и только
   *  потом про несохранённое. В обратном порядке человек, отменивший архивацию, уже успевал
   *  ответить «уйти без сохранения» — правки оставались на экране, но охрана считала форму
   *  чистой и следующий уход терял их молча.
   *  Спрашиваем ДО действия, а не после навигации: после архивации «Сохранить и уйти» писало бы
   *  паспорт уже архивного проекта, а копия при клонировании снимается с серверных данных. */
  const withUnsavedCheck = (run: () => void) => {
    run()
  }

  const handleArchiveToggle = () => {
    setOpen(false)
    // Разархивация обратима и НЕ уводит со страницы — ни подтверждения, ни вопроса о правках.
    if (project.archived) {
      void runArchiveToggle()
      return
    }
    // У зонтика вопрос другой: человек архивирует ОДИН проект, а из портфеля пропадает
    // строка, под которой он привык видеть все модули. Сами подпроекты остаются на месте —
    // об этом и говорим, иначе архивация выглядит как «спрятать программу целиком».
    const kids = project.subprojects_count ?? 0
    showConfirm(
      kids > 0
        ? t('project.archiveConfirmUmbrella', {
            defaultValue: 'Архивировать проект? Он скроется из портфеля. Его подпроектов ({{n}}) это не коснётся — они останутся в портфеле сами по себе.',
            n: kids,
          })
        : t('project.archiveConfirm', { defaultValue: 'Архивировать проект? Он скроется из портфеля.' }),
      () => withUnsavedCheck(runArchiveToggle),
      { variant: 'primary' },
    )
  }

  const handleTemplateToggle = async () => {
    setOpen(false)
    setBusy(true)
    try {
      await setProjectTemplate(project.id, !project.is_template)
      await invalidate()
      showToast(
        project.is_template
          ? t('project.unmakeTemplate', { defaultValue: 'Снято из шаблонов' })
          : t('project.madeTemplate', { defaultValue: 'Проект сохранён как шаблон' }),
        'success',
      )
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const handleClone = () => {
    setOpen(false)
    showConfirm(
      t('project.cloneConfirm', { defaultValue: 'Создать копию проекта (паспорт и структура, без задач)?' }),
      () => withUnsavedCheck(async () => {
        setBusy(true)
        try {
          const clone = await cloneProject(project.id)
          navigate(`/projects/${clone.id}/passport`)
        } catch (err) {
          handleError(err)
        } finally {
          setBusy(false)
        }
      }),
      { variant: 'primary' },
    )
  }

  // Экспорт текущей секции (таб регистрирует строки через useSectionExport)
  const sectionExport = useExportStore((s) => s.current)
  const handleExport = () => {
    setOpen(false)
    if (sectionExport) void exportRowsToXlsx(`${sectionExport.filename}.xlsx`, sectionExport.rows)
  }

  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50'

  return (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        variant="secondary"
        icon={<MoreHorizontal size={14} />}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t('common.more', { defaultValue: 'Ещё' })}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-lg"
        >
          {sectionExport && (
            <button type="button" role="menuitem" className={itemCls} onClick={handleExport}>
              <Download size={14} className="text-slate-600 dark:text-slate-400" />
              {t('common.exportXlsx', { defaultValue: 'Экспорт в Excel' })}
            </button>
          )}
          {canManageCoEditors && (
            <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onCoEditors() }} disabled={busy}>
              <Users size={14} className="text-slate-600 dark:text-slate-400" />
              {t('project.coEditors', { defaultValue: 'Со-РП' })}
            </button>
          )}
          {/* Наблюдатель — рядом с со-РП: это соседние ответы на один вопрос «кому открыть проект». */}
          {canManageCoEditors && (
            <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onObservers() }} disabled={busy}>
              <Eye size={14} className="text-slate-600 dark:text-slate-400" />
              {t('project.observers', { defaultValue: 'Наблюдатели' })}
            </button>
          )}
          {/* Подпроекты — рядом с со-РП и наблюдателями: это третий ответ на вопрос «кому открыть
              проект», только открывается он сразу целой ветке. У подпроекта пункта нет: уровень
              ровно один, и предлагать действие, которое сервер отклонит, незачем. */}
          {canManageCoEditors && !isSubproject && (
            <button type="button" role="menuitem" className={itemCls} onClick={() => { setOpen(false); onSubprojects() }} disabled={busy}>
              <Network size={14} className="text-slate-600 dark:text-slate-400" />
              {t('project.subprojects', { defaultValue: 'Подпроекты' })}
            </button>
          )}
          {canClone && (
            <button type="button" role="menuitem" className={itemCls} onClick={handleClone} disabled={busy}>
              <Copy size={14} className="text-slate-600 dark:text-slate-400" />
              {t('project.clone', { defaultValue: 'Клонировать' })}
            </button>
          )}
          {canArchive && (
            <>
              <button type="button" role="menuitem" className={itemCls} onClick={handleArchiveToggle} disabled={busy}>
                {project.archived
                  ? <><ArchiveRestore size={14} className="text-slate-600 dark:text-slate-400" />{t('project.unarchive', { defaultValue: 'Разархивировать' })}</>
                  : <><Archive size={14} className="text-slate-600 dark:text-slate-400" />{t('project.archive', { defaultValue: 'Архивировать' })}</>}
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={handleTemplateToggle} disabled={busy}>
                <FileStack size={14} className="text-slate-600 dark:text-slate-400" />
                {project.is_template
                  ? t('project.unmakeTemplate', { defaultValue: 'Снять из шаблонов' })
                  : t('project.makeTemplate', { defaultValue: 'Сделать шаблоном' })}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
