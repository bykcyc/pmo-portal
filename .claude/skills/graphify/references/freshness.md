# Graph freshness guard

Load this reference before treating Graphify output as evidence. The guard is
read-only: it must not install tools, update generated files, or change source.

## Minimal inspection

Inspect only the following artifacts first:

- `graphify-out/graph.json`;
- `graphify-out/manifest.json`, when present;
- `graphify-out/.graphify_root`, when present.

Resolve the recorded graph root relative to the current workspace. A graph is
not reusable when it was created for a different repository or a different
subtree.

Do not read the whole graph or `GRAPH_REPORT.md` to perform this check. Read
metadata and a small, varied sample of source paths instead.

## Verification checklist

1. Confirm that `graph.json` exists and is non-empty.
2. Confirm that the recorded root, if any, resolves to the current workspace.
3. Sample up to three source paths from `manifest.json` or from the intended
   graph result. Confirm that those paths still exist in the working tree.
4. Check whether the graph refers to removed, renamed, or duplicate top-level
   directories. One such reference is enough to mark the graph stale for that
   area.
5. If version control is available, check for relevant changed, deleted, or
   untracked files after the graph was produced. Treat them as a freshness risk
   even when timestamps are inconclusive.
6. Check the graph result's source paths before using it for a material claim.
   A node without a current source path is only a discovery hint.

## Verdicts

| Verdict | Conditions | Allowed use |
| --- | --- | --- |
| **Fresh** | Same root, valid graph, sampled sources exist, no relevant drift found | Use scoped graph output, then verify cited source for material claims. |
| **Suspect** | Graph exists but current edits or incomplete metadata may affect the answer | Use only to find candidate files; verify all relationships in current source. |
| **Stale** | Missing graph, wrong root, missing source paths, obsolete subtree, or duplicate legacy nodes | Do not rely on graph conclusions. Use repository search and the language server. |

## Required response on stale data

State the limitation succinctly, for example: `Graph data is stale for this
area; I am using the current working tree instead.` Do not silently rebuild or
hide the mismatch. A clean rebaseline is a separate, authorized maintenance
operation; see [maintenance.md](maintenance.md).

## Evidence rule

Freshness means that the graph is suitable for navigation, not that it is
authoritative. Current source code, tests, and runtime behaviour always take
precedence over generated graph data.
