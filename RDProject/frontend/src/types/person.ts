export interface Person {
  id: string
  first_name: string
  last_name: string
  full_name: string
  bitrix24_id: number | null
  email: string | null
  /** Телефон из Bitrix (PERSONAL_MOBILE/WORK_PHONE). Появляется у людей после синка справочника. */
  phone?: string | null
  /** Должность из Bitrix (WORK_POSITION). Появляется у людей после синка справочника. */
  position?: string | null
  created_at: string
  updated_at: string
  /** Связь с аккаунтом портала (если у человека есть логин). Проставляет сервер. */
  user_id?: string | null
  /** Уволенных в Bitrix помечаем неактивными, но НЕ удаляем — иначе не разрезолвить историю. */
  is_active?: boolean
  /** Не показывать в выпадающих списках выбора людей (технические логины вроде «Portfolio Owner»,
   *  которые попали в справочник при первичном заполнении из USERS). В самом справочнике человек
   *  остаётся видимым — иначе галочку не снять. Поле разрежённое: отсутствует = показываем. */
  hidden_from_pickers?: boolean
}

export interface PersonImportResult {
  imported: number
  updated: number
  deactivated: number   // уволенные в Bitrix — мягко, без удаления (история исполнителей)
  reactivated: number
  linked: number
  total_fetched: number
  complete: boolean     // false = Bitrix ответил не полностью; деактивации в этот раз не было
  error: string
  logins_deactivated?: number  // входы уволенных, погашенные синком (вместе с помощником)
  logins_held?: number         // попали под отключение, но не отключены: >3 за раз или последний владелец
}
