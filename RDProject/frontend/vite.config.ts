import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Бэкенд PMO: pmo-backend на :8002 (FastAPI + собственный Postgres).
// Адрес переопределяется переменной окружения контейнера фронта (PMO_BACKEND).
const BACKEND = process.env.PMO_BACKEND || 'http://host.docker.internal:8002'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('dhtmlx-gantt')) return 'gantt-vendor'
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'react-vendor'
          if (id.includes('@tanstack/react-query') || id.includes('zustand') || id.includes('i18next')) return 'app-vendor'
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'export-vendor'
          if (id.includes('xlsx')) return 'xlsx-vendor'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    // В контейнере на Windows-bind-mount inotify не работает — включаем polling, чтобы HMR видел правки.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': {
        target: BACKEND,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/auth': BACKEND,
      '/projects': {
        target: BACKEND,
        bypass: (req) => req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
      },
      '/users': BACKEND,
      '/portfolio': {
        target: BACKEND,
        bypass: (req) => req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
      },
      '/health': BACKEND,
      '/persons': BACKEND,
      '/admin': BACKEND,
    },
  },
})
