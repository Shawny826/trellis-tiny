/**
 * ZCode configurator.
 *
 * ZCode (智谱) is an agentCapable class-1 platform. Since ZCode 3.x it exposes
 * a workspace hook config at `.zcode/config.json` (SessionStart,
 * UserPromptSubmit, and PreToolUse for Agent/Task and Bash), so `hasHooks` is
 * true.
 *
 * trellis-tiny R2 single skill root: workflow and bundled skills are written
 * to the SHARED `.agents/skills/` root with the neutral placeholder renderer,
 * byte-identical to the codex and dsh writes of the same root. `.zcode/skills/`
 * is NOT written anymore — ZCode scans both roots (verified against its skill
 * discovery), so the private copy only duplicated every skill in the session
 * context. Any leftover `.zcode/skills/` from an upstream install is deleted
 * by init convergence (M4).
 *
 * Output paths:
 * - `.agents/skills/` — shared workflow + bundled skills (neutral rendering)
 * - `.zcode/commands/trellis/` — slash commands (invoked as /trellis:<name>)
 * - `.zcode/agents/` — sub-agent definitions with hook-injection fallback
 * - `.zcode/hooks/` + `.zcode/config.json` — shared Python hook scripts and
 *   the workspace hook registration
 */

import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllAgents, getHooksConfig } from "../templates/zcode/index.js";
import {
  collectSharedHooks,
  collectSkillTemplates,
  resolveBundledSkills,
  resolveCommands,
  resolvePlaceholders,
  resolveSkillsNeutral,
  writeTemplateMap,
} from "./shared.js";

/** Shared hooks directory written for ZCode (mirrors the configure path). */
const ZCODE_HOOKS_DIR = ".zcode/hooks";

/** Shared skills root — the single trellis skill destination (R2). */
const SHARED_SKILLS_ROOT = ".agents/skills";

/**
 * The ZCode file set — written at init and diffed by update.
 */
export function collectZcodeTemplates(): Map<string, string> {
  const config = AI_TOOLS.zcode;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // 1. Workflow + bundled skills → shared `.agents/skills/` (neutral
  //    rendering; must stay byte-identical to codex/dsh writes).
  for (const [filePath, content] of collectSkillTemplates(
    SHARED_SKILLS_ROOT,
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  // 2. Commands → .zcode/commands/trellis/ (native command surface; `start`
  //    is filtered because the SessionStart hook injects the overview).
  for (const cmd of resolveCommands(ctx)) {
    files.set(`.zcode/commands/trellis/${cmd.name}.md`, cmd.content);
  }

  // 3. Sub-agents → .zcode/agents/ (hook-inject; templates carry fallback).
  for (const agent of getAllAgents()) {
    files.set(`.zcode/agents/${agent.name}.md`, agent.content);
  }

  // 4. Shared hook scripts → .zcode/hooks/ (from SHARED_HOOKS_BY_PLATFORM).
  for (const [k, v] of collectSharedHooks(ZCODE_HOOKS_DIR, "zcode")) {
    files.set(k, v);
  }

  // 5. Workspace hook registration → .zcode/config.json
  files.set(
    ".zcode/config.json",
    resolvePlaceholders(getHooksConfig().content),
  );

  return files;
}

/** Print the manual global-plugin fallback required by affected ZCode builds. */
export function printZcodeSetupHint(): void {
  if (process.env.VITEST || process.env.TRELLIS_QUIET) return;

  const plugin = AI_TOOLS.zcode.globalHookPlugin;
  if (!plugin) return;

  process.stderr.write(
    `ℹ️  ZCode: if project Hooks are disabled, install ${plugin.name}, then start a new session.\n` +
      `   ZCode：若项目 Hooks 被禁用，请安装 ${plugin.name}，然后新建会话。\n` +
      `   请手动在 ZCode 插件市场中添加 ${plugin.marketplaceUrl}，并手动安装 ZCode 补丁插件 ${plugin.name}\n`,
  );
}

/**
 * Configure ZCode at init time: write the collected file set, then the one
 * thing a `Map<path, content>` cannot carry — a console notice.
 */
export async function configureZcode(cwd: string): Promise<void> {
  await writeTemplateMap(cwd, collectZcodeTemplates());
  printZcodeSetupHint();
}
