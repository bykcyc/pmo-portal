---
name: pmo-security-review
description: Review PMO authentication, authorization, data exposure, integrations, and dependency risks. Use for an explicit security assessment or changes involving roles, tokens, webhooks, uploads, secrets, or public links; do not run destructive tests or expose credentials.
---

# PMO security review

1. State the asset, trust boundary, attacker capability, and intended role behaviour before testing. Use harmless evidence and least-privilege test accounts.
2. Inspect authentication, PM/owner/viewer authorization, project ownership checks, public-share tokens, inbound webhooks, CORS, request validation, uploads, logs, error responses, and external integration boundaries.
3. Never print, copy, commit, or request secret values. Treat `.env`, production credentials, and live external systems as out of scope unless the user explicitly authorizes the access.
4. Distinguish confirmed vulnerability, hardening opportunity, and unverified hypothesis. For each finding give preconditions, affected boundary, impact, remediation, and regression test.
5. Preserve the backend compatibility contract while fixing security issues. Escalate any change that requires a migration, API version change, or production-side action.
