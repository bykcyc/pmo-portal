import { localIsoDate } from '@/utils/date'

type XLSXModule = typeof import('xlsx')
type WorkBook = import('xlsx').WorkBook
let XLSX: XLSXModule

export interface ParsedPassport {
  name: string; client: string; pm_name: string; planned_start: string; planned_end: string
  goal: string[]; scope: string[]; project_result: string[]; key_milestones: string[]
}
export interface ParsedTeamMember { full_name: string; position: string; project_role: string }
export interface ParsedWBSGroup { title: string; tasks: ParsedTask[] }
export interface ParsedTask {
  title: string; assignee_name: string; planned_start: string; planned_end: string
  duration_days: number | null; status: string; priority: string
}
export interface ParsedRisk {
  title: string; impact: string; probability: string; mitigation_plan: string
}
export interface ParsedKPI { name: string; target: string; description: string; formula: string }
export interface ParsedBacklogItem { title: string; priority: string; requested_by: string }
export interface ParsedCommPlanItem {
  goal: string; channel: string; audience: string; frequency: string; responsible: string
}
export interface ParsedAssumption {
  description: string; type: 'assumption' | 'constraint'
}
export interface ParsedStakeholder {
  name: string; role: string; type: 'internal' | 'external'
}
export interface ParsedBudgetItem { name: string; amount: number | null; category: string }
export interface ParsedMeetingAttendee { name: string; present: boolean }
export interface ParsedMeeting {
  title: string; meeting_type: string; meeting_date: string; meeting_time: string
  attendees: ParsedMeetingAttendee[]
}
export interface ParsedFollowup {
  title: string; requested_by: string; due_date: string; status: string
}
export interface ParsedSheetInfo {
  /** Expected template sections found in the workbook (canonical labels) */
  recognized: string[]
  /** Expected template sections missing from the workbook (canonical labels) */
  missing: string[]
  /** Workbook sheets that were present but not mapped to any known section */
  extra: string[]
}
export interface ParsedProject {
  passport: ParsedPassport; team: ParsedTeamMember[]; groups: ParsedWBSGroup[]
  risks: ParsedRisk[]; kpis: ParsedKPI[]; backlog: ParsedBacklogItem[]
  commPlan: ParsedCommPlanItem[]; assumptions: ParsedAssumption[]; stakeholders: ParsedStakeholder[]
  budget: ParsedBudgetItem[]; meetings: ParsedMeeting[]; followups: ParsedFollowup[]
  sheets: ParsedSheetInfo
}

// ── low-level helpers ──────────────────────────────────────────────────────────

type Row = unknown[]

const cellStr = (v: unknown): string => {
  if (v == null) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : localIsoDate(v)
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}
const norm = (v: unknown): string => cellStr(v).toLowerCase().replace(/\s+/g, ' ').trim()

const toISODate = (v: unknown): string => {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : localIsoDate(v)
  if (typeof v === 'number' && v > 1000) {
    try {
      const d = XLSX.SSF.parse_date_code(v)
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    } catch { /* fall through */ }
  }
  const s = String(v ?? '').trim()
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const firstRight = (row: Row | undefined, from = 1): string => {
  if (!row) return ''
  for (let c = from; c < row.length; c++) {
    const s = cellStr(row[c])
    if (s) return s
  }
  return ''
}

const getRows = (wb: WorkBook, name: string): Row[] => {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: '', raw: true })
}

// Резолвим лист по алиасам названия (нормализация trim+lowercase+collapse). Разные
// авторы называют листы по-разному (RU/EN/LV): «ПП»/«Паспорт Проекта »/«Passport» и т.д.
const SHEET_ALIASES: Record<string, string[]> = {
  passport: ['пп', 'паспорт', 'passport', 'charter', 'устав', 'projekta pase', 'pase'],
  team: ['team', 'команда', 'komanda'],
  wbs: ['wbs', 'сдр', 'иерархическая'],
  risks: ['risks', 'риски', 'riski'],
  kpi: ['kpi', 'кпэ', 'кпи'],
  backlog: ['backlog', 'бэклог', 'беклог'],
  communication: ['communication', 'коммуникац', 'komunikāc', 'komunikac'],
  finance: ['finance', 'финансы', 'бюджет', 'budget', 'finanses', 'смета'],
  followups: ['followup', 'follow-up', 'follow up', 'поручения', 'журнал последующих'],
  status: ['status report', 'статус'],
}

