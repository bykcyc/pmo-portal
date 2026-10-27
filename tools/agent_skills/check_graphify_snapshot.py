#!/usr/bin/env python3
"""Fail safely when a Graphify snapshot refers to missing workspace sources."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def source_paths(graph: object) -> set[str]:
    if not isinstance(graph, dict):
        return set()
    nodes = graph.get("nodes", [])
    if not isinstance(nodes, list):
        return set()
    return {
        value.replace("\\", "/")
        for node in nodes
        if isinstance(node, dict)
        for value in [node.get("source_file")]
        if isinstance(value, str) and value.strip() and not value.startswith("<")
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Graphify graph.json source paths against the working tree.")
    parser.add_argument("--root", type=Path, default=project_root(), help="PMO repository root")
    parser.add_argument("--graph", type=Path, help="Path to graph.json (default: <root>/graphify-out/graph.json)")
    parser.add_argument("--limit", type=int, default=20, help="Maximum missing paths to print")
    args = parser.parse_args()
    root = args.root.resolve()
    graph_path = (args.graph or root / "graphify-out" / "graph.json").resolve()
    if not graph_path.is_file():
        print(f"ERROR: graph snapshot is missing: {graph_path}", file=sys.stderr)
        return 2
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read graph snapshot: {exc}", file=sys.stderr)
        return 2

    paths = source_paths(graph)
    missing: list[str] = []
    outside: list[str] = []
    for source in sorted(paths):
        candidate = (root / source).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            outside.append(source)
        else:
            if not candidate.exists():
                missing.append(source)

    if missing or outside:
        print(
            f"Graph snapshot is stale: {len(missing)} missing and {len(outside)} outside-root source path(s).",
            file=sys.stderr,
        )
        for path in (missing + outside)[: max(0, args.limit)]:
            print(f"- {path}", file=sys.stderr)
        return 1

    print(f"Graph snapshot source paths are current: {len(paths)} path(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
