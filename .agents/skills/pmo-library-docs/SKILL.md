---
name: pmo-library-docs
description: Retrieve precise third-party library documentation for PMO dependencies. Use when an external package API, version-specific behaviour, or framework contract is unknown; do not use for local repository navigation or business logic.
---

# PMO library documentation

1. Identify the exact package, installed version, symbol, and question from the local manifest before requesting documentation. Use `pmo-backend/requirements.txt` for Python and `RDProject/frontend/package.json` for frontend dependencies.
2. Query configured Context7 when available, or another approved documentation provider, with that narrow request. Return the source and the minimal behaviour needed to make a decision.
3. Treat the checked-in manifest, lock state, and runtime behaviour as authoritative when they differ from generic documentation.
4. Do not use external documentation to infer PMO business rules or local architecture. Use Graphify for topology and the relevant language analysis skill for symbols.
5. Validate any implementation based on external documentation with the project's tests; never paste credentials, private code, or production data into a documentation query.
