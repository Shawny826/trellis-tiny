"""Which files tiny-trellis owns in a project, and how init updates them safely.

`.trellis/tiny/config.json` records the installed version and platforms;
`.trellis/tiny/manifest.json` records the hash of every file tiny-trellis wrote
whole (its own code, skills, reviewer agents). On init, an owned file is
overwritten only when it still matches the recorded hash; a file the user changed
stops init unless --force (back up, then overwrite) or --keep (leave it) is given.
Hashes ignore CRLF versus LF, so a checkout with autocrlf does not look edited.
"""
from __future__ import annotations

import datetime
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .errors import TinyError
from .files import read_optional, write_exact
from .project import Project

OPTIONAL_PREFIXES = (".claude/skills/", ".agents/skills/", ".claude/agents/", ".codex/agents/")
BACKUP_PREFIX = ".backup-"


@dataclass(frozen=True)
class UpdateOptions:
    force: bool
    keep: bool


@dataclass
class OwnershipPlan:
    writes: list = field(default_factory=list)
    backups: list = field(default_factory=list)
    retired: list = field(default_factory=list)
    kept: list = field(default_factory=list)
    user_deleted: list = field(default_factory=list)
    retired_but_changed: list = field(default_factory=list)
    manifest: dict = field(default_factory=dict)


def digest(text: str) -> str:
    return hashlib.sha256(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def config_path(project: Project) -> Path:
    return project.tool / "config.json"


def manifest_path(project: Project) -> Path:
    return project.tool / "manifest.json"


def load_config(project: Project) -> dict | None:
    """The recorded installation, or None when tiny-trellis was never installed here."""
    text = read_optional(config_path(project))
    if text is None:
        return None
    config = _parse_json(text, project.relative(config_path(project)))
    if not isinstance(config.get("version"), str) or not isinstance(config.get("platforms"), list):
        raise TinyError(f"{project.relative(config_path(project))} needs a version and platforms")
    return config


def load_manifest(project: Project) -> dict:
    text = read_optional(manifest_path(project))
    return {} if text is None else _parse_json(text, project.relative(manifest_path(project)))


def compare_versions(left: str, right: str) -> int:
    def parts(version: str) -> tuple:
        try:
            return tuple(int(part) for part in version.split("."))
        except ValueError as error:
            raise TinyError(f"cannot compare version {version!r}") from error
    a, b = parts(left), parts(right)
    return (a > b) - (a < b)


def plan_owned(project: Project, owned: list, manifest: dict, options: UpdateOptions,
               read) -> OwnershipPlan:
    plan = OwnershipPlan()
    conflicts = []
    for write in owned:
        relative = project.relative(write.path)
        current, recorded = read(write.path), manifest.get(relative)
        if current is None and recorded is not None and relative.startswith(OPTIONAL_PREFIXES):
            plan.user_deleted.append(relative)
            plan.manifest[relative] = recorded
            continue
        plan.manifest[relative] = digest(write.content)
        if current is None:
            plan.writes.append(write)
        elif digest(current) == digest(write.content):
            continue
        elif recorded is not None and digest(current) == recorded:
            plan.writes.append(write)
            plan.backups.append(write.path)
        elif options.force:
            plan.writes.append(write)
            plan.backups.append(write.path)
        elif options.keep:
            plan.kept.append(relative)
            plan.manifest[relative] = recorded or digest(current)
        else:
            conflicts.append(relative)
    if conflicts:
        listed = "\n".join(f"  {path}" for path in conflicts)
        raise TinyError(f"these tiny-trellis files were changed by hand:\n{listed}\n"
                        "Run init with --force to back them up and overwrite them, or with "
                        "--keep to leave them as they are.")
    _plan_retired(project, owned, manifest, read, plan)
    return plan


def apply_owned(project: Project, plan: OwnershipPlan, now: datetime.datetime) -> Path | None:
    """Back up overwritten and retired files, move retired files out, and return the
    backup folder (None when nothing needed backing up). Writes happen afterwards."""
    if not plan.backups and not plan.retired:
        return None
    backup = project.tool / f"{BACKUP_PREFIX}{now:%Y%m%d-%H%M%S}"
    if backup.exists():
        raise TinyError(f"{project.relative(backup)} already exists; run init again in a second")
    for path in plan.backups:
        write_exact(backup / project.relative(path), read_optional(path) or "")
    for relative in plan.retired:
        target = backup / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        (project.root / relative).rename(target)
    return backup


def write_records(project: Project, version: str, platforms: set, manifest: dict) -> list:
    """config.json and manifest.json contents, as (path, text) pairs."""
    config = {"version": version, "platforms": sorted(platforms)}
    return [
        (config_path(project), json.dumps(config, indent=2) + "\n"),
        (manifest_path(project), json.dumps(dict(sorted(manifest.items())), indent=2) + "\n"),
    ]


def _plan_retired(project: Project, owned: list, manifest: dict, read,
                  plan: OwnershipPlan) -> None:
    """Files an earlier version wrote that this version no longer installs."""
    current_paths = {project.relative(write.path) for write in owned}
    for relative, recorded in sorted(manifest.items()):
        if relative in current_paths:
            continue
        text = read(project.root / relative)
        if text is None:
            continue
        if digest(text) == recorded:
            plan.retired.append(relative)
        else:
            plan.retired_but_changed.append(relative)
            plan.manifest[relative] = recorded


def _parse_json(text: str, label: str) -> dict:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise TinyError(f"{label} is not valid JSON ({error})") from error
    if not isinstance(data, dict):
        raise TinyError(f"{label} must contain a JSON object")
    return data
