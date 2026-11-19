"""Finding the interpreter and the shell this machine should use.

The shell runs `finish --verify` commands. On Windows it is Git Bash when
installed and PowerShell 7 otherwise; WSL's bash.exe in System32 is not Git Bash.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .errors import TinyError

INTERPRETER_CANDIDATES = (("python3",), ("python",), ("py", "-3"))
VERSION_PROBE = "import sys; print(sys.version_info >= (3, 9))"
PROBE_TIMEOUT_SECONDS = 30


def detect_interpreter() -> list:
    tried = []
    for candidate in INTERPRETER_CANDIDATES:
        if shutil.which(candidate[0]) is None:
            tried.append(f"{candidate[0]}: not on PATH")
            continue
        probe = subprocess.run(
            [*candidate, "-c", VERSION_PROBE], capture_output=True, timeout=PROBE_TIMEOUT_SECONDS
        )
        if probe.returncode == 0 and probe.stdout.strip() == b"True":
            return list(candidate)
        tried.append(f"{' '.join(candidate)}: exit {probe.returncode}, printed {probe.stdout.strip()!r}")
    raise TinyError("no Python 3.9+ interpreter found on PATH (" + "; ".join(tried) + ")")


def detect_shell() -> dict:
    if sys.platform != "win32":
        bash = shutil.which("bash")
        if bash is None:
            raise TinyError("bash is not on PATH; it runs the finish --verify commands")
        return {"kind": "bash", "argv": [bash, "-c"]}
    bash = _git_bash()
    if bash is not None:
        return {"kind": "git-bash", "argv": [str(bash), "-c"]}
    pwsh = _pwsh7()
    if pwsh is not None:
        return {"kind": "pwsh", "argv": [pwsh, "-NoProfile", "-NonInteractive", "-Command"]}
    raise TinyError("neither Git Bash nor PowerShell 7 was found; install one of them")


def _git_bash() -> Path | None:
    configured = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if configured:
        path = Path(configured)
        if not path.is_file():
            raise TinyError(f"CLAUDE_CODE_GIT_BASH_PATH points to a missing file: {path}")
        return path
    for candidate in _git_bash_candidates():
        if candidate.is_file():
            return candidate
    return None


def _git_bash_candidates() -> list:
    candidates = []
    git = shutil.which("git")
    if git is not None:
        exec_path = subprocess.run(["git", "--exec-path"], capture_output=True, text=True)
        if exec_path.returncode != 0:
            raise TinyError(f"git --exec-path failed: {exec_path.stderr.strip()}")
        git_root = Path(exec_path.stdout.strip()).parents[2]
        candidates += [git_root / "bin" / "bash.exe", git_root / "usr" / "bin" / "bash.exe"]
    on_path = shutil.which("bash")
    system_dir = Path(os.environ.get("SystemRoot", r"C:\Windows")).resolve()
    if on_path is not None and system_dir not in Path(on_path).resolve().parents:
        candidates.append(Path(on_path))
    return candidates


def _pwsh7() -> str | None:
    pwsh = shutil.which("pwsh")
    if pwsh is None:
        return None
    probe = subprocess.run(
        [pwsh, "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"],
        capture_output=True,
        text=True,
        timeout=PROBE_TIMEOUT_SECONDS,
    )
    if probe.returncode != 0:
        raise TinyError(f"pwsh was found at {pwsh} but failed to start: {probe.stderr.strip()}")
    return pwsh if int(probe.stdout.strip()) >= 7 else None
