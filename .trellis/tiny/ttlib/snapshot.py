"""Content snapshots of the working tree that do not depend on how it is committed.

A snapshot maps every path to its Git blob hash. Tracked content comes from a
`git stash create` commit, which leaves the stash list and the working tree
untouched; untracked, non-ignored files are hashed with `git hash-object`, so
they get the same hash they will have once committed. Committing recorded work
therefore leaves the snapshot key unchanged.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from .errors import TinyError
from .project import git

BASELINE_REF = "refs/worktree/tiny-trellis/last-finish"
NESTED_REPOSITORY = "nested-repository"


@dataclass(frozen=True)
class Snapshot:
    commit: str
    untracked: dict
    entries: dict

    @property
    def key(self) -> str:
        digest = hashlib.sha256()
        for path in sorted(self.entries):
            digest.update(f"{path}\0{self.entries[path]}\0".encode("utf-8"))
        return digest.hexdigest()

    def to_dict(self) -> dict:
        return {"commit": self.commit, "untracked": dict(self.untracked)}


def take_snapshot(root: Path) -> Snapshot:
    stashed = git(root, "stash", "create").strip()
    commit = stashed or git(root, "rev-parse", "HEAD").strip()
    return _build(root, commit, _hash_untracked(root))


def snapshot_from_dict(root: Path, data: dict) -> Snapshot:
    return _build(root, data["commit"], dict(data["untracked"]))


def changed_files(base: Snapshot, current: Snapshot) -> list:
    """Paths whose content differs between two snapshots, including deletions."""
    paths = set(base.entries) | set(current.entries)
    return sorted(p for p in paths if base.entries.get(p) != current.entries.get(p))


def has_uncommitted(root: Path, snapshot: Snapshot) -> bool:
    head = git(root, "rev-parse", "HEAD").strip()
    return snapshot.commit != head or bool(snapshot.untracked)


def pin_baseline(root: Path, snapshot: Snapshot) -> None:
    """Keep the baseline commit reachable so `git gc` cannot prune its objects."""
    git(root, "update-ref", BASELINE_REF, snapshot.commit)


def _build(root: Path, commit: str, untracked: dict) -> Snapshot:
    return Snapshot(commit, untracked, {**_tracked_entries(root, commit), **untracked})


def _tracked_entries(root: Path, commit: str) -> dict:
    listing = git(root, "ls-tree", "-r", "-z", commit)
    entries = {}
    for record in filter(None, listing.split("\0")):
        meta, path = record.split("\t", 1)
        entries[path] = meta.split()[2]
    return entries


def _hash_untracked(root: Path) -> dict:
    listing = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    paths = list(filter(None, listing.split("\0")))
    nested = {path: NESTED_REPOSITORY for path in paths if (root / path).is_dir()}
    files = [path for path in paths if path not in nested]
    if not files:
        return nested
    hashes = git(root, "hash-object", "--stdin-paths", stdin="\n".join(files) + "\n").split()
    if len(hashes) != len(files):
        raise TinyError(f"git hash-object returned {len(hashes)} hashes for {len(files)} files")
    return {**dict(zip(files, hashes)), **nested}
