/**
 * Соисполнители задачи — кто ещё в ней участвует.
 *
 * ОТВЕТСТВЕННЫЙ у задачи по-прежнему один: «несколько исполнителей» на практике означает, что
 * не отвечает никто. Здесь — те, кто в работе участвует: задача появляется у них в «Моих
 * задачах», но загрузку в портфеле они не получают, иначе одни и те же часы посчитались бы
 * на всех разом.
 *
 * Отдельный диалог, а не ячейка таблицы: людей бывает несколько, каждого надо найти в
 * справочнике и каждого можно снять — в ячейку шириной в колонку это не помещается.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { CoAssignee } from '@/types/task'
import { ICON_SM } from '@/constants/ui'
import { Button } from '@/components/ui/button'
import { Surface } from '@/components/ui/surface'
import PersonPicker from '@/components/PersonPicker'

export default function CoAssigneesDialog({ taskTitle, value, canWrite, onSave, onClose }: {
  taskTitle: string
  value: CoAssignee[]
  canWrite: boolean
  onSave: (list: CoAssignee[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [list, setList] = useState<CoAssignee[]>(value)
  const [draft, setDraft] = useState('')

  const add = (name: string, personId: string | null) => {
    const clean = name.trim()
    if (!clean) return
    // Тёзку по имени не отличить, поэтому дубликатом считаем совпадение person_id, а при его
    // отсутствии — имени. Сервер проверит то же самое ещё раз: он и есть источник правды.
    const key = personId || clean.toLowerCase()
    if (list.some(c => (c.person_id || (c.name || '').toLowerCase()) === key)) { setDraft(''); return }
    setList([...list, { person_id: personId, name: clean, email: null }])
    setDraft('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <Surface className="w-full max-w-md p-6" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('wbs.coAssignees', { defaultValue: 'Соисполнители' })}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')}
            className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
            <X size={ICON_SM} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {taskTitle} · {t('wbs.coAssigneesHint', {
            defaultValue: 'Отвечает за задачу по-прежнему один человек. Соисполнители увидят её в «Моих задачах».',
          })}
        </p>

        {list.length === 0 ? (
          <p className="mb-3 text-xs italic text-slate-500 dark:text-slate-400">
            {t('wbs.coAssigneesEmpty', { defaultValue: 'Пока никого.' })}
          </p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {list.map((c, i) => (
              <li key={(c.person_id || c.name || '') + i}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
                <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">
                  {c.name}
                  {/* Не нашли в справочнике — говорим об этом: такой строке портал не сможет
                      показать задачу в «Моих задачах», потому что не знает, кто это. */}
                  {!c.person_id && (
                    <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                      {t('wbs.coAssigneeText', { defaultValue: '(не из справочника)' })}
                    </span>
                  )}
                </span>
                {canWrite && (
                  <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))}
                    className="ml-3 shrink-0 text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400">
                    {t('common.delete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <PersonPicker
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={draft}
            placeholder={t('wbs.coAssigneeAdd', { defaultValue: 'Добавить человека…' })}
            onChange={setDraft}
            onSelect={v => add(v, null)}
            onPickPerson={p => { if (p) add(p.full_name, p.id) }}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          {canWrite && <Button onClick={() => onSave(list)}>{t('common.save')}</Button>}
        </div>
      </Surface>
    </div>
  )
}
