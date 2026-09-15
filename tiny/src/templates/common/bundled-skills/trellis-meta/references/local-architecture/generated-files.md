# Local Files Generated After Init

`tt init` writes the trellis-tiny runtime into the user project. Later, `tt update` tries to update trellis-tiny-managed template files, but it uses `.trellis/.template-hashes.json` to determine which files have already been modified by the user.

This page only describes files that are visible and editable inside the user project.

## `.trellis/`

```text
.trellis/
├── workflow.md
├── config.yaml
├── .developer
├── .template-hashes.json
├── .runtime/
├── scripts/
├── spec/
├── tasks/
└── workspace/
```

| Path | Usually editable? | Notes |
| --- | --- | --- |
| `.trellis/workflow.md` | Yes | Local workflow documentation and AI routing rules. |
| `.trellis/config.yaml` | Yes | Project configuration, hooks, packages, journal line limits, and related settings. |
| `.trellis/spec/` | Yes | Project specs, intended to be updated regularly by users and AI. |
| `.trellis/tasks/` | Yes | Task material and research artifacts, maintained by the task workflow. |
| `.trellis/workspace/` | Yes | Session records, usually written by `add_session.py`. |
| `.trellis/scripts/` | Carefully | Local runtime. It can be customized, but only after understanding the call chain. |
| `.trellis/.runtime/` | No | Runtime state, usually written automatically by hooks/scripts. |
| `.trellis/.developer` | Carefully | Current developer identity. |
| `.trellis/.template-hashes.json` | No | Template hash record. Do not hand-write business rules here. |

## Platform Directories

Different platforms generate different directories. Common categories:

| Category | Example paths | Purpose |
| --- | --- | --- |
| hooks | `.zcode/hooks/`, `.codex/hooks/` | Inject session context, workflow-state, and sub-agent context. |
| settings | `.zcode/config.json`, `.codex/hooks.json` | Tell the platform when to run hooks or plugins. |
| agents | `.codex/agents/`, `.zcode/agents/` | Define agents such as `trellis-research`, `trellis-implement`, and `trellis-check`. |
| skills | `.agents/skills/` (the single shared root for codex / zcode / dsh), `.dsh/skills/` (dsh command-entry skills) | Skills that auto-trigger or can be read by AI. |
| commands/prompts/workflows | `.zcode/commands/trellis/` | Explicit user-invoked command or workflow entry points. |

When modifying a platform directory, also confirm whether `.trellis/workflow.md` still describes the same flow.

## Meaning Of Template Hashes

`.trellis/.template-hashes.json` records the content hash from the last time trellis-tiny wrote a template file. `tt update` uses it to distinguish three cases:

| Case | Update behavior |
| --- | --- |
| File was not modified by the user | It can be updated automatically. |
| File was modified by the user | Prompt the user to overwrite, keep, or generate `.new`. |
| File is no longer a current template | It is retired: the file is removed and its manifest entry dropped. |

When an AI customizes local trellis-tiny files, it does not need to maintain hashes manually. It is normal for `tt update` to recognize the result as "modified by the user."

## Local Customization Boundaries

Editable by default:

- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `.trellis/spec/**`
- `.trellis/scripts/**`
- Platform hooks, settings, agents, skills, commands, prompts, and workflows

Do not edit by default:

- Global npm install directory
- `node_modules/trellis-tiny`
- The trellis-tiny repository source code
- Concrete state files under `.trellis/.runtime/**`
- Hash contents inside `.trellis/.template-hashes.json`

Switch to the trellis-tiny source-code perspective only when the user explicitly wants to contribute upstream.
