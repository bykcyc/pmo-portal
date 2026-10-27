# PMO architecture and data flow

Project-management portal for project managers and a portfolio owner. Executors
never log in — their work is pushed to Bitrix24. This document describes the
**current** system (own PostgreSQL, since 2026-07-10). The old OpenProject engine is gone; its
REST shapes survive only as in-process compatibility shims in `db.py`.

## 1. Runtime topology

Production (`deploy/docker-compose.prod.yml`):

```
browser ─────────── HTTPS ──┐
AI assistant ── MCP+OAuth ──┼──▶ Caddy (auto-HTTPS) ──▶ built SPA for every other path
Fireflies, Bitrix24 ─ hooks ┘     │  /api/* (prefix stripped), /mcp*, /oauth/*,
                                  │  /.well-known/oauth-*, /webhooks/*
                                  ▼
              pmo-backend (FastAPI + asyncpg, :8002, SINGLE uvicorn worker)
                     │  SQL (asyncpg pool, min 1 / max 10)
                     ▼
              pmo-db (PostgreSQL 16, :5432 inside the Compose network)

pmo-backend also ─┬─▶ Bitrix24 REST (push tasks to executors, calendar, people sync)
                  ├─▶ Fireflies API (read the transcript of a queued meeting)
                  └─▶ SMTP (weekly PM digests, leadership digest)
```

In production Caddy is the only published service: its image carries the built SPA
(`deploy/Dockerfile.frontend`; there is no nginx), and `deploy/Caddyfile` routes the paths above to
the backend. Development (`docker-compose.yml`) runs three services on one network: `pmo-db`
(host port 127.0.0.1:5433), `pmo-backend` (127.0.0.1:8002) and `frontend` — the Vite dev server
on 127.0.0.1:3000 with HMR, which proxies `/api` to `PMO_BACKEND=http://pmo-backend:8002` with
the prefix stripped. Either way the SPA talks only to `/api`; it has no knowledge of the database.

**Single worker is load-bearing.** `uvicorn asgi:app` (the dev Compose `command` and the backend
image `CMD`) has no `--workers`, so all in-process state lives in one process: the `USERS` cache,
APScheduler jobs, login rate-limit dict / token-revocation set, and — critically — the
optimistic-lock retry loop. Concurrency safety comes from PostgreSQL (`projects.version` optimistic
lock, `pg_advisory_xact_lock` in store writes), not from the app being multi-process.

## 2. Module map

**Frontend** — `RDProject/frontend/src/` (React 18 + Vite + TypeScript + Tailwind):
- `api/` — one file per portal module (`projects.ts`, `tasks.ts`, `risks.ts`, `gantt.ts`,
  `portfolio.ts`, `meetings.ts`, `budget.ts`, `public.ts`, …); **all** requests go through
  `api/client.ts` (axios, `baseURL:'/api'`, Bearer interceptor, public-share `?share=` mode).
- `pages/` — top-level screens (`PortfolioDashboard`, `ProjectDetailPage`, `MyWorkPage`,
  `CalendarPage`, `DraftsPage`, `ConsentPage` (OAuth consent, `/connect`), `PublicProjectPage`,
  `SettingsPage`, `LoginPage`, …).
- `components/tabs/` — 16 project sections (WBS, Gantt, Risks, Team, Budget, Meetings,
  Decisions, Backlog, KPIs, Baseline, Reports, Stakeholders, Assumptions, CommPlan, Kanban…);
  `components/ui/` are primitives (skeleton/feedback). Permissions are hidden client-side via
  `useCanWrite()`; the server is the authority.

**Backend** — `pmo-backend/` (FastAPI). `main.py` is a thin assembly: shared helpers/state,
`_lifespan`, the metrics middleware, `_register_collection` calls, and `include_router` wiring.
Route groups live in `*_routes.py` modules using the `build_router(api)` facade — every handler
resolves state/helpers through `api.<name>` (i.e. `main`) **at call time**, so `main.*` monkeypatch
points stay valid and response bytes are unchanged.
- `*_routes.py` — `auth`, `system`, `attachments`, `collections`, `share_notes`, `tasks`,
  `risks`, `task_ops`, `portfolio`, `bitrix`, `bitrix_calendar`, `fireflies`, `directory`,
  `admin`, `projects`, `project_ops`, `drafts`, `problems`, `access`, `registry`, `oauth`.
