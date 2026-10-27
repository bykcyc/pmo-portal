import { describe, it, expect } from 'vitest'
import { foldName, filterPersons } from './personSearch'

const P = (full_name: string) => ({ full_name })

describe('foldName (зеркало серверного _fold_name)', () => {
  it('снимает диакритику латышских имён', () => {
    expect(foldName('Līga Ozoliņa')).toBe('liga ozolina')
    expect(foldName('Jānis Liepbergs')).toBe('janis liepbergs')
    expect(foldName('Pāvels Čakstiņš')).toBe('pavels cakstins')
  })
  it('схлопывает пробелы и регистр', () => {
    expect(foldName('  ПЕТЕРИС   ПИЕМЕРС ')).toBe('петерис пиемерс')
  })
})

describe('filterPersons', () => {
  const persons = [P('Līga Ozoliņa'), P('Jānis Liepbergs'), P('Viktors Sokolovs'), P('Inese Rendele')]

  it('находит имя, набранное БЕЗ диакритики — ровно то, из-за чего поиск считали сломанным', () => {
    expect(filterPersons(persons, 'liga').map(p => p.full_name)).toEqual(['Līga Ozoliņa'])
    expect(filterPersons(persons, 'ozolina').map(p => p.full_name)).toEqual(['Līga Ozoliņa'])
    expect(filterPersons(persons, 'petrovs')).toEqual([])   // такого человека нет — и не выдумываем
  })

  it('ищет по токенам в любом порядке: люди набирают и фамилию, и имя', () => {
    expect(filterPersons(persons, 'ozolina liga').map(p => p.full_name)).toEqual(['Līga Ozoliņa'])
  })

  it('пустой запрос отдаёт весь список', () => {
    expect(filterPersons(persons, '   ')).toHaveLength(4)
  })

  it('ищет по подстроке, а не только по началу', () => {
    expect(filterPersons(persons, 'vind')).toEqual([])
    expect(filterPersons(persons, 'ende').map(p => p.full_name)).toEqual(['Inese Rendele'])
  })
})
