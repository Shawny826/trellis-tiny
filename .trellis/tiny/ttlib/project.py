"""Locating the project and its tiny-trellis paths, and running git."""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import TinyError

TOOL_RELATIVE = Path(".trellis") / "tiny"
SCRIPT_RELATIVE = TOOL_RELATIVE / "tt.py"


def git(root: Path, *args: str, stdin: str | None = None) -> str:
    """Run git in root and return its stdout. A non-zero exit raises TinyError."""
    result = subprocess.run(
        ["git", "-c", "core.quotepath=false", *args],
        cwd=root,
        input=None if stdin is None else stdin.encode("utf-8"),
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise TinyError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout.decode("utf-8")


@dataclass(frozen=True)
class Project:
    root: Path

    @property
    def trellis(self) -> Path:
        return self.root / ".trellis"

    @property
    def tool(self) -> Path:
        return self.root / TOOL_RELATIVE

    @property
    def runtime(self) -> Path:
        return self.tool / ".runtime"

    @property
    def checks(self) -> Path:
        return self.tool / "checks"

    @property
    def tasks(self) -> Path:
        return self.trellis / "tasks"

    @property
    def spec(self) -> Path:
        return self.trellis / "spec"

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()


def find_project(start: Path) -> Project:
    """Return the Git working tree that contains start."""
    top = git(start, "rev-parse", "--show-toplevel").strip()
    return Project(Path(top))


def open_installed(start: Path) -> Project:
    project = find_project(start)
    if not (project.root / SCRIPT_RELATIVE).is_file():
        raise TinyError(f"tiny-trellis is not installed in {project.root}; run init first")
    return project


def load_local(project: Project) -> dict:
    """Machine-specific settings written by init: interpreter and shell."""
    path = project.runtime / "local.json"
    if not path.is_file():
        raise TinyError(f"{project.relative(path)} is missing; run init on this machine")
    return json.loads(path.read_text(encoding="utf-8"))


def command_prefix(project: Project) -> str:
    interpreter = load_local(project)["interpreter"]
    return " ".join([*interpreter, SCRIPT_RELATIVE.as_posix()])


def developer_slug(project: Project) -> str:
    """Directory name for this developer's journal, from git user.name."""
    try:
        name = git(project.root, "config", "user.name").strip()
    except TinyError as error:
        raise TinyError("git user.name is not set; the journal is filed under it") from error
    slug = re.sub(r"[^\w.-]+", "-", name).strip("-.")
    if not slug:
        raise TinyError(f"git user.name {name!r} has no characters usable in a directory name")
    return slug
