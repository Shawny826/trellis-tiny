"""The init command: install tiny-trellis into a project, or upgrade an installation.

A project without .trellis/tiny/config.json gets a fresh install; a project with
one is upgraded to this version. Every file's new content is computed before
anything is written, so a problem found in any file stops init with no changes.
An upstream Trellis installation is migrated first, after the user confirms in a
terminal, or without asking when --migrate is given.
"""
from __future__ import annotations

import datetime
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from . import __version__
from .checks import discover
from .environment import detect_interpreter, detect_shell
from .errors import TinyError
from .files import read_exact, read_optional, write_exact
from .hookconfig import claude_groups, codex_groups, merge_hooks
from .managed import apply_block, with_import
from .migrate import MigrationPlan, apply_migration, describe, plan_migration, require_clean_tree
from .ownership import (OwnershipPlan, UpdateOptions, apply_owned, compare_versions, load_config,
                        load_manifest, plan_owned, write_records)
from .project import Project, find_project, git
from .skills import claude_skills, codex_skills
from .snapshot import take_snapshot
from .state import load_baseline, load_state, record_baseline
from .upstream import is_installed

PACKAGE_DIR = Path(__file__).resolve().parent
ASSETS = PACKAGE_DIR / "assets"
PLATFORMS = ("claude", "codex")
TOOL_GITIGNORE = ".runtime/\n.backup-*/\n__pycache__/\n"


@dataclass(frozen=True)
class Write:
    path: Path
    content: str


@dataclass(frozen=True)
class InitOptions:
    platforms: set
    dry_run: bool = False
    migrate: bool = False
    force: bool = False
    keep: bool = False
    allow_downgrade: bool = False


@dataclass(frozen=True)
class InitPlan:
    project: Project
    installed: str | None
    platforms: set
    migration: MigrationPlan | None
    ownership: OwnershipPlan
    writes: list
    read: object


def init(start: Path, options: InitOptions) -> int:
    plan = _plan(find_project(start), options)
    ask = plan.migration is not None and not options.migrate and not options.dry_run
    _report(plan, options.dry_run or ask)
    if options.dry_run:
        return 0
    if ask and not _confirm_migration():
        print("Nothing was changed.")
        return 1
    project = plan.project
    clean_before = _matches_baseline(project)
    now = datetime.datetime.now()
    if plan.migration is not None:
        apply_migration(plan.migration)
    backup = apply_owned(project, plan.ownership, now)
    for write in plan.writes:
        write_exact(write.path, write.content)
    if clean_before is not False:
        record_baseline(project, load_state(project), take_snapshot(project.root))
    _print_next_steps(plan, backup)
    return 0


def _plan(project: Project, options: InitOptions) -> InitPlan:
    git(project.root, "rev-parse", "--verify", "HEAD")
    config = load_config(project)
    platforms = _platforms(config, options.platforms)
    if config is not None and compare_versions(config["version"], __version__) > 0 \
            and not options.allow_downgrade:
        raise TinyError(f"this project was set up by tiny-trellis {config['version']}, which is "
                        f"newer than this tt ({__version__}). Update tiny-trellis, or run init "
                        "--allow-downgrade.")
    migration = _migration_plan(project, options.migrate)
    if migration is not None and not options.dry_run:
        require_clean_tree(project)
    local = {"interpreter": detect_interpreter(), "shell": detect_shell()}
    read = migration.reader() if migration is not None else read_optional
    owned, merged = plan_writes(project, platforms, local, read)
    ownership = plan_owned(project, owned, load_manifest(project),
                           UpdateOptions(options.force, options.keep), read)
    records = write_records(project, __version__, platforms, ownership.manifest)
    merged += [Write(path, text) for path, text in records]
    writes = ownership.writes + [write for write in merged if read(write.path) != write.content]
    installed = config["version"] if config is not None else None
    return InitPlan(project, installed, platforms, migration, ownership, writes, read)


def plan_writes(project: Project, platforms: set, local: dict, read=read_optional) -> tuple:
    """(owned, merged): files tiny-trellis writes whole, and files it edits in place."""
    owned = [*_tool_files(project), Write(project.tool / ".gitignore", TOOL_GITIGNORE)]
    merged = []
    index = project.spec / "index.md"
    if read(index) is None:
        merged.append(Write(index, _asset("spec-index.md")))
    agents = project.root / "AGENTS.md"
    merged.append(Write(agents, apply_block(read(agents), _asset("agents-block.md"))))
    with_stop = bool(discover(project))
    if "claude" in platforms:
        claude_md = project.root / "CLAUDE.md"
        settings = project.root / ".claude" / "settings.local.json"
        groups = claude_groups(local["interpreter"], with_stop)
        merged.append(Write(claude_md, with_import(read(claude_md))))
        merged.append(Write(settings, merge_hooks(read(settings), groups,
                                                  ".claude/settings.local.json")))
        owned.append(Write(project.root / ".claude/agents/tiny_trellis_reviewer.md",
                           _asset("reviewer.md")))
        owned += [Write(project.root / path, text) for path, text in claude_skills().items()]
    if "codex" in platforms:
        hooks = project.root / ".codex" / "hooks.json"
        groups = codex_groups(local["interpreter"], project.root, with_stop)
        merged.append(Write(hooks, merge_hooks(read(hooks), groups, ".codex/hooks.json")))
        owned.append(Write(project.root / ".codex/agents/tiny_trellis_reviewer.toml",
                           _asset("reviewer.toml")))
        owned += [Write(project.root / path, text) for path, text in codex_skills().items()]
    merged.append(Write(project.runtime / "local.json", json.dumps(local, indent=2) + "\n"))
    merged.append(_exclude_write(project, platforms))
    return owned, merged