const matchesAlias = (sheetName: string, aliases: string[]): boolean => {
  const n = norm(sheetName)
  return aliases.some(a => n === a || n.startsWith(a) || n.includes(a))
}
const findSheetName = (wb: WorkBook, key: string): string => {
  const aliases = SHEET_ALIASES[key] || []
  return wb.SheetNames.find(n => matchesAlias(n, aliases)) || ''
}
const rowsFor = (wb: WorkBook, key: string): Row[] => {
  const name = findSheetName(wb, key)
  return name ? getRows(wb, name) : []
}

// ── passport (label-driven) ────────────────────────────────────────────────────

const findLabelRow = (rows: Row[], aliases: string[], maxRow = 80): number => {
  for (let i = 0; i < Math.min(rows.length, maxRow); i++) {
    const c0 = norm(rows[i]?.[0])
    if (c0 && aliases.some(a => c0.startsWith(a) || c0.includes(a))) return i
  }
  return -1
}
const labelRight = (rows: Row[], aliases: string[]): string => {
  const i = findLabelRow(rows, aliases)
  return i < 0 ? '' : firstRight(rows[i], 1)
}
// Значение-блок: либо справа от метки, либо в строках ниже (col0) до пустой строки/следующей метки.
const labelBlock = (rows: Row[], aliases: string[], stopAliases: string[]): string => {
  const i = findLabelRow(rows, aliases)
  if (i < 0) return ''
  const right = firstRight(rows[i], 1)
  if (right) return right
  const parts: string[] = []
  for (let r = i + 1; r < rows.length; r++) {
    const c0 = cellStr(rows[r]?.[0])
    if (!c0) { if (parts.length) break; else continue }
    const n0 = norm(c0)
    if (stopAliases.some(a => n0.startsWith(a) || n0.includes(a))) break
    parts.push(c0)
    if (parts.length >= 8) break
  }
  return parts.join('\n')
}

const PASSPORT_LABELS = {
  name: ['название проект', 'наименование проект', 'project name', 'projekta nosaukums'],
  owner: ['владелец проект', 'заказчик', 'спонсор', 'sponsor', 'owner', 'īpašnieks', 'pasūtītājs'],
  pm: ['руководитель проект', 'project manager', 'projekta vadītāj', 'менеджер проект'],
  start: ['старт проект', 'дата начала', 'начало проект', 'project start', 'sākuma datums', 'projekta sākums'],
  end: ['окончание проект', 'планируемая дата окончания', 'дата окончания', 'project end', 'beigu datums', 'plānotais beigu'],
  goal: ['цель проект', 'project goal', 'projekta mērķis', 'мērķis'],
  scope: ['объем проект', 'объём проект', 'project scope', 'projekta apjoms', 'apjoms'],
  result: ['результат проект', 'project result', 'projekta rezultāts', 'rezultāts'],
  milestones: ['основные этапы', 'этапы проект', 'project milestone', 'вехи', 'posmi', 'galvenie posmi'],
}
const ALL_PASSPORT_STOPS = Object.values(PASSPORT_LABELS).flat()

