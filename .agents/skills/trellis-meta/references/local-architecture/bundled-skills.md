# Bundled Skills

"Bundled skills" are multi-file built-in skills shipped inside the trellis-tiny npm package. Unlike marketplace skills (which a user installs separately into their own `.claude/skills/` or other platform skill root), bundled skills are written automatically into the shared skill root by `tt init` and kept in sync by `tt update`. They are part of trellis-tiny itself, not third-party content.

A bundled skill is a directory under `src/templates/common/bundled-skills/<skill>/` that already contains its own `SKILL.md` (with YAML frontmatter) plus optional `references/`, assets, or other supporting files. trellis-tiny copies the whole directory tree as-is into the shared skill root, so references stay lazy-loadable instead of being flattened into one oversized `SKILL.md`.

## What Counts As Bundled (vs. Adjacent Concepts)

| Source path | Type | How it ships |
| --- | --- | --- |
| `templates/common/bundled-skills/<name>/` | Bundled skill (multi-file) | Whole directory copied to every platform skill root |
| `templates/common/skills/<name>.md` | Single-file workflow skill | Wrapped with frontmatter, written as `<root>/<name>/SKILL.md` |
| `templates/common/commands/<name>.md` | Slash command / prompt | ZCode: written to `.zcode/commands/trellis/`; codex and dsh fold the same templates into `.agents/skills/` / `.dsh/skills/` as skills |
| `templates/<platform>/skills/` | Platform-specific skill | Written only into that platform's directory (e.g. the three dsh entry skills in `.dsh/skills/`) |
| User skills under `.agents/skills/<my-skill>/` etc. | Marketplace or user-authored | Not managed by trellis-tiny at all |

The Trellis CLI never touches anything that is not produced by one of its own template loaders. Anything a user drops into a platform skill root by hand is left alone.

## Current Bundled Skills

The set is discovered at runtime by listing directories under `templates/common/bundled-skills/`:

| Skill | Purpose |
| --- | --- |
| `trellis-meta` | This skill. Explains the local Trellis architecture and customization entry points to an AI working inside a user project. |
| `trellis-session-insight` | Wraps the `tt mem` CLI so an AI knows when and how to reach into past Claude Code / Codex / Pi Agent conversation logs. |
| `trellis-spec-bootstrap` | Platform-neutral workflow for creating or refreshing `.trellis/spec/` from the real codebase (with optional GitNexus / ABCoder integration). |

The list is discovered at runtime, so adding a new directory under `bundled-skills/` is the only step required to register a new skill (see "Adding a New Bundled Skill" below).

## Where Bundled Skills Land Per Platform

A platform's whole file set — commands, workflow skills, agents, hooks, bundled skills — is described exactly once, by `collect<Platform>Templates()` in `src/configurators/<platform>.ts`. For bundled skills that description is two calls: `resolveBundledSkills(ctx)` reads every directory under `templates/common/bundled-skills/`, resolves placeholders, and returns a flat list of `{relativePath, content}` entries; `collectSkillTemplates(<skillsRoot>, <workflowSkills>, <bundledSkills>)` folds them into the platform's `Map<filePath, content>` under `<skillsRoot>/<skill>/<relativePath>`.

All three trellis-tiny platforms receive the full bundled-skill set, into ONE shared root:

| Platform | Bundled skill root |
| --- | --- |
| Codex | `.agents/skills/<skill>/` |
| ZCode | `.agents/skills/<skill>/` |
| DeepSeek Harness (dsh) | `.agents/skills/<skill>/` (plus its three command-entry skills under `.dsh/skills/`) |

Codex, ZCode and dsh share the `.agents/skills/` root (the Agent Skills workspace standard). ZCode scans both it and its own `.zcode/skills/` root, so trellis-tiny deliberately writes ONLY the shared root — no `.zcode/skills/` copy exists anymore. The collectors are required to emit byte-identical content for every file more than one of them writes there.

One description, two consumers:

1. `tt init` → `configurePlatform(platformId, cwd)` → `writeTemplateMap(cwd, collect<Platform>Templates())`. For dsh the registry entry in `configurators/index.ts` is literally `fromTemplates(collectDshTemplates)`, which *is* that composition. Codex and ZCode spell out a `configure` of their own, each for work a `Map<path, content>` cannot express (codex: an intentionally empty `.codex/skills/` directory plus preservation of user-set agent model keys; zcode: a one-shot console notice) — none of them restates the file list.
2. `tt update` → `collectPlatformTemplates(platformId)` (in `configurators/index.ts`) → the same map, used to detect drift and to populate `.trellis/.template-hashes.json`.

Because both consumers read the one description, init and update cannot disagree about which files a bundled skill produces.

## Dispatch Wiring (Code Path)

The mechanism that auto-dispatches bundled skills to platform skill roots lives in two files:

1. `src/templates/common/index.ts`
   - `listDirectories("bundled-skills")` enumerates the on-disk skills.
   - `listBundledSkillFiles(skillDir)` walks each skill's directory recursively and returns `{relativePath, content}` for every file.
   - `getBundledSkillTemplates()` returns the cached `CommonBundledSkill[]`.

