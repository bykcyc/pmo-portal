# Scoped graph queries

Load this reference only after the freshness guard permits graph use. Graph
queries are read-only and should return the smallest useful subgraph.

## Select one operation

| Need | Operation |
| --- | --- |
| Broad local context around a subsystem or concern | `query` |
| Shortest relationship between two known concepts | `path` |
| Context for one known graph node | `explain` |

Use one operation at a time. Narrow the question before increasing the token
budget or issuing a second query.

```text
graphify query "<focused local-codebase question>" --budget 1200
graphify path "<source concept>" "<target concept>"
graphify explain "<one concept>"
```

The command examples are shell-neutral. Use the current environment's normal
command runner; do not embed shell-specific setup, interpreter discovery, or
client directives in this skill.

## Interpret the result

1. Extract only the relevant nodes, edges, and their source paths.
2. Open the cited current source before treating a relationship as fact.
3. Identify whether the result is structural evidence or an inferred edge.
4. Return a concise answer containing: the conclusion, the source paths, the
   freshness verdict, and any uncertainty.

Do not paste `graph.json`, `GRAPH_REPORT.md`, a full community listing, or a
raw traversal into the conversation.

## When a query does not help

If the CLI is unavailable, the graph has no matching node, or the result lacks
current source paths, do not recreate a custom graph traversal inline. Fall
back to repository search for local text and the language server for symbols,
references, types, and diagnostics. State that fallback briefly.

## No feedback writes

Never use query results to append answers, notes, or inferred relationships to
the graph during normal navigation. Generated graph content must remain
separate from analysis until a user explicitly requests a maintained rebuild.