function splitListText(text: string): string[] {
  if (!text) return []
  const t = text.trim()
  // Инлайновый нумерованный список в одной ячейке: «1. … 2. … 3. …»
  const inlineMarks = t.match(/\b\d+[.)]\s/g)
  if (!t.includes('\n') && inlineMarks && inlineMarks.length >= 2) {
    return t.split(/\s+(?=\d+[.)]\s)/).map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean)
  }
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const numbered = lines.filter(l => /^\d+[.)]\s/.test(l))
  if (numbered.length >= 2) return numbered.map(l => l.replace(/^\d+[.)]\s+/, '').trim()).filter(Boolean)
  const dashed = lines.filter(l => /^[-–—•]\s/.test(l))
  if (dashed.length >= 2) return dashed.map(l => l.replace(/^[-–—•]\s+/, '').trim()).filter(Boolean)
  return lines.length ? lines : [t]
}

function parsePassport(wb: WorkBook, fileName: string): ParsedPassport {
  const p = rowsFor(wb, 'passport')
  const wbsRows = rowsFor(wb, 'wbs')
  const financeRows = rowsFor(wb, 'finance')

  // Название: метка в паспорте → в WBS (там тоже есть шапка «Название проекта») → «Project:» в Финансах → имя файла.
  let name = labelRight(p, PASSPORT_LABELS.name)
  if (!name) name = labelRight(wbsRows, PASSPORT_LABELS.name)
  if (!name) name = labelRight(financeRows, ['project', 'проект'])
  if (!name) name = fileName.replace(/\.(xlsx|xls)$/i, '').trim()

  return {
    name,
    client: labelRight(p, PASSPORT_LABELS.owner) || labelRight(wbsRows, PASSPORT_LABELS.owner),
    pm_name: labelRight(p, PASSPORT_LABELS.pm) || labelRight(wbsRows, PASSPORT_LABELS.pm),
    planned_start: toISODate(labelRight(p, PASSPORT_LABELS.start) || labelRight(wbsRows, PASSPORT_LABELS.start)),
    planned_end: toISODate(labelRight(p, PASSPORT_LABELS.end) || labelRight(wbsRows, PASSPORT_LABELS.end)),
    goal: splitListText(labelBlock(p, PASSPORT_LABELS.goal, ALL_PASSPORT_STOPS)),
    scope: splitListText(labelBlock(p, PASSPORT_LABELS.scope, ALL_PASSPORT_STOPS)),
    project_result: splitListText(labelBlock(p, PASSPORT_LABELS.result, ALL_PASSPORT_STOPS)),
    key_milestones: splitListText(labelBlock(p, PASSPORT_LABELS.milestones, ALL_PASSPORT_STOPS)),
  }
}

// ── generic table locator (header row + column mapping by label) ────────────────

interface ColDef { key: string; aliases: string[] }
interface Located { header: number; cols: Record<string, number> }

function locateTable(rows: Row[], defs: ColDef[], scan = 40): Located | null {
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    const row = rows[i]
    if (!row) continue
    const cols: Record<string, number> = {}
    let matched = 0
    for (const def of defs) {
      for (let c = 0; c < row.length; c++) {
        const cell = norm(row[c])
        if (!cell) continue
        if (def.aliases.some(a => cell === a || cell.startsWith(a) || cell.includes(a))) {
          if (!(def.key in cols)) { cols[def.key] = c; matched++ }
          break
        }
      }
    }
    if (defs[0].key in cols && matched >= 2) return { header: i, cols }
  }
  return null
}
const at = (row: Row | undefined, col: number | undefined): string =>
  col == null || col < 0 || !row ? '' : cellStr(row[col])

// ── value maps ─────────────────────────────────────────────────────────────────

