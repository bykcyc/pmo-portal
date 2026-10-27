import { create } from 'zustand'

/** Экспорт текущей секции проекта в XLSX через меню «Ещё» в шапке.
 * Каждый таб регистрирует свои строки (useSectionExport), меню показывает пункт
 * «Экспорт в Excel», когда есть что выгружать. Заменяет разрозненные inline-кнопки. */
export interface SectionExport {
  filename: string
  rows: Record<string, unknown>[]
}

interface ExportState {
  current: SectionExport | null
  setExport: (e: SectionExport | null) => void
}

export const useExportStore = create<ExportState>((set) => ({
  current: null,
  setExport: (e) => set({ current: e }),
}))
