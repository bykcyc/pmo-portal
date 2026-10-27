/**
 * Роль человека в конкретном проекте — для подписи в списке и на карточке.
 *
 * Роль НЕ вычисляется из дерева на фронте: сервер присылает готовые `inherited_*`
 * (db._TREE_CTE), здесь только выбирается, какая из них старше. Считать дерево второй раз
 * в браузере значило бы завести вторую копию правила доступа — ровно тот случай, который на
 * этом проекте уже трижды приводил к расхождению.
 *
 * Порядок старшинства: прямое назначение важнее унаследованного, право писать важнее чтения.
 */
export type ProjectRole = 'pm' | 'copm' | 'copm_inherited' | 'observer' | 'observer_inherited' | null

export interface RoleProject {
  pm_id?: string | null
  editors?: string[] | null
  observers?: string[] | null
  inherited_editors?: string[] | null
  inherited_observers?: string[] | null
}

export function projectRoleOf(
  user: { id?: string } | null | undefined,
  project: RoleProject | null | undefined,
): ProjectRole {
  const uid = String(user?.id ?? '')
  if (!uid || !project) return null
  const has = (list: string[] | null | undefined) => (list ?? []).map(String).includes(uid)
  if (project.pm_id && String(project.pm_id) === uid) return 'pm'
  if (has(project.editors)) return 'copm'
  if (has(project.inherited_editors)) return 'copm_inherited'
  if (has(project.observers)) return 'observer'
  if (has(project.inherited_observers)) return 'observer_inherited'
  return null
}

/** Ключ подписи в локалях (`project.role.*`). Отдельно от роли: подписи меняются, роли — нет. */
export function projectRoleLabelKey(role: ProjectRole): string | null {
  return role ? `project.role.${role}` : null
}


/**
 * Показывать ли вкладку «Подпроекты».
 *
 * Есть дети — показываем всем, кто открыл проект: сводка по модулям и есть ответ на вопрос
 * «что внутри программы». Детей нет — показываем только тому, кто может их привязать, иначе
 * вкладка висит у каждого обычного проекта и обещает раздел, которого у него не будет.
 * У подпроекта её нет никогда: дерево ровно одноуровневое, внуков не бывает.
 *
 * Правило живёт здесь, а не в разметке страницы, потому что его должен стеречь тест: в
 * JSX оно проверялось бы только глазами.
 */
export function showsSubprojectsTab(
  project: { parent_id?: string | null; subprojects_count?: number } | null | undefined,
  canManage: boolean,
): boolean {
  if (!project) return false
  if ((project.subprojects_count ?? 0) > 0) return true
  return canManage && !project.parent_id
}
