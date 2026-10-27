# Portable Agent Skills adapters

## Canonical source and generated mirror

Project-owned Agent Skills have exactly one editable source:

```text
.agents/skills/<skill-name>/SKILL.md
```

`.claude/skills/` is a generated mirror for Claude Code. Do not edit files in
that directory by hand: changes will be detected as drift and protected from
being silently overwritten. Codex consumes the canonical `.agents/skills/`
directory directly, so it has no second mirror. Cursor should be configured to
discover the canonical directory where its local installation supports it;
create no `.cursor/skills` copy until such an adapter is actually required.

This separation keeps the skills portable while keeping MCP connections, LSP
providers, credentials, permissions, and client hooks out of `SKILL.md`.

## Synchronization

The synchronizer only uses the Python standard library and works on Windows,
macOS, and Linux. It never creates symlinks and it does not install tools.

```text
python tools/agent_skills/sync_agent_skills.py check
python tools/agent_skills/sync_agent_skills.py sync
```

The first migration must explicitly adopt any pre-existing Claude copy. Run it
for one skill at a time so that an unmanaged user skill cannot be replaced by
accident:

```text
python tools/agent_skills/sync_agent_skills.py sync --skill graphify --adopt-existing
python tools/agent_skills/sync_agent_skills.py sync
python tools/agent_skills/sync_agent_skills.py check
```

If a managed mirror was intentionally edited, review the difference first and
then use the narrow repair command below. The previous mirror is copied into
`.claude/skills/.pmo-agent-skills-backups/` before it is replaced.

```text
python tools/agent_skills/sync_agent_skills.py sync --skill graphify --force-managed
```

Useful safe checks:

```text
python tools/agent_skills/sync_agent_skills.py sync --dry-run
python tools/agent_skills/sync_agent_skills.py check --skill graphify
```

The generated manifest `.claude/skills/.pmo-agent-skills-sync.json` records
content hashes, not credentials or private data. A non-zero `check` result is
appropriate for CI and pre-merge verification.

## Client adapters

| Client | Skill discovery | Project policy |
| --- | --- | --- |
| Codex | `.agents/skills/` | Canonical source; no duplicate skill folder. |
| Claude Code | `.claude/skills/` | Generated mirror, updated only by this synchronizer. |
| Cursor | Canonical source where supported | Keep no copy by default; add a dedicated adapter only after local discovery is verified. |

`AGENTS.md`, `CLAUDE.md`, and client hooks are deliberately not used as a
second skill registry. They contain only durable project rules or optional
client behavior.

## Validation

Validate the canonical skills before synchronizing them:

```text
python tools/agent_skills/validate_skills.py
```

The validator uses only the Python standard library. It checks folder/name
consistency, minimal frontmatter, relative links, portable markers, generated
caches, and the progressive-disclosure line limit.

Check Graphify output before trusting it for navigation:

```text
python tools/agent_skills/check_graphify_snapshot.py
```

A non-zero result means that source paths in the snapshot no longer match the
working tree. Do not run a clean rebaseline on a dirty worktree that contains
unrelated user changes; preserve or finish those changes first.

## Hooks

The historical broad Graphify PreToolUse hooks are disabled because they were
POSIX-specific and added context to nearly every read/search. The optional
`graphify_pretool_hint.py` adapter is available for a client-specific opt-in;
it is intentionally not enabled by default. It emits one hint only for a broad
search and only if `graphify-out/.graphify_root` points at the current project.

No adapter in this directory configures Context7, GitHub MCP, Playwright,
Python LSP, OAuth, API tokens, or permissions. Those are host-level client
integrations and must be configured outside the repository's portable skills.

## Host integrations

- **Python LSP:** open `pmo-backend` as its own workspace and use its
  `pyrightconfig.json` target. The client may supply Pyrite, Pyright, or
  another compatible language server; no provider binary is committed here.
- **Superpowers:** install the selected upstream plugin once per client. It is
  the sole behavioural workflow; `pmo-feature-delivery` is only a PMO adapter.
- **Context7 and GitHub MCP:** configure connections and OAuth or tokens in
  each client's local settings. Keep GitHub read-only by default and never put
  credentials, URLs containing secrets, or permission grants in this repo.
- **Playwright:** use the repository's existing test configuration and
  container runtime; do not install frontend dependencies on the host merely
  to run a browser test.

### Per-client setup checklist

These capabilities are configured once inside each client (Claude Code, Codex,
Cursor) and never in this repository, so no credential or connection ever lands
in a portable skill. Each capability already has a project policy skill that
consumes it; do not install a second generic skill that would compete for the
same trigger.

| Capability | Enable once per client | Consumed by (do not duplicate) | Secrets |
| --- | --- | --- | --- |
| Superpowers | Install the upstream behavioural plugin; confirm it pulls no competing lifecycle (no Caveman, Karpathy). | `pmo-feature-delivery`, `pmo-refactor`, `pmo-python-analysis` defer planning to it | none |
| Python LSP | Point the client language server at the `pmo-backend` workspace and its `pyrightconfig.json` (Python 3.11). Pyrite, Pyright, or any compatible server. | `pmo-python-analysis` | none |
| Context7 | Configure the MCP connection and its OAuth or token in the client's local settings. | `pmo-library-docs` | token/OAuth in the client only |
| GitHub MCP | Configure the MCP and token; keep it read-only by default. | `pmo-github-workflow` | token in the client only |
| Playwright | Use `RDProject/frontend/playwright.config.ts` and the isolated `C:\pw-runner` runner; do not install frontend dependencies on the host. | `pmo-playwright-e2e` | none |

Skill discovery itself is already handled by the client-adapter table above
(Codex reads `.agents/skills/`, Claude Code the generated mirror, Cursor the
canonical source). Configuring a capability does not require any change here.

Verify each capability by exercising it once, not by inspecting a config file:
resolve a `pmo-backend` symbol through the LSP, retrieve one dependency doc
through Context7, read a pull request through the GitHub MCP, and run one
`pmo-playwright-e2e` smoke flow. Portable-skill health is separate and is
checked with `validate_skills.py`, `sync_agent_skills.py check`, and
`check_graphify_snapshot.py`.

Do not install generic capability skills (`code-review`, `security`,
`feature-dev`, `simplifier`, `skill-creator`, or a second `python-lsp` skill).
The PMO versions already encode this project's invariants — byte-compatible API,
RBAC, metadata limits — so a generic duplicate would win a trigger without that
context and reintroduce the prompt dilution this layout avoids.
