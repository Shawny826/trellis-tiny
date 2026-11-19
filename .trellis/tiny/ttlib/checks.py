"""Project checks: Python scripts in .trellis/tiny/checks/ that judge the changed files.

Each check receives a JSON object on stdin with `root` (the project root) and
`changed_files` (paths relative to it, deletions included). Exit code 0 means
pass, 1 means the check found a problem, and anything else means the check
itself could not run.
"""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .project import Project

CHECK_TIMEOUT_SECONDS = 300
OUTPUT_LIMIT = 2000


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: str
    output: str

    @property
    def passed(self) -> bool:
        return self.status == "pass"


def discover(project: Project) -> list:
    if not project.checks.is_dir():
        return []
    return sorted(
        path for path in project.checks.glob("*.py") if not path.name.startswith("_")
    )


def run_checks(project: Project, files: list) -> list:
    payload = json.dumps({"root": str(project.root), "changed_files": files})
    return [_run_one(project, script, payload.encode("utf-8")) for script in discover(project)]


def all_passed(results: list) -> bool:
    return all(result.passed for result in results)


def describe_failures(results: list) -> str:
    lines = []
    for result in results:
        if result.passed:
            continue
        label = "failed" if result.status == "fail" else "could not run"
        lines.append(f"- {result.name} {label}: {result.output or '(no output)'}")
    return "\n".join(lines)


def summarize(results: list) -> str:
    if not results:
        return "no project checks registered"
    passed = sum(1 for result in results if result.passed)
    return f"{passed}/{len(results)} passed"


def _run_one(project: Project, script: Path, payload: bytes) -> CheckResult:
    try:
        completed = subprocess.run(
            [sys.executable, str(script)],
            input=payload,
            cwd=project.root,
            capture_output=True,
            timeout=CHECK_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(script.name, "error", f"timed out after {CHECK_TIMEOUT_SECONDS} s")
    output = (completed.stdout + completed.stderr).decode("utf-8", "replace").strip()
    output = output[-OUTPUT_LIMIT:]
    if completed.returncode == 0:
        return CheckResult(script.name, "pass", output)
    if completed.returncode == 1:
        return CheckResult(script.name, "fail", output)
    return CheckResult(script.name, "error", f"exited with code {completed.returncode}: {output}")
