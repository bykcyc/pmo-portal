---
name: pmo-playwright-e2e
description: Run or design headless Playwright checks for PMO user flows, responsive layouts, visual regressions, and browser errors. Use for explicit UI or E2E verification; do not use it for backend-only changes or uncontrolled data mutation.
---

# PMO Playwright E2E

1. Establish the target route, role, viewport, expected outcome, and whether the flow may write data. Prefer existing safe test accounts and read-only flows; require explicit authority for create, update, or delete actions.
2. Use the repository's [Playwright configuration](../../../RDProject/frontend/playwright.config.ts) and keep test execution isolated from the mounted frontend dependency directory. Do not install or rewrite frontend dependencies merely to run a browser test.
3. Record reproducible evidence: URL, role, viewport, observed result, console errors, and trace or screenshot when available.
4. Cover the smallest representative flow first. For responsive or accessibility work, include desktop and narrow viewport checks plus keyboard-visible focus where relevant.
5. Treat visual and API baselines as controlled artifacts. Update them only when an intentional product change has been reviewed; never overwrite a failing baseline as the first response.
