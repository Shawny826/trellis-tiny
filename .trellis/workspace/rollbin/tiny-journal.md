# Change journal (tiny-trellis)

## 2026-11-19 17:42
- Reason: Mark the TypeScript-era specs in the knowledge index and rewrite the AGENTS.md leftover section after migrating this repository to tiny-trellis
- Changed: .trellis/spec/index.md, AGENTS.md
- Verify: none — docs-only change to AGENTS.md and the knowledge index
- Checks: no project checks registered
- Review: self
- Commit: f774619

## 2026-11-19 17:49
- Reason: Delete the leftover .zcode/ ZCode setup, whose hooks no longer worked after the migration, and describe the remaining TypeScript-era leftovers accurately in AGENTS.md
- Changed: .zcode/agents/trellis-check.md, .zcode/agents/trellis-implement.md, .zcode/agents/trellis-research.md, .zcode/commands/trellis/continue.md, .zcode/commands/trellis/finish-work.md, .zcode/config.json, .zcode/hooks/inject-shell-session-context.py, .zcode/hooks/inject-subagent-context.py, .zcode/hooks/inject-workflow-state.py, .zcode/hooks/session-start.py, AGENTS.md
- Verify: `test ! -e .zcode && test -z "$(git ls-files .zcode)"` — exit 0 — no output
- Checks: no project checks registered
- Review: independent
- Commit: 8396c3c (with uncommitted changes)
