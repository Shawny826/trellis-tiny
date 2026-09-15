# Change Local Skills, Commands, Prompts, And Workflows

When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, edit skills, commands, prompts, or workflows in local platform directories.

Before editing, classify the skill you are about to touch:

- **Bundled skill** — `trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`. Source of truth lives in the trellis-tiny repo under `src/templates/common/bundled-skills/<name>/`; auto-dispatched to the shared skill root by `getBundledSkillTemplates()` on `tt init` / `tt update`. Local edits here are tracked by `.trellis/.template-hashes.json` and will be flagged on the next update.
- **Project-local skill** — anything else under a skill root (e.g. `.agents/skills/`). Owned by the user; not refreshed by `tt update`.

The remainder of this file uses "skill" for the local file; the override and conflict rules differ between the two cases.

## Read These Files First

1. `.trellis/workflow.md`
2. Target platform skill/command/prompt/workflow directory
3. Related agent or hook files
4. Whether project rules already exist in `.trellis/spec/`
5. `.trellis/.template-hashes.json` — confirms whether the skill you are about to edit is upstream-owned (entry present) or project-local (entry absent)

## Which Entry Type To Choose

| Goal | Recommendation |
| --- | --- |
| AI should automatically know a capability | Add or modify a skill. |
| User wants to trigger manually with a command | Add or modify a command/prompt/workflow. |
| Team project conventions | Prefer `.trellis/spec/` or a project-local skill — never a bundled skill directory. |
| Tweak a bundled skill (`trellis-meta` et al.) for the user's own project | Create a project-local sibling skill (different name) that overrides intent, or edit `.trellis/spec/`. Edits inside the bundled skill directory survive only until the next `tt update` and will need a "keep" choice each time. |
| Contribute the change back upstream | Edit `src/templates/common/bundled-skills/<name>/` in the trellis-tiny repo, not the deployed copy. |
| Change Trellis flow semantics | Synchronize `.trellis/workflow.md`. |

## Modify A Skill

A skill is usually:

```text
<skill-name>/
├── SKILL.md
└── references/
```

`SKILL.md` should be short and responsible for triggering/routing. Put long content in `references/` so AI can read it on demand.

The frontmatter description should specify when to use the skill. Example:

```yaml
description: "Use when customizing this project's deployment workflow and release checklist."
```

Do not write vague descriptions such as "helpful project skill"; they can trigger incorrectly.

### Bundled vs. Project-Local

The same directory shape is used by two very different ownership models:

| Aspect | Bundled (`trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`) | Project-local |
| --- | --- | --- |
| Source of truth | `src/templates/common/bundled-skills/<name>/` in the trellis-tiny repo | Inside the user project itself |
| Dispatch | Auto-dispatched to the shared skill root by `getBundledSkillTemplates()` (`src/templates/common/index.ts`) on `tt init` / `tt update` | Created by the user (or another skill) and never moved |
| Hash tracking | Every file recorded in `.trellis/.template-hashes.json`; conflict prompt on update | Not tracked |
| Editing locally | Allowed but will be marked "modified by user" on next update | Free editing |
| The right way to customize | Add a *new* project-local skill with a *different* name that supplements (or supersedes) the bundled one | Edit the file directly |

If the goal is "make my project's AI behave differently when discussing release notes," the answer is almost always a project-local skill, not surgery on `trellis-meta/`.

## Modify A Command/Prompt/Workflow

Explicit entry points should state:

- How the user triggers it.
- Which `.trellis/` files to read.
- Which scripts to run.
- How to report after completion.

If a command only repeats workflow rules, prefer making it reference/read `.trellis/workflow.md` instead of maintaining a second copy of the flow.

## Common Paths

| Platform | Entry directories |
| --- | --- |
| Codex | `.agents/skills/` (shared root), `.codex/skills/` (empty, user extensions) |
| ZCode | `.agents/skills/` (shared root), `.zcode/commands/trellis/` |
| DeepSeek Harness (dsh) | `.agents/skills/` (shared root), `.dsh/skills/` (three command-entry skills) |

Every directory above is a deploy target for the bundled skills. The shared `.agents/skills/` root receives a full copy on `tt init` and a refresh on `tt update`; nothing has to be wired by hand.

## Add A Project-Local Skill

If the user wants to document team-private customizations, create a project-local skill — never put project-private content into a bundled skill directory, since `tt update` will overwrite it.

```text
.agents/skills/project-trellis-local/
└── SKILL.md
```

Project-local skills in the shared `.agents/skills/` root are visible to all three platforms; dsh-private entry points can also live under `.dsh/skills/`.

Pick a name that does **not** collide with the bundled set:

- `trellis-meta`
- `trellis-spec-bootstrap`
- `trellis-session-insight`

A reused name causes `getBundledSkillTemplates()` to overwrite the project-local copy on the next update. A common convention is to prefix the project name: `acme-trellis-deploy`, `acme-trellis-onboarding`.

## Notes

- Do not mix every platform's syntax into one file.
- Do not change only one platform entry point while claiming all platforms are supported.
- Do not hide long-term engineering conventions inside a command; write them to `.trellis/spec/`.
- Do not hand-edit files inside `trellis-meta/`, `trellis-spec-bootstrap/`, or `trellis-session-insight/` under a skill root expecting the change to persist — they are bundled and refreshed by `tt update`. Either contribute upstream or add a project-local skill that complements them.
- After `tt update` reports a "modified by you" conflict on a bundled skill file, choose **keep** only if you accept maintaining the divergence by hand; otherwise accept the overwrite and re-apply the intent as a project-local skill.
