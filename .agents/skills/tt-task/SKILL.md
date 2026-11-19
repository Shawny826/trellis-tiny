---
name: tt-task
description: Create, resume, hand off, or close a cross-session task in .trellis/tasks/. Use when work likely won't finish in this session, when the status line names an active task, and at the end of every turn that moved such a task forward.
---

# Cross-session task

The task file is all a new session has, so it must be enough to continue the work without this conversation. You can't see when a session ends — the user may just close it — so keep the file current turn by turn rather than waiting for a last moment.

## Start
1. Run `task new "<title>"`. It creates `.trellis/tasks/<date>-<slug>.md` with the sections below.
2. Fill in Goal (one or two sentences) and Acceptance criteria (each checkable by a command, a test, or an observable behavior). If either is unclear, use `tt-clarify` first.
3. Work in steps you can finish and verify one at a time.

## Resume
1. Read the task file the status line names, then the files and specs it links to.
2. Check Next against the current code before acting on it. If they disagree, the code wins; note the difference under Decisions.

## At the end of every turn that moved the task forward
1. Update Done (what is finished and verified), Next (the first concrete step, then the rest), and Decisions (what was decided and why, including rejected options).
2. Run `finish` for the work verified in this turn, with `--task <file name>` when more than one task is active. If nothing is verified yet, leave it for a later turn; the status line will show those changes as unrecorded.

## Close
When every acceptance criterion is met and verified, run `task close <file name>`, then `finish`. If the work is abandoned instead, write why under Decisions before closing.

## Sections
- Goal and Acceptance criteria say what done means. Change them only with the user's agreement, and record the change under Decisions.
- Done, Next, and Decisions are yours to keep current.
