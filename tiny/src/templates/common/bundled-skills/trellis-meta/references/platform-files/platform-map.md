# Platform File Map

This page lists trellis-tiny file locations in a user project by platform. Whether a platform directory exists in an actual project depends on which `tt init --<platform>` flags the user ran (trellis-tiny supports `--codex`, `--zcode`, `--dsh`; claude-code is a dormant extension slot that installs nothing).

## Matrix

| Platform | CLI flag | Main directory | Skill directory | Agent directory | Hooks/extensions |
| --- | --- | --- | --- | --- | --- |
| Codex | `--codex` | `.codex/` | `.agents/skills/` (shared root) + `.codex/skills/` (empty, user extensions) | `.codex/agents/` | `.codex/hooks/` + `.codex/hooks.json` |
| ZCode | `--zcode` | `.zcode/` | `.agents/skills/` (shared root — no private skill copy is written) | `.zcode/agents/` | `.zcode/hooks/` + `.zcode/config.json` (SessionStart + UserPromptSubmit + PreToolUse Agent/Task); sub-agents use hook-injected context |
| DeepSeek Harness (dsh) | `--dsh` | `.dsh/` | `.agents/skills/` (shared) + `.dsh/skills/` (three command-entry skills) | None (workflow skills run implement/check inline) | None (pull-based; no project hooks/settings) |

## Capability Groups

### Trellis Sub-Agent Support

These platforms ship `trellis-research`, `trellis-implement`, and `trellis-check` files:

- Codex (`.codex/agents/*.toml`)
- ZCode (`.zcode/agents/*.md`; context injected by the PreToolUse `Agent|Task` hook)

dsh has no project-level sub-agent surface — implement/check/research run inline through the workflow skills.

When changing implementation/check/research behavior, look for the corresponding platform agent files first.

### Shared `.agents/skills/`

Codex, ZCode, and DeepSeek Harness (dsh) all write the shared `.agents/skills/` layer — it is the single trellis-tiny skill root, and every file written there is byte-identical regardless of which platform's configurator produced it. ZCode reads both it and its own private root, which is why the old private-root skill copy was removed (see `local-architecture/bundled-skills.md`). Tools that support the agentskills.io standard can read `.agents/skills/` too, but do not assume every tool does.

## Decision Rules When Modifying Platform Files

1. User specified a platform: modify only that platform directory unless shared workflow/spec files must also change.
2. User says "all platforms should do this": synchronize equivalent entry points platform by platform; do not modify only one directory.
3. User only says "my AI": inspect the configuration directories that actually exist in the project and infer the current AI platform.
4. User wants project rules: prefer `.trellis/spec/` or a project-local skill.
5. User wants Trellis behavior: edit `.trellis/workflow.md` plus platform hooks/agents/skills/commands.

## When Paths Differ

Platform ecosystems change, and user projects may already be customized. If this table disagrees with local files, use the actual settings/config in the user project as authoritative:

- Check the hook that settings registers.
- Check the script that a command/prompt/workflow points to.
- Judge behavior by the read rules currently written in the agent file.

Do not delete a custom file just because it is not listed in this path table.
