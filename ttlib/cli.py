"""Command-line parsing and dispatch for tt.py."""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import traceback
from pathlib import Path

from . import __version__
from .errors import TinyError
from .finish import FinishOptions, finish
from .install import InitOptions, init
from .launcher import install, uninstall
from .project import Project, open_installed
from .tasks import close_task, new_task
from .turn import check_hook, check_now, status_line


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tt", description="tiny-trellis project workflow")
    parser.add_argument("--version", action="version", version=f"tiny-trellis {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    init_parser = commands.add_parser(
        "init", help="install tiny-trellis here, or upgrade the installation to this version")
    init_parser.add_argument("--claude", action="store_true",
                             help="set up Claude Code (with neither flag, a new install sets up both)")
    init_parser.add_argument("--codex", action="store_true", help="set up Codex")
    init_parser.add_argument("--dry-run", action="store_true", help="list changes only")
    # Migration is asked for interactively; --migrate answers yes without a terminal.
    init_parser.add_argument("--migrate", action="store_true", help=argparse.SUPPRESS)
    changed = init_parser.add_mutually_exclusive_group()
    changed.add_argument("--force", action="store_true",
                         help="back up tiny-trellis files you changed, then overwrite them")
    changed.add_argument("--keep", action="store_true",
                         help="leave tiny-trellis files you changed as they are")
    init_parser.add_argument("--allow-downgrade", action="store_true",
                             help="install this version over a newer one")

    for name, text in (("install", "put the tt command on this machine's PATH"),
                       ("uninstall", "remove the tt command that install wrote")):
        sub = commands.add_parser(name, help=text)
        sub.add_argument("--python", help="interpreter for tt (default: the one running now)")
        sub.add_argument("--bin-dir", help="folder on PATH for the launcher")

    for name, text in (("status", "print the status line"), ("check", "run project checks")):
        sub = commands.add_parser(name, help=text)
        sub.add_argument("--hook", action="store_true", help="read hook input from stdin")

    finish_parser = commands.add_parser("finish", help="check, verify, and record a change")
    finish_parser.add_argument("--reason", required=True, help="one sentence: why the change")
    verify = finish_parser.add_mutually_exclusive_group(required=True)
    verify.add_argument("--verify", help="command that shows the change works")
    verify.add_argument("--no-verify", dest="no_verify", help="why nothing can be run")
    finish_parser.add_argument("--review", required=True, choices=("self", "independent"))
    finish_parser.add_argument("--task", help="task file name, when more than one is active")

    task_parser = commands.add_parser("task", help="cross-session task files")
    task_commands = task_parser.add_subparsers(dest="task_command", required=True)
    task_commands.add_parser("new", help="create a task file").add_argument("title")
    task_commands.add_parser("close", help="mark a task closed").add_argument("name")
    return parser


def main(argv: list | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    if args.command == "check" and args.hook:
        return _guarded_check_hook()
    try:
        return _dispatch(args)
    except TinyError as error:
        print(f"tiny-trellis: {error}", file=sys.stderr)
        return 1


def _dispatch(args: argparse.Namespace) -> int:
    if args.command == "init":
        platforms = {name for name in ("claude", "codex") if getattr(args, name)}
        options = InitOptions(platforms, args.dry_run, args.migrate, args.force, args.keep,
                              args.allow_downgrade)
        return init(Path.cwd(), options)
    if args.command == "install":
        return install(args.python, args.bin_dir)
    if args.command == "uninstall":
        return uninstall(args.python, args.bin_dir)
    if args.command == "status":
        project = _hook_project(_read_hook_input()) if args.hook else open_installed(Path.cwd())
        print(status_line(project))
        return 0
    project = open_installed(Path.cwd())
    if args.command == "check":
        return check_now(project)
    if args.command == "finish":
        options = FinishOptions(args.reason, args.verify, args.no_verify, args.review, args.task)
        return finish(project, options)
    return _task(project, args)


def _task(project: Project, args: argparse.Namespace) -> int:
    if args.task_command == "new":
        path = new_task(project, args.title, datetime.date.today())
        print(f"Created {project.relative(path)}; fill in the goal and acceptance criteria.")
    else:
        path = close_task(project, args.name)
        print(f"Closed {project.relative(path)}.")
    return 0


def _guarded_check_hook() -> int:
    """A failure of the hook itself blocks the stop once, so a broken check never passes
    silently. If the stop was already continued by a hook and it fails again, the stop is
    let through with a warning instead of looping forever."""
    data: dict = {}
    try:
        data = _read_hook_input()
        return check_hook(_hook_project(data))
    except Exception:
        details = traceback.format_exc()
        if data.get("stop_hook_active") is True:
            warning = ("tiny-trellis: the end-of-turn check failed twice in a row, so this "
                       "stop was let through. Fix the check hook:\n" + details)
            print(json.dumps({"systemMessage": warning}, ensure_ascii=False))
            return 0
        print(details, file=sys.stderr)
        print("tiny-trellis: the end-of-turn check could not run, so this stop is blocked "
              "until the problem above is fixed.", file=sys.stderr)
        return 2


def _read_hook_input() -> dict:
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if not isinstance(data, dict) or "cwd" not in data:
        raise TinyError("hook input on stdin must be a JSON object with a cwd field")
    return data


def _hook_project(data: dict) -> Project:
    return open_installed(Path(os.path.expanduser(data["cwd"])))
