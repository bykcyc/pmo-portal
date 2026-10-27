---
name: pmo-refactor
description: Simplify PMO code and reduce technical debt without changing approved behaviour. Use only for an explicit refactor, cleanup, or maintainability task after the affected behaviour and validation boundary are known.
---

# PMO refactor

1. Establish the current observable behaviour and a focused safety net before editing. Keep refactoring separate from feature work unless the user accepts the combined scope. When Superpowers is available, let it own multi-step planning rather than starting a competing behavioural workflow.
2. Use Graphify for structural impact when the affected area is unfamiliar, and language tooling for symbol-level changes. Prefer small, reversible steps with a clear before-and-after rationale.
3. For backend work, read [the compatibility contract](../../../pmo-backend/CLAUDE.md). Do not change API bytes, route registration, schema types, JSON ordering, or metadata semantics without explicit approval.
4. Do not introduce import-time I/O, whole-table delete/reinsert persistence, `_counts`, baselines in project metadata, or unrelated dependency upgrades.
5. Run the appropriate unit, integration, frontend, and compatibility checks after each structural step. Stop and report if the required proof cannot be obtained.
