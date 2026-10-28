import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { Shield, Plus, Trash2, Pencil, Check, X, Key, ShieldOff } from 'lucide-react'
import type { AdminUser } from '@/api/users'
import { formatDate } from '@/utils/date'

type AddUserState = { email: string; password: string; full_name: string; role: string; bitrix24_user_id: string }
type EditUserState = { id: string; email: string; full_name: string; role: string; bitrix24_user_id: string; is_active: boolean }
type PwUserState = { id: string; name: string; pw: string }

interface UsersSectionProps {
  t: TFunction
  addUser: AddUserState | null
  setAddUser: Dispatch<SetStateAction<AddUserState | null>>
  editUser: EditUserState | null
  setEditUser: Dispatch<SetStateAction<EditUserState | null>>
  pwUser: PwUserState | null
  setPwUser: Dispatch<SetStateAction<PwUserState | null>>
  handleChangePw: () => void
  handleAddUser: () => void
  handleEditUser: () => void
  handleDeleteUser: (u: AdminUser) => void
  handleResetTwoFa: (u: AdminUser) => void
  usersLoading: boolean
  adminUsers: AdminUser[]
  ROLE_OPTIONS: { value: string; label: string }[]
  actionCellClass: string
  actionWrapClass: string
  iconButtonClass: string
}

/** Доступ к данным закрыт: 2FA не подключена, а срок на её подключение уже вышел.
 *  Именно эти люди упираются в стену «Настройте 2FA» и ничего в портале не видят. */
const isTwoFaBlocked = (u: AdminUser) =>
  !u.twofa_enabled && !!u.twofa_grace_until && new Date(u.twofa_grace_until).getTime() < Date.now()

