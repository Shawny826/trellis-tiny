"""Text edits that init makes to files the user also edits: AGENTS.md and CLAUDE.md."""
from __future__ import annotations

from .errors import TinyError

BEGIN_PREFIX = "<!-- tiny-trellis:begin"
END_LINE = "<!-- tiny-trellis:end -->"
IMPORT_LINE = "@AGENTS.md"


def apply_block(existing: str | None, block: str) -> str:
    """Insert or replace the managed block, leaving text outside the markers alone."""
    block = block.replace("\r\n", "\n")
    if not block.endswith("\n"):
        block += "\n"
    if existing is None or not existing.strip():
        return block
    eol = line_ending(existing)
    block = block.replace("\n", eol)
    lines = existing.splitlines(keepends=True)
    begins = [i for i, line in enumerate(lines) if line.strip().startswith(BEGIN_PREFIX)]
    ends = [i for i, line in enumerate(lines) if line.strip() == END_LINE]
    if not begins and not ends:
        return existing.rstrip("\r\n") + eol + eol + block
    if len(begins) == 1 and len(ends) == 1 and begins[0] < ends[0]:
        return "".join(lines[: begins[0]]) + block + "".join(lines[ends[0] + 1:])
    raise TinyError(
        f"AGENTS.md has {len(begins)} begin and {len(ends)} end tiny-trellis markers; "
        "expected one pair. Fix the markers by hand and run init again."
    )


def with_import(existing: str | None) -> str:
    """CLAUDE.md content that imports AGENTS.md, so Claude Code reads the managed block."""
    if existing is None or not existing.strip():
        return IMPORT_LINE + "\n"
    if any(line.strip() == IMPORT_LINE for line in existing.splitlines()):
        return existing
    eol = line_ending(existing)
    return IMPORT_LINE + eol + eol + existing


def line_ending(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"