const mapStatus = (s: string): string => {
  const m: Record<string, string> = {
    'izdarīts': 'completed', 'pabeigts': 'completed', 'procesā': 'in_progress', 'izpildē': 'in_progress',
    'kavēts': 'in_progress', 'vēl nav uzsākts': 'not_started', 'nav sākts': 'not_started', 'apturēts': 'on_hold',
    'выполнено': 'completed', 'выполнена': 'completed', 'завершено': 'completed', 'в процессе': 'in_progress',
    'в работе': 'in_progress', 'не начато': 'not_started', 'не начата': 'not_started', 'на паузе': 'on_hold',
    'done': 'completed', 'in progress': 'in_progress', 'not started': 'not_started',
  }
  return m[norm(s)] ?? 'not_started'
}
const mapPriority = (s: string): string => {
  const m: Record<string, string> = {
    'kritiska': 'critical', 'augsta': 'high', 'vidēja': 'medium', 'zema': 'low',
    'критический': 'critical', 'критическая': 'critical', 'высокий': 'high', 'высокая': 'high',
    'средний': 'medium', 'средняя': 'medium', 'низкий': 'low', 'низкая': 'low',
    'critical': 'critical', 'high': 'high', 'medium': 'medium', 'low': 'low',
  }
  return m[norm(s)] ?? 'medium'
}
const mapLevel = (n: unknown): string => {
  const v = typeof n === 'number' ? n : parseFloat(String(n))
  if (isNaN(v)) return 'medium'
  if (v >= 4) return 'high'
  if (v >= 3) return 'medium'
  return 'low'
}

// ── section parsers ──────────────────────────────────────────────────────────

function parseTeam(wb: WorkBook): ParsedTeamMember[] {
  const r = rowsFor(wb, 'team')
  const loc = locateTable(r, [
    { key: 'name', aliases: ['имя фамилия', 'имя', 'ф.и.о', 'фио', 'name', 'vārds uzvārds', 'vārds'] },
    { key: 'position', aliases: ['позиция', 'должность', 'position', 'amats'] },
    { key: 'role', aliases: ['роль', 'project role', 'loma', 'роль в проекте'] },
  ])
  if (!loc) return []
  const out: ParsedTeamMember[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const full_name = at(r[i], loc.cols.name)
    if (!full_name || norm(full_name).startsWith('название проект')) break
    out.push({ full_name, position: at(r[i], loc.cols.position), project_role: at(r[i], loc.cols.role) })
  }
  return out
}

function parseWBS(wb: WorkBook): ParsedWBSGroup[] {
  const r = rowsFor(wb, 'wbs')
  // Колонки берём из строки-заголовка «Название|Ответственный|Статус|Начало|Deadline|…».
  const loc = locateTable(r, [
    { key: 'title', aliases: ['название', 'name', 'nosaukums', 'задача'] },
    { key: 'assignee', aliases: ['ответственный', 'исполнитель', 'responsible', 'atbildīgais'] },
    { key: 'status', aliases: ['статус', 'status', 'statuss'] },
    { key: 'start', aliases: ['начало', 'дата начала', 'start', 'sākums'] },
    { key: 'newEnd', aliases: ['новый deadline', 'новый срок', 'jaunais termiņš'] },
    { key: 'end', aliases: ['deadline', 'конец', 'окончание', 'срок', 'end', 'termiņš'] },
    { key: 'duration', aliases: ['длительность', 'duration', 'ilgums'] },
  ], 60)
  const c = loc?.cols ?? { title: 0, assignee: 1, status: 2, start: 3, end: 4, duration: 7 }
  const endCol = c.newEnd != null ? c.newEnd : c.end
  const groups: ParsedWBSGroup[] = []
  let current: ParsedWBSGroup | null = null
  const groupRe = /^\d+\.\s+\D/
  const taskRe = /^\d+\.\d+/
  const startRow = loc ? loc.header + 1 : 0
  for (let i = startRow; i < r.length; i++) {
    const a = at(r[i], c.title ?? 0)
    if (!a) continue
    if (groupRe.test(a)) {
      current = { title: a.trim(), tasks: [] }
      groups.push(current)
    } else if (taskRe.test(a) && current) {
      const days = toNum(r[i]?.[c.duration])
      current.tasks.push({
        title: a.replace(/^[\d.]+\s+/, '').trim() || a.trim(),
        assignee_name: at(r[i], c.assignee),
        planned_start: toISODate(r[i]?.[c.start]),
        planned_end: toISODate(r[i]?.[endCol]),
        duration_days: days != null && days > 0 ? days : null,
        status: mapStatus(at(r[i], c.status)),
        priority: 'medium',
      })
    }
  }
  return groups.filter(g => g.tasks.length > 0)
}