def _platforms(config: dict | None, requested: set) -> set:
    if config is None:
        return set(requested) or set(PLATFORMS)
    recorded = set(config["platforms"])
    unknown = recorded - set(PLATFORMS)
    if unknown:
        raise TinyError(f".trellis/tiny/config.json lists unknown platforms: {sorted(unknown)}")
    return recorded | set(requested)


def _migration_plan(project: Project, migrate: bool) -> MigrationPlan | None:
    upstream = is_installed(project.root)
    if migrate and not upstream:
        raise TinyError("--migrate was given, but no upstream Trellis installation was found")
    if not upstream:
        return None
    return plan_migration(project, datetime.datetime.now(), _asset("spec-index.md"))


def _confirm_migration() -> bool:
    """Ask before migrating. Without a terminal there is no one to ask, so init stops.
    On Windows the NUL device counts as a terminal; reading it gives EOF, a no."""
    if not sys.stdin.isatty():
        raise TinyError("found an upstream Trellis installation, and migrating it needs a yes "
                        "from a terminal. Run `init --migrate` to migrate without asking, or "
                        "`init --dry-run` to preview it.")
    try:
        answer = input("Migrate from Trellis as listed above, then install tiny-trellis? [y/N] ")
    except EOFError:
        print("\nNo answer was given; run `init --migrate` to migrate without asking.")
        return False
    return answer.strip().lower() in ("y", "yes")


def _exclude_write(project: Project, platforms: set) -> Write:
    """Keep the machine-specific hook files out of Git through .git/info/exclude,
    which is local to this clone and never committed."""
    wanted = []
    if "claude" in platforms:
        wanted.append("/.claude/settings.local.json")
    if "codex" in platforms:
        wanted.append("/.codex/hooks.json")
    relative = git(project.root, "rev-parse", "--git-path", "info/exclude").strip()
    path = Path(relative) if Path(relative).is_absolute() else project.root / relative
    existing = read_optional(path) or ""
    present = {line.strip() for line in existing.splitlines()}
    missing = [line for line in wanted if line not in present]
    if not missing:
        return Write(path, existing)
    separator = "" if not existing or existing.endswith("\n") else "\n"
    return Write(path, existing + separator + "\n".join(missing) + "\n")


def _tool_files(project: Project) -> list:
    """tt.py and a copy of the ttlib package, unless init runs from that very copy."""
    files = [Write(project.tool / "tt.py", _asset("tt.py"))]
    if PACKAGE_DIR == (project.tool / "ttlib").resolve():
        return files
    for source in sorted(PACKAGE_DIR.rglob("*")):
        if source.is_file() and "__pycache__" not in source.parts:
            target = project.tool / "ttlib" / source.relative_to(PACKAGE_DIR)
            files.append(Write(target, read_exact(source)))
    return files


def _matches_baseline(project: Project) -> bool | None:
    """Whether the tree held no unrecorded work before init; None before the first install.
    Only then may the baseline move past init's own changes."""
    state = load_state(project)
    if "last_finish" not in state:
        return None
    return take_snapshot(project.root).key == load_baseline(project, state).key


def _asset(name: str) -> str:
    return read_exact(ASSETS / name).replace("\r\n", "\n")


def _report(plan: InitPlan, dry_run: bool) -> None:
    prefix = "would " if dry_run else ""
    names = " and ".join("Claude Code" if p == "claude" else "Codex" for p in sorted(plan.platforms))
    if plan.installed is None:
        print(f"{prefix}install tiny-trellis {__version__} for {names}")
    elif plan.installed != __version__:
        print(f"{prefix}upgrade tiny-trellis from {plan.installed} to {__version__} for {names}")
    for line in describe(plan.project, plan.migration) if plan.migration is not None else []:
        print(prefix + line)
    ownership = plan.ownership
    for relative in ownership.retired:
        print(f"{prefix}retire {relative} (no longer used; moved into the backup)")
    for label, paths in (("kept as you changed it", ownership.kept),
                         ("not recreated because you deleted it", ownership.user_deleted),
                         ("no longer used, but left because you changed it",
                          ownership.retired_but_changed)):
        for relative in paths:
            print(f"note: {relative} {label}")
    if not plan.writes and not ownership.retired and plan.migration is None:
        print("Everything is already up to date.")
    for write in plan.writes:
        verb = "update" if plan.read(write.path) is not None else "create"
        print(f"{prefix}{verb} {plan.project.relative(write.path)}")


def _print_next_steps(plan: InitPlan, backup: Path | None) -> None:
    project = plan.project
    if backup is not None:
        print(f"Replaced and retired files were backed up in {project.relative(backup)}/.")
    if plan.migration is not None:
        print(f"Migrated from Trellis. What moved and what was removed is listed in "
              f"{project.relative(plan.migration.archive)}/MIGRATION.md; review `git status` "
              "and commit when it looks right.")
    if plan.writes or plan.ownership.retired:
        print("Start a new agent session so the hooks, skills, and AGENTS.md block load.")
    if "codex" in plan.platforms and plan.writes:
        print("Codex skips new or changed hooks until you review and trust them: run /hooks "
              "in Codex.")
