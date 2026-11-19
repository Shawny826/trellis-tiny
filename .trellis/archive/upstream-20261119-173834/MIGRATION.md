# Migration from Trellis

tiny-trellis replaced the upstream Trellis installation on 2026-11-19 17:38. Nothing was deleted. To undo it, move the files below back to the same relative paths and put the removed entries back into their files.

## Moved into this folder

- .trellis/config.yaml
- .trellis/scripts/__init__.py
- .trellis/scripts/add_session.py
- .trellis/scripts/common/__init__.py
- .trellis/scripts/common/active_task.py
- .trellis/scripts/common/cli_adapter.py
- .trellis/scripts/common/config.py
- .trellis/scripts/common/developer.py
- .trellis/scripts/common/git.py
- .trellis/scripts/common/git_context.py
- .trellis/scripts/common/io.py
- .trellis/scripts/common/log.py
- .trellis/scripts/common/packages_context.py
- .trellis/scripts/common/paths.py
- .trellis/scripts/common/safe_commit.py
- .trellis/scripts/common/session_context.py
- .trellis/scripts/common/task_context.py
- .trellis/scripts/common/task_queue.py
- .trellis/scripts/common/task_store.py
- .trellis/scripts/common/task_utils.py
- .trellis/scripts/common/tasks.py
- .trellis/scripts/common/trellis_config.py
- .trellis/scripts/common/types.py
- .trellis/scripts/common/workflow_phase.py
- .trellis/scripts/get_context.py
- .trellis/scripts/get_developer.py
- .trellis/scripts/init_developer.py
- .trellis/scripts/task.py
- .trellis/workflow.md
- .trellis/.template-hashes.json
- .trellis/.version

## Removed from shared files

(none)

## Notes

- 3 file(s) in the upstream manifest are not handled by this migration (tiny-trellis supports Claude Code and Codex only) and were left in place; they may depend on the archived upstream scripts, so review them (listed in MIGRATION.md): .zcode/agents/trellis-check.md, .zcode/config.json, .zcode/hooks/inject-subagent-context.py
- 17 file(s) in the upstream manifest were already missing
- spec/, tasks/, and workspace/ stay in place; old journals sit next to tiny-trellis's own tiny-journal.md
## Not handled, left in place

These files are in the upstream manifest but this migration does not handle them; most belong to platforms other than Claude Code and Codex. Their hooks and settings were not changed. They may run upstream scripts that were moved into this folder, such as `.trellis/scripts/`, so Trellis on those platforms may stop working. Move, delete, or fix them by hand.

- .zcode/agents/trellis-check.md
- .zcode/config.json
- .zcode/hooks/inject-subagent-context.py
