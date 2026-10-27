export interface ReportMilestone {
  id: string
  name: string
  planned_date?: string | null
  actual_date?: string | null
  status?: string | null
}

export interface StatusReport {
  id: string
  project_id: string
  report_date: string
  period?: string | null
  status_overall?: string | null
  status_budget?: string | null
  status_timeline?: string | null
  summary?: string | null
  next_steps?: string | null
  conclusions?: string | null
  budget_plan?: number | null
  budget_actual?: number | null
  budget_forecast?: number | null
  created_at: string
  /**
   * НЕОБЯЗАТЕЛЬНО — потому что таким поле приходит ПО ПРОВОДУ: коллекции проекта хранятся
   * схемо-свободным JSON, и отчёт создаёт не только форма этой вкладки (однажды его создал
   * помощник, без вех вовсе, и вкладка упала целиком — тип обещал массив, и TypeScript молчал).
   *
   * `api/reports.ts` нормализует поле на границе, так что до компонентов доезжает массив.
   * Но тип оставлен НЕОБЯЗАТЕЛЬНЫМ намеренно: соседний `Meeting` объявляет свои массивы
   * обязательными и держится на той же нормализации — то есть на дисциплине. Здесь то же
   * самое сторожит компилятор, и путь в обход `api/reports.ts` он не пропустит молча.
   */
  milestones?: ReportMilestone[]
}

export interface RiskSummaryItem {
  id: string
  code?: string | null
  title: string
  probability?: string | null
  impact?: string | null
  owner?: string | null
}

/**
 * ВНИМАНИЕ: этот тип НЕ совпадает с тем, что отдаёт сервер.
 *
 * `GET /projects/{pid}/risks-summary` возвращает `high`/`medium` ЧИСЛАМИ (счётчики из
 * `by_level`), а не списками рисков. Поэтому в ReportsTab блок «Активные риски» никогда не
 * появляется: `(3).length` — это `undefined`, а `undefined > 0` — ложь. Падения нет, раздел
 * просто молча пуст, и потому этого не замечали.
 *
 * Чинить надо на сервере (добавить списки открытых высоких и средних рисков рядом со
 * счётчиками) — это меняет байты маршрута и требует пересборки эталона, поэтому отдельным
 * решением. Тип оставлен как есть НАМЕРЕННО: он описывает то, что вкладке нужно, и правка
 * типа без правки сервера сломала бы сборку, ничего не починив.
 */
export interface RisksSummary {
  high: RiskSummaryItem[]
  medium: RiskSummaryItem[]
}
