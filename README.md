# tiny-trellis

A lightweight project workflow for Claude Code and Codex. The design rationale is in [`docs/design.md`](docs/design.md); Chinese reading copies of the managed block, the skills, and the reviewer are in [`docs/zh/`](docs/zh/).

Requirements: Python 3.9 or newer (standard library only), Git, and a project repository with at least one commit. On Windows, verification commands run in Git Bash; if Git Bash isn't installed, PowerShell 7 is used.

## Installing the `tt` command (once per machine)

Clone tiny-trellis, then run its launcher from the checkout. This is the counterpart of `npm install -g` for upstream Trellis, without pip or a network download:

```bash
git clone <repository url> tiny-trellis
```

```bash
cd tiny-trellis
```

```bash
./tt install
```

In cmd or PowerShell, the last step is `.\tt install`.

- The launcher at the top of the checkout (`tt` for Git Bash, macOS, and Linux; `tt.cmd` for cmd and PowerShell) runs `tt.py` with the first Python 3.9+ it finds: `python3`, then `python`, then `py -3`. Pass `--python <path>` to `install` to pick another interpreter.
- `tt install` writes two small launchers into a folder on `PATH`: on Windows the interpreter's `Scripts` folder, elsewhere `~/.local/bin`. They point at this checkout, so `git pull` updates the command. Use `--bin-dir <folder>` to put them elsewhere.
- It never overwrites a `tt` that it did not write. `tt uninstall` removes only its own launchers.
- tiny-trellis does not install Python. If none is found, the launcher says so and points to https://www.python.org/downloads/.

Check it in a new terminal with `tt --version`.

## Setting up a project

Run this from the project's root directory:

```bash
tt init
```

- A project without tiny-trellis gets a fresh install: the `.trellis/` folders, the managed block in `AGENTS.md`, hooks, the reviewer subagent, and the skills. With no flags it sets up both Claude Code and Codex; `--claude` or `--codex` sets up only one.
- Once it finishes, start a new agent session. In Codex, you also need to review and trust the hooks with `/hooks` before they take effect.
- Use `--dry-run` to list the changes without writing anything.
- If the project has an upstream Trellis installation, init stops and asks for `--migrate`. See "Migrating from Trellis" below.

## Upgrading a project

Update tiny-trellis itself (`git pull` in its checkout), then run the same command in each project:

```bash
tt init
```

In a project that already has tiny-trellis, `init` upgrades it to the installed version and keeps the platforms recorded in `.trellis/tiny/config.json`. A flag such as `--codex` adds a platform.

- Files tiny-trellis wrote whole (its own code, the skills, the reviewer agents) are tracked with hashes in `.trellis/tiny/manifest.json`. One that still matches its hash is replaced; the old copy goes to `.trellis/tiny/.backup-<time>/`.
- A file you changed by hand stops the upgrade with a list. Run `tt init --force` to back up your version and overwrite it, or `tt init --keep` to leave it as it is.
- A skill or agent file you deleted is not recreated. Deleted tiny-trellis code is restored.
- Files an earlier version installed and this one no longer does are moved into the backup folder, unless you changed them.
- A project set up by a newer version is not downgraded unless you pass `--allow-downgrade`.
- If the working tree had no unrecorded work before the upgrade, the status line stays clean afterwards; review `git status` and commit the upgrade.

What init writes:

