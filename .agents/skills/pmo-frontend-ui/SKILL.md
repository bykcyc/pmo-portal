---
name: pmo-frontend-ui
description: Design, implement, or assess user-facing React screens, dashboards, forms, tables, and accessibility in RDProject/frontend. Use only for UI tasks or visual defects; do not activate for backend-only or generic code changes.
---

# PMO frontend UI

1. Identify the user role, route, primary task, state, and viewport before proposing a UI change. Preserve PM, owner, and viewer permission distinctions rather than hiding an authorization problem in the interface.
2. Inspect existing components, tokens, routes, and responsive patterns before adding a new pattern. Keep the frontend dependent only on `/api` and do not silently change backend response contracts.
3. Make hierarchy, status, destructive actions, empty states, errors, loading feedback, and dense-table behaviour understandable without relying on colour alone.
4. Check keyboard flow, visible focus, labels, accessible names, contrast, touch targets, desktop layout, and a narrow viewport. Use `pmo-playwright-e2e` when browser evidence is needed.
5. Keep design work scoped to the requested screen or flow. Run the relevant frontend tests and type/build checks after implementation; use `pmo-library-docs` only for an unknown third-party UI API.
