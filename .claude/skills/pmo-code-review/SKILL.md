---
name: pmo-code-review
description: Review PMO code changes for correctness, regressions, maintainability, and contract safety. Use for a requested review of a diff, branch, pull request, or planned change; do not modify code unless asked to implement a finding.
---

# PMO code review

1. Define the review scope and inspect the actual diff before drawing conclusions. Separate observed defects from suggestions.
2. Trace risky paths with language tooling, reaching for Graphify only when the affected topology is unfamiliar. Prioritize authorization, persistence, serialized API behaviour, task/risk ordering, asynchronous error handling, and frontend state consistency.
3. For backend-impacting changes, read [the compatibility contract](../../../pmo-backend/CLAUDE.md). Flag changes to string IDs, `TEXT` dates, `json` order, response shapes, metadata limits, route registration, or import-time behaviour.
4. Rate findings by user impact and likelihood. For each actionable finding provide file or symbol, reproduction or evidence, consequence, and a concrete remediation.
5. Do not label a concern as a defect without evidence from code, tests, or a reproducible path. Recommend the smallest relevant validation; route security-specific analysis to `pmo-security-review`.
