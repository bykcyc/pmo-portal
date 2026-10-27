---
name: pmo-github-workflow
description: Inspect PMO GitHub repositories, pull requests, issues, reviews, and checks through a configured GitHub integration. Use for repository collaboration tasks; default to read-only and require explicit authority before any issue, comment, pull request, merge, label, or other write action.
---

# PMO GitHub workflow

1. Confirm the repository, branch or pull request, and requested outcome before accessing remote state. Use read-only inspection by default.
2. Gather only the relevant commits, changed files, checks, discussions, and linked issues. Distinguish repository evidence from local working-tree state.
3. Request explicit user authority immediately before creating, editing, closing, labeling, commenting on, approving, merging, or deleting any remote object. State the exact target and irreversible effect.
4. Never expose, persist, or request credentials, tokens, private keys, or client configuration. Use the configured integration without embedding client-specific commands in this skill.
5. For a code review, apply `pmo-code-review`; for security-sensitive changes, apply `pmo-security-review`. Do not represent a local test result as a remote CI result or vice versa.
6. Report remote actions, links or identifiers, observed check status, and any remaining local validation required.
