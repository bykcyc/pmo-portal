/**
 * Роль в проекте. Главное здесь — старшинство: прямое назначение важнее унаследованного,
 * право писать важнее чтения. Иначе РП зонтика подписывался бы «наблюдателем» в собственном
 * проекте, где он ещё и РП.
 */
import { describe, it, expect } from 'vitest'
import { projectRoleOf, projectRoleLabelKey, showsSubprojectsTab } from './projectRole'

const me = { id: 'u1' }

describe('projectRoleOf', () => {
  it('различает все пять ролей', () => {
    expect(projectRoleOf(me, { pm_id: 'u1' })).toBe('pm')
    expect(projectRoleOf(me, { pm_id: 'x', editors: ['u1'] })).toBe('copm')
    expect(projectRoleOf(me, { pm_id: 'x', inherited_editors: ['u1'] })).toBe('copm_inherited')
    expect(projectRoleOf(me, { pm_id: 'x', observers: ['u1'] })).toBe('observer')
    expect(projectRoleOf(me, { pm_id: 'x', inherited_observers: ['u1'] })).toBe('observer_inherited')
    expect(projectRoleOf(me, { pm_id: 'x' })).toBeNull()
  })

  it('прямое назначение старше унаследованного', () => {
    // РП зонтика, который вдобавок ведёт этот подпроект сам: он РП, а не «правит по дереву».
    expect(projectRoleOf(me, { pm_id: 'u1', inherited_editors: ['u1'] })).toBe('pm')
    expect(projectRoleOf(me, { pm_id: 'x', editors: ['u1'], inherited_editors: ['u1'] })).toBe('copm')
  })

  it('право писать старше права читать', () => {
    expect(projectRoleOf(me, { pm_id: 'x', inherited_editors: ['u1'], observers: ['u1'] })).toBe('copm_inherited')
  })

  it('без пользователя или без проекта роли нет', () => {
    expect(projectRoleOf(null, { pm_id: 'u1' })).toBeNull()
    expect(projectRoleOf({ id: '' }, { editors: [''] })).toBeNull()
    expect(projectRoleOf(me, null)).toBeNull()
  })

  it('ключ подписи есть у каждой роли и отсутствует без неё', () => {
    expect(projectRoleLabelKey('copm_inherited')).toBe('project.role.copm_inherited')
    expect(projectRoleLabelKey(null)).toBeNull()
  })
})

describe('showsSubprojectsTab', () => {
  it('есть дети — вкладку видит каждый, кто открыл проект', () => {
    expect(showsSubprojectsTab({ subprojects_count: 3 }, false)).toBe(true)
  })

  it('детей нет и привязать некому — вкладки нет', () => {
    // Иначе она висит у каждого обычного проекта и обещает раздел, которого не будет.
    expect(showsSubprojectsTab({ subprojects_count: 0 }, false)).toBe(false)
    expect(showsSubprojectsTab({}, false)).toBe(false)
  })

  it('детей нет, но человек может их привязать — вкладка есть', () => {
    expect(showsSubprojectsTab({ subprojects_count: 0 }, true)).toBe(true)
  })

  it('у подпроекта вкладки нет никогда: внуков не бывает', () => {
    expect(showsSubprojectsTab({ parent_id: '7', subprojects_count: 0 }, true)).toBe(false)
  })

  it('нет проекта — нет вкладки', () => {
    expect(showsSubprojectsTab(null, true)).toBe(false)
  })
})
