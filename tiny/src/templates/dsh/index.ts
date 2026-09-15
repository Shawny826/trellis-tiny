/**
 * DeepSeek Harness (dsh) template module.
 *
 * dsh is a class-2 pull-based, skills-only platform:
 * - Workflow + bundled skills go to the shared `.agents/skills/` root via
 *   the neutral resolver (byte-identical to codex/zcode writes of the same
 *   root in trellis-tiny).
 * - User-invocable entry points (`trellis-start` / `trellis-continue` /
 *   `trellis-finish-work`, loaded by the dsh agent through its skill-loader
 *   tool) live under `.dsh/skills/<name>/SKILL.md` — dsh's own highest-rank
 *   project skill root.
 * - Operator guide `.dsh/DSH.md`.
 *
 * dsh has no shipped session-start hook, so `trellis-start` is kept as a
 * user-invocable skill. dsh ships no project-level sub-agent definition
 * surface, so no trellis-implement / trellis-check / trellis-research agent
 * prompts are written; implement/check/research run inline through the
 * workflow skills.
 *
 * Ported from upstream `packages/cli/src/templates/dsh/index.ts`.
 */

import { createTemplateReader } from "../template-utils.js";

const { readTemplate } = createTemplateReader(import.meta.url);

/** Operator guide copied to `.dsh/DSH.md`. */
export function getDshGuide(): string {
  return readTemplate("DSH.md");
}
