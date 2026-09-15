/**
 * Shared utilities for platform configurators.
 *
 * Trimmed port of upstream `packages/cli/src/configurators/shared.ts` to the
 * trellis-tiny platform matrix (codex / zcode / dsh). What was dropped and
 * why:
 * - the resolved-Python module state (lives in `lib/python-resolver.ts` in
 *   tiny; re-exported here so callers keep the documented import surface);
 * - `wrapWithCommandFrontmatter` / OMP frontmatter (no tiny platform wraps
 *   palette commands — ZCode writes plain markdown slash commands);
 * - `collectBothTemplates` (its consumers — cursor/devin/qoder — don't exist
 *   in tiny);
 * - the pull-based sub-agent prelude block and Copilot frontmatter
 *   normalization (codex ships native SubagentStart context with in-template
 *   pull fallbacks; zcode is class-1 hook-inject; dsh has no agents).
 *
 * The placeholder contract is unchanged: every upstream placeholder
 * ({{PYTHON_CMD}}, {{CMD_REF:name}}, {{EXECUTOR_AI}}, {{USER_ACTION_LABEL}},
 * {{CLI_FLAG}}, {{#FLAG}}/{{^FLAG}}) is preserved in both renderers, and
 * anything written under `.agents/skills/` MUST go through the neutral
 * renderer so codex / zcode / dsh writes stay byte-identical.
 */

import path from "node:path";

import {
  getPythonCommandForPlatform,
} from "../lib/python-resolver.js";
import {
  type CommonTemplate,
  getBundledSkillTemplates,
  getCommandTemplates,
  getSkillTemplates,
} from "../templates/common/index.js";
import {
  getSharedHookScriptsForPlatform,
  type SharedHookPlatform,
} from "../templates/shared-hooks/index.js";
import type { TemplateContext } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";

// Re-exported so init/update/tests can keep the upstream import path; the
// single source of truth (and the only module state) is lib/python-resolver.
export {
  getPythonCommandForPlatform,
  resetResolvedPythonCommand,
  setResolvedPythonCommand,
} from "../lib/python-resolver.js";

/**
 * Per-platform configure options threaded from init flags.
 * No current tiny configurator consumes options; the `withStatusline` field
 * is reserved for the dormant claude-code extension slot (upstream's
 * `trellis init --with-statusline`) so reviving the slot needs no registry
 * signature churn.
 */
export interface PlatformConfigureOptions {
  /** Claude Code only: install the opt-in Trellis statusLine. */
  withStatusline?: boolean;
}

/**
 * Replace literal `python3` with the resolved Python command, excluding
 * shebang lines.
 *
 * Applied at init/update write time so that all file types (including .py,
 * .md, .toml, .json) get the correct command for the host platform without
 * template-level changes.
 *
 * No-op when the resolved command is `python3` (the template default).
 * Idempotent: running it twice produces the same result.
 */
export function replacePythonCommandLiterals(content: string): string {
  const target = getPythonCommandForPlatform();
  if (target === "python3") return content;
  return content
    .split("\n")
    .map((line) =>
      line.startsWith("#!") ? line : line.replaceAll("python3", target),
    )
    .join("\n");
}

/**
 * Resolve platform-specific placeholders in template content.
 *
 * When called without a context, only resolves {{PYTHON_CMD}} (legacy behavior
 * for settings.json, hooks.json, etc.).
 *
 * When called with a TemplateContext, additionally resolves:
 * - {{CMD_REF:name}}         → platform-specific command reference
 * - {{EXECUTOR_AI}}          → AI executor description
 * - {{USER_ACTION_LABEL}}    → user action label
 * - {{CLI_FLAG}}             → platform cli flag (e.g. "claude", "codex")
 * - {{#FLAG}}...{{/FLAG}}    → conditional include (when FLAG is true)
 * - {{^FLAG}}...{{/FLAG}}    → negated conditional (when FLAG is false)
 *
 * Supported conditional flags: AGENT_CAPABLE, HAS_HOOKS
 */