- `mcp_server.py` (MCP tools), `oauth_provider.py` (OAuth authorization server), `draft_apply.py`
  (applies accepted drafts), `fireflies_sync.py` (queue worker), `fireflies_match.py` (pure
  meeting matching, no I/O) — the assistant integration and the Fireflies queue, see §5.
- `asgi.py` — the uvicorn entry point: loads `.env`, then imports `main.app`. `pmo_api.py` — the
  `PmoApi` Protocol that types the `api` facade for pyright.
- `db.py` — asyncpg data-access layer; **shims** each DB row back into the OpenProject shape
  (`project_shim`/`task_shim`/`risk_shim`) so every downstream mapper stays untouched.
- `project_meta.py` — passport-JSON persistence helpers (parse / serialize / `save_full` /
  `with_retry`), import-side-effect free with explicit persistence callables.
- `domain.py` — pure domain math (CPM critical path, workload, RAG), no FastAPI/IO/global state.
- `app_runtime.py` — lifespan orchestration + seed users. `security.py` — mostly pure helpers (plus a few token-revocation and
  rate-limit calls through injected clients): HMAC
  session tokens, bcrypt passwords, TOTP 2FA, agent-token hashing, Fernet for stored secrets and
  the prod-secret guard (the RBAC dependencies `rbac`/`require_owner` live in `main.py`).
  `mailer.py` — SMTP. `schema.sql` — canonical DB schema (applied idempotently at startup via
  `db.apply_schema`).

## 3. Where state lives

| Entity / collection | Home | Notes |
|---|---|---|
| Project passport (паспорт, WBS meta, budget summary, share cfg) | `projects.meta` (`json` blob) | 60 KiB cap; `json` not `jsonb` (key order is golden). **No** task/risk counts or baselines. |
| `_action_log`, `_meetings`, `_backlog`, `_notes` | `project_docs(project_id, coll, seq, doc json)` | Normalized out of `meta`; merged back into `m` via `_docs` by `load_meta`/`fetch_projects`. |
| Tasks (WBS: phase/task/milestone) | `tasks` table | Was WP + `_task_extra` sidecar, now flat columns; `wp_id_seq` shared with risks. |
| Risks | `risks` table | Was WP + `_risk_extra`; `updates` is inline `json`. |
| Task dependencies | `deps` table | Was `_deps` in meta; `seq` preserves array order; no FK (tolerates orphans). |
| Activity / comments (journals) | `activities` table | Per-WP version counter; `details json`. |
| Attachments | `attachments` table | 25 MB cap; `data BYTEA`. |
| **Users** | `users` table (`email,seq,doc json`) | Formerly `users.json` — now a PostgreSQL table. |
| **Persons** (Bitrix directory) | `persons` table | Formerly a JSON file store. |
| **Settings** (RAG thresholds, SMTP) | `settings` table (single row id=1) | Formerly JSON file. |
| **Snapshots** (daily portfolio metrics) | `snapshots` table (`snap_date` PK) | Formerly `snapshots.json`; pruned to ~400 dates. |
| **Baselines** | `baselines` table (`project_id,seq,doc`) | Formerly JSON; lazy-migrated out of legacy `meta._baselines`. |

## 4. Key request flows

- **Login** — `POST /api/auth/login`: rate-limit check → `USERS[email]` (loaded from `users` table
  at startup) → `_verify_password` (bcrypt, off-thread) → returns an HMAC-SHA256 bearer token
  (`{sub, jti, exp}` signed with `ADAPTER_SECRET`, stateless). With TOTP 2FA enabled the first step
  returns a short-lived challenge instead, and `POST /auth/login/totp` trades it plus the code for
  the token. Once the 2FA grace period is over, `_twofa_gate_mw` answers 403 to a user without 2FA
  on every path except `/auth/me`, `/auth/logout` and `/me/2fa*`. `logout` revokes the token
  signature until its `exp`; `/auth/me` returns the RBAC-resolved user.
- **Project write** — mutating handlers call `with_meta_retry(pid, mutate)`: `load_meta` →
  `mutate(m)` (mutate in place; generate ids/timestamps *before* so retries are stable) →
  `db.update_project_meta` guarded by `WHERE version = expected`. On a lost race (rows=0) it
  re-reads fresh meta and retries (≤4). The same version-checked transaction rewrites the
  `project_docs` collections via `colls=`/`extract_colls`, so `_action_log` etc. are protected by
  the same optimistic lock.
