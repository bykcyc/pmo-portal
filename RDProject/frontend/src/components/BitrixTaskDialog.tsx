import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X, ExternalLink, Trash2, Check, AlertTriangle } from 'lucide-react'
import { getPersons } from '@/api/persons'
import PersonPicker from '@/components/PersonPicker'
import type { Person } from '@/types/person'

const BITRIX_DOMAIN = 'bitrix.example.com'

export interface BitrixTaskDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  entityType: 'task' | 'backlog'
  entityId: string
  bitrix24TaskId: number | null
  prefill: {
    title: string
    description: string | null
    assigneeName: string | null
    pmName: string | null
    deadline: string | null
  }
  onCreateTask: (payload: {
    title: string
    description: string | null
    responsible_id: number | null
    created_by_id: number | null
    deadline: string | null
  }) => Promise<void>
  onDeleteTask: () => Promise<void>
}

function findPerson(persons: Person[], name: string | null): Person | undefined {
  if (!name) return undefined
  const lower = name.toLowerCase().trim()
  return persons.find(p => p.full_name.toLowerCase() === lower)
}

export default function BitrixTaskDialog({
  open, onClose, bitrix24TaskId, prefill, onCreateTask, onDeleteTask,
}: BitrixTaskDialogProps) {
  const { t } = useTranslation()
  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: () => getPersons(), staleTime: 60_000 })

  // Название задачи → в НАЗВАНИЕ Bitrix (раньше поле было пустым, а имя уезжало в описание).
  const [title, setTitle] = useState(prefill.title || '')
  const [description, setDescription] = useState(prefill.description || '')
  const [creatorName, setCreatorName] = useState(prefill.pmName || '')
  const [responsibleName, setResponsibleName] = useState(prefill.assigneeName || '')
  const [deadline, setDeadline] = useState(prefill.deadline || '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Resolve persons from names
  const creatorPerson = useMemo(() => findPerson(persons, creatorName), [persons, creatorName])
  const responsiblePerson = useMemo(() => findPerson(persons, responsibleName), [persons, responsibleName])

  const creatorId = creatorPerson?.bitrix24_id ?? null
  const responsibleId = responsiblePerson?.bitrix24_id ?? null

  if (!open) return null

  const isViewMode = bitrix24TaskId !== null

  const handleCreate = async () => {
    if (!title.trim()) { setError(t('bitrix24Task.taskTitle') + ' required'); return }
    setSaving(true); setError(null)
    try {
      await onCreateTask({
        title: title.trim(),
        description: description.trim() || null,
        responsible_id: responsibleId,
        created_by_id: creatorId,
        deadline: deadline || null,
      })
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('bitrix24Task.createError')
      setError(msg)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true); setError(null)
    try {
      await onDeleteTask()
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('bitrix24Task.deleteError')
      setError(msg)
    } finally { setDeleting(false); setConfirmDelete(false) }
  }

  const bitrixUrl = `https://${BITRIX_DOMAIN}/company/personal/user/0/tasks/task/view/${bitrix24TaskId}/`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-[460px] max-w-[95vw] mx-4 border border-gray-100 dark:border-slate-800"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-slate-200">
            {isViewMode ? t('bitrix24Task.viewTitle') : t('bitrix24Task.createTitle')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"><X size={18} /></button>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-300 mb-3 bg-red-50 dark:bg-red-950/40 px-3 py-1.5 rounded">{error}</p>}

        {isViewMode ? (
          /* ── View mode ── */
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800/60 p-3 rounded-lg">
              <span className="text-sm text-gray-600 dark:text-slate-300">ID:</span>
              <span className="text-sm font-mono font-semibold text-gray-800 dark:text-slate-200">{bitrix24TaskId}</span>
            </div>
            <a
              href={bitrixUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors w-full justify-center"
            >
              <ExternalLink size={15} />
              {t('bitrix24Task.openInBitrix')}
            </a>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors w-full justify-center disabled:opacity-50"
            >
              <Trash2 size={15} />
              {confirmDelete ? t('bitrix24Task.confirmDelete') : t('bitrix24Task.deleteTask')}
            </button>
          </div>
        ) : (
          /* ── Create mode ── */
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
                {t('bitrix24Task.taskTitle')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('bitrix24Task.description')}</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('bitrix24Task.creator')}</label>
                {creatorPerson ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-slate-800/60 rounded-md border border-gray-200 dark:border-slate-700">
                    <span className="text-sm text-gray-800 dark:text-slate-200 truncate flex-1">{creatorPerson.full_name}</span>
                    {creatorId ? (
                      <span className="flex items-center gap-0.5 text-xs text-green-700 dark:text-green-300 shrink-0">
                        <Check size={11} /> {creatorId}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-300 shrink-0">
                        <AlertTriangle size={11} /> {t('bitrix24Task.noB24Id')}
                      </span>
                    )}
                  </div>
                ) : creatorName && !creatorPerson ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 dark:bg-red-950/40 rounded-md border border-red-200 dark:border-red-900">
                      <span className="text-sm text-gray-600 dark:text-slate-300 truncate flex-1">{creatorName}</span>
                      <span className="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-300 shrink-0">
                        <AlertTriangle size={11} /> {t('bitrix24Task.noPersonInBitrix')}
                      </span>
                    </div>
                    <PersonPicker
                      value={creatorName}
                      onChange={setCreatorName}
                      placeholder={t('bitrix24Task.creator') + '…'}
                      className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                ) : (
                  <PersonPicker
                    value={creatorName}
                    onChange={setCreatorName}
                    placeholder={t('bitrix24Task.creator') + '…'}
                    className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('bitrix24Task.responsible')}</label>
                {responsiblePerson ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-slate-800/60 rounded-md border border-gray-200 dark:border-slate-700">
                    <span className="text-sm text-gray-800 dark:text-slate-200 truncate flex-1">{responsiblePerson.full_name}</span>
                    {responsibleId ? (
                      <span className="flex items-center gap-0.5 text-xs text-green-700 dark:text-green-300 shrink-0">
                        <Check size={11} /> {responsibleId}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-300 shrink-0">
                        <AlertTriangle size={11} /> {t('bitrix24Task.noB24Id')}
                      </span>
                    )}
                  </div>
                ) : responsibleName && !responsiblePerson ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 dark:bg-red-950/40 rounded-md border border-red-200 dark:border-red-900">
                      <span className="text-sm text-gray-600 dark:text-slate-300 truncate flex-1">{responsibleName}</span>
                      <span className="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-300 shrink-0">
                        <AlertTriangle size={11} /> {t('bitrix24Task.noPersonInBitrix')}
                      </span>
                    </div>
                    <PersonPicker
                      value={responsibleName}
                      onChange={setResponsibleName}
                      placeholder={t('bitrix24Task.responsible') + '…'}
                      className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                ) : (
                  <PersonPicker
                    value={responsibleName}
                    onChange={setResponsibleName}
                    placeholder={t('bitrix24Task.responsible') + '…'}
                    className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{t('bitrix24Task.deadline')}</label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 px-4 py-2 text-sm font-medium text-btn-primary-fg bg-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50"
              >
                {saving ? t('bitrix24Task.creating') : t('bitrix24Task.create')}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
