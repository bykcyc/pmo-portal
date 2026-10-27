# PMO backend — security invariants

Canonical security contract for `pmo-backend` (FastAPI + asyncpg + own PostgreSQL).
Everything here is load-bearing behavior that other code and tests depend on. **Do not
remove or weaken any item without a replacement control and a green regression run.**
File/line references are to the current tree; the behavior, not the line number, is the contract.

## RBAC permission matrix

Roles come from `users.role`: `owner` (portfolio manager), `pm` (project manager) and `exec`
(company leadership) — `_VALID_ROLES`, `main.py`; the former `viewer` role was removed. **co-PM**
and **observer** are not roles but per-project lists: a co-PM is a user in the project's `editors`
(`_owns_item`), an observer is a user in its `observers` (`_observes_item`, read-only). In a project
tree the PM and co-PMs of an umbrella also write to its subprojects, while subproject PMs/co-PMs and
the umbrella's observers get read access along the tree (`inherited_editors` / `inherited_observers`,
computed by `db._TREE_CTE`, never stored). **public** is the synthetic `_PUBLIC_USER` (role
`"public"`) minted only for a valid `?share=` token.

`rbac` (`main.py`) uses three sets: `WRITE_ROLES = {"owner", "pm", "exec"}` may write at all,
`READ_ALL_ROLES = {"owner", "exec"}` read every project, and `WRITE_ALL_ROLES = {"owner"}` write to
every project. Everyone else is checked per project: `_user_owns_project` for writes,
`_user_can_read_project` (PM, co-PM or observer of the project, directly or through the tree) for reads.

| Actor | Read (project data) | Write (tasks/risks/collections/meta) | Admin (users, settings, digests) | Share (public link) |
|---|---|---|---|---|
| **owner** | all projects | all projects (`WRITE_ALL_ROLES`) | **Yes** — `require_owner` | Publish + read token on any project |
| **exec** | all projects (`READ_ALL_ROLES`) | own projects only, like a PM (`_user_owns_project`) | No | As a PM on own projects; elsewhere sees the config without the token |
| **pm** (primary PM of the project) | own, co-PM and observed projects | own projects only (`_user_owns_project`) | No | Publish + read token (`_is_primary_pm_or_owner`) |
| **co-PM** (in `editors`) | that project | that project (`_owns_item` counts `editors`) | No | Publish yes; **token redacted** in `GET /share` (not primary). Cannot add co-PMs or transfer (`_is_primary_pm_or_owner`) |
| **observer** (in `observers`) | that project (`_can_read_item`) | No — writes still require ownership → 403 | No | No — sees the config without the token |
| **public** (share token) | **only published sections of the one shared project, GET only** | No — `"public"` ∉ `WRITE_ROLES` | No | No |

Notes: the portfolio pages (`require_portfolio_view`) admit `owner`, `exec` and `pm`, but every handler
still filters to the projects that user may read. Ownership is cached ~30 s (`_OWNS_TTL`); transfer,
co-PM and observer changes must invalidate it (`_invalidate_project_ownership`,
`_invalidate_after_membership_change`) or the previous PM keeps access until TTL expiry.

## Security invariants — do not remove

1. **Bearer tokens are HMAC-SHA256 signed with `ADAPTER_SECRET`, carry a `jti` nonce and an 8h `exp`, and are revocable.** `make_token`/`read_token` (`security.py`) verify with `hmac.compare_digest`; the per-token `jti` makes two logins in the same second distinct so `logout` (`_revoke_token`/`_is_revoked`, keyed on the signature) revokes exactly one token. Never drop signature verification, the `jti`, the `exp` check, or revocation.
1a. **The browser keeps the bearer token in `localStorage`, deliberately.** `RDProject/frontend/src/store/authStore.ts` persists `{token, user}` under `auth-storage`. It used to be `sessionStorage`, which gave each browser tab its own copy: a link from a Bitrix chat, a bookmark, Ctrl+N or a restored tab all opened with an empty store and bounced the user to `/login` — with 2FA on, that meant password *and* a TOTP code per tab, and a few of those in a row hit the login rate limiter, so the portal looked broken. What `sessionStorage` bought was small: closing a tab never revoked anything, the token stays valid on the server for the full `TOKEN_TTL` (8h) either way, and neither storage area resists XSS — both are readable from JS. What it costs: a session now survives a browser restart, so on a shared unlocked machine the next person lands in the previous one's session until the token expires. The mitigations that matter are therefore server-side and must stay: the 8h `exp`, `logout` revocation by signature, and `is_active` checks on every request. The store also drops a token whose `exp` has passed before rehydrating it, and a `storage` listener signs every tab out when one of them logs out.

