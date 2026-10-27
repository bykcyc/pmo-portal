import { describe, it, expect } from 'vitest'
import { computeCanWrite } from './ProjectPermission'

describe('computeCanWrite (RBAC mirror)', () => {
  it('pm owns project by pm_id', () => {
    expect(computeCanWrite({ id: 'u1', role: 'pm' }, { pm_id: 'u1' })).toBe(true)
  })
  it('pm does not own (other pm_id)', () => {
    expect(computeCanWrite({ id: 'u1', role: 'pm' }, { pm_id: 'u2' })).toBe(false)
  })
  it('portfolio manager (owner) may edit any project — WP2', () => {
    expect(computeCanWrite({ id: 'u9', role: 'owner' }, { pm_id: 'u1' })).toBe(true)
  })
  it('does NOT grant ownership by pm_name (S3 — name is mutable)', () => {
    expect(computeCanWrite({ id: 'u1', role: 'pm', full_name: 'PM One' }, { pm_id: null, editors: [] })).toBe(false)
  })
  it('co-PM in editors can write even if not the lead pm', () => {
    expect(computeCanWrite({ id: 'u1', role: 'pm' }, { pm_id: 'u2', editors: ['u1'] })).toBe(true)
    expect(computeCanWrite({ id: 'u1', role: 'pm' }, { pm_id: 'u2', editors: ['u3'] })).toBe(false)
  })
  it('exec (руководство компании) writes its OWN projects — mirror of backend WRITE_ROLES', () => {
    // Здесь стояло `role !== 'pm' → false`, и у exec собственный проект был мёртвым экраном:
    // кнопки заблокированы, хотя сервер запись разрешал.
    expect(computeCanWrite({ id: 'u1', role: 'exec' }, { pm_id: 'u1' })).toBe(true)
    expect(computeCanWrite({ id: 'u1', role: 'exec' }, { pm_id: 'u2', editors: ['u1'] })).toBe(true)
    expect(computeCanWrite({ id: 'u1', role: 'exec' },
      { pm_id: 'u2', editors: [], inherited_editors: ['u1'] })).toBe(true)
    // Но чужой проект — по-прежнему нет: exec не owner.
    expect(computeCanWrite({ id: 'u1', role: 'exec' }, { pm_id: 'u2', editors: ['u3'] })).toBe(false)
  })

  it('unknown role cannot write even if listed in editors', () => {
    expect(computeCanWrite({ id: 'u1', role: 'guest' }, { pm_id: 'u2', editors: ['u1'] })).toBe(false)
  })
  it('null/undefined inputs are safe', () => {
    expect(computeCanWrite(null, { pm_id: 'u1' })).toBe(false)
    expect(computeCanWrite({ id: 'u1', role: 'pm' }, null)).toBe(false)
  })

  // Дерево проектов: РП и со-РП ЗОНТИКА правят его подпроекты. Список считает сервер и
  // присылает готовым (`inherited_editors`) — фронт про дерево ничего не выводит сам.
  // Без этой ветки РП зонтика видел бы подпроект целиком, но все поля были бы погашены.
  it('РП зонтика правит подпроект по унаследованному праву', () => {
    expect(computeCanWrite({ id: 'u1', role: 'pm' },
                           { pm_id: 'u2', editors: [], inherited_editors: ['u1'] })).toBe(true)
    expect(computeCanWrite({ id: 'u9', role: 'pm' },
                           { pm_id: 'u2', inherited_editors: ['u1'] })).toBe(false)
  })

  it('унаследованное ЧТЕНИЕ права писать не даёт', () => {
    // inherited_observers сюда не приходит вовсе — проверяем, что и лишнего поля не хватит.
    expect(computeCanWrite({ id: 'u1', role: 'pm' },
                           { pm_id: 'u2', inherited_observers: ['u1'] } as never)).toBe(false)
  })
})
