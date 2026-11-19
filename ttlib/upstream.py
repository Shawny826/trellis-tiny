"""Reading an upstream Trellis installation: its manifest and its parts of shared files.

Upstream records every file its init/update wrote in .trellis/.template-hashes.json
(schema version 2). Its spec/, tasks/, and workspace/ are user data and are not in
the manifest. Upstream hook commands have the form `<python> [flags] <script path>`.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .errors import TinyError
from .files import read_exact

PYTHON_PROGRAM = re.compile(r"(python[0-9.]*|py)(\.exe)?")

MANIFEST = ".trellis/.template-hashes.json"
UPSTREAM_MARKERS = (MANIFEST, ".trellis/workflow.md", ".trellis/scripts/task.py")
EXTRA_METADATA = (MANIFEST, ".trellis/.version")
CONTENT_PREFIXES = (
    ".trellis/", ".claude/hooks/", ".claude/agents/", ".claude/commands/", ".claude/skills/",
    ".codex/hooks/", ".codex/agents/", ".agents/skills/",
)
KEPT_PREFIXES = (".trellis/spec/", ".trellis/tasks/", ".trellis/workspace/", ".trellis/tiny/",
                 ".trellis/archive/")
SCRUBBED_JSON = (".claude/settings.json", ".codex/hooks.json")
AGENTS_FILE = "AGENTS.md"
LEFT_AS_IS = (".codex/config.toml",)
BLOCK_START = "<!-- TRELLIS:START -->"
BLOCK_END = "<!-- TRELLIS:END -->"
STATUSLINE_SCRIPT = ".claude/hooks/statusline.py"
LEFTOVER_FOLDERS = (".claude/agents", ".claude/commands", ".claude/skills", ".claude/hooks",
                    ".codex/agents", ".codex/hooks", ".agents/skills")


@dataclass(frozen=True)
class Inventory:
    moves: list
    scrubbed: list
    left: list
    missing: list


def is_installed(root: Path) -> bool:
    return any((root / marker).exists() for marker in UPSTREAM_MARKERS)


def manifest_paths(root: Path) -> list:
    path = root / MANIFEST
    if not path.is_file():
        raise TinyError(f"{MANIFEST} is missing, so the files upstream installed are unknown. "
                        "Run `trellis update` with the upstream CLI first, or migrate by hand.")
    try:
        data = json.loads(read_exact(path))
    except json.JSONDecodeError as error:
        raise TinyError(f"{MANIFEST} is not valid JSON ({error})") from error
    if not (isinstance(data, dict) and data.get("__version") == 2
            and isinstance(data.get("hashes"), dict)):
        raise TinyError(f"{MANIFEST} is not in the version 2 format this migration reads. "
                        "Run `trellis update` with the upstream CLI first.")
    paths = sorted(data["hashes"])
    for item in paths:
        pure = PurePosixPath(item)
        if pure.is_absolute() or ".." in pure.parts or "\\" in item:
            raise TinyError(f"{MANIFEST} lists a path outside the project: {item!r}")
    return paths


def classify(root: Path, paths: list) -> Inventory:
    moves, scrubbed, left, missing, unsupported = [], [], [], [], []
    for item in paths:
        if not (root / item).exists():
            missing.append(item)
        elif item in SCRUBBED_JSON or item == AGENTS_FILE:
            scrubbed.append(item)
        elif item in LEFT_AS_IS:
            left.append(item)
        elif item.startswith(CONTENT_PREFIXES) and not item.startswith(KEPT_PREFIXES):
            moves.append(item)
        else:
            unsupported.append(item)
    if unsupported:
        shown = "\n".join(f"  {item}" for item in unsupported[:20])
        more = f"\n  ... and {len(unsupported) - 20} more" if len(unsupported) > 20 else ""
        raise TinyError("the upstream installation includes files this migration does not "
                        f"handle (tiny-trellis supports Claude Code and Codex only):\n{shown}{more}")
    extras = [item for item in EXTRA_METADATA if (root / item).is_file() and item not in moves]
    return Inventory(moves + extras, scrubbed, left, missing)


def leftovers(root: Path, manifest: list) -> list:
    """Files named trellis* in the platform folders that the manifest does not list, such as
    skills an older upstream version installed. They are reported, never moved."""
    listed = set(manifest)
    found = []
    for folder in LEFTOVER_FOLDERS:
        base = root / folder
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            relative = path.relative_to(root).as_posix()
            parts = PurePosixPath(relative).parts[len(PurePosixPath(folder).parts):]
            if (path.is_file() and relative not in listed
                    and any(part.lower().startswith("trellis") for part in parts)):
                found.append(relative)
    return sorted(found)


def scrub_hooks(text: str, moved: set, label: str) -> tuple:
    """Remove hook handlers (and the status line) that run a moved upstream script.

    Returns the new text and a list of the removed entries; the text is unchanged
    when nothing was removed."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise TinyError(f"{label} is not valid JSON ({error}); fix it and run init again") \
            from error
    if not isinstance(data, dict):
        raise TinyError(f"{label} must contain a JSON object")
    removed, unclear = [], []
    result = dict(data)
    if isinstance(data.get("hooks"), dict):
        hooks, removed, unclear = _scrub_events(data["hooks"], moved)
        result.pop("hooks")
        if hooks:
            result["hooks"] = hooks
    status = data.get("statusLine")
    status_kind = _command_kind(status, moved & {STATUSLINE_SCRIPT})
    if status_kind == "upstream":
        result.pop("statusLine")
        removed.append({"statusLine": status})
    elif status_kind == "unclear":
        unclear.append(status)
    if unclear:
        commands = "\n".join(f"  {entry.get('command')}" for entry in unclear)
        raise TinyError(f"{label} has hooks that run an upstream script without a Python "
                        f"interpreter, so it is unclear whether they are upstream's:\n{commands}\n"
                        "Remove or change them by hand, then run init --migrate again.")
    if not removed:
        return text, []
    return json.dumps(result, indent=2, ensure_ascii=False) + "\n", removed