2. **`current_user` gates every request on account state and revocation.** It rejects unknown `sub`, `is_active=False` accounts (deactivated users cannot ride a still-valid 8h token — S1), tokens issued before the account's last password change (`pw_changed_at`), and revoked signatures. Keep all four checks.
3. **Passwords are bcrypt-hashed and verified/created off the event loop.** `verify_password` uses `bcrypt.checkpw` on `password_hash`; hashing (`_hash_pw`) and verification run via `asyncio.to_thread` in login and the admin/self password setters. Do not compare plaintext in prod paths, and do not move bcrypt onto the event loop.
4. **IDOR scoping: a child object must belong to the project in its path.** `_wp_in_project`, `_task_in_project`, `_risk_in_project`, and `_attachment_in_project` (`main.py`) verify ownership before mutate/download. Task/risk mutations validate the object id against the project before the first write; reorder validates **all** ids before writing any. Keep these checks in front of every `/{pid}/…/{childId}` operation.
5. **Public share is section-scoped, GET-only, and single-project; notes are never public.** `rbac`/`_resolve_public` accept `?share=` only for `GET`, only when `_path_section` maps the segment to a section that `_section_published` confirms is in the project's published list, and only for the token's own project. `_SECTION_BY_SEG` deliberately **omits `notes`** (S2) — internal notes must not leak via a share link. Unknown segments resolve to `None` (deny). The public passport is redacted unless `passport` is explicitly published.
6. **Secrets-at-rest are Fernet-encrypted.** The Bitrix webhook override and the SMTP password are stored as `enc:…` (`build_fernet`/`encrypt_secret`, key derived from `ADAPTER_SECRET`). UI views (`_bitrix_settings_view`, `_smtp_settings_view`) never return the token/password. Keep encryption on write and redaction on read. Assistant (MCP) tokens, OAuth authorization codes and refresh tokens are never stored in clear: only their SHA-256 hash is kept, and a token's value is shown once, at issue.
7. **Login is rate-limited.** `_rate_ok` (Redis or in-memory `_LOGIN_ATTEMPTS`) caps attempts per email per 60 s window (`LOGIN_MAX_ATTEMPTS`, default 10) and returns 429. Do not remove the limiter or the pre-password check.
8. **Production fails fast on default/missing secrets.** With `ADAPTER_ENV=production`, `enforce_prod_secrets` raises on: default or shorter-than-32-byte `ADAPTER_SECRET`, missing Fernet (secrets would be stored in clear), empty `users` table (seed accounts live), **a seed account still accepting its default password** (`_demo_credentials_live` — owner@company.com/admin123, pm1@company.com/pm123), `BITRIX24_WEBHOOK_URL` set without `BITRIX24_INBOUND_TOKEN`, and `FIREFLIES_ENABLED` without `FIREFLIES_WEBHOOK_SECRET` or `FIREFLIES_API_KEY`. Keep every branch, including the demo-password check.
9. **In-memory state is correct only with a single worker.** `_REVOKED`, `_LOGIN_ATTEMPTS`, and `_OWNS_TTL` are per-process. Run `--workers=1` **unless** `REDIS_URL` is set (shared revocation + rate-limit store). Multiple workers without Redis silently break token revocation and rate-limiting — do not raise worker count without provisioning Redis. (Scheduled jobs are already multi-worker-safe: `db.run_with_job_lock` wraps snapshot/digest firings in a Postgres advisory lock so exactly one worker runs each; the still-per-worker `USERS`/settings caches are the remaining reason single-worker is recommended.)

