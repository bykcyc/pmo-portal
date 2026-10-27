#!/usr/bin/env python3
"""Optional, low-noise Graphify hint hook for clients that support PreToolUse.

The repository keeps automatic hints disabled.  This adapter is intentionally
opt-in and only emits a hint before a broad local-search command when a graph
appears to be rooted in the current project.  A malformed hook payload never
blocks the developer's tool call.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


SEARCH_COMMAND = re.compile(r"(?:^|[;&|\s])(?:rg|grep|ripgrep|find|fd|ack|ag)(?:\s|$)", re.IGNORECASE)


def graph_is_usable(root: Path) -> bool:
    graph_dir = root / "graphify-out"
    graph = graph_dir / "graph.json"
    recorded_root = graph_dir / ".graphify_root"
    if not graph.is_file() or not recorded_root.is_file() or (graph_dir / ".needs_update").exists():
        return False
    try:
        return Path(recorded_root.read_text(encoding="utf-8").strip()).resolve() == root.resolve()
    except (OSError, ValueError):
        return False


def command_from(payload: dict[str, Any]) -> str:
    tool_input = payload.get("tool_input", payload)
    if not isinstance(tool_input, dict):
        return ""
    return str(tool_input.get("command", ""))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
        command = command_from(payload)
        root = Path.cwd()
        if not command or "graphify" in command.lower() or not SEARCH_COMMAND.search(command):
            return 0
        if not graph_is_usable(root):
            return 0
    except (OSError, ValueError, json.JSONDecodeError):
        return 0

    response = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": (
                "Graphify is available for a codebase-level question. Prefer one scoped "
                '`graphify query "<question>"`, `graphify path "<A>" "<B>"`, or '
                '`graphify explain "<concept>"` before a broad raw-file search. '
                "Use direct search for an exact known file or symbol."
            ),
        }
    }
    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