def scrub_agents_block(text: str) -> tuple:
    """Remove the TRELLIS:START..END block. Returns the new text and the removed block."""
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.strip() == BLOCK_START]
    ends = [i for i, line in enumerate(lines) if line.strip() == BLOCK_END]
    if not starts and not ends:
        return text, None
    if len(starts) != 1 or len(ends) != 1 or starts[0] > ends[0]:
        raise TinyError(f"AGENTS.md has {len(starts)} TRELLIS:START and {len(ends)} TRELLIS:END "
                        "markers; expected one pair. Fix them by hand and run init again.")
    removed = "".join(lines[starts[0]:ends[0] + 1])
    before, after = lines[:starts[0]], lines[ends[0] + 1:]
    if not "".join(before).strip():
        while after and not after[0].strip():
            after.pop(0)
        before = []
    kept = before + after
    while kept and not kept[-1].strip():
        kept.pop()
    new_text = "".join(kept)
    if new_text and not new_text.endswith(("\n", "\r\n")):
        new_text += "\r\n" if "\r\n" in text else "\n"
    return new_text, removed


def _scrub_events(hooks: dict, moved: set) -> tuple:
    kept_events, removed, unclear = {}, [], []
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            kept_events[event] = groups
            continue
        kept_groups = []
        for group in groups:
            handlers = group.get("hooks") if isinstance(group, dict) else None
            if not isinstance(handlers, list):
                kept_groups.append(group)
                continue
            kinds = [(h, _command_kind(h, moved)) for h in handlers]
            removed += [{"event": event, "matcher": group.get("matcher"), "handler": h}
                        for h, kind in kinds if kind == "upstream"]
            unclear += [h for h, kind in kinds if kind == "unclear"]
            rest = [h for h, kind in kinds if kind != "upstream"]
            if rest:
                kept_groups.append({**group, "hooks": rest})
        if kept_groups:
            kept_events[event] = kept_groups
    return kept_events, removed, unclear


def _command_kind(entry: object, moved: set) -> str:
    """"upstream" when a Python interpreter runs a moved upstream script, the form upstream
    writes; "unclear" when the last token is such a script but the first is not Python
    (it might be a user's own hook); "other" otherwise."""
    command = entry.get("command") if isinstance(entry, dict) else None
    if not isinstance(command, str) or not command.strip():
        return "other"
    tokens = command.split()
    script = tokens[-1].strip("\"'").replace("\\", "/")
    if not any(script == path or script.endswith("/" + path) for path in moved):
        return "other"
    program = tokens[0].strip("\"'").replace("\\", "/").rsplit("/", 1)[-1].lower()
    return "upstream" if PYTHON_PROGRAM.fullmatch(program) else "unclear"
