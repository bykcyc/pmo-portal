# PMO agent guidance

## Navigation and skills

- Treat `.agents/skills/` as the canonical source of portable project skills. Client-specific mirrors are generated artifacts and must not be edited by hand.
- Treat Superpowers as the sole behavioural workflow when it is installed. Do not add Caveman, Karpathy, or another competing planning/TDD lifecycle to this project.
- Use Graphify only for unfamiliar cross-module architecture, dependency paths, or change impact. Start with `graphify query "<question>"`; use `path` only between confirmed nodes and `explain` for one focused concept.
- Treat the graph as tentative when it returns duplicate or missing source paths. Validate returned files with a scoped read, LSP, or `rg`; do not use `GRAPH_REPORT.md` unless a scoped query is insufficient.
- For a known local symbol, type, import, or reference, use LSP or a scoped text search instead of Graphify. For third-party API semantics or version-specific behavior, use Context7 only after identifying the dependency and version.
- Do not update Graphify during read-only work. After structural changes to source topology (files, imports/exports, public symbols, routers, or schema), follow the Graphify maintenance procedure; after ignore-policy changes, perform a clean rebaseline rather than relying on an incremental update.

## Backend compatibility contract

- PostgreSQL in `pmo-backend/schema.sql` is canonical. OpenProject-shaped dictionaries in `db.py` are compatibility shims, not an external dependency.
- Preserve string IDs, TEXT date columns, JSON (not JSONB), work-package response shapes, ordering, and the 60 KiB project-meta cap unless a versioned migration is explicitly approved.
- Refactors must keep API bodies byte-compatible. Run backend tests, frontend tests/build, and the API golden comparison after each structural step.
- Avoid import-time I/O. If `main.py` is split, extract state/meta/security first; move routers only afterward and compare the route table at every step.
- Prefer scoped SQL operations over whole-table delete/reinsert stores. Never reintroduce `_counts` or baselines into project metadata.