export default function UsersSection({
  t,
  addUser,
  setAddUser,
  editUser,
  setEditUser,
  pwUser,
  setPwUser,
  handleChangePw,
  handleAddUser,
  handleEditUser,
  handleDeleteUser,
  handleResetTwoFa,
  usersLoading,
  adminUsers,
  ROLE_OPTIONS,
  actionCellClass,
  actionWrapClass,
  iconButtonClass,
}: UsersSectionProps) {
  return (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-gray-500 dark:text-slate-400" />
              <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{t('settings.users.title')}</h2>
            </div>
            <button onClick={() => setAddUser({ email: '', password: '', full_name: '', role: 'pm', bitrix24_user_id: '' })}
              disabled={!!addUser}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-btn-primary text-btn-primary-fg rounded-md hover:bg-btn-primary-hover disabled:opacity-50">
              <Plus size={12} />{t('settings.users.add')}
            </button>
          </div>

          {/* Password change dialog */}
          {pwUser && (
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-amber-950/40 border border-yellow-200 dark:border-amber-900 rounded-lg">
              <p className="text-xs font-medium text-gray-700 dark:text-slate-200 mb-2">{t('settings.users.changePassword')}: {pwUser.name}</p>
              <div className="flex gap-2">
                <input autoFocus type="password" placeholder={t('settings.users.newPassword')}
                  aria-label={t('settings.users.newPassword', { defaultValue: 'Новый пароль' })}
                  value={pwUser.pw} onChange={e => setPwUser({ ...pwUser, pw: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') handleChangePw(); if (e.key === 'Escape') setPwUser(null) }}
                  className="flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-2 py-1" />
                <button onClick={handleChangePw} className="px-3 py-1 text-xs bg-btn-primary text-btn-primary-fg rounded hover:bg-btn-primary-hover">{t('common.save')}</button>
                <button onClick={() => setPwUser(null)} className="px-3 py-1 text-xs border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded hover:bg-gray-50 dark:hover:bg-slate-800">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {usersLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('common.loading')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('settings.users.name')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('settings.users.email')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('settings.users.role')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('settings.bitrixIdCol')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 pr-4">{t('common.status')}</th>
                    <th className="text-left font-medium text-gray-500 dark:text-slate-400 py-2 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {addUser && (
                    <tr className="border-b border-gray-100 dark:border-slate-800 bg-primary-50/30 dark:bg-blue-950/40">
                      <td className="py-1.5 pr-2"><input autoFocus aria-label={t('settings.users.name', { defaultValue: 'Полное имя' })} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addUser.full_name} onChange={e => setAddUser({ ...addUser, full_name: e.target.value })} placeholder={t('settings.users.name')} onKeyDown={e => { if (e.key === 'Escape') setAddUser(null) }} /></td>
                      <td className="py-1.5 pr-2"><input type="email" aria-label={t('settings.users.email', { defaultValue: 'Эл. почта' })} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addUser.email} onChange={e => setAddUser({ ...addUser, email: e.target.value })} placeholder={t('auth.emailPlaceholder')} /></td>
                      <td className="py-1.5 pr-2">
                        <select aria-label={t('settings.users.role', { defaultValue: 'Роль' })} className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-1.5 py-1 text-xs" value={addUser.role} onChange={e => setAddUser({ ...addUser, role: e.target.value })}>
                          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2"><input aria-label={t('settings.bitrixIdCol', { defaultValue: 'Bitrix24 ID' })} className="w-20 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addUser.bitrix24_user_id} onChange={e => setAddUser({ ...addUser, bitrix24_user_id: e.target.value.replace(/\D/g, '') })} placeholder={t('common.id')} /></td>
                      <td className="py-1.5 pr-2">
                        <input type="password" aria-label={t('settings.users.password', { defaultValue: 'Пароль' })} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={addUser.password} onChange={e => setAddUser({ ...addUser, password: e.target.value })} placeholder={t('settings.users.password')} />
                      </td>
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          <button onClick={handleAddUser} aria-label={t('common.save', { defaultValue: 'Сохранить' })} className={`${iconButtonClass} text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200`}><Check size={14} /></button>
                          <button onClick={() => setAddUser(null)} aria-label={t('common.cancel', { defaultValue: 'Отмена' })} className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {adminUsers.map(u => editUser?.id === u.id ? (
                    <tr key={u.id} className="border-b border-gray-100 dark:border-slate-800 bg-yellow-50/30 dark:bg-amber-950/40">
                      <td className="py-1.5 pr-2"><input autoFocus aria-label={t('settings.users.name', { defaultValue: 'Полное имя' })} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editUser.full_name} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleEditUser(); if (e.key === 'Escape') setEditUser(null) }} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={t('settings.users.email', { defaultValue: 'Эл. почта' })} className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editUser.email} onChange={e => setEditUser({ ...editUser, email: e.target.value })} /></td>
                      <td className="py-1.5 pr-2">
                        <select aria-label={t('settings.users.role', { defaultValue: 'Роль' })} className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-1.5 py-1 text-xs" value={editUser.role} onChange={e => setEditUser({ ...editUser, role: e.target.value })}>
                          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2"><input aria-label={t('settings.bitrixIdCol', { defaultValue: 'Bitrix24 ID' })} className="w-20 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 rounded px-1.5 py-1 text-xs" value={editUser.bitrix24_user_id} onChange={e => setEditUser({ ...editUser, bitrix24_user_id: e.target.value.replace(/\D/g, '') })} /></td>
                      <td className="py-1.5 pr-2">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={editUser.is_active} onChange={e => setEditUser({ ...editUser, is_active: e.target.checked })} />
                          {editUser.is_active ? t('settings.users.active') : t('settings.users.inactive')}
                        </label>
                      </td>
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          <button onClick={handleEditUser} aria-label={t('common.save', { defaultValue: 'Сохранить' })} className={`${iconButtonClass} text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200`}><Check size={14} /></button>
                          <button onClick={() => setEditUser(null)} aria-label={t('common.cancel', { defaultValue: 'Отмена' })} className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-gray-600`}><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.id} className={`border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800 ${!u.is_active ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 pr-4 text-gray-800 dark:text-slate-200 font-medium">{u.full_name}</td>
                      <td className="py-1.5 pr-4 text-gray-600 dark:text-slate-300">{u.email}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${u.role === 'owner' ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300' : u.role === 'pm' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}>
                          {ROLE_OPTIONS.find(o => o.value === u.role)?.label ?? u.role}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-gray-500 dark:text-slate-400 font-mono">{u.bitrix24_user_id ?? '—'}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`text-xs ${u.is_active ? 'text-green-700 dark:text-green-300' : 'text-red-500 dark:text-rose-300'}`}>
                          {u.is_active ? t('settings.users.active') : t('settings.users.inactive')}
                        </span>
                        {isTwoFaBlocked(u) && (
                          <span
                            className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                            title={t('twofa.blockedHint')}
                          >
                            {t('twofa.blocked')}
                          </span>
                        )}
                        {u.offboarded_at && (
                          <span
                            className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                            title={t('settings.users.offboardedHint', { date: formatDate(u.offboarded_at) })}
                          >
                            {t('settings.users.offboarded')}
                          </span>
                        )}
                      </td>
                      <td className={actionCellClass}>
                        <div className={actionWrapClass}>
                          <button onClick={() => setEditUser({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, bitrix24_user_id: u.bitrix24_user_id?.toString() ?? '', is_active: u.is_active })}
                            aria-label={t('common.edit', { defaultValue: 'Изменить' })}
                            className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-primary-600`}><Pencil size={12} /></button>
                          <button onClick={() => setPwUser({ id: u.id, name: u.full_name, pw: '' })}
                            aria-label={t('settings.users.changePassword', { defaultValue: 'Сменить пароль' })}
                            className={`${iconButtonClass} text-gray-500 dark:text-slate-400 hover:text-yellow-600`} title={t('settings.users.changePassword')}><Key size={12} /></button>
                          {/* Кнопка нужна в ДВУХ случаях, и раньше показывалась только в первом:
                              2FA подключена (потерял телефон) — сбросить; 2FA НЕ подключена и срок
                              вышел — продлить. Во втором случае пользователь заблокирован, и без
                              кнопки администратору нечем было бы ему помочь. Действие одно и то же:
                              сброс 2FA заодно выдаёт свежий срок (admin_routes: first_login_at = now). */}
                          {(u.twofa_enabled || isTwoFaBlocked(u)) && (
                            <button onClick={() => handleResetTwoFa(u)}
                              aria-label={u.twofa_enabled ? t('twofa.reset') : t('twofa.extend')}
                              className={`${iconButtonClass} ${isTwoFaBlocked(u) ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-slate-400'} hover:text-amber-600`}
                              title={u.twofa_enabled ? t('twofa.reset') : t('twofa.extend')}><ShieldOff size={12} /></button>
                          )}
                          <button onClick={() => handleDeleteUser(u)}
                            aria-label={t('common.delete', { defaultValue: 'Удалить' })}
                            className={`${iconButtonClass} text-gray-300 dark:text-slate-600 hover:text-red-500`}><Trash2 size={12} /></button>
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
