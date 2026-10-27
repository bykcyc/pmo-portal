/**
 * Реестр проектов переходного периода — экран руководителя портфеля.
 *
 * Пока компания переходит с Excel, часть проектов существует только в голове владельца.
 * Портфель без них показывает половину картины. Здесь строка заводится руками («болванка»),
 * а когда РП действительно создаст проект в портале, строка привязывается к нему — и дальше
 * статус, прогресс и срок берутся ЖИВЫЕ, из проекта, а не из памяти.
 *
 * Экран умышленно похож на таблицу: правка по ячейке, сохранение по уходу из поля. Это временный
 * инструмент на время перехода, и заводить ради него формы-диалоги не стоит — когда все проекты
 * заведены, реестр пустеет и пункт меню исчезает сам.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ExternalLink, AlertTriangle } from 'lucide-react'

import { PageShell, PageHeader } from '@/components/ui/layout'
import { Surface } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/badges'
import { SkeletonRows } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/feedback'
import { useConfirmStore } from '@/store/confirmStore'
import { useToastStore } from '@/store/toastStore'
import { getProjects } from '@/api/projects'
import {
  createRegistryRow, deleteRegistryRow, getRegistry, updateRegistryRow,
  type RegistryPatch, type RegistryRow,
} from '@/api/registry'
import { cn } from '@/utils/cn'

const RAG_CLASS: Record<string, string> = {
  red: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  yellow: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}

/** Слово владельца («красный») и код портала («red») — одна шкала. */
function ragKey(v: string | null | undefined): string {
  const s = (v || '').toLowerCase()
  if (s.startsWith('крас') || s === 'red') return 'red'
  if (s.startsWith('жёлт') || s.startsWith('желт') || s === 'yellow' || s === 'amber') return 'amber'
  if (s.startsWith('зел') || s === 'green') return 'green'
  return ''
}

const COLS: Array<{ key: keyof RegistryPatch; width: string }> = [
  { key: 'pm_name', width: 'w-44' },
  { key: 'name', width: 'w-72' },
  { key: 'kind', width: 'w-36' },
  { key: 'rag', width: 'w-28' },
  { key: 'customer', width: 'w-40' },
  { key: 'phase', width: 'w-36' },
]

