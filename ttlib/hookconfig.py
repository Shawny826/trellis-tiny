"""Hook entries for Claude Code (.claude/settings.local.json) and Codex (.codex/hooks.json).

Entries that run .trellis/tiny/tt.py belong to tiny-trellis and are replaced on
every init; every other key and hook in those files is kept as it was.
"""
from __future__ import annotations

import json
from pathlib import Path

from .errors import TinyError
from .project import SCRIPT_RELATIVE

SESSION_SOURCES = "startup|resume|clear|compact|fork"
MARKER = SCRIPT_RELATIVE.as_posix()


def claude_groups(interpreter: list, with_stop: bool) -> dict:
    """Exec-form hooks: no shell is involved, so Git Bash does not matter here."""
    executable, *leading = interpreter
    script = "${CLAUDE_PROJECT_DIR}/" + MARKER

    def group(command: str) -> dict:
        return {"type": "command", "command": executable,
                "args": [*leading, script, command, "--hook"]}

    groups = {"SessionStart": {"matcher": SESSION_SOURCES, "hooks": [group("status")]}}
    if with_stop:
        groups["Stop"] = {"hooks": [group("check")]}
    return groups


def codex_groups(interpreter: list, project_root: Path, with_stop: bool) -> dict:
    """Shell-form hooks with an absolute script path; the line parses the same in sh,
    cmd, and PowerShell because only the script path is quoted."""
    script = f'"{(project_root / SCRIPT_RELATIVE).as_posix()}"'

    def group(command: str) -> dict:
        return {"type": "command", "command": " ".join([*interpreter, script, command, "--hook"])}

    groups = {"SessionStart": {"matcher": SESSION_SOURCES, "hooks": [group("status")]}}
    if with_stop:
        groups["Stop"] = {"hooks": [group("check")]}
    return groups


def merge_hooks(existing: str | None, groups: dict, file_label: str) -> str:
    settings = _parse(existing, file_label)
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        raise TinyError(f"{file_label}: \"hooks\" is not an object")
    merged = {}
    for event, event_groups in hooks.items():
        kept = [g for g in (_without_ours(g) for g in event_groups) if g is not None]
        if kept:
            merged[event] = kept
    for event, group in groups.items():
        merged[event] = [*merged.get(event, []), group]
    return json.dumps({**settings, "hooks": merged}, indent=2, ensure_ascii=False) + "\n"


def _parse(existing: str | None, file_label: str) -> dict:
    if existing is None or not existing.strip():
        return {}
    try:
        settings = json.loads(existing)
    except json.JSONDecodeError as error:
        raise TinyError(f"{file_label} is not valid JSON ({error}); fix it and run init again") \
            from error
    if not isinstance(settings, dict):
        raise TinyError(f"{file_label} must contain a JSON object")
    return settings


def _without_ours(group: dict) -> dict | None:
    """The group without tiny-trellis handlers, or None when nothing else is left."""
    if "hooks" not in group:
        return group
    handlers = [h for h in group["hooks"] if MARKER not in json.dumps(h)]
    if not handlers:
        return None
    return {**group, "hooks": handlers}
