"""The finish command: checks, verification, and one journal entry."""
from __future__ import annotations

import datetime
import subprocess
import sys
from dataclasses import dataclass

from .checks import all_passed, describe_failures, run_checks, summarize
from .errors import TinyError
from .journal import Entry, append_entry, render
from .project import Project, developer_slug, git, load_local
from .snapshot import Snapshot, changed_files, has_uncommitted, take_snapshot
from .state import load_baseline, load_state, record_baseline
from .tasks import active_tasks, find_active

VERIFY_TIMEOUT_SECONDS = 1800
FAILURE_TAIL_LINES = 40


@dataclass(frozen=True)
class FinishOptions:
    reason: str
    verify: str | None
    no_verify: str | None
    review: str
    task: str | None


def finish(project: Project, options: FinishOptions) -> int:
    reason = _one_line(options.reason, "--reason")
    developer = developer_slug(project)
    state = load_state(project)
    base = load_baseline(project, state)
    current = take_snapshot(project.root)
    if current.key == base.key:
        raise TinyError("nothing has changed since the last finish, so there is nothing to record")
    files = changed_files(base, current)
    results = run_checks(project, files)
    if not all_passed(results):
        print("Project checks failed; nothing was recorded.\n" + describe_failures(results),
              file=sys.stderr)
        return 1
    verification = _verify(project, options)
    if verification is None:
        return 1
    entry = Entry(
        when=datetime.datetime.now(),
        reason=reason,
        changed=files,
        verification=verification,
        checks=summarize(results),
        review=options.review,
        task=_task_for(project, options.task),
        commit=_commit_line(project, current),
    )
    path = append_entry(project, developer, render(entry))
    record_baseline(project, state, take_snapshot(project.root))
    print(f"Recorded in {project.relative(path)}.")
    return 0


def _verify(project: Project, options: FinishOptions) -> str | None:
    """Journal text for the verification, or None after reporting a failed command."""
    if options.no_verify is not None:
        return "none — " + _one_line(options.no_verify, "--no-verify")
    command = _one_line(options.verify or "", "--verify")
    shell = load_local(project)["shell"]["argv"]
    completed = subprocess.run(
        [*shell, command],
        cwd=project.root,
        capture_output=True,
        timeout=VERIFY_TIMEOUT_SECONDS,
    )
    output = (completed.stdout + completed.stderr).decode("utf-8", "replace")
    lines = [line for line in output.splitlines() if line.strip()]
    if completed.returncode != 0:
        tail = "\n".join(lines[-FAILURE_TAIL_LINES:])
        print(f"The verify command exited with {completed.returncode}; nothing was recorded.\n"
              f"{tail}", file=sys.stderr)
        return None
    last = lines[-1].strip() if lines else "no output"
    return f"`{command}` — exit 0 — {last}"


def _task_for(project: Project, name: str | None) -> str | None:
    if name is not None:
        return project.relative(find_active(project, name))
    tasks = active_tasks(project)
    return project.relative(tasks[0]) if len(tasks) == 1 else None


def _commit_line(project: Project, snapshot: Snapshot) -> str:
    head = git(project.root, "rev-parse", "--short", "HEAD").strip()
    if has_uncommitted(project.root, snapshot):
        return f"{head} (with uncommitted changes)"
    return head


def _one_line(text: str, option: str) -> str:
    clean = text.strip()
    if not clean:
        raise TinyError(f"{option} needs a value")
    if "\n" in clean or "\r" in clean:
        raise TinyError(f"{option} must be a single line")
    return clean
