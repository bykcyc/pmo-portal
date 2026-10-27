import { createContext, useContext, type ReactNode } from 'react'

/**
 * Whether the current user may modify the current project. Mirrors the backend `rbac`:
 *   owner (Руководитель портфеля) — writes ANY project (READ_ALL_ROLES bypasses the scope);
 *   pm / exec                     — only projects they lead: pm_id, co-PM in `editors`,
 *                                   or inherited from the umbrella above.
 * Ownership is NOT derived from the mutable pm_name (S3) — matches the backend, which
 * dropped that fallback. Default false → a tab rendered outside a provider stays read-only.
 */
const ProjectPermissionContext = createContext<{ canWrite: boolean }>({ canWrite: false })

export function ProjectPermissionProvider({ canWrite, children }: { canWrite: boolean; children: ReactNode }) {
  return <ProjectPermissionContext.Provider value={{ canWrite }}>{children}</ProjectPermissionContext.Provider>
}

export function useCanWrite(): boolean {
  return useContext(ProjectPermissionContext).canWrite
}

/** Pure ownership check, reusable outside React (mirrors adapter `_owns_item`). */
export function computeCanWrite(
  user: { id?: string; role?: string; full_name?: string } | null | undefined,
  project: { pm_id?: string | null; editors?: string[] | null;
             inherited_editors?: string[] | null } | null | undefined,
): boolean {
  if (!user || !project) return false
  // WP2: Руководитель портфеля (owner) правит ЛЮБОЙ проект — зеркало серверного rbac,
  // где owner ∈ READ_ALL_ROLES и обходит скоуп владения. Раньше он был строго read-only.
  if (user.role === 'owner') return true
  // Зеркало серверного WRITE_ROLES = {owner, pm, exec}. Здесь стояло `role !== 'pm'`, и
  // руководство компании (exec) видело СВОЙ проект только на чтение: кнопки заблокированы,
  // хотя сервер запись ему разрешал. Расхождение молчаливое — 403 никто не получал, просто
  // экран был мёртвый.
  if (user.role !== 'pm' && user.role !== 'exec') return false
  const uid = String(user.id ?? '')
  if (uid === '') return false
  // Основной РП по pm_id (S3: НЕ по pm_name — его можно поменять в PUT /me).
  if (project.pm_id && String(project.pm_id) === uid) return true
  // Co-РП: пользователь в списке editors тоже владеет проектом (зеркало backend `_owns_item`).
  if ((project.editors ?? []).map(String).includes(uid)) return true
  // По дереву: РП и со-РП ЗОНТИКА правят его подпроекты. Список считает сервер и присылает
  // готовым — фронт про дерево ничего не выводит сам, иначе правило разъехалось бы с бэкендом.
  return (project.inherited_editors ?? []).map(String).includes(uid)
}
