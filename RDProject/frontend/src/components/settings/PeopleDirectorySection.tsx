import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import type { QueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Plus, Trash2, Download, Pencil, Check, X, KeyRound, UserCheck } from 'lucide-react'
import { deleteAllPersons } from '@/api/persons'
import type { Person } from '@/types/person'

type AddPersonRow = { first_name: string; last_name: string; email: string; bitrix24_id: string }
type EditPersonRow = { id: string; first_name: string; last_name: string; email: string; bitrix24_id: string }

interface PeopleDirectorySectionProps {
  t: TFunction
  confirm: (message: string, callback: () => void | Promise<void>, options?: { confirmLabel?: string; variant?: 'danger' | 'primary' }) => void
  qc: QueryClient
  persons: Person[]
  personsLoading: boolean
  handleImport: () => void
  importing: boolean
  addRow: AddPersonRow | null
  setAddRow: Dispatch<SetStateAction<AddPersonRow | null>>
  importMsg: string | null
  handleAddPerson: () => void
  editRow: EditPersonRow | null
  setEditRow: Dispatch<SetStateAction<EditPersonRow | null>>
  handleEditPerson: () => void
  handleDeletePerson: (p: Person) => void
  handleToggleHidden: (p: Person) => void
  /** null = учётки нет, можно заводить. Считается по списку пользователей, а не по
   *  person.user_id: удаление пользователя эту ссылку не чистит, и висячий id залипал бы. */
  hasLogin: (p: Person) => boolean
  handleCreateLogin: (p: Person) => void
  actionCellClass: string
  actionWrapClass: string
  iconButtonClass: string
}

