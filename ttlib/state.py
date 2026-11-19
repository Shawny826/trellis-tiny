"""Per-machine runtime state in .trellis/tiny/.runtime/state.json."""
from __future__ import annotations

import json
import os
from pathlib import Path

from .errors import TinyError
from .project import Project
from .snapshot import Snapshot, pin_baseline, snapshot_from_dict


def _path(project: Project) -> Path:
    return project.runtime / "state.json"


def load_state(project: Project) -> dict:
    """The saved state, or an empty dict before init has recorded anything."""
    path = _path(project)
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(project: Project, state: dict) -> None:
    path = _path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def load_baseline(project: Project, state: dict) -> Snapshot:
    """The snapshot recorded by the last finish (or by init)."""
    if "last_finish" not in state:
        raise TinyError("no baseline is recorded on this machine; run init")
    return snapshot_from_dict(project.root, state["last_finish"])


def record_baseline(project: Project, state: dict, snapshot: Snapshot) -> dict:
    """Save snapshot as the new baseline and return the new state."""
    pin_baseline(project.root, snapshot)
    new_state = {key: value for key, value in state.items() if key != "last_block"}
    new_state["last_finish"] = snapshot.to_dict()
    new_state["last_pass"] = snapshot.key
    save_state(project, new_state)
    return new_state
