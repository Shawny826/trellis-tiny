"""Reading and writing text files without changing their line endings."""
from __future__ import annotations

from pathlib import Path


def read_exact(path: Path) -> str:
    with open(path, encoding="utf-8", newline="") as handle:
        return handle.read()


def read_optional(path: Path) -> str | None:
    """Return the file's text, or None when the file does not exist."""
    return read_exact(path) if path.is_file() else None


def write_exact(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def append_exact(path: Path, text: str) -> None:
    with open(path, "a", encoding="utf-8", newline="") as handle:
        handle.write(text)
