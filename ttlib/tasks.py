"""Cross-session task files, one Markdown file per task in .trellis/tasks/."""
from __future__ import annotations

import datetime
import re
from pathlib import Path

from .errors import TinyError
from .files import read_exact, write_exact
from .project import Project

ACTIVE_LINE = "- Status: active"
CLOSED_LINE = "- Status: closed"
TEMPLATE = Path(__file__).parent / "assets" / "task.md"


def new_task(project: Project, title: str, today: datetime.date) -> Path:
    clean_title = title.strip()
    if not clean_title:
        raise TinyError("a task needs a title")
    stem = f"{today.isoformat()}-{_slug(clean_title)}"
    path = project.tasks / f"{stem}.md"
    counter = 2
    while path.exists():
        path = project.tasks / f"{stem}-{counter}.md"
        counter += 1
    write_exact(path, read_exact(TEMPLATE).replace("{title}", clean_title))
    return path


def active_tasks(project: Project) -> list:
    if not project.tasks.is_dir():
        return []
    return [path for path in sorted(project.tasks.glob("*.md")) if _is_active(path)]


def find_active(project: Project, name: str) -> Path:
    path = _task_path(project, name)
    if not _is_active(path):
        raise TinyError(f"{project.relative(path)} is not an active task")
    return path


def close_task(project: Project, name: str) -> Path:
    path = find_active(project, name)
    text = read_exact(path)
    lines = text.splitlines(keepends=True)
    matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == ACTIVE_LINE]
    if len(matches) != 1:
        raise TinyError(f"{project.relative(path)} has {len(matches)} status lines; expected one")
    index = matches[0]
    ending = lines[index][len(ACTIVE_LINE):]
    lines[index] = CLOSED_LINE + ending
    write_exact(path, "".join(lines))
    return path


def _task_path(project: Project, name: str) -> Path:
    file_name = name if name.endswith(".md") else f"{name}.md"
    path = project.tasks / Path(file_name).name
    if not path.is_file():
        raise TinyError(f"no task file named {file_name} in {project.relative(project.tasks)}")
    return path


def _is_active(path: Path) -> bool:
    return any(line.rstrip() == ACTIVE_LINE for line in read_exact(path).splitlines())


def _slug(title: str) -> str:
    slug = re.sub(r"[^\w]+", "-", title).strip("-_").lower()
    return slug[:60] or "task"
