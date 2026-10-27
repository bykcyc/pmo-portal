---
name: graphify
description: >-
  Map a local codebase when a task needs architecture, dependency paths,
  cross-module impact analysis, or orientation in an unfamiliar subsystem.
  Verify graph freshness, then use a narrow graphify query, path, or explain
  request. Do not use for external-library documentation, known-symbol
  navigation, routine file lookup, or automatic graph rebuilding.
---

# Graphify

Use Graphify as a **local structural map**, not as a replacement for source
code, an LSP, tests, or external documentation.

## Scope and boundaries

Use this skill when the question needs one of the following:

- a subsystem map or an architecture overview;
- a dependency path between modules, concepts, or boundaries;
- cross-module impact analysis before changing code;
- orientation in a component whose location or relationships are unknown.

Do not use it for:

- a known symbol's definition, references, type, or diagnostics;
- a simple filename or literal-text search;
- third-party API documentation or version-specific framework behaviour;
- rebuilding a graph merely because one exists;
- writing graph feedback, hooks, configuration, or installation state.

## Default routing

1. Run the read-only checks in [references/freshness.md](references/freshness.md).
2. If the graph is **fresh**, use one scoped operation from
   [references/query.md](references/query.md).
3. If it is **suspect**, use the graph only as a navigation hint and confirm
   every material claim in current source.
4. If it is **stale** or unavailable, say so, then use repository search and
   the language server instead. Do not repair the graph during a read-only
   task.
5. Hand off from graph topology to exact symbol analysis and external docs as
   described in [references/interop.md](references/interop.md).

## Query discipline

- Start with one question and the smallest useful token budget.
- Prefer `query` for local context, `path` for a concrete relationship, and
  `explain` for one graph node.
- Keep graph output bounded; do not load or paste the entire graph or report.
- Treat a graph edge as evidence of a possible relationship, not proof of
  current behaviour. Verify the cited source before making a consequential
  recommendation or code change.
- Report graph freshness and the source paths that support the answer.
- Do not persist answers back into the graph: query work is read-only by
  default.

## Maintenance boundary

Graph maintenance is a generated-artifact write operation. Load
[references/maintenance.md](references/maintenance.md) only when the user
explicitly asks for it or an applicable project policy requires an update after
verified code changes.

Never install Graphify, create hooks, start watchers, fetch remote content, or
perform a full rebuild implicitly.

## Progressive disclosure

Load only the reference needed for the current task:

| Need | Reference |
| --- | --- |
| Decide whether graph data is safe to use | [freshness.md](references/freshness.md) |
| Ask `query`, `path`, or `explain` | [query.md](references/query.md) |
| Update or rebaseline generated graph data | [maintenance.md](references/maintenance.md) |
| Coordinate Graphify with LSP and external docs | [interop.md](references/interop.md) |
