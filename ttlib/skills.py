"""The tiny-trellis skills, written for each platform from one source per skill.

Each source SKILL.md has only `name` and `description` in its frontmatter, the
fields both platforms read. Skills the user starts by hand are marked per platform:
Claude Code with `disable-model-invocation: true` in the frontmatter (its
description then stays out of context), and Codex with
`policy.allow_implicit_invocation: false` in agents/openai.yaml.
"""
from __future__ import annotations

from pathlib import Path

from .errors import TinyError
from .files import read_exact

SOURCE = Path(__file__).resolve().parent / "assets" / "skills"
USER_ONLY = ("tt-digest", "tt-bootstrap")
CLAUDE_USER_ONLY_LINE = "disable-model-invocation: true\n"
CODEX_USER_ONLY_POLICY = "policy:\n  allow_implicit_invocation: false\n"


def skill_names() -> list:
    return sorted(path.parent.name for path in SOURCE.glob("*/SKILL.md"))


def claude_skills() -> dict:
    """Relative path -> content for .claude/skills/."""
    files = {}
    for name in skill_names():
        text = _source(name)
        if name in USER_ONLY:
            text = _add_frontmatter_line(text, CLAUDE_USER_ONLY_LINE, name)
        files[Path(".claude", "skills", name, "SKILL.md")] = text
    return files


def codex_skills() -> dict:
    """Relative path -> content for .agents/skills/, the folder Codex reads skills from."""
    files = {}
    for name in skill_names():
        folder = Path(".agents", "skills", name)
        files[folder / "SKILL.md"] = _source(name)
        if name in USER_ONLY:
            files[folder / "agents" / "openai.yaml"] = CODEX_USER_ONLY_POLICY
    return files


def _source(name: str) -> str:
    return read_exact(SOURCE / name / "SKILL.md").replace("\r\n", "\n")


def _add_frontmatter_line(text: str, line: str, name: str) -> str:
    if not text.startswith("---\n"):
        raise TinyError(f"skill {name} has no frontmatter on its first line")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise TinyError(f"skill {name} has an unterminated frontmatter")
    return text[:end + 1] + line + text[end + 1:]
