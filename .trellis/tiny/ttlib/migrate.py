"""Migrating from an upstream Trellis installation without deleting anything.

Files upstream installed move into .trellis/archive/upstream-<time>/ under their
original relative paths. Upstream entries in shared files are removed and copied
verbatim into the archive's MIGRATION.md. spec/, tasks/, and workspace/ stay in place.
"""
from __future__ import annotations

import datetime
import json
from dataclasses import dataclass
from pathlib import Path

from .errors import TinyError
from .files import read_exact, read_optional, write_exact
from .managed import line_ending
from .project import Project, git
from .upstream import (AGENTS_FILE, SCRUBBED_JSON, classify, leftovers, manifest_paths,
                       scrub_agents_block, scrub_hooks)

ARCHIVE_ROOT = Path(".trellis") / "archive"
ARCHIVE_GITIGNORE = "# Keep every archived upstream file in Git, even if a parent rule ignores it.\n!*\n"
TASKS_INDEX = "upstream-tasks.md"
FOREIGN_SHOWN = 20


@dataclass(frozen=True)
class MigrationPlan:
    archive: Path
    moves: tuple
    edits: dict
    removed: tuple
    notes: tuple

    def reader(self):
        """read_optional as it will look after the migration, for planning the install."""
        moved = {source for source, _ in self.moves}

        def read(path: Path) -> str | None:
            if path in self.edits:
                return self.edits[path]
            return None if path in moved else read_optional(path)

        return read


def plan_migration(project: Project, now: datetime.datetime, index_template: str) -> MigrationPlan:
    manifest = manifest_paths(project.root)
    inventory = classify(project.root, manifest)
    unlisted = leftovers(project.root, manifest)
    archive = project.root / ARCHIVE_ROOT / f"upstream-{now:%Y%m%d-%H%M%S}"
    if archive.exists():
        raise TinyError(f"{project.relative(archive)} already exists; run init again in a second")
    moves = tuple((project.root / item, archive / item) for item in inventory.moves)
    edits, removed = _scrub_shared(project, inventory, set(inventory.moves))
    knowledge, unreadable = _knowledge_edits(project, now, index_template)
    edits.update(knowledge)
    notes = tuple(_notes(inventory, unreadable, unlisted))
    report = (_report(project, moves, removed, notes, now) + _foreign_section(inventory.foreign)
              + _unlisted_section(unlisted))
    edits[archive / "MIGRATION.md"] = report
    edits[archive / ".gitignore"] = ARCHIVE_GITIGNORE
    return MigrationPlan(archive, moves, edits, tuple(removed), notes)


def _foreign_section(foreign: list) -> str:
    if not foreign:
        return ""
    lines = ["## Not handled, left in place", "",
             "These files are in the upstream manifest but this migration does not handle "
             "them; most belong to platforms other than Claude Code and Codex. Their hooks and "
             "settings were not changed. They may run upstream scripts that were moved into this "
             "folder, such as `.trellis/scripts/`, so Trellis on those platforms may stop "
             "working. Move, delete, or fix them by hand.", "", *(f"- {path}" for path in foreign),
             ""]
    return "\n".join(lines)


def _unlisted_section(unlisted: list) -> str:
    if not unlisted:
        return ""
    lines = ["## Left in place for you to review", "",
             "These files are named like upstream's but are not in its manifest, so this "
             "migration did not touch them. An older upstream version may have installed them; "
             "they can still load as skills or commands. Move or delete them by hand if they "
             "are upstream's.", "", *(f"- {path}" for path in unlisted), ""]
    return "\n".join(lines)


def require_clean_tree(project: Project) -> None:
    if git(project.root, "status", "--porcelain").strip():
        raise TinyError("the working tree has uncommitted changes. Commit or stash them first, "
                        "so the migration can be reviewed and undone with Git.")