// Pre-compiled regexes for placeholder resolution
const RE_PYTHON_CMD = /\{\{PYTHON_CMD\}\}/g;
const RE_CMD_REF = /\{\{CMD_REF:([\w][\w-]*)\}\}/g;
const RE_EXECUTOR_AI = /\{\{EXECUTOR_AI\}\}/g;
const RE_USER_ACTION_LABEL = /\{\{USER_ACTION_LABEL\}\}/g;
const RE_CLI_FLAG = /\{\{CLI_FLAG\}\}/g;
const RE_BLANK_LINES = /\n{3,}/g;

const CONDITIONAL_FLAGS = ["AGENT_CAPABLE", "HAS_HOOKS"] as const;
const CONDITIONAL_REGEXES = Object.fromEntries(
  CONDITIONAL_FLAGS.map((flag) => [
    flag,
    {
      pos: new RegExp(
        `\\{\\{#${flag}\\}\\}([\\s\\S]*?)\\{\\{/${flag}\\}\\}`,
        "g",
      ),
      neg: new RegExp(
        `\\{\\{\\^${flag}\\}\\}([\\s\\S]*?)\\{\\{/${flag}\\}\\}`,
        "g",
      ),
    },
  ]),
) as Record<(typeof CONDITIONAL_FLAGS)[number], { pos: RegExp; neg: RegExp }>;

export function resolvePlaceholders(
  content: string,
  context?: TemplateContext,
): string {
  let result = replacePythonCommandLiterals(
    content.replace(RE_PYTHON_CMD, getPythonCommandForPlatform()),
  );

  if (!context) return result;

  // Simple substitutions
  result = result.replace(
    RE_CMD_REF,
    (_match, name: string) => `${context.cmdRefPrefix}${name}`,
  );
  result = result.replace(RE_EXECUTOR_AI, context.executorAI);
  result = result.replace(RE_USER_ACTION_LABEL, context.userActionLabel);
  result = result.replace(RE_CLI_FLAG, context.cliFlag);

  // Conditional blocks
  const flagValues: Record<(typeof CONDITIONAL_FLAGS)[number], boolean> = {
    AGENT_CAPABLE: context.agentCapable,
    HAS_HOOKS: context.hasHooks,
  };

  for (const flag of CONDITIONAL_FLAGS) {
    const value = flagValues[flag];
    const { pos, neg } = CONDITIONAL_REGEXES[flag];
    // Reset lastIndex for global regexes reused across calls
    pos.lastIndex = 0;
    neg.lastIndex = 0;
    result = result.replace(pos, value ? "$1" : "");
    result = result.replace(neg, value ? "" : "$1");
  }

  // Clean up blank lines left by removed conditional blocks
  result = result.replace(RE_BLANK_LINES, "\n\n");

  return result;
}

/**
 * Resolve placeholders for files written under `.agents/skills/` (the shared
 * Agent Skills directory consumed natively by codex, zcode, and dsh).
 *
 * Identical to {@link resolvePlaceholders} except that {@link CMD_REF} is
 * rendered in a platform-neutral form (`` `name` (Trellis command) ``)
 * instead of substituting a platform-specific prefix. This is the only
 * placeholder that varies between platforms in the skill templates from
 * `common/skills/`, so neutralizing it makes the rendered SKILL.md files
 * byte-identical regardless of which Trellis configurator wrote them —
 * eliminating the "last-writer-wins" collision when several tiny platforms
 * target `.agents/skills/`.
 *
 * `{{CLI_FLAG}}`, `{{EXECUTOR_AI}}`, `{{USER_ACTION_LABEL}}`, conditionals,
 * and `{{PYTHON_CMD}}` are still resolved from the platform context. The
 * shared skills do not use those placeholders, so they remain platform-
 * neutral (verified by the cross-configurator byte-identity tests).
 */
