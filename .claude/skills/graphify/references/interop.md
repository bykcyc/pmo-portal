# Graphify, LSP, and external documentation

Use these tools as a pipeline, not as interchangeable sources of truth.

```text
Unknown local topology -> Graphify -> exact local symbol -> language server
External API uncertainty -> dependency manifest -> documentation retrieval
```

## Responsibilities

| Tool | Owns | Does not own |
| --- | --- | --- |
| Graphify | Local architecture, module relationships, dependency paths, impact candidates | Exact symbol semantics, types, external APIs |
| Python LSP | Definitions, references, call sites, imports, types, diagnostics | Broad cross-repository topology or third-party documentation |
| Context7 or equivalent docs tool | Version-specific third-party APIs and configuration | Local source discovery, product business logic, or dependency mapping |

## Handoff protocol

1. Use Graphify only when the local topology is unknown or cross-module impact
   is needed. Its output should be a short candidate file/module list and
   relationship hypothesis.
2. Use the language server on those files to resolve definitions, references,
   imports, types, and diagnostics in the current checkout.
3. Use external documentation only when a question remains about a third-party
   package or framework. Supply the exact package, installed version, symbol,
   and focused question from the dependency manifest or lockfile.
4. Verify an implementation with the repository's tests. Runtime behaviour and
   current source outrank graph data and documentation summaries.

## Skip unnecessary activation

- A known local symbol: start with the language server; do not activate
  Graphify.
- A simple local text or filename search: use repository search; do not
  activate Graphify or documentation retrieval.
- An external API question with no local topology question: use the dependency
  manifest and documentation retrieval directly.
- A stale graph: use repository search plus the language server, not a graph
  repair or broad documentation lookup.

This separation keeps graph extraction, symbol resolution, and documentation
retrieval small, independently verifiable, and token-efficient.