- **Public share** — PM sets `POST /projects/{pid}/share` (mints `secrets.token_urlsafe(16)`).
  Viewers open `/public/{token}`; the SPA sets `setPublicShare(token)` so every request carries
  `?share=<token>` with **no** Bearer, and a 401 does not log the viewer out. `_find_share` scopes
  the response to the published sections only.
- **Background scheduler** — started in `_lifespan` (APScheduler, UTC), skipped when
  `SCHEDULER_DISABLED=1` (used during golden capture). Jobs: daily portfolio snapshot 23:00
  (`_take_portfolio_snapshot`, also run once at boot; the same job sweeps expired drafts and
  abandoned OAuth requests), weekly PM digests Mon 08:00 (`_run_digests`), leadership digest
  Mon 08:30 (`_run_leadership_digest`), Bitrix24 people sync daily 04:00 (no-op without Bitrix)
  and, only with `FIREFLIES_ENABLED`, the Fireflies queue every minute (`fireflies_sync.run_due`).
  Each job takes a Postgres advisory lock, so it runs once even with several workers. Digests send
  via SMTP (`mailer.py`).
- **Bitrix24** — backlog/tasks push to Bitrix (`bitrix_routes`); an inbound webhook
  (`BITRIX_INBOUND_TOKEN`) updates task status from executor progress. `bitrix_calendar_routes`
  serves the Bitrix24 calendar: week grid, busy intervals (never the titles of other people's
  meetings), event creation and common-slot suggestions.

## 5. AI assistant integration

- **MCP** — `mcp_server.py`, mounted at `/mcp`. Tools: `my_projects`, `people`, `project_card`,
  `project_section`; `create_project` and `propose_changes` also need the `draft` scope. A tool reaches
  only projects its user owns (PM, co-PM, umbrella PM) or, for the portfolio owner, any project — and
  only those opened to the assistant (closed by default; `create_project` opens the project it
  creates). No tool changes access settings, tokens or 2FA. Calls and refusals are logged to `mcp_access_log`.
- **OAuth** — `oauth_routes.py` serves the SDK protocol endpoints (`/oauth/*`, `/.well-known/oauth-*`)
  and the API of the consent page (SPA `/connect`, behind the normal login + 2FA); `oauth_provider.py`
  implements the SDK provider over Postgres. The result is an ordinary, revocable `api_tokens` row.
- **Drafts** — every change or delete of existing data becomes a draft (`project_drafts`) that the
  PM reviews, edits and accepts or rejects via `drafts_routes.py`; `draft_apply.py` applies it in a
  fixed section order. Owner-only auto-apply (`/admin/settings/mcp`, off by default) runs the same
  accept path at once.
- **Fireflies** (only with `FIREFLIES_ENABLED`) — `fireflies_routes.py` checks the webhook's
  HMAC-SHA256 signature over the raw body and only queues the meeting; the `fireflies_sync.run_due`
  worker (every minute) fetches the transcript, matches it via the pure `fireflies_match.py` and
  writes minutes to the PMO meeting and, behind `FIREFLIES_BITRIX_COMMENTS`, a comment on the
  Bitrix24 event — skipping private meetings and unsure matches.

## 6. Compatibility contract and verification

The byte-compatibility contract is canonical: see **[pmo-backend/CLAUDE.md](pmo-backend/CLAUDE.md)**
and **[AGENTS.md](AGENTS.md)**. Do not change without an approved versioned migration:
string IDs (over `INTEGER`/`BIGINT`), `TEXT` date columns, `json` (not `jsonb`), OpenProject-shaped
response bodies, collection ordering, and the 60 KiB `projects.meta` cap. Never reintroduce
`_counts`/baselines into `projects.meta`.

Run after backend changes (harness commands: [tools/goldens/README.md](tools/goldens/README.md)):
1. API golden — every GET response in the capture manifest, byte-compared with a locally captured
   baseline (`capture_api.py`, base `http://127.0.0.1:8002`).
2. Write invariants — business-rule checks in a sandbox project the script creates and deletes
   (`writeflow.py`).
3. E2E + visual regression snapshots (`npx playwright test --workers=1`).
4. Unit — `pytest tests -q` (backend), `npm run test` + `npx tsc --noEmit` (frontend).

Every step must end green; the counts are not pinned here because they change with the code. CI
runs step 4 (plus pyright); steps 1–3 need a running stack, and their baselines stay outside Git.

Golden/visual baselines are date-bound (they embed "today" and journals) — capture and compare on
the same date.