export function resolvePlaceholdersNeutral(
  content: string,
  context?: TemplateContext,
): string {
  let result = replacePythonCommandLiterals(
    content.replace(RE_PYTHON_CMD, getPythonCommandForPlatform()),
  );

  if (!context) return result;

  // Neutral form for the only collision-causing placeholder
  result = result.replace(
    RE_CMD_REF,
    (_match, name: string) => `\`${name}\` (Trellis command)`,
  );
  result = result.replace(RE_EXECUTOR_AI, context.executorAI);
  result = result.replace(RE_USER_ACTION_LABEL, context.userActionLabel);
  result = result.replace(RE_CLI_FLAG, context.cliFlag);

  // Conditional blocks (resolved per platform — none of the auto-triggered
  // shared skills use conditionals, but command-as-skill files might in future).
  const flagValues: Record<(typeof CONDITIONAL_FLAGS)[number], boolean> = {
    AGENT_CAPABLE: context.agentCapable,
    HAS_HOOKS: context.hasHooks,
  };

  for (const flag of CONDITIONAL_FLAGS) {
    const value = flagValues[flag];
    const { pos, neg } = CONDITIONAL_REGEXES[flag];
    pos.lastIndex = 0;
    neg.lastIndex = 0;
    result = result.replace(pos, value ? "$1" : "");
    result = result.replace(neg, value ? "" : "$1");
  }

  result = result.replace(RE_BLANK_LINES, "\n\n");

  return result;
}

// ---------------------------------------------------------------------------
// Template wrapping utilities
// ---------------------------------------------------------------------------

/** Skill description registry — maps template name to auto-trigger description. */
const SKILL_DESCRIPTIONS: Record<string, string> = {
  start:
    "Initializes an AI development session by reading workflow guides, developer identity, git status, active tasks, and project guidelines from .trellis/. Classifies incoming tasks and routes to brainstorm, direct edit, or task workflow. Use when beginning a new coding session, resuming work, starting a new task, or re-establishing project context.",
  continue:
    "Resume work on the current task. Loads the workflow Phase Index, figures out which phase/step to pick up at, then pulls the step-level detail via get_context.py --mode phase. Use when coming back to an in-progress task and you need to know what to do next.",
  "finish-work":
    "Wrap up the current session: verify quality gate passed, remind user to commit, archive completed tasks, and record session progress to the developer journal. Use when done coding and ready to end the session.",
  "before-dev":
    "Discovers and injects project-specific coding guidelines from .trellis/spec/ before implementation begins. Reads spec indexes, pre-development checklists, and shared thinking guides for the target package. Use when starting a new coding task, before writing any code, switching to a different package, or needing to refresh project conventions and standards.",
  brainstorm:
    "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task.",
  check:
    "Comprehensive quality verification: spec compliance, lint, type-check, tests, cross-layer data flow, code reuse, and consistency checks. Use when code is written and needs quality verification, before committing changes, or to catch context drift during long sessions.",
  "break-loop":
    "Deep bug analysis to break the fix-forget-repeat cycle. Analyzes root cause category, why fixes failed, prevention mechanisms, and captures knowledge into specs. Use after fixing a bug to prevent the same class of bugs.",
  "update-spec":
    "Captures executable contracts and coding conventions into .trellis/spec/ documents. Use when learning something valuable from debugging, implementing, or discussion that should be preserved for future sessions.",
};

/**
 * Wrap resolved template content with YAML frontmatter for skill format.
 * Used by platforms that use SKILL.md (codex, dsh, and the shared
 * `.agents/skills/` root).
 */
