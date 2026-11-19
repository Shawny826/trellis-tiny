"""The append-only change journal in .trellis/workspace/<developer>/tiny-journal.md."""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from pathlib import Path

from .files import append_exact, write_exact
from .project import Project

JOURNAL_NAME = "tiny-journal.md"
HEADER = "# Change journal (tiny-trellis)\n"


@dataclass(frozen=True)
class Entry:
    when: datetime.datetime
    reason: str
    changed: list
    verification: str
    checks: str
    review: str
    task: str | None
    commit: str


def render(entry: Entry) -> str:
    lines = [
        f"## {entry.when:%Y-%m-%d %H:%M}",
        f"- Reason: {entry.reason}",
        f"- Changed: {', '.join(entry.changed)}",
        f"- Verify: {entry.verification}",
        f"- Checks: {entry.checks}",
        f"- Review: {entry.review}",
    ]
    if entry.task:
        lines.append(f"- Task: {entry.task}")
    lines.append(f"- Commit: {entry.commit}")
    return "\n".join(lines) + "\n"


def append_entry(project: Project, developer: str, text: str) -> Path:
    path = project.trellis / "workspace" / developer / JOURNAL_NAME
    if not path.exists():
        write_exact(path, HEADER)
    append_exact(path, "\n" + text)
    return path