function parseRisks(wb: WorkBook): ParsedRisk[] {
  const r = rowsFor(wb, 'risks')
  const loc = locateTable(r, [
    { key: 'title', aliases: ['риск', 'risk', 'risks', 'угроза'] },
    { key: 'impact', aliases: ['влияние', 'impact', 'ietekme', 'воздействие'] },
    { key: 'probability', aliases: ['вероятность', 'probability', 'varbūtība'] },
    { key: 'mitigation', aliases: ['план смягчения', 'митигация', 'меры', 'mitigation', 'plāns', 'reaģēšana'] },
  ])
  if (!loc) return []
  const out: ParsedRisk[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const title = at(r[i], loc.cols.title)
    if (!title) continue
    out.push({
      title, impact: mapLevel(r[i]?.[loc.cols.impact]), probability: mapLevel(r[i]?.[loc.cols.probability]),
      mitigation_plan: at(r[i], loc.cols.mitigation),
    })
  }
  return out
}

function parseKPIs(wb: WorkBook): ParsedKPI[] {
  const r = rowsFor(wb, 'kpi')
  const loc = locateTable(r, [
    { key: 'name', aliases: ['kpi', 'показатель', 'метрика', 'наименование'] },
    { key: 'target', aliases: ['цель', 'target', 'mērķis', 'целевое'] },
    { key: 'description', aliases: ['описание', 'description', 'apraksts'] },
    { key: 'formula', aliases: ['формула', 'formula', 'формула расчёта'] },
  ])
  if (!loc) return []
  const out: ParsedKPI[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const name = at(r[i], loc.cols.name)
    if (!name || /^ФАЗА/i.test(name)) continue
    out.push({ name, target: at(r[i], loc.cols.target), description: at(r[i], loc.cols.description), formula: at(r[i], loc.cols.formula) })
  }
  return out
}

function parseBacklog(wb: WorkBook): ParsedBacklogItem[] {
  const r = rowsFor(wb, 'backlog')
  const loc = locateTable(r, [
    { key: 'title', aliases: ['задачи', 'задача', 'доставка', 'title', 'task', 'uzdevums', 'описание'] },
    { key: 'priority', aliases: ['приоритет', 'priority', 'prioritāte'] },
    { key: 'requested_by', aliases: ['ответственный', 'responsible', 'atbildīgais', 'заказчик'] },
  ])
  if (!loc) return []
  const out: ParsedBacklogItem[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const title = at(r[i], loc.cols.title)
    if (!title) continue
    out.push({ title, priority: mapPriority(at(r[i], loc.cols.priority)), requested_by: at(r[i], loc.cols.requested_by) })
  }
  return out
}

function parseCommPlan(wb: WorkBook): ParsedCommPlanItem[] {
  const r = rowsFor(wb, 'communication')
  const loc = locateTable(r, [
    { key: 'goal', aliases: ['цель коммуникации', 'цель', 'goal', 'mērķis'] },
    { key: 'channel', aliases: ['канал', 'channel', 'kanāls'] },
    { key: 'audience', aliases: ['аудитория', 'audience', 'auditorija'] },
    { key: 'frequency', aliases: ['частота', 'периодичность', 'frequency', 'biežums'] },
    { key: 'responsible', aliases: ['ответственный', 'responsible', 'atbildīgais'] },
  ])
  if (!loc) return []
  const out: ParsedCommPlanItem[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const goal = at(r[i], loc.cols.goal)
    if (!goal) continue
    out.push({
      goal, channel: at(r[i], loc.cols.channel), audience: at(r[i], loc.cols.audience),
      frequency: at(r[i], loc.cols.frequency), responsible: at(r[i], loc.cols.responsible),
    })
  }
  return out
}

