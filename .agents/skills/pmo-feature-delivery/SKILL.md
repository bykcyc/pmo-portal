---
name: pmo-feature-delivery
description: Deliver a scoped PMO feature across backend, frontend, tests, and documentation. Use after the requested outcome, acceptance behaviour, and authority to change are clear; do not replace the selected behavioural or TDD workflow.
---

# PMO feature delivery

1. Restate the user-visible outcome, affected roles, data impact, and acceptance checks. Do not expand scope or mutate live data without explicit authority.
2. When Superpowers is available, let it own planning and red-green TDD. Do not activate another behavioural workflow that competes with that lifecycle.
3. When the affected area is unfamiliar, map the relevant modules with Graphify; then resolve concrete symbols with language tooling. Read the backend contract before any API, schema, persistence, or metadata change.
4. Make the smallest coherent vertical change. Keep API compatibility unless the request explicitly authorizes a versioned contract change.
5. Add or update focused tests before relying on broad end-to-end coverage. Keep frontend code dependent only on `/api`.
6. Run the validation layers that match the changed boundary: unit/type checks, backend tests, frontend tests/build, API golden comparison, writeflow, or Playwright. Do not refresh baselines merely to hide a regression. For changes touching authentication, RBAC, tokens, webhooks, uploads, or public share links, apply `pmo-security-review` as part of that boundary check.
7. Summarize changed behaviour, validation evidence, remaining risks, and any deliberately deferred work.
