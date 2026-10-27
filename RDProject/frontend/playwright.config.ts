import { defineConfig, devices } from '@playwright/test'

// E2E по ЖИВОМУ стеку (up.ps1), baseURL :3000.
//
// ГДЕ ЭТО ЗАПУСКАЕТСЯ. `node_modules` фронта — контейнерные (Alpine): `npm install` на хосте
// в frontend/ делать НЕЛЬЗЯ (сломает vite в контейнере, и браузеры Playwright под Alpine не
// ставятся). Поэтому тесты гоняются из отдельного каталога-раннера на хосте:
//   mkdir pw-runner && cd pw-runner && npm i -D @playwright/test@1.49.1
//   npx playwright install chromium
//   # в playwright.config.ts раннера: testDir -> сюда, в <repo>/RDProject/frontend/e2e
//   npx playwright test --workers=1
//
// СПЕКИ НЕ КОПИРУЮТСЯ. Раньше их копировали в раннер — и копии разошлись: два месяца правок
// жили только на одной машине, вне гита, а в репозитории лежала версия с тестами удалённых
// фич. Теперь код спек существует в ОДНОМ месте (здесь), а у раннера остаются только вещи,
// которых в гите быть не должно: node_modules, браузеры и эталонные снимки,
// привязанных к данным конкретного дева.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Голден-снимки визуальной регрессии (visual.spec.ts) — плоско в e2e/__screenshots__.
  // Сами снимки в репозитории НЕ лежат: они тяжёлые и привязаны к данным
  // конкретного дева (витринный проект 47) — как и эталоны API, которые тоже вне гита.
  // Каталог задаётся снаружи, чтобы раннер мог держать их у себя: см. E2E_SNAPSHOTS.
  snapshotPathTemplate: (process.env.E2E_SNAPSHOTS || '{testDir}/__screenshots__') + '/{arg}{ext}',
  expect: {
    timeout: 10_000,
    // maxDiffPixels (а не ratio): ловим смещение блока, прощаем сглаживание шрифтов.
    // Щедрый timeout: сравнение переснимает кадр, пока он не совпадёт с эталоном, — это
    // гасит поздние дорисовки (карточка-советник, догрузка таблиц), но настоящее
    // расхождение данных (тысячи пикселей) всё равно не сойдётся и упадёт.
    toHaveScreenshot: { maxDiffPixels: 40, animations: 'disabled', caret: 'hide', timeout: 30_000 },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
