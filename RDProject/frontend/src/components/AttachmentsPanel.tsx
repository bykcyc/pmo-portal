import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Paperclip, Download, Trash2, Upload } from 'lucide-react'
import {
  getAttachments, uploadAttachment, deleteAttachment, downloadAttachment,
} from '@/api/attachments'
import { Button } from '@/components/ui/button'
import { useCanWrite } from '@/contexts/ProjectPermission'

function fmtSize(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Вложения work package (задача/риск) через attachments API OpenProject. */
export default function AttachmentsPanel({ projectId, wpId }: { projectId: string; wpId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const key = ['attachments', projectId, wpId]
  const { data: items = [], isLoading } = useQuery({ queryKey: key, queryFn: () => getAttachments(projectId, wpId) })

  const upload = async (file: File) => {
    setBusy(true)
    setProgress(0)
    try {
      await uploadAttachment(projectId, wpId, file, setProgress)
      await qc.invalidateQueries({ queryKey: key })
    } finally {
      setBusy(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await upload(file)
  }

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (!canWrite || busy) return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await upload(file)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canWrite) return
    e.preventDefault()
    setDragOver(true)
  }

  const onDelete = async (aid: number) => {
    setBusy(true)
    try {
      await deleteAttachment(projectId, aid)
      await qc.invalidateQueries({ queryKey: key })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-md border-2 border-dashed transition-colors ${dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'border-transparent'}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          <Paperclip size={14} /> {t('attachments.title', { defaultValue: 'Вложения' })}
        </span>
        {canWrite && (
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              icon={<Upload size={14} />}
            >
              {t('attachments.add', { defaultValue: 'Загрузить' })}
            </Button>
          </>
        )}
      </div>

      {progress !== null && (
        <p className="mb-2 text-xs text-blue-600 dark:text-blue-300">{t('attachments.uploading', { defaultValue: 'Загрузка' })} {progress}%</p>
      )}

      {isLoading ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('attachments.empty', { defaultValue: 'Файлов нет.' })}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-xs">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200" title={a.file_name ?? ''}>{a.file_name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-[10px] text-slate-600 dark:text-slate-400">{fmtSize(a.size)}</span>
                <button type="button" title={t('attachments.download', { defaultValue: 'Скачать' })}
                  aria-label={t('attachments.download', { defaultValue: 'Скачать' })}
                  onClick={() => downloadAttachment(projectId, a.id, a.file_name ?? 'file')}
                  className="text-slate-600 dark:text-slate-400 hover:text-blue-600">
                  <Download size={14} />
                </button>
                {canWrite && (
                  <button type="button" title={t('common.delete')} aria-label={t('common.delete')} disabled={busy}
                    onClick={() => onDelete(a.id)}
                    className="text-slate-600 dark:text-slate-400 hover:text-rose-600 disabled:opacity-50">
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
