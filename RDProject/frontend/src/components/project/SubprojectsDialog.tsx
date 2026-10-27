/**
 * Управление подпроектами зонтика.
 *
 * ОТДЕЛЬНЫЙ диалог, а не третий `kind` у CoEditorsDialog. Тот параметризован ролью человека
 * («со-РП» ↔ «наблюдатель») — там и правда меняются только подписи да пара обработчиков.
 * Здесь кандидаты не люди, а ПРОЕКТЫ, и у выбора свои правила: нельзя брать шаблон, уже
 * привязанный проект и проект, у которого есть свои подпроекты. Впихнуть это третьим случаем
 * значило бы сделать `kind` не подписью, а развилкой смысла.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { addSubproject, getProjects, getSubprojects, removeSubproject } from '@/api/projects'
import { ICON_SM } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import { useToastStore } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'
import { computeCanWrite } from '@/contexts/ProjectPermission'

export function SubprojectsDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)
  const currentUser = useAuthStore((s) => s.user)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: children = [], isLoading } = useQuery({
    queryKey: ['subprojects', projectId],
    queryFn: () => getSubprojects(projectId),
  })
  // per_page с запасом: диалог показывает выпадающий список, а не страницы.
  const { data: all } = useQuery({
    queryKey: ['projects', 'for-subprojects'],
    queryFn: () => getProjects({ page: 1, per_page: 200 }),
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['subprojects', projectId] })
    // Связь меняет ПРАВА, а значит и состав любого списка проектов — обновляем всё,
    // что могло показывать старую картину, а не только эту таблицу.
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    await queryClient.invalidateQueries({ queryKey: ['portfolio'] })
  }

  const handleError = (err: unknown) => {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
  }

  const linkedIds = new Set(children.map((c) => String(c.id)))
  // Кандидат — верхнеуровневый проект без своих подпроектов, не шаблон и не сам зонтик.
  // Не-владельцу показываем только те, которыми он вправе управлять: сервер всё равно откажет,
  // и предлагать имя, на котором клик заканчивается отказом, — худший вид подсказки.
  const candidates = (all?.data ?? []).filter((p) => {
    if (String(p.id) === String(projectId) || linkedIds.has(String(p.id))) return false
    if (p.parent_id || (p.subprojects_count ?? 0) > 0 || p.is_template) return false
    return currentUser?.role === 'owner' || computeCanWrite(currentUser, p)
  })

  const handleAdd = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await addSubproject(projectId, selectedId)
      await invalidate()
      setSelectedId('')
      showToast(t('project.subprojectAdded', { defaultValue: 'Подпроект привязан' }), 'success')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (childId: string) => {
    setBusy(true)
    try {
      await removeSubproject(projectId, childId)
      await invalidate()
      showToast(t('project.subprojectRemoved', { defaultValue: 'Подпроект отвязан' }), 'success')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <Surface className="mx-4 w-full max-w-lg p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('project.subprojectsManage', { defaultValue: 'Подпроекты' })}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100">
            <X size={ICON_SM} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {t('project.subprojectsHint', { defaultValue: 'Руководитель этого проекта видит и правит все подпроекты, а их руководители видят друг друга и общий проект. Уровень только один: подпроект не может иметь своих подпроектов.' })}
        </p>

        {isLoading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
        ) : children.length === 0 ? (
          <p className="mb-4 text-xs italic text-slate-600 dark:text-slate-400">
            {t('project.subprojectsEmpty', { defaultValue: 'Подпроектов пока нет.' })}
          </p>
        ) : (
          <ul className="mb-4 space-y-1.5">
            {children.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                <span className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.code}</span>{' '}
                  {c.name}
                  {c.pm_name ? <span className="text-slate-500 dark:text-slate-400"> · {c.pm_name}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(String(c.id))}
                  disabled={busy}
                  className="ml-3 shrink-0 text-xs text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
                >
                  {t('project.subprojectUnlink', { defaultValue: 'Отвязать' })}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          {t('project.addSubproject', { defaultValue: 'Добавить подпроект' })}
        </label>
        <div className="flex gap-2">
          <select
            aria-label={t('project.subprojectPick', { defaultValue: 'Выберите проект' })}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:border-slate-500"
          >
            <option value="">{t('project.subprojectPick', { defaultValue: 'Выберите проект' })}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
          <Button size="sm" onClick={handleAdd} disabled={!selectedId || busy}>
            {t('common.add', { defaultValue: 'Добавить' })}
          </Button>
        </div>
        {candidates.length === 0 && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {t('project.subprojectNoCandidates', { defaultValue: 'Нет подходящих проектов: подпроектом может стать только самостоятельный проект без своих подпроектов.' })}
          </p>
        )}
      </Surface>
    </div>
  )
}