Supporting controls to preserve: only `WRITE_ROLES` write, and everyone except `owner` only to projects they own; CORS is restricted to `CORS_ORIGINS`; the Bitrix inbound webhook checks `BITRIX24_INBOUND_TOKEN`; uploads enforce a 25 MB cap (streamed, `_read_upload_limited` → 413) and an extension allowlist; `full_name`/title/code length and enum validation return 422; `_count_owners` guards prevent removing/deactivating the last owner.

## Assistant (MCP) access

- `/mcp` accepts only assistant tokens (`verify_api_token`), never the portal session token, and refuses them for deactivated accounts. A person issues a personal token in the profile (`POST /me/agent-tokens`: live portal session, at most five active, 90-day expiry); a claude.ai connector gets the same kind of token through the portal's own OAuth 2.1 + PKCE flow, approved by the person on the portal's consent page after the normal login (`oauth_provider.py`, `oauth_routes.py`). Refresh tokens are single-use (a replay revokes the whole chain), a chain ends after 365 days at most, and revoking a token in the profile revokes its chain too.
- Every token carries the scope `read` or `read+draft`. The writing tools (`create_project`, `propose_changes`) call `_require_draft_scope` first; an empty scope list counts as read-only, and a refresh can narrow the scopes but never widen them.
- The assistant reaches only projects the user leads — PM, co-PM or umbrella PM (`_owns_item`; `owner`: all) — **and** that were opened to it in the portal (`_agent_access`, closed by default; no assistant tool opens it — only a project the assistant creates itself starts open). Changes to an existing project are saved as a draft that a person with write access accepts in the portal; creating a new project is the only direct write.
- Auto-apply is an owner-only switch (`PUT /admin/settings/mcp`, off by default, only a literal `true` turns it on, every change is logged). While it is on, drafts proposed with an `owner` token that holds `draft` are accepted at once through the same accept path and leave a `draft.auto_accept` entry in the project log; drafts from every other role still wait for a person.

## Required regression tests — keep green

Run `python -m pytest tests -q`; all tests must pass. These directly cover the invariants above:

- `test_token_roundtrip`, `test_token_tampered_and_garbage`, `test_logout_revokes_token` — token signing / tamper rejection / revocation (inv. 1).
- `test_deactivated_user_token_rejected`, `test_no_token_401`, `test_login_and_me` — `current_user` state gate (inv. 2).
- `test_login_wrong_password`, `test_me_password_wrong_current_403`, `test_encrypt_secret_roundtrip` — bcrypt + secret-at-rest (inv. 3, 6).
- `test_task_and_risk_mutations_reject_foreign_object_ids`, `test_task_reorder_validates_all_ids_before_first_write`, `test_attachment_scope_denied`, `test_activity_scope_denied` — IDOR scoping (inv. 4).
- `test_public_project_redacts_passport_unless_explicitly_published`, `test_share_cfg_defaults`, `test_public_share_hides_access_lists` — public-share scoping / notes-not-public (inv. 5).
- `test_login_rate_limit` — rate limiting (inv. 7).
- `test_enforce_prod_secrets` — production fail-fast incl. demo-password check (inv. 8).
- `test_owner_can_write_any_project`, `test_pm_cannot_write_foreign_project_403`, `test_pm_read_scope_foreign_project_403`, `test_owns_item`, `test_owns_item_honors_editors`, `test_project_editors`, `test_observer_reads_but_never_writes`, `test_transfer_rejects_inactive_and_viewer`, `test_admin_users_rbac`, `test_rag_settings_rbac`, `tests/test_role_exec.py` — RBAC matrix (roles, editors, observers, exec, admin gate).
- `tests/test_mcp_scopes.py`, `tests/test_mcp_auto_apply.py`, `tests/test_admin_mcp_settings.py`, `tests/test_oauth_refresh.py`, `test_oauth_consent_requires_login` — assistant access (scopes, auto-apply, OAuth).

Also required per `CLAUDE.md`: openapi route-table diff vs baseline = 0, a byte-golden compare in which every snapshot matches (via `http://127.0.0.1:8002`), and writeflow passing every check for write paths.