def apply_migration(plan: MigrationPlan) -> None:
    for source, target in plan.moves:
        if target.exists():
            raise TinyError(f"refusing to overwrite {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
    for path, text in plan.edits.items():
        write_exact(path, text)


def describe(project: Project, plan: MigrationPlan) -> list:
    lines = [f"migrate: archive {len(plan.moves)} upstream file(s) into "
             f"{project.relative(plan.archive)}/"]
    lines += [f"migrate: remove {entry['summary']}" for entry in plan.removed]
    lines += [f"migrate: note: {note}" for note in plan.notes]
    return lines


def _scrub_shared(project: Project, inventory, moved: set) -> tuple:
    edits, removed = {}, []
    for item in inventory.scrubbed:
        path = project.root / item
        text = read_exact(path)
        new_text = text
        if item in SCRUBBED_JSON:
            new_text, entries = scrub_hooks(text, moved, item)
            removed += [{"file": item, "summary": _summary(item, e), "detail": e} for e in entries]
        elif item == AGENTS_FILE:
            new_text, block = scrub_agents_block(text)
            if block is not None:
                removed.append({"file": item, "summary": "the Trellis block from AGENTS.md",
                                "detail": block})
        if new_text != text:
            edits[path] = new_text
    return edits, removed


def _summary(item: str, entry: dict) -> str:
    if "statusLine" in entry:
        return f"the Trellis status line from {item}"
    return f"the {entry['event']} hook `{entry['handler'].get('command')}` from {item}"


def _knowledge_edits(project: Project, now: datetime.datetime, index_template: str) -> tuple:
    """Edits that point the knowledge index at upstream's specs and tasks, and the task.json
    files that could not be read."""
    edits = {}
    lines = []
    tasks_text, unreadable = _tasks_index(project, now)
    if tasks_text is not None:
        edits[project.spec / TASKS_INDEX] = tasks_text
        lines.append(f"- [{TASKS_INDEX}]({TASKS_INDEX}) — tasks from the earlier Trellis "
                     "installation, with links to their PRDs and research")
    for index in sorted(project.spec.glob("*/index.md")):
        name = index.relative_to(project.spec).as_posix()
        lines.append(f"- [{name}]({name}) — {index.parent.name} guidelines carried over "
                     "from Trellis")
    index_path = project.spec / "index.md"
    current = read_optional(index_path) or index_template
    missing = [line for line in lines if line.split(" — ")[0] not in current]
    if missing:
        eol = line_ending(current)
        edits[index_path] = current.rstrip("\r\n") + eol + eol.join(missing) + eol
    return edits, unreadable


def _tasks_index(project: Project, now: datetime.datetime) -> tuple:
    """The index text (or None without tasks) and the task.json files that could not be read."""
    active = sorted(project.tasks.glob("*/task.json"))
    archived = sorted(project.tasks.glob("archive/*/*/task.json"))
    if not active and not archived:
        return None, []
    lines = ["# Upstream Trellis tasks", "",
             f"Listed by tiny-trellis when it replaced Trellis on {now:%Y-%m-%d}. The task "
             "folders were left where they were; read one when its topic comes up. Status "
             "values are upstream's own.", ""]
    unreadable = []
    for heading, files in (("Not archived", active), ("Archived", archived)):
        if not files:
            continue
        lines += [f"## {heading}", ""]
        for task_json in files:
            line, problem = _task_line(project, task_json)
            lines.append(line)
            if problem is not None:
                unreadable.append(f"{project.relative(task_json)} ({problem})")
        lines.append("")
    return "\n".join(lines), unreadable


def _task_line(project: Project, task_json: Path) -> tuple:
    """The index line for one task, and why its task.json could not be read (or None)."""
    folder = task_json.parent
    link = Path("..", folder.relative_to(project.trellis)).as_posix()
    if (folder / "prd.md").is_file():
        link += "/prd.md"
    try:
        data = json.loads(read_exact(task_json))
    except json.JSONDecodeError as error:
        data, problem = None, f"not valid JSON: {error}"
    else:
        problem = None if isinstance(data, dict) else "not a JSON object"
    if problem is not None:
        return f"- [{folder.name}]({link}) — task.json could not be read ({problem})", problem
    title = data.get("title") or data.get("name") or folder.name
    status = data.get("status") or "no status"
    created = f" — created {data['createdAt']}" if data.get("createdAt") else ""
    return f"- [{title}]({link}) — {status}{created}", None


def _notes(inventory, unreadable: list, unlisted: list) -> list:
    notes = []
    if inventory.foreign:
        shown = ", ".join(inventory.foreign[:FOREIGN_SHOWN])
        more = (f", and {len(inventory.foreign) - FOREIGN_SHOWN} more"
                if len(inventory.foreign) > FOREIGN_SHOWN else "")
        notes.append(f"{len(inventory.foreign)} file(s) in the upstream manifest are not handled "
                     "by this migration (tiny-trellis supports Claude Code and Codex only) and "
                     "were left in place; they may depend on the archived upstream scripts, so "
                     f"review them (listed in MIGRATION.md): {shown}{more}")
    if unlisted:
        notes.append(f"{len(unlisted)} file(s) named trellis* are not in the upstream manifest "
                     "and were left in place; they are listed in MIGRATION.md for you to review")
    if ".codex/config.toml" in inventory.left:
        notes.append(".codex/config.toml was left as is; upstream's `project_doc_fallback_"
                     "filenames` and `[agents] max_depth = 1` do not affect tiny-trellis")
    if inventory.missing:
        notes.append(f"{len(inventory.missing)} file(s) in the upstream manifest were already "
                     "missing")
    if unreadable:
        notes.append(f"{len(unreadable)} upstream task.json file(s) could not be read; they are "
                     "listed by folder name in upstream-tasks.md and were left unchanged: "
                     + "; ".join(unreadable))
    notes.append("spec/, tasks/, and workspace/ stay in place; old journals sit next to "
                 "tiny-trellis's own tiny-journal.md")
    return notes


def _report(project: Project, moves: tuple, removed: list, notes: tuple,
            now: datetime.datetime) -> str:
    lines = ["# Migration from Trellis", "",
             f"tiny-trellis replaced the upstream Trellis installation on {now:%Y-%m-%d %H:%M}. "
             "Nothing was deleted. To undo it, move the files below back to the same "
             "relative paths and put the removed entries back into their files.", "",
             "## Moved into this folder", ""]
    lines += [f"- {project.relative(source)}" for source, _ in moves] or ["- (none)"]
    lines += ["", "## Removed from shared files", ""]
    for entry in removed:
        detail = entry["detail"]
        body = detail if isinstance(detail, str) else json.dumps(detail, indent=2,
                                                                  ensure_ascii=False)
        fence = "markdown" if isinstance(detail, str) else "json"
        lines += [f"### {entry['summary']}", "", f"```{fence}", body.rstrip("\r\n"), "```", ""]
    if not removed:
        lines += ["(none)", ""]
    lines += ["## Notes", "", *(f"- {note}" for note in notes), ""]
    return "\n".join(lines)
