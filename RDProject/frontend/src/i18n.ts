import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import ru from './locales/ru.json'
import lv from './locales/lv.json'

// Уважает сохранённый выбор пользователя; при его отсутствии дефолт — русский
// (язык браузера не должен переопределять продуктовый дефолт).
const storedLng = typeof window !== 'undefined' ? window.localStorage.getItem('i18nextLng') : null

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      lv: { translation: lv },
    },
    lng: storedLng || 'ru',
    fallbackLng: 'en',
    defaultNS: 'translation',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
