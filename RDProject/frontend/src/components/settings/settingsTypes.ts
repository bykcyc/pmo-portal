// Общие типы страницы настроек. Лист-модуль: и SettingsPage, и секции импортируют его,
// поэтому он не должен зависеть от SettingsPage (иначе циклический импорт).

export interface SyncLogEntry {
  id: string
  task_id?: string | null
  bitrix24_task_id?: number | null
  sync_action?: string | null
  status?: string | null
  error_message?: string | null
  synced_at: string
}
