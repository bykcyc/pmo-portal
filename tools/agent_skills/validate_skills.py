#!/usr/bin/env python3
"""Validate portable PMO Agent Skills without third-party dependencies."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LINK_PATTERN = re.compile(r"\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)")
FORBIDDEN_MARKERS = (
    "${CLAUDE_",
    "CLAUDE_SKILL_DIR",
    "context: fork",
    "allowed-tools:",
    "trigger:",
)


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def skill_directories(source: Path) -> list[Path]:
    return sorted(
        (path for path in source.iterdir() if path.is_dir() and (path / "SKILL.md").is_file()),
        key=lambda path: path.name,
    )


def frontmatter(path: Path) -> tuple[dict[str, str], str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening frontmatter delimiter")

    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("missing closing frontmatter delimiter") from exc

    document: dict[str, str] = {}
    current_key: str | None = None
    block_value = False
    for line in lines[1:end]:
        if not line.strip():
            continue
        if line[:1].isspace():
            if current_key != "description" or not block_value:
                raise ValueError(f"unexpected indented frontmatter line: {line!r}")
            document[current_key] = f"{document[current_key]} {line.strip()}".strip()
            continue
        match = re.fullmatch(r"([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))?", line)
        if not match:
            raise ValueError(f"unsupported frontmatter line: {line!r}")
        current_key, value = match.groups()
        if current_key in document:
            raise ValueError(f"duplicate frontmatter key: {current_key}")
        value = (value or "").strip()
        block_value = value in {">", ">-", "|", "|-"}
        document[current_key] = "" if block_value else value

    return document, "\n".join(lines[end + 1 :])


def check_links(path: Path, root: Path, errors: list[str]) -> None:
    for target in LINK_PATTERN.findall(path.read_text(encoding="utf-8")):
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        destination = (path.parent / target).resolve()
        try:
            destination.relative_to(root)
        except ValueError:
            errors.append(f"{path}: link escapes project root: {target}")
            continue
        if not destination.exists():
            errors.append(f"{path}: missing linked target: {target}")


def validate_skill(skill: Path, root: Path) -> list[str]:
    errors: list[str] = []
    skill_file = skill / "SKILL.md"
    try:
        metadata, body = frontmatter(skill_file)
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return [f"{skill_file}: {exc}"]

    if set(metadata) != {"name", "description"}:
        errors.append(f"{skill_file}: frontmatter must contain only name and description")
    if metadata.get("name") != skill.name:
        errors.append(f"{skill_file}: name must match directory {skill.name!r}")
    if not NAME_PATTERN.fullmatch(skill.name):
        errors.append(f"{skill_file}: directory name is not lowercase kebab-case")
    if not metadata.get("description"):
        errors.append(f"{skill_file}: description must not be empty")
    if len(skill_file.read_text(encoding="utf-8").splitlines()) > 500:
        errors.append(f"{skill_file}: exceeds 500-line progressive-disclosure limit")

    for file in skill.rglob("*"):
        if not file.is_file():
            continue
        relative = file.relative_to(skill)
        if "__pycache__" in relative.parts or file.suffix == ".pyc":
            errors.append(f"{file}: generated cache is not allowed in a portable skill")
            continue
        if file.suffix.lower() in {".md", ".txt", ".py"}:
            text = file.read_text(encoding="utf-8")
            for marker in FORBIDDEN_MARKERS:
                if marker in text:
                    errors.append(f"{file}: portable skill contains forbidden marker {marker!r}")
            if file.suffix.lower() == ".md":
                check_links(file, root, errors)

    if not body.strip():
        errors.append(f"{skill_file}: body must not be empty")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate .agents/skills without PyYAML.")
    parser.add_argument("--root", type=Path, default=project_root(), help="PMO repository root")
    args = parser.parse_args()
    root = args.root.resolve()
    source = root / ".agents" / "skills"
    if not source.is_dir():
        print(f"ERROR: canonical skills directory is missing: {source}", file=sys.stderr)
        return 2

    skills = skill_directories(source)
    if not skills:
        print("ERROR: no skills found", file=sys.stderr)
        return 2

    errors: list[str] = []
    for skill in skills:
        errors.extend(validate_skill(skill, root))

    if errors:
        print("Portable skill validation failed:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Portable skill validation passed: {len(skills)} skill(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
