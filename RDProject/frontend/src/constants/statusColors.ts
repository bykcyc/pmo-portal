// Genuinely-shared Tailwind color maps used across multiple views (via the
// shared StatusBadge / PriorityBadge components in src/components/ui/badges.tsx,
// which render project status/priority pills on the Projects list, Portfolio
// dashboard, Project detail and My Work pages).
//
// NOTE: The per-tab color maps (Assumptions, Backlog, KPIs, Decisions, Meetings,
// WBS, Gantt, Reports, ...) are intentionally NOT centralized here: each uses a
// different key set and/or different exact Tailwind shades, so they are
// domain-specific rather than verbatim duplicates.

export const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

export const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  on_hold: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}
