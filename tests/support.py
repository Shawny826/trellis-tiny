"""Shared helpers: a throwaway Git repository per test and a runner for tt.py."""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_SCRIPT = SOURCE_ROOT / "tt.py"
sys.path.insert(0, str(SOURCE_ROOT))


def _make_writable_and_retry(function, path, _details):
    os.chmod(path, stat.S_IWRITE)
    function(path)


def remove_temp_tree(path: Path) -> None:
    """Delete a directory that this test suite created under the system temp directory."""
    temp_root = Path(tempfile.gettempdir()).resolve()
    resolved = path.resolve()
    if temp_root not in resolved.parents or not resolved.name.startswith("tt-test-"):
        raise AssertionError(f"refusing to delete {resolved}: not a tt-test temp directory")
    if sys.version_info >= (3, 12):
        shutil.rmtree(resolved, onexc=_make_writable_and_retry)
    else:
        shutil.rmtree(resolved, onerror=_make_writable_and_retry)


def make_temp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="tt-test-")).resolve()


class RepoTestCase(unittest.TestCase):
    """Each test gets a fresh repository with one commit containing README.md."""

    def setUp(self) -> None:
        self.root = make_temp_dir()
        self.addCleanup(remove_temp_tree, self.root)
        self.git("init", "-q")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "commit.gpgsign", "false")
        self.write("README.md", "hello\n")
        self.commit("initial")

    def git(self, *args: str) -> str:
        completed = subprocess.run(
            ["git", *args], cwd=self.root, capture_output=True, text=True, encoding="utf-8"
        )
        if completed.returncode != 0:
            raise AssertionError(f"git {' '.join(args)} failed: {completed.stderr}")
        return completed.stdout

    def commit(self, message: str) -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def write(self, relative: str, text: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        return path

    def read(self, relative: str) -> str:
        with open(self.root / relative, encoding="utf-8", newline="") as handle:
            return handle.read()

    def tt(self, *args: str, stdin: str | None = None, script: Path | None = None,
           env: dict | None = None) -> subprocess.CompletedProcess:
        script = script or self.root / ".trellis" / "tiny" / "tt.py"
        return subprocess.run(
            [sys.executable, str(script), *args],
            cwd=self.root,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, **(env or {})},
        )

    def install(self, *flags: str) -> subprocess.CompletedProcess:
        completed = self.tt("init", *(flags or ("--claude", "--codex")), script=SOURCE_SCRIPT)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed

    def hook(self, command: str, extra: dict | None = None,
             env: dict | None = None) -> subprocess.CompletedProcess:
        payload = json.dumps({"cwd": str(self.root), **(extra or {})})
        return self.tt(command, "--hook", stdin=payload, env=env)

    def assert_ok(self, completed: subprocess.CompletedProcess) -> None:
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