function parseBudget(wb: WorkBook): ParsedBudgetItem[] {
  const r = rowsFor(wb, 'finance')
  const loc = locateTable(r, [
    { key: 'name', aliases: ['позиция', 'статья', 'наименование', 'item', 'position', 'pozīcija'] },
    { key: 'total', aliases: ['итого', 'сумма', 'total', 'всего', 'kopā', 'eur'] },
  ], 30)
  if (!loc) return []
  const out: ParsedBudgetItem[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const name = at(r[i], loc.cols.name)
    if (!name || /^(итого|затраты на|total)/i.test(name)) continue
    // Сумма: колонка «итого/сумма/EUR», иначе сумма числовых ячеек строки.
    let amount = toNum(r[i]?.[loc.cols.total])
    if (amount == null) {
      const nums = (r[i] || []).map(toNum).filter((x): x is number => x != null)
      amount = nums.length ? nums.reduce((s, x) => s + x, 0) : null
    }
    out.push({ name, amount, category: 'implementation' })
  }
  return out
}

function parseFollowups(wb: WorkBook): ParsedFollowup[] {
  const r = rowsFor(wb, 'followups')
  const loc = locateTable(r, [
    { key: 'title', aliases: ['действие', 'описание проблемы', 'action', 'задача', 'rīcība'] },
    { key: 'responsible', aliases: ['ответственный', 'responsible', 'atbildīgais'] },
    { key: 'due', aliases: ['срок', 'due', 'termiņš', 'дата'] },
    { key: 'status', aliases: ['статус', 'status', 'statuss'] },
  ])
  if (!loc) return []
  const out: ParsedFollowup[] = []
  for (let i = loc.header + 1; i < r.length; i++) {
    const title = at(r[i], loc.cols.title)
    if (!title) continue
    out.push({
      title, requested_by: at(r[i], loc.cols.responsible),
      due_date: toISODate(r[i]?.[loc.cols.due]), status: mapStatus(at(r[i], loc.cols.status)) === 'completed' ? 'done' : 'open',
    })
  }
  return out
}

function parseMeetings(wb: WorkBook): ParsedMeeting[] {
  const sheets = wb.SheetNames.filter(n => {
    const nn = norm(n)
    return nn.startsWith('minutes') || nn.includes('протокол')
  })
  const out: ParsedMeeting[] = []
  for (const name of sheets) {
    const r = getRows(wb, name)
    const meeting_type = labelRight(r, ['тип встречи', 'meeting type', 'tikšanās veids'])
    const meeting_date = toISODate(labelRight(r, ['дата', 'date', 'datums']))
    const meeting_time = labelRight(r, ['время', 'time', 'laiks'])
    // участники: строка-заголовок «Имя|…|Присутствует|…»
    const loc = locateTable(r, [
      { key: 'name', aliases: ['имя', 'name', 'vārds', 'участник'] },
      { key: 'present', aliases: ['присутствует', 'present', 'piedalās', 'да/нет'] },
    ])
    const attendees: ParsedMeetingAttendee[] = []
    if (loc) {
      for (let i = loc.header + 1; i < r.length; i++) {
        const nm = at(r[i], loc.cols.name)
        if (!nm) { if (attendees.length) break; else continue }
        if (/посещаемость|повестка|решени|agenda|attend/i.test(nm)) break
        const pres = norm(at(r[i], loc.cols.present))
        attendees.push({ name: nm, present: /^(да|jā|yes|✓|true|1|present)/.test(pres) })
      }
    }
    out.push({ title: name.trim(), meeting_type, meeting_date, meeting_time, attendees })
  }
  return out
}

