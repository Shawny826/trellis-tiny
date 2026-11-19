"""The status line, the end-of-turn check, and the manual check command."""
from __future__ import annotations

import hashlib
import json
import sys

from .checks import all_passed, describe_failures, discover, run_checks
from .project import Project, command_prefix
from .snapshot import changed_files, take_snapshot
from .state import load_baseline, load_state, save_state
from .tasks import active_tasks


def status_line(project: Project) -> str:
    base = load_baseline(project, load_state(project))
    current = take_snapshot(project.root)
    parts = [f"tiny-trellis: run commands as `{command_prefix(project)} <command>`."]
    tasks = active_tasks(project)
    if tasks:
        names = ", ".join(project.relative(path) for path in tasks)
        parts.append(f"Active task: {names}.")
    else:
        parts.append("No active task.")
    if current.key != base.key:
        count = len(changed_files(base, current))
        parts.append(
            f"{count} changed file(s) since the last finish are not recorded; "
            "run `finish` once that work is complete."
        )
    return " ".join(parts)


def check_now(project: Project) -> int:
    """Run the project checks on the changes since the last finish and print the result."""
    base = load_baseline(project, load_state(project))
    current = take_snapshot(project.root)
    results = run_checks(project, changed_files(base, current))
    if not results:
        print("No project checks are registered in .trellis/tiny/checks/.")
        return 0
    for result in results:
        print(f"{result.name}: {result.status}")
    if all_passed(results):
        return 0
    print(describe_failures(results), file=sys.stderr)
    return 1


def check_hook(project: Project) -> int:
    """End-of-turn hook. Exit 2 blocks the stop; exit 0 lets it through."""
    state = load_state(project)
    base = load_baseline(project, state)
    current = take_snapshot(project.root)
    if state.get("last_pass") == current.key or not discover(project):
        return 0
    results = run_checks(project, changed_files(base, current))
    if all_passed(results):
        passed = {key: value for key, value in state.items() if key != "last_block"}
        save_state(project, {**passed, "last_pass": current.key})
        return 0
    failures = describe_failures(results)
    block_key = hashlib.sha256(f"{current.key}\0{failures}".encode("utf-8")).hexdigest()
    if state.get("last_block") == block_key:
        warning = (
            "tiny-trellis: the same check failure came back with nothing changed, "
            "so this stop was let through. Unresolved:\n" + failures
        )
        print(json.dumps({"systemMessage": warning}, ensure_ascii=False))
        return 0
    save_state(project, {**state, "last_block": block_key})
    print(
        "tiny-trellis checks failed for the changes since the last finish:\n"
        f"{failures}\nFix these, then finish the turn again.",
        file=sys.stderr,
    )
    return 2
