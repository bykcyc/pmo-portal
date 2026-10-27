---
name: pmo-skill-authoring
description: Create, revise, validate, or simplify portable PMO Agent Skills. Use only when a user explicitly asks to design or change a SKILL.md; do not invoke for normal application implementation.
---

# PMO skill authoring

1. Identify the concrete reusable workflow, positive trigger examples, near-miss negatives, and the canonical scope before creating a skill.
2. Check existing skills and client capabilities first. Do not duplicate a reliable language server, MCP integration, bundled capability, or another behavioural workflow without a project-specific gap.
3. Use a lowercase kebab-case directory and matching `name`. Keep frontmatter limited to `name` and a precise `description` that states both activation boundary and purpose.
4. Keep the body procedural and concise. Put rare, lengthy, or variant-specific material in a directly linked reference only when it materially reduces activation context.
5. Keep canonical skills cross-platform: no client-only syntax, shell-specific commands, credentials, or hidden side effects. Reserve client adapters for discovery and integration details; syncing a skill to its client mirrors and adapters is `pmo-guidance-sync`, not this skill.
6. Validate YAML, directory/name consistency, relative links, trigger quality, and collision risk before handoff. Test the skill against at least one intended request and one near miss when practical.