2. `src/configurators/shared.ts`
   - `resolveBundledSkills(ctx)` flattens that list into `ResolvedSkillFile[]` with `<skill>/<relativePath>` paths and resolved placeholders.
   - `collectSkillTemplates(skillsRoot, workflowSkills, bundledSkills)` returns workflow skills and bundled skill files together as a `Map<filePath, content>` rooted at `skillsRoot`.
   - `writeTemplateMap(cwd, files)` is the single writer that puts a collected map on disk.

Every platform reaches those helpers from its own `collect<Platform>Templates()` — `codex.ts`, `zcode.ts` and `dsh.ts` call them directly (trellis-tiny has no `collectBothTemplates` consumers).

## Adding a New Bundled Skill

The shape and dispatch wiring are already generic, so adding a skill requires only file changes plus distribution verification.

1. **Create the directory tree.**

   ```
   src/templates/common/bundled-skills/<my-skill>/
     SKILL.md                     # YAML frontmatter + body
     references/                  # optional
       <topic>.md
     assets/                      # optional (anything readable as utf-8)
   ```

2. **Write a valid `SKILL.md` header.** The frontmatter must include at minimum:

   ```yaml
   ---
   name: <my-skill>
   description: "When the AI should reach for this skill. Triggering phrases go here."
   ---
   ```

   The `description` is what each platform's auto-trigger mechanism matches against, so it should describe the user-intent triggers, not the skill's internals.

3. **Use placeholders where appropriate.** Bundled skill content runs through `resolvePlaceholders(file.content, ctx)`. Any `{{platform_name}}`, `{{python_cmd}}`, etc. token supported by `resolvePlaceholders` will be substituted per platform.

4. **No dispatch wiring is required.** `listDirectories("bundled-skills")` discovers the new directory automatically, so all platforms receive it on the next `tt init` or `tt update`.

5. **Verify the distribution path** before shipping. Skipping any of these steps has historically caused features to be documented as bundled while the published npm tarball was missing the files:

   - Source files exist on the branch being tagged.
   - `pnpm -C tiny build` copies the asset into `dist/templates/common/bundled-skills/<skill>/`.
   - `npm pack --dry-run --json` includes the expected `dist/**` paths.
   - In a fresh temp project, `tt init` writes `.agents/skills/<skill>/SKILL.md` — the single shared root (codex / zcode / dsh); dsh additionally gets its three command-entry skills under `.dsh/skills/`. No `.zcode/skills/` copy exists.
   - `.trellis/.template-hashes.json` lists the generated files.
   - `tt update --dry-run` in that temp project reports "Already up to date!".

6. No extra registration is needed for upgrades: a skill added in a new release lands via the standard "new file" branch of `tt update`.

## Overriding a Bundled Skill Locally

There is no formal "project-local skill" mechanism (e.g. `.trellis/skills/`). Bundled skills are platform-rooted, so any override is platform-rooted too.

The supported pattern relies on the existing template-hash diff in `tt update`:

1. Edit the local file directly. Example: `.agents/skills/trellis-meta/SKILL.md`.
2. The file's hash now diverges from the entry in `.trellis/.template-hashes.json`.
3. The next `tt update` detects the user modification and leaves the file untouched (trellis-tiny never overwrites user-modified files without an explicit `--force`).

Caveats:

- The override applies to the shared `.agents/skills/` root, which all three platforms read — one edit covers codex, zcode and dsh. Only dsh-private entry skills (`.dsh/skills/`) would need a separate edit.
- A future `tt update --force` will overwrite local edits. Keep the override under version control so it can be reapplied if needed.
- Marketplace skills installed under the same platform skill root with a different folder name (e.g. `.claude/skills/my-custom-meta/`) are untouched by Trellis and are the cleaner option when the goal is to add behavior, not to mutate the bundled skill.
- Team-private conventions belong in `.trellis/spec/` or in a separate marketplace-style local skill, not in modifications to `trellis-meta` itself. See `customize-local/add-project-local-conventions.md`.

## Removing a Bundled Skill From a Project

There is no per-project opt-out flag for bundled skills. Two options:

1. **Delete the directory in each skill root.** `tt update` will see the file missing, compare against `.template-hashes.json`, and treat the deletion the same as any other user modification — it will not silently re-create the directory unless `--force` is passed.

2. **Pin a trellis-tiny version that did not ship the skill.** The bundled-skill set is determined at build time, so installing an older release of the CLI is the only way to permanently exclude a skill that the current release ships.

A third option — globally disabling all bundled skills — is not supported. The dispatch is unconditional: `collect<Platform>Templates()` takes no arguments, so there is nowhere for a flag to enter. Adding one would mean changing that signature across all three platforms plus `collectPlatformTemplates` in `configurators/index.ts`.

## Operating Rules

- Treat `templates/common/bundled-skills/` as the single source of truth for what bundled skills exist. Do not hand-maintain platform-by-platform skill lists.
- Do not add platform-specific logic inside a bundled `SKILL.md`. If a behavior is platform-specific, put it in `templates/<platform>/skills/` instead.
- Do not couple bundled skills to a specific CLI binary (e.g. `tt mem`) without surfacing the dependency in the skill's description and references — users on older releases may not have the command.
- Do not store project-private content in a bundled skill. Bundled skills are public, shipped to every user; project rules belong in `.trellis/spec/` or a local skill.
