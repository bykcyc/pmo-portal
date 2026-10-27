---
name: pmo-guidance-sync
description: Maintain PMO repository guidance and synchronize portable skills to their cross-client adapters. Use only for an explicit request to update AGENTS.md or CLAUDE.md, or to sync skills to their client mirrors and adapters; author or change a skill's own SKILL.md with pmo-skill-authoring. Do not activate for ordinary application-code work.
---

# PMO guidance synchronization

1. Treat [AGENTS.md](../../../AGENTS.md) as the durable cross-client project contract and `.agents/skills` as the canonical portable skill source.
2. Keep client-specific files as narrow adapters or discovery pointers. Do not duplicate policies manually, add credentials, or turn client configuration into a second source of truth.
3. Read every source and target before editing. Preserve unrelated local settings, user-owned hooks, and existing client integrations.
4. Keep portable instructions platform-neutral: use relative paths, describe intent rather than shell syntax, and avoid client-only directives in canonical skills.
5. Validate changed links, frontmatter, discovery paths, and the generated or mirrored content. Report the source-of-truth path and any intentionally unsupported client capability.