| Location | Contents | Committed |
|---|---|---|
| `.trellis/tiny/` | The CLI copy the hooks run, `config.json` (version and platforms), and `manifest.json` (hashes of owned files) | Yes |
| `.trellis/tiny/.runtime/`, `.trellis/tiny/.backup-*/` | This machine's interpreter, shell, and baseline snapshot; backups from upgrades | No |
| `.trellis/spec/index.md` | Knowledge index template (only when the file doesn't exist) | Yes |
| `AGENTS.md` | The managed block (only the content between the markers is replaced) | Yes |
| `CLAUDE.md` | The `@AGENTS.md` import line | Yes |
| `.claude/agents/`, `.codex/agents/` | Reviewer subagent definitions | Yes |
| `.claude/skills/tt-*/`, `.agents/skills/tt-*/` | The six skills, for Claude Code and Codex respectively | Yes |
| `.claude/settings.local.json`, `.codex/hooks.json` | Hooks (contain machine-specific paths) | No, excluded via `.git/info/exclude` |

## Migrating from Trellis

Commit or stash your work first, then preview and run the migration:

```bash
tt init --migrate --dry-run
```

```bash
tt init --migrate
```

Nothing is deleted. The migration works from upstream's own install manifest, `.trellis/.template-hashes.json`:

- Files upstream installed move into `.trellis/archive/upstream-<time>/` under their original relative paths.
- Upstream hooks are removed from `.claude/settings.json` and `.codex/hooks.json`, and the `TRELLIS:START`…`TRELLIS:END` block is removed from `AGENTS.md`. Everything removed is copied verbatim into the archive's `MIGRATION.md`, so it can be put back.
- `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` stay where they are. Old tasks get an index in `.trellis/spec/upstream-tasks.md`.
- `.codex/config.toml` is left unchanged.

The migration stops without changing anything when:

- the working tree has uncommitted changes (`--dry-run` does not need a clean tree);
- the manifest is missing or not in its version 2 format (run `trellis update` with the upstream CLI first);
- a hook runs an upstream script without a Python interpreter, so it is unclear whose it is.

Files named `trellis*` that are not in the manifest (often left by older upstream versions) are listed in `MIGRATION.md` and left in place for you to review.

Files in the manifest that the migration does not handle, mostly those of platforms other than Claude Code and Codex (such as `.cursor/` or `.zcode/`), are also left in place, together with their hooks and settings, and listed in the output and in `MIGRATION.md`. They may run upstream scripts the migration archived, such as `.trellis/scripts/`, so Trellis on those platforms may stop working until you move, delete, or fix them.

## Commands

In daily use these commands are run by the agent following the managed block; you don't need to type them yourself.

```bash
python3 .trellis/tiny/tt.py status
```

```bash
python3 .trellis/tiny/tt.py task new "Retry policy refactor"
```

```bash
python3 .trellis/tiny/tt.py finish --reason "One sentence explaining the change" --verify "python -m pytest -q" --review self
```

```bash
python3 .trellis/tiny/tt.py check
```

- `finish` runs the project checks first, then the verification command. If either fails, nothing is recorded. Use `--no-verify "<reason>"` when there is nothing to verify.
- `finish` does not commit. It only records the commit hash and the working tree state at that moment.

## Skills

The managed block in `AGENTS.md` keeps only the rules that always apply. The procedures live in skills, whose full text loads only when they are used:

| Skill | Used for | Invoked by |
|---|---|---|
| `tt-clarify` | Settling an ambiguous request one question at a time | The agent, or you |
| `tt-task` | Creating, resuming, handing off, and closing cross-session tasks | The agent, or you |
| `tt-review` | Independent review of a high-risk change through the reviewer subagent | The agent, or you |
| `tt-record` | Writing a confirmed decision or a lesson from a fix into `.trellis/spec/` | The agent, or you |
| `tt-digest` | Distilling old tasks and journals into specs, one topic at a time | You only |
| `tt-bootstrap` | Writing the first specs and the knowledge index from the repository | You only |

Start a skill in Claude Code with `/tt-bootstrap`, and in Codex with `$tt-bootstrap` or `/skills`.

## Project checks

Put Python scripts in `.trellis/tiny/checks/` (files whose names start with `_` are ignored), then run init again to install the end-of-turn hook.

- Input: a JSON object on stdin, `{"root": "<project root>", "changed_files": ["<relative path>", ...]}`, listing changes since the last finish, including deleted files.
- Exit codes: `0` passes, `1` means a problem was found (stdout and stderr are shown to the agent), and any other code means the check itself couldn't run.

## Running the tests

```bash
python -m unittest discover -s tests
```