// Допущения/стейкхолдеры: в старом шаблоне жили в тексте «Charter_2 page»; в новых
// файлах отдельных данных нет — оставляем пустыми (заполняются вручную), но
// поддерживаем старую разметку, если лист присутствует.
function parseAssumptions(wb: WorkBook): ParsedAssumption[] {
  const r2 = getRows(wb, 'Charter_2 page')
  const text = r2.length ? cellStr(r2[13]?.[0]) : ''
  if (!text) return []
  const items: ParsedAssumption[] = []
  let type: 'assumption' | 'constraint' = 'assumption'
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^Предположени|^Assumptions/i.test(line)) { type = 'assumption'; continue }
    if (/^Ограничени|^Constraints/i.test(line)) { type = 'constraint'; continue }
    if (/^[-–—•]\s/.test(line)) { const d = line.replace(/^[-–—•]\s+/, '').trim(); if (d) items.push({ description: d, type }) }
    else if (/^\d+[.)]\s/.test(line)) { const d = line.replace(/^\d+[.)]\s+/, '').trim(); if (d) items.push({ description: d, type }) }
  }
  return items
}

function parseStakeholders(wb: WorkBook): ParsedStakeholder[] {
  const r2 = getRows(wb, 'Charter_2 page')
  const text = r2.length ? cellStr(r2[10]?.[0]) : ''
  if (!text) return []
  const out: ParsedStakeholder[] = []
  let type: 'internal' | 'external' = 'internal'
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^Внутренн|^Internal/i.test(line)) { type = 'internal'; continue }
    if (/^Внешн|^External/i.test(line)) { type = 'external'; continue }
    const dashIdx = line.search(/\s[–—-]\s/)
    if (dashIdx > 0) {
      const name = line.slice(0, dashIdx).trim()
      const role = line.slice(dashIdx).replace(/^\s*[–—-]\s*/, '').trim()
      if (name) out.push({ name, role, type })
    } else if (line.length > 2 && !/^[-–—•]/.test(line)) {
      out.push({ name: line, role: '', type })
    }
  }
  return out
}

// ── sheet detection (по алиасам) ────────────────────────────────────────────────

const DETECT_ORDER: [label: string, key: string][] = [
  ['Passport', 'passport'], ['Team', 'team'], ['WBS', 'wbs'], ['Risks', 'risks'],
  ['KPI', 'kpi'], ['Backlog', 'backlog'], ['Communication', 'communication'],
  ['Finance', 'finance'], ['Followups', 'followups'],
]

function detectSheets(wb: WorkBook): ParsedSheetInfo {
  const recognized: string[] = []
  const missing: string[] = []
  const mappedSheets = new Set<string>()
  for (const [label, key] of DETECT_ORDER) {
    const name = findSheetName(wb, key)
    if (name) { recognized.push(label); mappedSheets.add(name) }
    else missing.push(label)
  }
  // Meetings (несколько листов Minutes)
  const minutes = wb.SheetNames.filter(n => norm(n).startsWith('minutes') || norm(n).includes('протокол'))
  if (minutes.length) { recognized.push('Meetings'); minutes.forEach(n => mappedSheets.add(n)) }
  else missing.push('Meetings')
  const IGNORE = /^(readme|gantt|gant|status report|статус|results|результат)/i
  const extra = wb.SheetNames.filter(n => !mappedSheets.has(n) && !IGNORE.test(norm(n)))
  return { recognized, missing, extra }
}

// ── main export ───────────────────────────────────────────────────────────────

export async function parseExcelFile(buffer: ArrayBuffer, fileName = ''): Promise<ParsedProject> {
  XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  return {
    passport: parsePassport(wb, fileName),
    team: parseTeam(wb),
    groups: parseWBS(wb),
    risks: parseRisks(wb),
    kpis: parseKPIs(wb),
    backlog: parseBacklog(wb),
    commPlan: parseCommPlan(wb),
    assumptions: parseAssumptions(wb),
    stakeholders: parseStakeholders(wb),
    budget: parseBudget(wb),
    meetings: parseMeetings(wb),
    followups: parseFollowups(wb),
    sheets: detectSheets(wb),
  }
}