export default function RegistryPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const showConfirm = useConfirmStore((s) => s.show)
  const showToast = useToastStore((s) => s.show)
  const [busy, setBusy] = useState(false)

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['registry'],
    queryFn: getRegistry,
  })
  // Список проектов для привязки. per_page с запасом: выбирать надо из всех, а не из первой страницы.
  const { data: projects } = useQuery({
    queryKey: ['registry-projects'],
    queryFn: () => getProjects({ per_page: 200 }),
  })

  const stats = useMemo(() => {
    const s = { red: 0, amber: 0, green: 0, linked: 0, total: rows.length }
    for (const r of rows) {
      const key = ragKey(r.live?.rag ?? r.rag)
      if (key === 'red') s.red += 1
      else if (key === 'amber') s.amber += 1
      else if (key === 'green') s.green += 1
      if (r.live) s.linked += 1
    }
    return s
  }, [rows])

  const save = async (id: string, patch: RegistryPatch) => {
    try {
      await updateRegistryRow(id, patch)
      await qc.invalidateQueries({ queryKey: ['registry'] })
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(detail || t('common.error', { defaultValue: 'Ошибка' }), 'error')
      await qc.invalidateQueries({ queryKey: ['registry'] })   // вернуть строку к сохранённому виду
    }
  }

  const addRow = async () => {
    setBusy(true)
    try {
      await createRegistryRow({ name: t('registry.newRow', { defaultValue: 'Новый проект' }) })
      await qc.invalidateQueries({ queryKey: ['registry'] })
    } finally {
      setBusy(false)
    }
  }

  const removeRow = (row: RegistryRow) => {
    showConfirm(
      t('registry.deleteAsk', { defaultValue: 'Удалить строку реестра «{{name}}»?', name: row.name }),
      async () => {
        await deleteRegistryRow(row.id)
        await qc.invalidateQueries({ queryKey: ['registry'] })
      },
      { variant: 'danger', confirmLabel: t('common.delete', { defaultValue: 'Удалить' }) },
    )
  }

  return (
    <PageShell>
      <PageHeader
        title={t('registry.title', { defaultValue: 'Реестр проектов' })}
        description={t('registry.description', {
          defaultValue: 'Проекты, которые должны вестись в портале. Пока проект не заведён — строка живёт сама по себе; после привязки данные берутся из проекта.',
        })}
        actions={
          <Button icon={<Plus size={16} />} onClick={addRow} disabled={busy}>
            {t('registry.add', { defaultValue: 'Добавить строку' })}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill className={RAG_CLASS.red}>{t('registry.red', { defaultValue: 'красных' })}: {stats.red}</Pill>
        <Pill className={RAG_CLASS.amber}>{t('registry.amber', { defaultValue: 'жёлтых' })}: {stats.amber}</Pill>
        <Pill className={RAG_CLASS.green}>{t('registry.green', { defaultValue: 'зелёных' })}: {stats.green}</Pill>
        <Pill className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {t('registry.linked', { defaultValue: 'заведено в портале' })}: {stats.linked} / {stats.total}
        </Pill>
      </div>

      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : isError ? (
        <EmptyState title={t('common.error', { defaultValue: 'Ошибка' })} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('registry.emptyTitle', { defaultValue: 'Реестр пуст' })}
          description={t('registry.emptyBody', {
            defaultValue: 'Добавьте проекты, которые должны вестись в портале. Когда все они заведены, реестр больше не нужен.',
          })}
        />
      ) : (
        <Surface className="overflow-x-auto p-0">
          {/* Минимальная ширина: без неё колонки схлопываются и текст обрезается на полуслове —
              таблица должна скроллиться вбок, а не врать содержимым. */}
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">{t('registry.pm', { defaultValue: 'Руководитель' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.name', { defaultValue: 'Проект' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.kind', { defaultValue: 'Тип' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.rag', { defaultValue: 'Статус' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.customer', { defaultValue: 'Заказчик' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.phase', { defaultValue: 'Фаза' })}</th>
                <th className="px-3 py-2 font-medium">{t('registry.link', { defaultValue: 'Проект в портале' })}</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  {COLS.map(({ key, width }) => {
                    // У привязанной строки статус и руководителя показываем ЖИВЫЕ и не даём править:
                    // иначе в реестре будет одно, в проекте другое, и верить будет нечему.
                    const liveValue = row.live
                      ? (key === 'rag' ? row.live.rag : key === 'pm_name' ? row.live.pm_name : key === 'name' ? row.live.name : null)
                      : null
                    if (liveValue !== null && liveValue !== undefined) {
                      return (
                        <td key={key} className={cn('px-3 py-1.5', width)}>
                          {key === 'rag' ? (
                            <Pill className={RAG_CLASS[ragKey(liveValue)] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}>
                              {/* Портал отдаёт код (red), человеку нужно слово на его языке. */}
                              {t(`registry.rag_${ragKey(liveValue) || 'none'}`, { defaultValue: liveValue })}
                            </Pill>
                          ) : (
                            <span className="text-slate-800 dark:text-slate-100">{liveValue}</span>
                          )}
                        </td>
                      )
                    }
                    return (
                      <td key={key} className={cn('px-3 py-1.5', width)}>
                        <input
                          defaultValue={(row[key as keyof RegistryRow] as string) || ''}
                          onBlur={(e) => {
                            const next = e.target.value.trim()
                            if (next !== ((row[key as keyof RegistryRow] as string) || '')) {
                              void save(row.id, { [key]: next } as RegistryPatch)
                            }
                          }}
                          className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm text-slate-800 outline-none hover:border-slate-200 focus:border-blue-500 focus:bg-white dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-900"
                        />
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.project_id || ''}
                        onChange={(e) => void save(row.id, { project_id: e.target.value || null })}
                        className="max-w-[220px] rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">{t('registry.notLinked', { defaultValue: '— не заведён —' })}</option>
                        {(projects?.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                        ))}
                      </select>
                      {row.live && (
                        <Link
                          to={`/projects/${row.live.id}`}
                          className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                          title={t('registry.open', { defaultValue: 'Открыть проект' })}
                        >
                          <ExternalLink size={15} />
                        </Link>
                      )}
                      {row.link_broken && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle size={14} />
                          {t('registry.linkBroken', { defaultValue: 'проект удалён' })}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeRow(row)}
                      aria-label={t('common.delete', { defaultValue: 'Удалить' })}
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}
    </PageShell>
  )
}
