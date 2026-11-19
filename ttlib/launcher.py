"""`tt install` and `tt uninstall`: put the `tt` command on this machine's PATH.

Like npm's global installs, this writes small launcher scripts into a folder on
PATH; each runs this checkout's tt.py with a fixed Python interpreter. Updating
the checkout (for example with `git pull`) updates the command. Only launchers
carrying the MARKER line are ever overwritten or removed.
"""
from __future__ import annotations

import os
import subprocess
import sys
import sysconfig
from pathlib import Path

from .errors import TinyError
from .files import read_optional, write_exact

MARKER = "tiny-trellis launcher, written by `tt install`"
SOURCE_SCRIPT = Path(__file__).resolve().parents[1] / "tt.py"
SCRIPTS_PROBE = "import sysconfig; print(sysconfig.get_path('scripts'))"
VERSION_PROBE = "import sys; print(sys.version_info >= (3, 9))"


def install(python: str | None, bin_dir: str | None) -> int:
    interpreter = _interpreter(python)
    target = Path(bin_dir) if bin_dir else _default_bin_dir(interpreter)
    if not SOURCE_SCRIPT.is_file():
        raise TinyError(f"{SOURCE_SCRIPT} is missing; run install from a tiny-trellis checkout")
    launchers = _launchers(interpreter, SOURCE_SCRIPT)
    for path in launchers:
        _require_ours_or_absent(target / path)
    target.mkdir(parents=True, exist_ok=True)
    for name, text in launchers.items():
        path = target / name
        write_exact(path, text)
        if not name.endswith(".cmd"):
            path.chmod(0o755)
        print(f"wrote {path}")
    print(f"`tt` now runs {SOURCE_SCRIPT} with {interpreter}.")
    if not _on_path(target):
        print(f"{target} is not on PATH yet. Add it to PATH, then open a new terminal.")
    return 0


def uninstall(python: str | None, bin_dir: str | None) -> int:
    target = Path(bin_dir) if bin_dir else _default_bin_dir(_interpreter(python))
    removed = 0
    for name in ("tt", "tt.cmd"):
        path = target / name
        text = read_optional(path)
        if text is None:
            continue
        if MARKER not in text:
            print(f"left {path}: it was not written by `tt install`")
            continue
        path.unlink()
        removed += 1
        print(f"removed {path}")
    if removed == 0:
        print(f"no tiny-trellis launcher found in {target}")
    return 0


def _launchers(interpreter: str, script: Path) -> dict:
    """Launcher scripts by file name. On Windows, tt.cmd serves cmd and PowerShell, and the
    extensionless `tt` serves Git Bash, which does not look for .cmd files."""
    python_posix, script_posix = Path(interpreter).as_posix(), script.as_posix()
    shell = (f"#!/bin/sh\n# {MARKER}\n"
             f"exec \"{python_posix}\" \"{script_posix}\" \"$@\"\n")
    if sys.platform != "win32":
        return {"tt": shell}
    batch = (f"@echo off\r\nrem {MARKER}\r\n"
             f"\"{interpreter}\" \"{script}\" %*\r\n")
    return {"tt": shell, "tt.cmd": batch}


def _interpreter(python: str | None) -> str:
    """The running interpreter (the launcher starts it as python3), or the one given."""
    if python is None:
        return sys.executable
    probe = subprocess.run([python, "-c", VERSION_PROBE], capture_output=True, text=True)
    if probe.returncode != 0 or probe.stdout.strip() != "True":
        raise TinyError(f"{python} is not a Python 3.9+ interpreter "
                        f"(exit {probe.returncode}: {probe.stderr.strip() or probe.stdout.strip()})")
    path = subprocess.run([python, "-c", "import sys; print(sys.executable)"],
                          capture_output=True, text=True, check=True)
    return path.stdout.strip()


def _default_bin_dir(interpreter: str) -> Path:
    """Windows: the interpreter's Scripts folder, where pip puts commands too.
    Elsewhere: ~/.local/bin."""
    if sys.platform != "win32":
        return Path.home() / ".local" / "bin"
    if Path(interpreter) == Path(sys.executable):
        return Path(sysconfig.get_path("scripts"))
    probe = subprocess.run([interpreter, "-c", SCRIPTS_PROBE], capture_output=True, text=True,
                           check=True)
    return Path(probe.stdout.strip())


def _require_ours_or_absent(path: Path) -> None:
    text = read_optional(path)
    if text is not None and MARKER not in text:
        raise TinyError(f"{path} already exists and was not written by `tt install`. "
                        "Remove it, or pass --bin-dir to install somewhere else.")


def _on_path(folder: Path) -> bool:
    wanted = os.path.normcase(str(folder.resolve()))
    entries = os.environ.get("PATH", "").split(os.pathsep)
    return any(os.path.normcase(str(Path(entry).resolve())) == wanted
               for entry in entries if entry)
