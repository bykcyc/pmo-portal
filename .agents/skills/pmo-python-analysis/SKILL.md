---
name: pmo-python-analysis
description: Analyze Python symbols, types, imports, and backend change impact in pmo-backend. Use for precise local Python navigation or diagnostics; use library documentation only for third-party APIs and Graphify for repository topology.
---

# PMO Python analysis

1. Start with one concrete symbol, behaviour, or diagnostic. Open `pmo-backend` as the workspace and honor its `pyrightconfig.json` Python 3.11 target. Detect an available Python Language Server rather than assuming a particular Pyrite or Pyright binary; use narrow text search only when no language service is available.
2. Use Graphify first when the question is about cross-module topology or dependency paths rather than a known symbol.
3. Before changing routes, persistence, serialization, or project metadata, read [the backend contract](../../../pmo-backend/CLAUDE.md) and, for schema work, [the canonical schema](../../../pmo-backend/schema.sql).
4. Preserve string API IDs, `TEXT` dates, `json` serialization order, response shapes, collection ordering, and the 60 KiB project-meta limit unless an approved migration changes the contract.
5. Keep imports side-effect free. For unknown library behaviour, hand off only the package, installed version, and symbol to `pmo-library-docs`.
6. Report the affected symbols and assumptions before proposing a broad change. When the analysis leads into a multi-step change, let Superpowers own planning rather than starting a competing behavioural workflow. Run the smallest relevant validation, then the required backend and contract checks when a compatibility boundary changes.
