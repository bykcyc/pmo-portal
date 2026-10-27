/**
 * Поиск человека в справочнике (сотрудники из Bitrix).
 *
 * Зеркало серверного `_fold_name` (pmo-backend/main.py): NFKD → нижний регистр → снятие
 * диакритики → схлопывание пробелов. Для латышских имён это не украшательство: в именах вроде
 * «Līga Ozoliņa», «Jānis Liepbergs», «Pāvels Čakstiņš» есть диакритика, а набирают их
 * обычно без неё. Без нормализации «Liga» не находит «Līga» — и человек уверен,
 * что поиск сломан.
 *
 * Снятие диакритики — нормализация написания, а не догадка о том, кто имелся в виду. Побочно
 * сходятся «й»/«и» и «ё»/«е» — для ПОИСКА это плюс (Алёна/Алена), и нигде больше эта функция
 * не используется: идентичность человека определяется по person_id, а не по свёрнутому имени.
 */
export function foldName(s: string): string {
  return s
    .normalize('NFKD')
    // ̀–ͯ — блок комбинируемых диакритических знаков: после NFKD «ī» = «i» + макрон,
    // и мы выбрасываем именно макрон, оставляя базовую букву.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/**
 * Фильтр по токенам: все слова запроса должны найтись в свёрнутом ФИО, порядок не важен.
 * «ozolina liga» находит «Līga Ozoliņa» — люди ищут и по фамилии, и по имени.
 */
export function filterPersons<T extends { full_name: string }>(persons: T[], query: string): T[] {
  const tokens = foldName(query).split(' ').filter(Boolean)
  if (!tokens.length) return persons
  return persons.filter((p) => {
    const folded = foldName(p.full_name || '')
    return tokens.every((tk) => folded.includes(tk))
  })
}
