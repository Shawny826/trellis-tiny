/**
 * Shared hook templates — platform-independent Python hook scripts.
 *
 * These scripts read only from .trellis/ paths (JSONL, prd.md, spec/) and
 * have no platform-specific placeholders. They can be written as-is to any
 * platform's hooks directory.
 *
 * Ported from upstream `packages/cli/src/templates/shared-hooks/index.ts`,
 * with the distribution table trimmed to the trellis-tiny platform matrix
 * (codex / zcode + the dormant claude-code slot).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readTemplate(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

export interface HookScript {
  /** Filename (e.g., "session-start.py") */
  name: string;
  /** Script content — no placeholders, ready to write directly */
  content: string;
}

export type SharedHookName =
  | "session-start.py"
  | "inject-shell-session-context.py"
  | "inject-workflow-state.py"
  | "inject-subagent-context.py";

export type SharedHookPlatform = "claude" | "codex" | "zcode";

/**
 * Which shared hooks each platform actually invokes. Single source of truth
 * for shared-hook distribution — `collectSharedHooks` reads this table, and
 * both init and update consume the map it returns.
 *
 * Routing rules (condensed from upstream; see upstream
 * `.trellis/spec/cli/backend/platform-integration.md` for the full rationale):
 * - `session-start.py` — every platform with a SessionStart hook event except
 *   codex, which bundles a platform-specific session-start.py under its own
 *   template dir.
 * - `inject-workflow-state.py` — every platform with a UserPromptSubmit (or
 *   equivalent) event.
 * - `inject-subagent-context.py` — platforms with native sub-agent context
 *   delivery. Codex uses its SubagentStart `additionalContext` event; ZCode's
 *   PreToolUse `Agent|Task` matcher mutates sub-agent prompts (class-1).
 * - `inject-shell-session-context.py` — platforms with a hook that fires
 *   *before* a shell command and receives both the session id and the pending
 *   command; the only channel by which session identity reaches `task.py`.
 *   Codex is absent: its SubagentStart/UserPromptSubmit events carry session
 *   identity already, and it publishes no pre-shell event.
 * - claude keeps its upstream entry for the dormant extension slot; no tiny
 *   configurator consumes it until the slot is revived.
 */
export const SHARED_HOOKS_BY_PLATFORM: Record<
  SharedHookPlatform,
  readonly SharedHookName[]
> = {
  claude: [
    "session-start.py",
    "inject-workflow-state.py",
    "inject-subagent-context.py",
  ],
  codex: ["inject-workflow-state.py", "inject-subagent-context.py"],
  zcode: [
    "session-start.py",
    "inject-shell-session-context.py",
    "inject-workflow-state.py",
    "inject-subagent-context.py",
  ],
};

/**
 * Get all shared hook scripts. Content is platform-independent and can be
 * written directly without placeholder resolution.
 */
export function getSharedHookScripts(): HookScript[] {
  const scripts: HookScript[] = [];
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith(".py"))
    .sort();

  for (const file of files) {
    scripts.push({ name: file, content: readTemplate(file) });
  }

  return scripts;
}

/**
 * Get the shared hook scripts that a given platform actually registers.
 * Drives `collectSharedHooks` so distribution never drifts from the
 * per-platform capability declared above.
 */
export function getSharedHookScriptsForPlatform(
  platform: SharedHookPlatform,
): HookScript[] {
  const allowed = new Set<string>(SHARED_HOOKS_BY_PLATFORM[platform]);
  return getSharedHookScripts().filter((h) => allowed.has(h.name));
}
