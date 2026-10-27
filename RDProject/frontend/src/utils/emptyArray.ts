/**
 * Стабильная ссылка на пустой массив — дефолт для `useQuery` (`data = EMPTY_ARRAY`).
 *
 * `const { data = [] }` создаёт НОВЫЙ `[]` на каждом рендере, пока запрос не разрешён
 * (loading/error → data === undefined). Если такой массив попадает в зависимости
 * `useEffect`/`useMemo`, которые вызывают setState (напр. `useEffect(() => setLocalRows(data), [data])`),
 * это даёт бесконечный re-render («Maximum update depth exceeded»). Стабильная ссылка это устраняет.
 *
 * `never[]` присваивается любому `T[]`, поэтому годится дефолтом для запроса любого типа.
 */
export const EMPTY_ARRAY: never[] = []
