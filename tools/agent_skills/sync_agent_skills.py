#!/usr/bin/env python3
"""Synchronize portable Agent Skills into a Claude Code mirror safely.

The canonical project skills live in ``.agents/skills``.  Claude Code also
discovers project skills in ``.claude/skills``; this utility makes that folder
a generated mirror without symlinks or client-specific source copies.

It deliberately never overwrites an unmanaged mirror.  Adoption and repair of
manually changed managed mirrors both require an explicit flag and produce a
backup before replacement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MANIFEST_NAME = ".pmo-agent-skills-sync.json"
BACKUP_DIR_NAME = ".pmo-agent-skills-backups"
SCHEMA_VERSION = 1
IGNORED_PARTS = {"__pycache__", ".git", ".DS_Store"}


class SyncError(RuntimeError):
    """Raised when a mirror cannot be safely inspected or updated."""


@dataclass(frozen=True)
class Skill:
    """A portable skill directory and its content digest."""

    name: str
    path: Path
    digest: str


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_from_root(root: Path, value: str) -> Path:
    candidate = Path(value)
    return candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()


def relative_to_root(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def ignored(relative: Path) -> bool:
    return any(part in IGNORED_PARTS for part in relative.parts) or relative.suffix == ".pyc"


def iter_skill_files(skill_dir: Path) -> Iterable[Path]:
    for path in sorted(skill_dir.rglob("*"), key=lambda item: item.as_posix()):
        relative = path.relative_to(skill_dir)
        if ignored(relative):
            continue
        if path.is_symlink():
            raise SyncError(f"Symlinks are not portable in a mirrored skill: {path}")
        if path.is_file():
            yield path


def tree_digest(skill_dir: Path) -> str:
    hasher = hashlib.sha256()
    for path in iter_skill_files(skill_dir):
        relative = path.relative_to(skill_dir).as_posix().encode("utf-8")
        hasher.update(relative)
        hasher.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        hasher.update(b"\0")
    return hasher.hexdigest()


def discover_skills(source: Path) -> dict[str, Skill]:
    if not source.is_dir():
        raise SyncError(f"Canonical skills directory is missing: {source}")

    skills: dict[str, Skill] = {}
    for child in sorted(source.iterdir(), key=lambda item: item.name):
        if child.name.startswith(".") or not child.is_dir():
            continue
        if not (child / "SKILL.md").is_file():
            continue
        skills[child.name] = Skill(child.name, child, tree_digest(child))
    return skills


def read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "skills": {}}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"Cannot read sync manifest {path}: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("skills", {}), dict):
        raise SyncError(f"Invalid sync manifest: {path}")
    return document


def write_manifest(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def selected_skills(all_skills: dict[str, Skill], requested: list[str] | None) -> dict[str, Skill]:
    if not requested:
        return all_skills
    missing = sorted(set(requested).difference(all_skills))
    if missing:
        raise SyncError(f"Unknown canonical skill(s): {', '.join(missing)}")
    return {name: all_skills[name] for name in dict.fromkeys(requested)}


def copy_skill(source: Path, destination: Path) -> None:
    def ignore(_: str, names: list[str]) -> set[str]:
        return {name for name in names if name in IGNORED_PARTS or name.endswith(".pyc")}

    shutil.copytree(source, destination, ignore=ignore, symlinks=False)


def unique_backup_path(backup_root: Path, name: str) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = backup_root / timestamp / name
    counter = 1
    while candidate.exists():
        candidate = backup_root / timestamp / f"{name}-{counter}"
        counter += 1
    return candidate


def backup_skill(destination: Path, backup_root: Path) -> Path:
    target = unique_backup_path(backup_root, destination.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(destination, target, symlinks=False)
    return target


def replace_with_staged(staged: Path, destination: Path) -> None:
    """Replace a directory while retaining a rollback path until replacement works."""

    old_destination: Path | None = None
    if destination.exists():
        old_destination = destination.with_name(f".{destination.name}.sync-old-{uuid.uuid4().hex}")
        destination.rename(old_destination)
    try:
        staged.rename(destination)
    except Exception:
        if old_destination and old_destination.exists() and not destination.exists():
            old_destination.rename(destination)
        raise
    if old_destination and old_destination.exists():
        shutil.rmtree(old_destination)


def status_for_skill(skill: Skill, mirror: Path, manifest_skills: dict[str, Any]) -> tuple[str, str]:
    destination = mirror / skill.name
    entry = manifest_skills.get(skill.name)
    if not destination.exists():
        return "missing", "mirror directory is missing"
    if not destination.is_dir():
        return "conflict", "mirror path is not a directory"
    destination_digest = tree_digest(destination)
    if not isinstance(entry, dict):
        return "unmanaged", "mirror exists but is not managed by this synchronizer"
    if destination_digest != skill.digest:
        return "drift", "mirror content differs from the canonical skill"
    if entry.get("source_digest") != skill.digest or entry.get("mirror_digest") != destination_digest:
        return "manifest", "mirror matches source but the manifest is stale"
    return "ok", "mirror matches canonical source"


def check(root: Path, source: Path, mirror: Path, requested: list[str] | None, quiet: bool) -> int:
    skills = selected_skills(discover_skills(source), requested)
    manifest_path = mirror / MANIFEST_NAME
    manifest = read_manifest(manifest_path)
    manifest_skills = manifest.get("skills", {})
    failures = 0

    for skill in skills.values():
        state, detail = status_for_skill(skill, mirror, manifest_skills)
        if state != "ok":
            failures += 1
        if not quiet:
            print(f"[{state.upper()}] {skill.name}: {detail}")

    stale = sorted(set(manifest_skills).difference(discover_skills(source)))
    for name in stale:
        failures += 1
        if not quiet:
            print(f"[STALE] {name}: managed mirror has no canonical source; kept conservatively")

    if not quiet:
        if failures:
            print(f"Skill mirror check failed: {failures} issue(s).")
        else:
            print(f"Skill mirror is current: {len(skills)} skill(s).")
    return 0 if failures == 0 else 1


def sync(
    root: Path,
    source: Path,
    mirror: Path,
    requested: list[str] | None,
    adopt_existing: bool,
    force_managed: bool,
    dry_run: bool,
    quiet: bool,
) -> int:
    if (adopt_existing or force_managed) and not requested:
        raise SyncError("--adopt-existing and --force-managed require one or more --skill values")

    all_skills = discover_skills(source)
    skills = selected_skills(all_skills, requested)
    mirror.mkdir(parents=True, exist_ok=True)
    manifest_path = mirror / MANIFEST_NAME
    manifest = read_manifest(manifest_path)
    manifest_skills: dict[str, Any] = dict(manifest.get("skills", {}))
    backup_root = mirror / BACKUP_DIR_NAME
    conflicts = 0
    changed = False

    for skill in skills.values():
        destination = mirror / skill.name
        entry = manifest_skills.get(skill.name)
        destination_digest = tree_digest(destination) if destination.is_dir() else None
        needs_copy = destination_digest != skill.digest
        backup_needed = False

        if destination.exists() and not destination.is_dir():
            conflicts += 1
            if not quiet:
                print(f"[CONFLICT] {skill.name}: destination is not a directory")
            continue

        if destination.exists() and not isinstance(entry, dict):
            if not adopt_existing:
                conflicts += 1
                if not quiet:
                    print(
                        f"[CONFLICT] {skill.name}: unmanaged mirror; use "
                        f"--skill {skill.name} --adopt-existing to back it up and adopt it"
                    )
                continue
            backup_needed = needs_copy

        if destination.exists() and isinstance(entry, dict):
            expected = entry.get("mirror_digest")
            changed_by_user = expected is not None and destination_digest != expected
            if changed_by_user and needs_copy:
                if not force_managed:
                    conflicts += 1
                    if not quiet:
                        print(
                            f"[CONFLICT] {skill.name}: managed mirror was edited; use "
                            f"--skill {skill.name} --force-managed to back it up and replace it"
                        )
                    continue
                backup_needed = True

        if dry_run:
            action = "copy" if needs_copy else "adopt manifest"
            suffix = " with backup" if backup_needed else ""
            if not quiet:
                print(f"[DRY RUN] {skill.name}: {action}{suffix}")
            continue

        if backup_needed:
            backup = backup_skill(destination, backup_root)
            if not quiet:
                print(f"[BACKUP] {skill.name}: {relative_to_root(backup, root)}")

        if needs_copy:
            staging_root = Path(tempfile.mkdtemp(prefix=".pmo-skills-sync-", dir=mirror.parent))
            staged = staging_root / skill.name
            try:
                copy_skill(skill.path, staged)
                replace_with_staged(staged, destination)
            finally:
                shutil.rmtree(staging_root, ignore_errors=True)
            if not quiet:
                print(f"[SYNCED] {skill.name}")
        elif not quiet:
            print(f"[ADOPTED] {skill.name}: existing content already matches canonical")

        mirror_digest = tree_digest(destination)
        manifest_skills[skill.name] = {
            "source_digest": skill.digest,
            "mirror_digest": mirror_digest,
        }
        changed = True

    if changed and not dry_run:
        manifest.update(
            {
                "schema_version": SCHEMA_VERSION,
                "canonical_source": relative_to_root(source, root),
                "mirror": relative_to_root(mirror, root),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "skills": manifest_skills,
            }
        )
        write_manifest(manifest_path, manifest)

    if not quiet:
        if conflicts:
            print(f"Synchronization completed with {conflicts} protected conflict(s).")
        elif dry_run:
            print("Dry run completed without writes.")
        else:
            print(f"Synchronization completed for {len(skills)} skill(s).")
    return 2 if conflicts else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Mirror .agents/skills into .claude/skills without symlinks or unsafe overwrites."
    )
    parser.add_argument("--root", default=str(project_root()), help="Project root (default: repository containing this script)")
    parser.add_argument("--source", default=".agents/skills", help="Canonical skills directory, relative to --root")
    parser.add_argument("--mirror", default=".claude/skills", help="Generated Claude mirror, relative to --root")
    parser.add_argument("--quiet", action="store_true", help="Only report errors")

    commands = parser.add_subparsers(dest="command", required=True)
    check_parser = commands.add_parser("check", help="Verify mirror content and manifest")
    check_parser.add_argument("--skill", action="append", help="Check only this skill (repeatable)")

    sync_parser = commands.add_parser("sync", help="Copy missing or outdated managed skills")
    sync_parser.add_argument("--skill", action="append", help="Sync only this skill (repeatable)")
    sync_parser.add_argument(
        "--adopt-existing",
        action="store_true",
        help="Adopt a selected unmanaged mirror; backs it up before replacement when it differs",
    )
    sync_parser.add_argument(
        "--force-managed",
        action="store_true",
        help="Replace a selected manually edited managed mirror after creating a backup",
    )
    sync_parser.add_argument("--dry-run", action="store_true", help="Show planned actions without writing")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    source = resolve_from_root(root, args.source)
    mirror = resolve_from_root(root, args.mirror)
    try:
        if args.command == "check":
            return check(root, source, mirror, args.skill, args.quiet)
        return sync(
            root,
            source,
            mirror,
            args.skill,
            args.adopt_existing,
            args.force_managed,
            args.dry_run,
            args.quiet,
        )
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 3
    except OSError as exc:
        print(f"ERROR: filesystem operation failed: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
