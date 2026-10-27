import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { queryClient } from './lib/queryClient'
import './i18n'
// Manrope — шрифт темы Warm (латиница+кириллица через unicode-range,
// font-display: swap). Classic остаётся на Inter/Segoe-стеке через --font-sans;
// Inter НАМЕРЕННО не устанавливаем — Classic всегда рендерил Segoe-фолбэком,
// и установка Inter сломала бы его пиксельный паритет.
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