export function wrapWithSkillFrontmatter(
  name: string,
  content: string,
): string {
  // Look up description by base name (without trellis- prefix)
  const baseName = name.replace(/^trellis-/, "");
  const description = SKILL_DESCRIPTIONS[baseName];
  if (!description) {
    throw new Error(
      `Missing skill description for "${baseName}". Add it to SKILL_DESCRIPTIONS in shared.ts.`,
    );
  }
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n${content}`;
}

// ---------------------------------------------------------------------------
// Shared configurator helpers
// ---------------------------------------------------------------------------

/** A resolved template ready to be written to disk. */
export interface ResolvedTemplate {
  name: string;
  content: string;
}

/** A resolved file inside a multi-file skill directory. */
export interface ResolvedSkillFile {
  /** POSIX path relative to the skills root, e.g. "trellis-meta/SKILL.md" */
  relativePath: string;
  content: string;
}

/**
 * Filter command templates based on platform capabilities.
 *
 * `start.md` is stripped only on platforms that are BOTH `agentCapable` AND
 * `hasHooks` — in tiny that is only zcode: its SessionStart hook
 * auto-injects the workflow overview, so a user-facing `start` would be
 * redundant.
 *
 * `agentCapable && !hasHooks` platforms (codex, dsh) have no such hook, so
 * they need the user-invocable `trellis-start` skill / `start.md` command as
 * fallback.
 */
function filterCommands(
  templates: CommonTemplate[],
  ctx: TemplateContext,
): CommonTemplate[] {
  if (ctx.agentCapable && ctx.hasHooks) {
    return templates.filter((t) => t.name !== "start");
  }
  return templates;
}

/**
 * Resolve ALL templates as skills with trellis- prefix.
 * Used where everything is a skill (codex's `.agents/skills/` set, and the
 * dsh-private command entry skills).
 *
 * `start` is filtered out on agent-capable + hook-bearing platforms — the
 * session-start hook injects the workflow overview instead.
 */
export function resolveAllAsSkills(ctx: TemplateContext): ResolvedTemplate[] {
  const templates = [
    ...filterCommands(getCommandTemplates(), ctx),
    ...getSkillTemplates(),
  ];
  return templates.map((tmpl) => ({
    name: `trellis-${tmpl.name}`,
    content: wrapWithSkillFrontmatter(
      `trellis-${tmpl.name}`,
      resolvePlaceholders(tmpl.content, ctx),
    ),
  }));
}

/**
 * Resolve command templates as plain commands (no wrapping).
 * Used by zcode's native slash-command surface (`.zcode/commands/trellis/`).
 *
 * `start` is filtered out on agent-capable + hook-bearing platforms.
 */
export function resolveCommands(ctx: TemplateContext): ResolvedTemplate[] {
  return filterCommands(getCommandTemplates(), ctx).map((tmpl) => ({
    name: tmpl.name,
    content: resolvePlaceholders(tmpl.content, ctx),
  }));
}

/**
 * Resolve the auto-triggered skill templates from `common/skills/` with trellis- prefix + SKILL.md frontmatter.
 * Platform-specific {{CMD_REF}} rendering — only for platform-private skill roots.
 */
export function resolveSkills(ctx: TemplateContext): ResolvedTemplate[] {
  return getSkillTemplates().map((tmpl) => ({
    name: `trellis-${tmpl.name}`,
    content: wrapWithSkillFrontmatter(
      `trellis-${tmpl.name}`,
      resolvePlaceholders(tmpl.content, ctx),
    ),
  }));
}

/**
 * Same as {@link resolveSkills} but uses {@link resolvePlaceholdersNeutral}
 * so the rendered SKILL.md files are byte-identical across any two platforms
 * that target `.agents/skills/`. This is the required renderer for every
 * shared `.agents/skills/` write in tiny (zcode workflow skills, dsh main
 * skill set).
 */
export function resolveSkillsNeutral(ctx: TemplateContext): ResolvedTemplate[] {
  return getSkillTemplates().map((tmpl) => ({
    name: `trellis-${tmpl.name}`,
    content: wrapWithSkillFrontmatter(
      `trellis-${tmpl.name}`,
      resolvePlaceholdersNeutral(tmpl.content, ctx),
    ),
  }));
}

/**
 * Same as {@link resolveAllAsSkills} but uses
 * {@link resolvePlaceholdersNeutral} for the shared common skills. The command
 * templates (start, continue, finish-work) folded into the skill set still
 * resolve `{{CLI_FLAG}}` / `{{PYTHON_CMD}}` per platform — only codex writes
 * those files into `.agents/skills/`, so byte-identity isn't required there.
 */
export function resolveAllAsSkillsNeutral(
  ctx: TemplateContext,
): ResolvedTemplate[] {
  const templates = [
    ...filterCommands(getCommandTemplates(), ctx),
    ...getSkillTemplates(),
  ];
  return templates.map((tmpl) => ({
    name: `trellis-${tmpl.name}`,
    content: wrapWithSkillFrontmatter(
      `trellis-${tmpl.name}`,
      resolvePlaceholdersNeutral(tmpl.content, ctx),
    ),
  }));
}

/**
 * Resolve multi-file built-in skills.
 *
 * Unlike workflow skills, bundled skills already contain their own SKILL.md
 * frontmatter and may include references/assets. They are still rendered
 * through placeholder resolution so init and update get byte-identical output.
 * (The vendored bundled skills contain no platform-varying placeholders — only
 * {{CMD_REF}} appears in common templates at all, and none in bundled-skills —
 * so their rendered bytes are platform-independent.)
 */
export function resolveBundledSkills(
  ctx: TemplateContext,
): ResolvedSkillFile[] {
  return getBundledSkillTemplates().flatMap((skill) =>
    skill.files.map((file) => ({
      relativePath: `${skill.name}/${file.relativePath}`,
      content: resolvePlaceholders(file.content, ctx),
    })),
  );
}

// ---------------------------------------------------------------------------
// Shared collectors
// ---------------------------------------------------------------------------

/** Collect skill files under a target root for update hash tracking. */
export function collectSkillTemplates(
  skillsRoot: string,
  skills: readonly { name: string; content: string }[],
  bundledSkills: readonly ResolvedSkillFile[] = [],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const skill of skills) {
    files.set(`${skillsRoot}/${skill.name}/SKILL.md`, skill.content);
  }
  for (const skillFile of bundledSkills) {
    files.set(`${skillsRoot}/${skillFile.relativePath}`, skillFile.content);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Template maps — a platform's file set, described once
//
// `collect<Platform>Templates()` returns `Map<relPath, content>`: the single
// description of what a platform installs. `update` diffs that map and
// `configure` writes it through `writeTemplateMap`. Nothing else enumerates a
// platform's files — two descriptions that disagree is how `trellis update`
// silently stops managing a file (upstream manifests/0.5.7.json).
// ---------------------------------------------------------------------------

/** Apply the python3 → python rewrite to every entry of a template map. */
export function renderTemplateMap(
  files: Map<string, string>,
): Map<string, string> {
  const rendered = new Map<string, string>();
  for (const [relPath, content] of files) {
    rendered.set(relPath, replacePythonCommandLiterals(content));
  }
  return rendered;
}

/**
 * Write a collected template map into `cwd`.
 *
 * Renders through {@link renderTemplateMap} first — the same rewrite
 * `collectPlatformTemplates` applies on the update path — so a file's
 * init-time bytes and its update-time expected bytes cannot drift.
 */
export async function writeTemplateMap(
  cwd: string,
  files: Map<string, string>,
): Promise<void> {
  for (const [relPath, content] of renderTemplateMap(files)) {
    const absPath = path.join(cwd, ...relPath.split("/"));
    ensureDir(path.dirname(absPath));
    await writeFile(absPath, content);
  }
}

/**
 * Collect the shared hook scripts that `platform` actually registers, keyed
 * under `hooksPath`. Driven by SHARED_HOOKS_BY_PLATFORM so a platform's hook
 * set is never restated per configurator.
 */
export function collectSharedHooks(
  hooksPath: string,
  platform: SharedHookPlatform,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const hook of getSharedHookScriptsForPlatform(platform)) {
    files.set(`${hooksPath}/${hook.name}`, hook.content);
  }
  return files;
}
