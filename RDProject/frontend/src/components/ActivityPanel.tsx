import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Send } from 'lucide-react'
import { getActivity, addComment } from '@/api/activity'
import { getUsers } from '@/api/users'
import { formatDate } from '@/utils/date'
import { useDetailFormatter } from '@/components/ActionDetail'
import { Button } from '@/components/ui/button'
import { useCanWrite } from '@/contexts/ProjectPermission'
import type { UserListItem } from '@/types/user'

/** Локальная часть email, либо slug из ФИО (для @mention-токена). */
function mentionToken(u: UserListItem): string {
  if (u.email) return u.email.split('@')[0]
  return u.full_name.trim().toLowerCase().replace(/\s+/g, '.')
}

/** История изменений + комментарии work package (задача/риск) из journals OpenProject. */
export default function ActivityPanel({ projectId, wpId }: { projectId: string; wpId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const canWrite = useCanWrite()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionFrom, setMentionFrom] = useState<number | null>(null)
  const [fragment, setFragment] = useState('')
  const [active, setActive] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // Изменения приходят с сервера технической строкой «поле: было→стало» — переводим тут же,
  // тем же форматтером, что и журнал действий проекта.
  const formatDetail = useDetailFormatter()

  const key = ['activity', projectId, wpId]
  const { data: entries = [], isLoading } = useQuery({ queryKey: key, queryFn: () => getActivity(projectId, wpId) })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers, staleTime: 60_000 })

  const suggestions = mentionFrom === null
    ? []
    : users
      .filter((u) => {
        const q = fragment.toLowerCase()
        return mentionToken(u).toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q)
      })
      .slice(0, 6)

  const closeMention = () => {
    setMentionFrom(null)
    setFragment('')
    setActive(0)
  }

  /** Обновляет состояние @-меншена по позиции каретки в textarea. */
  const syncMention = (value: string, caret: number) => {
    const upToCaret = value.slice(0, caret)
    const m = /@(\w*)$/.exec(upToCaret)
    if (m) {
      setMentionFrom(caret - m[1].length - 1)
      setFragment(m[1])
      setActive(0)
    } else {
      closeMention()
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    syncMention(e.target.value, e.target.selectionStart)
  }

  const pick = (u: UserListItem) => {
    if (mentionFrom === null) return
    const caret = taRef.current?.selectionStart ?? text.length
    const before = text.slice(0, mentionFrom)
    const after = text.slice(caret)
    const insert = `@${mentionToken(u)}`
    const next = `${before}${insert} ${after}`
    setText(next)
    closeMention()
    const pos = before.length + insert.length + 1
    requestAnimationFrame(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(pos, pos)
    })
  }

  const submit = async () => {
    const v = text.trim()
    if (!v) return
    setSending(true)
    try {
      await addComment(projectId, wpId, v)
      setText('')
      closeMention()
      await qc.invalidateQueries({ queryKey: key })
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionFrom !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        pick(suggestions[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        <MessageSquare size={14} /> {t('activity.title', { defaultValue: 'История и комментарии' })}
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('activity.empty', { defaultValue: 'Пока нет активности.' })}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                <span>{e.user ?? ''}</span>
                <span>{e.created_at ? formatDate(e.created_at) : ''}</span>
              </div>
              {e.comment && <p className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{e.comment.replace(/\*\*/g, '')}</p>}
              {e.details.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4 text-slate-600 dark:text-slate-400">
                  {e.details.map((d, i) => <li key={i}>{formatDetail(d)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <>
          <div className="mt-2 flex items-end gap-1.5">
            <div className="relative w-full">
              <textarea
                ref={taRef}
                rows={2}
                value={text}
                onChange={onChange}
                onKeyDown={onKeyDown}
                placeholder={t('activity.placeholder', { defaultValue: 'Написать комментарий…' })}
                className="w-full resize-none rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {mentionFrom !== null && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-lg">
                  {suggestions.map((u, i) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onMouseDown={(ev) => { ev.preventDefault(); pick(u) }}
                        className={`flex w-full flex-col items-start px-2.5 py-1 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${i === active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                      >
                        <span className="text-slate-700 dark:text-slate-200">@{mentionToken(u)}</span>
                        <span className="text-[10px] text-slate-600 dark:text-slate-400">{u.full_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button
              size="sm"
              onClick={submit}
              disabled={sending || !text.trim()}
              title={t('activity.send', { defaultValue: 'Отправить' })}
              aria-label={t('activity.send', { defaultValue: 'Отправить' })}
              className="h-8 w-9 shrink-0 px-0"
              icon={<Send size={14} />}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-600 dark:text-slate-400">{t('activity.mentionHint', { defaultValue: '@логин — упомянуть участника' })}</p>
        </>
      )}
    </div>
  )
}