export default function PeopleDirectorySection({
  t,
  confirm,
  qc,
  persons,
  personsLoading,
  handleImport,
  importing,
  addRow,
  setAddRow,
  importMsg,
  handleAddPerson,
  editRow,
  setEditRow,
  handleEditPerson,
  handleDeletePerson,
  handleToggleHidden,
  hasLogin,
  handleCreateLogin,
  actionCellClass,
  actionWrapClass,
  iconButtonClass,
}: PeopleDirectorySectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{t('persons.title')}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => confirm(t('persons.deleteAllConfirm'), async () => {
                  await deleteAllPersons()
                  qc.invalidateQueries({ queryKey: ['persons'] })
                })}
                disabled={persons.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-300 dark:border-rose-900 text-red-600 dark:text-rose-300 rounded-md hover:bg-red-50 dark:hover:bg-rose-950/40 disabled:opacity-50">
                <Trash2 size={12} />{t('persons.deleteAll')}
              </button>
              <button onClick={handleImport} disabled={importing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">
                <Download size={12} className={importing ? 'animate-spin' : ''} />
                {importing ? t('persons.importing') : t('persons.importFromBitrix')}
              </button>
              <button onClick={() => setAddRow({ first_name: '', last_name: '', email: '', bitrix24_id: '' })}
                disabled={!!addRow}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
                <Plus size={12} />{t('persons.add')}
              </button>
            </div>
          </div>
          {importMsg && (
            <p className={`mb-3 text-xs flex items-center gap-1 ${importMsg.includes('{{') || importMsg === t('persons.importError') ? 'text-red-600 dark:text-rose-300' : 'text-green-700 dark:text-green-300'}`}>
              {importMsg.includes(t('persons.importError')) ? <XCircle size={13} /> : <CheckCircle size={13} />}
              {importMsg}
            </p>
          )}
          {personsLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('common.loading')}</p>
          ) : persons.length === 0 && !addRow ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-4">{t('persons.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('persons.firstName')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('persons.lastName')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('persons.email')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('persons.bitrix24Id')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4 w-20" title={t('persons.hiddenHint')}>{t('persons.hidden')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {addRow && (
                    <tr className="border-b border-gray-100 dark:border-slate-800 bg-primary-50/30 dark:bg-blue-950/40">
                      <td className="py-1.5 pr-2"><input autoFocus aria-label={t('persons.firstName')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addRow.first_name} onChange={e => setAddRow({ ...addRow, first_name: e.target.value })} placeholder={t('persons.firstName')} onKeyDown={e => { if (e.key === 'Enter') handleAddPerson(); if (e.key === 'Escape') setAddRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.lastName')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addRow.last_name} onChange={e => setAddRow({ ...addRow, last_name: e.target.value })} placeholder={t('persons.lastName')} onKeyDown={e => { if (e.key === 'Enter') handleAddPerson(); if (e.key === 'Escape') setAddRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.email')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addRow.email} onChange={e => setAddRow({ ...addRow, email: e.target.value })} placeholder={t('persons.email')} onKeyDown={e => { if (e.key === 'Enter') handleAddPerson(); if (e.key === 'Escape') setAddRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.bitrix24Id')} className="w-28 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addRow.bitrix24_id} onChange={e => setAddRow({ ...addRow, bitrix24_id: e.target.value.replace(/\D/g, '') })} placeholder={t('common.id')} onKeyDown={e => { if (e.key === 'Enter') handleAddPerson(); if (e.key === 'Escape') setAddRow(null) }} /></td>
                      <td className="py-1.5 pr-4" />
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          <button type="button" aria-label={t('common.save', { defaultValue: 'Сохранить' })} onClick={handleAddPerson} className={`${iconButtonClass} text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200`}><Check size={14} /></button>
                          <button type="button" aria-label={t('common.cancel', { defaultValue: 'Отмена' })} onClick={() => setAddRow(null)} className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {persons.map(p => editRow?.id === p.id ? (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-slate-800 bg-yellow-50/30 dark:bg-amber-950/40">
                      <td className="py-1.5 pr-2"><input autoFocus aria-label={t('persons.firstName')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editRow.first_name} onChange={e => setEditRow({ ...editRow, first_name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleEditPerson(); if (e.key === 'Escape') setEditRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.lastName')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editRow.last_name} onChange={e => setEditRow({ ...editRow, last_name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleEditPerson(); if (e.key === 'Escape') setEditRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.email')} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editRow.email} onChange={e => setEditRow({ ...editRow, email: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleEditPerson(); if (e.key === 'Escape') setEditRow(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('persons.bitrix24Id')} className="w-28 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editRow.bitrix24_id} onChange={e => setEditRow({ ...editRow, bitrix24_id: e.target.value.replace(/\D/g, '') })} onKeyDown={e => { if (e.key === 'Enter') handleEditPerson(); if (e.key === 'Escape') setEditRow(null) }} /></td>
                      <td className="py-1.5 pr-4" />
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          <button type="button" aria-label={t('common.save', { defaultValue: 'Сохранить' })} onClick={handleEditPerson} className={`${iconButtonClass} text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200`}><Check size={14} /></button>
                          <button type="button" aria-label={t('common.cancel', { defaultValue: 'Отмена' })} onClick={() => setEditRow(null)} className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id} className={`border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800 ${p.hidden_from_pickers ? 'bg-gray-50 dark:bg-slate-800/60' : ''}`}>
                      <td className="py-1.5 pr-4 text-gray-800 dark:text-slate-200">{p.first_name}</td>
                      <td className="py-1.5 pr-4 text-gray-800 dark:text-slate-200">{p.last_name}</td>
                      <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">{p.email ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-gray-500 dark:text-slate-400 font-mono">{p.bitrix24_id ?? '—'}</td>
                      <td className="py-1.5 pr-4">
                        <input
                          type="checkbox"
                          aria-label={`${t('persons.hidden')}: ${p.full_name}`}
                          checked={Boolean(p.hidden_from_pickers)}
                          onChange={() => handleToggleHidden(p)}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-600 dark:accent-primary-400"
                        />
                      </td>
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          {/* Учётка есть → зелёная иконка-статус; нет → кнопка «завести логин».
                              role="img" у span обязателен: на голом span aria-label запрещён
                              (axe: aria-prohibited-attr) и подпись не читалась бы. */}
                          {hasLogin(p) ? (
                            <span role="img" className={`${iconButtonClass} text-green-600 dark:text-green-400 cursor-default`} title={t('settings.users.hasLogin')} aria-label={t('settings.users.hasLogin')}>
                              <UserCheck size={12} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!p.email}
                              onClick={() => handleCreateLogin(p)}
                              title={p.email ? t('settings.users.createLogin') : t('settings.users.needEmail')}
                              aria-label={`${t('settings.users.createLogin')}: ${p.full_name}`}
                              className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              <KeyRound size={12} />
                            </button>
                          )}
                          <button type="button" aria-label={t('common.edit', { defaultValue: 'Редактировать' })} onClick={() => setEditRow({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email ?? '', bitrix24_id: p.bitrix24_id?.toString() ?? '' })} className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-primary-600`}><Pencil size={12} /></button>
                          <button type="button" aria-label={t('common.delete', { defaultValue: 'Удалить' })} onClick={() => handleDeletePerson(p)} className={`${iconButtonClass} text-gray-300 dark:text-slate-600 hover:text-red-500`}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
  )
}
