import { useState } from 'react'
import { X, Send, Trash2 } from 'lucide-react'
import { formatDateTime } from '@/utils/date'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getEntityNotes, addEntityNote, deleteEntityNote } from '@/api/notes'
import { addRiskUpdate, deleteRiskUpdate } from '@/api/risks'
import type { EntityNote } from '@/types/note'
import type { RiskUpdate } from '@/types/risk'

interface BaseProps {
  projectId: string
  title: string
  onClose: () => void
}
interface EntityProps extends BaseProps {
  isRisk?: false
  entityType: string
  entityId: string
}
interface RiskProps extends BaseProps {
  isRisk: true
  riskId: string
  updates: RiskUpdate[]
}
type Props = EntityProps | RiskProps

export default function LogPanel(props: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: entityNotes = [] } = useQuery<EntityNote[]>({
    queryKey: ['notes', props.isRisk ? '' : props.entityType, props.isRisk ? '' : props.entityId],
    queryFn: () => (!props.isRisk
      ? getEntityNotes(props.projectId, props.entityType, props.entityId)
      : Promise.resolve([] as EntityNote[])),
    enabled: !props.isRisk,
  })

  const entries: Array<{ id: string; text: string; created_at: string }> = props.isRisk
    ? props.updates.map((u) => ({ id: u.id, text: u.update_text, created_at: u.created_at }))
    : entityNotes.map((n) => ({ id: n.id, text: n.content, created_at: n.created_at }))

  const handleAdd = async () => {
    if (!text.trim()) return
    setSubmitting(true)
    try {
      if (props.isRisk) {
        await addRiskUpdate(props.projectId, props.riskId, text)
        qc.invalidateQueries({ queryKey: ['risks', props.projectId] })
      } else {
        await addEntityNote(props.projectId, props.entityType, props.entityId, text)
        qc.invalidateQueries({ queryKey: ['notes', props.entityType, props.entityId] })
      }
      setText('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (props.isRisk) {
      await deleteRiskUpdate(props.projectId, props.riskId, id)
      qc.invalidateQueries({ queryKey: ['risks', props.projectId] })
    } else {
      await deleteEntityNote(props.projectId, id)
      qc.invalidateQueries({ queryKey: ['notes', props.entityType, props.entityId] })
    }
  }

  return (
    <div className="flex w-64 flex-shrink-0 flex-col border-l border-gray-200 dark:border-slate-700 pl-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary-700">{t('common.log')}</span>
        <button onClick={props.onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
          <X size={14} />
        </button>
      </div>
      <p className="mb-3 truncate text-xs font-medium text-gray-500 dark:text-slate-400" title={props.title}>{props.title}</p>

      <div className="mb-3 max-h-96 flex-1 space-y-2 overflow-y-auto">
        {entries.length === 0 && (
          <p className="text-xs italic text-gray-400">{t('risks.noUpdates')}</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="group relative rounded bg-gray-50 dark:bg-slate-800/60 p-2 text-xs">
            <p className="pr-4 text-gray-800 dark:text-slate-200">{e.text}</p>
            <p className="mt-0.5 text-gray-400">{formatDateTime(e.created_at)}</p>
            <button
              onClick={() => handleDelete(e.id)}
              className="absolute right-1.5 top-1.5 p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder={t('logPanel.addNote')}
          className="flex-1 rounded border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 px-2 py-1.5 text-xs focus:border-primary-400 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={submitting || !text.trim()}
          className="shrink-0 rounded bg-btn-primary p-1.5 text-btn-primary-fg hover:bg-btn-primary-hover disabled:opacity-50"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  )
}
