/**
 * Две роли портала (WP2). Ключи ролей в API остались прежними — сменились только смысл и лейблы:
 *   owner = Руководитель портфеля — видит и правит ЛЮБОЙ проект + админка (люди, настройки).
 *   pm    = Руководитель проекта  — только свои проекты и те, где он со-РП.
 * Роль viewer удалена.
 *
 * Права всегда проверяет сервер; фронт лишь прячет то, что всё равно вернёт 403.
 */
type RoleUser = { role?: string } | null | undefined

/** Руководитель портфеля: портфельный скоуп + админка + реестр. Только он. */
export function isPortfolioManager(user: RoleUser): boolean {
  return user?.role === 'owner'
}

/** Кто вправе создавать/клонировать проекты: все три роли — своими проектами. */
export function canCreateProject(user: RoleUser): boolean {
  return user?.role === 'pm' || user?.role === 'owner' || user?.role === 'exec'
}

/**
 * Портфель — раздел всех, кто ведёт проекты (решение владельца).
 *
 * Видят его руководитель портфеля, руководство компании и руководитель проекта, но
 * СОДЕРЖИМОЕ у всех разное: сервер режет выборку по доступу, и РП получает только свои
 * проекты, те, где он со-РП, и те, где он наблюдатель. Зеркало серверного
 * `require_portfolio_view`; расходиться им нельзя.
 */
export function canSeePortfolio(user: RoleUser): boolean {
  return user?.role === 'owner' || user?.role === 'exec' || user?.role === 'pm'
}

/**
 * Кого можно назначить РП проекта — зеркало серверного `WRITE_ROLES` + `is_active`
 * (см. гарды в project_create и project_transfer: неактивный или читающий → 422/403).
 * РПП тоже может быть РП проекта — это решение по продукту, а не побочный эффект.
 */
export function canBeProjectManager(user: (RoleUser & { is_active?: boolean })): boolean {
  return canCreateProject(user) && user?.is_active !== false
}
