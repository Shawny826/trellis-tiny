/**
 * Legacy-artifact convergence (design §5, PRD D5).
 *
 * trellis-tiny's first real-world target is a project previously initialized
 * by upstream Trellis (21-platform matrix, `.zcode/skills/` double root).
 * `tt init` detects those leftovers, prints them, and deletes them —
 * `--dry-run` prints the plan only.
 *
 * Scope (hardcoded legacy paths — tiny never writes these):
 *   1. `.zcode/skills/trellis-*`        — the removed second skill root (R2).
 *      Directory pruned when left empty.
 *   2. `.zcode/cli/agents`              — upstream transition path, dropped
 *      from zcode's managed paths on purpose (M3); removal lives here.
 *   3. `.trellis/scripts/hooks/linear_sync.py` — upstream Linear integration,
 *      never vendored.
 *   3b. `.agents/skills/trellis-channel/` — the channel bundled skill's copy
 *      in the shared root (R4); covered by no other rule, so explicit.
 *   3c. `.trellis/agents/{implement,check}.md` — channel runtime agents
 *      (R4); content-gated because the filenames are generic.
 *   3d. `.agents/skills/trellis-meta/references/local-architecture/
 *      multi-agent-channel.md` — upstream-only reference page (R4).
 *   4. Non-target platform directories (upstream config dirs tiny does not
 *      install) — only the TRELLIS-named features inside are removed
 *      (`trellis` / `trellis-*` basenames). Anything else in those
 *      directories is user-owned and stays; the directory itself is removed
 *      only when it becomes empty. Mixed-ownership files (`settings.json`
 *      hook registrations) are reported as residue, never touched.
 *
 * Never touched: `.trellis/tasks/**`, `.trellis/workspace/**`,
 * `.trellis/spec/**` (user data — read-only for convergence).
 */

import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";

import { toPosix } from "../utils/posix.js";

/** zcode-private skill root dropped by R2 (single `.agents/skills/` root). */
const LEGACY_ZCODE_SKILLS_DIR = ".zcode/skills";

/** Upstream's `.zcode/cli/agents` transition path (see M3 registry notes). */
const LEGACY_ZCODE_CLI_AGENTS_DIR = ".zcode/cli/agents";

/** Upstream Linear integration script — never vendored by tiny. */
const LEGACY_LINEAR_SYNC_SCRIPT = ".trellis/scripts/hooks/linear_sync.py";

/**
 * Channel bundled skill in the SHARED skills root (R4: no channel in tiny).
 * Upstream v0.6.17 wrote its bundled skills to both `.zcode/skills/` and
 * `.agents/skills/`; the generic `.zcode/skills/trellis-*` sweep covers the
 * private root, but the shared-root copy survives every other rule: tiny's
 * expected file set never contains the key (R4), the legacy manifest is
 * discarded wholesale, and uninstall is manifest-driven. So it is detected
 * explicitly — by its channel-specific name, never touching sibling skills.
 */
const LEGACY_SHARED_CHANNEL_SKILL_DIR = ".agents/skills/trellis-channel";

/**
 * Upstream-only reference page inside trellis-meta (channel architecture).
 * Tiny's vendored trellis-meta dropped it, but init only overwrites tracked
 * files and never deletes manifest-foreign files — without this rule the
 * page survives every `tt init` (M8 dogfood finding). The filename is
 * upstream-exclusive, so there is no user-content surface; sibling files in
 * the same directory are untouched.
 */
const LEGACY_META_CHANNEL_REFERENCE =
  ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md";

/**
 * Channel runtime agent definitions upstream init wrote under
 * `.trellis/agents/` (PRD R4). The filenames are generic (`implement.md` /
 * `check.md`), so deletion is content-gated: a file without the channel
 * marker is user-authored and stays.
 */
const LEGACY_CHANNEL_AGENTS: readonly {
  relativePath: string;
  contentMarker: RegExp;
}[] = [
  {
    relativePath: ".trellis/agents/implement.md",
    contentMarker: /trellis[\s-]?channel/i,
  },
  {
    relativePath: ".trellis/agents/check.md",
    contentMarker: /trellis[\s-]?channel/i,
  },
];

/**
 * Upstream platform config directories that trellis-tiny does not install.
 * Derived from upstream `types/ai-tools.ts` (v0.6.17) minus tiny's active
 * config dirs (`.codex` / `.dsh` / `.zcode`). `.claude` is included: the
 * dormant slot installs nothing, so any trellis content found there came
 * from an upstream install.
 */
const LEGACY_PLATFORM_DIRS: readonly string[] = [
  ".agent",
  ".claude",
  ".codebuddy",
  ".cursor",
  ".devin",
  ".factory",
  ".gemini",
  ".github/copilot",
  ".grok",
  ".kimi-code",
  ".kilocode",
  ".kiro",
  ".omp",
  ".opencode",
  ".pi",
  ".qoder",
  ".reasonix",
  ".snow",
  ".trae",
];

/** User data — convergence must never propose deletions under these. */
const USER_DATA_PREFIXES = [
  ".trellis/tasks/",
  ".trellis/workspace/",
  ".trellis/spec/",
];

/** A deletion candidate produced by {@link detectLegacyArtifacts}. */
export interface LegacyArtifact {
  /** POSIX path relative to cwd. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  kind: "file" | "dir";
  /** Human-readable reason shown in the plan. */
  reason: string;
}

/**
 * Does `name` mark a trellis-written feature? Covers `trellis-<skill>` skill
 * dirs/files, `.claude/agents/trellis-*.md`, and `commands/trellis` dirs.
 */
function isTrellisNamedFeature(name: string): boolean {
  return name === "trellis" || name.startsWith("trellis-");
}

/** Collect trellis-named features under a legacy platform directory. */
function detectTrellisFeaturesInPlatformDir(
  cwd: string,
  platformDir: string,
): LegacyArtifact[] {
  const absDir = path.join(cwd, ...platformDir.split("/"));
  if (!fs.existsSync(absDir)) return [];

  const artifacts: LegacyArtifact[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (isTrellisNamedFeature(entry.name)) {
        artifacts.push({
          relativePath: toPosix(path.relative(cwd, fullPath)),
          absolutePath: fullPath,
          kind: entry.isDirectory() ? "dir" : "file",
          reason: `trellis feature inside legacy platform dir ${platformDir}`,
        });
      } else if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  };
  walk(absDir);
  return artifacts;
}

/**
 * Detect all upstream leftovers in `cwd`, sorted for a stable plan.
 * Pure detection — no filesystem mutation.
 */
export function detectLegacyArtifacts(cwd: string): LegacyArtifact[] {
  const artifacts: LegacyArtifact[] = [];

  // 1. `.zcode/skills/trellis-*` entries (files or skill dirs).
  const zcodeSkills = path.join(cwd, ...LEGACY_ZCODE_SKILLS_DIR.split("/"));
  if (fs.existsSync(zcodeSkills)) {
    for (const entry of fs.readdirSync(zcodeSkills, { withFileTypes: true })) {
      if (!isTrellisNamedFeature(entry.name)) continue;
      artifacts.push({
        relativePath: `${LEGACY_ZCODE_SKILLS_DIR}/${entry.name}`,
        absolutePath: path.join(zcodeSkills, entry.name),
        kind: entry.isDirectory() ? "dir" : "file",
        reason: "duplicate skill root removed by R2 (.agents/skills/ is the single root)",
      });
    }
  }

  // 2. Upstream transition path `.zcode/cli/agents` (whole subtree).
  const zcodeCliAgents = path.join(
    cwd,
    ...LEGACY_ZCODE_CLI_AGENTS_DIR.split("/"),
  );
  if (fs.existsSync(zcodeCliAgents)) {
    artifacts.push({
      relativePath: LEGACY_ZCODE_CLI_AGENTS_DIR,
      absolutePath: zcodeCliAgents,
      kind: "dir",
      reason: "upstream .zcode/cli/agents transition path (not managed by tiny)",
    });
  }

  // 3. Linear sync script.
  const linearSync = path.join(cwd, ...LEGACY_LINEAR_SYNC_SCRIPT.split("/"));
  if (fs.existsSync(linearSync)) {
    artifacts.push({
      relativePath: LEGACY_LINEAR_SYNC_SCRIPT,
      absolutePath: linearSync,
      kind: "file",
      reason: "upstream Linear integration (not vendored by tiny)",
    });
  }

  // 3b. Channel bundled skill in the shared root (R4) — whole directory
  //     (SKILL.md + references die together).
  const sharedChannelSkill = path.join(
    cwd,
    ...LEGACY_SHARED_CHANNEL_SKILL_DIR.split("/"),
  );
  if (fs.existsSync(sharedChannelSkill)) {
    const stat = fs.statSync(sharedChannelSkill);
    artifacts.push({
      relativePath: LEGACY_SHARED_CHANNEL_SKILL_DIR,
      absolutePath: sharedChannelSkill,
      kind: stat.isDirectory() ? "dir" : "file",
      reason: "channel bundled skill removed by R4 (tiny ships no channel)",
    });
  }

  // 3c. Channel runtime agents under `.trellis/agents/` (R4, content-gated
  //     so user-authored files with the same generic names survive).
  for (const agent of LEGACY_CHANNEL_AGENTS) {
    const absPath = path.join(cwd, ...agent.relativePath.split("/"));
    if (!fs.existsSync(absPath)) continue;
    try {
      if (!agent.contentMarker.test(fs.readFileSync(absPath, "utf-8"))) {
        continue;
      }
    } catch {
      continue;
    }
    artifacts.push({
      relativePath: agent.relativePath,
      absolutePath: absPath,
      kind: "file",
      reason: "channel runtime agent definition (R4; content-verified)",
    });
  }

  // 3d. Upstream-only trellis-meta channel reference page (R4).
  const metaChannelRef = path.join(
    cwd,
    ...LEGACY_META_CHANNEL_REFERENCE.split("/"),
  );
  if (fs.existsSync(metaChannelRef)) {
    artifacts.push({
      relativePath: LEGACY_META_CHANNEL_REFERENCE,
      absolutePath: metaChannelRef,
      kind: "file",
      reason: "upstream-only trellis-meta channel reference (not vendored by tiny)",
    });
  }

  // 4. Trellis-named features inside non-target platform directories.
  for (const platformDir of LEGACY_PLATFORM_DIRS) {
    artifacts.push(...detectTrellisFeaturesInPlatformDir(cwd, platformDir));
  }

  // Defensive: user data can never be a deletion candidate.
  const safe = artifacts.filter(
    (a) => !USER_DATA_PREFIXES.some((p) => a.relativePath.startsWith(p)),
  );

  return safe.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Print the convergence plan to stdout.
 */
export function printConvergencePlan(plan: LegacyArtifact[]): void {
  if (plan.length === 0) return;
  console.log(chalk.yellow("\n🔧 Legacy upstream artifacts detected:"));
  for (const artifact of plan) {
    console.log(
      `  ${chalk.red("-")} ${artifact.relativePath}  ${chalk.gray(`(${artifact.reason})`)}`,
    );
  }
}

function removeArtifact(artifact: LegacyArtifact): void {
  fs.rmSync(artifact.absolutePath, {
    recursive: artifact.kind === "dir",
    force: true,
  });
}

/**
 * Remove an empty directory (and empty ancestors up to — but excluding —
 * `stopAt`). Never crosses above `stopAt`; never touches protected
 * user-data dirs.
 */
function pruneEmptyParents(absPath: string, stopAt: string): void {
  let current = path.dirname(absPath);
  const stop = path.resolve(stopAt);
  while (current.startsWith(stop + path.sep) && current !== stop) {
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

export interface ConvergenceResult {
  /** Artifacts that were detected. */
  detected: LegacyArtifact[];
  /** Artifacts actually deleted (empty in dry-run). */
  removed: string[];
}

/**
 * Print and apply the convergence plan.
 *
 * @param dryRun when true, only prints the plan ("只打印清单") and performs
 *   no deletion.
 */
export function convergeLegacyArtifacts(
  cwd: string,
  dryRun: boolean,
): ConvergenceResult {
  const plan = detectLegacyArtifacts(cwd);
  if (plan.length === 0) {
    return { detected: [], removed: [] };
  }

  printConvergencePlan(plan);

  if (dryRun) {
    console.log(chalk.gray("Dry run — legacy artifacts were NOT deleted."));
    return { detected: plan, removed: [] };
  }

  const removed: string[] = [];
  for (const artifact of plan) {
    try {
      removeArtifact(artifact);
      removed.push(artifact.relativePath);
      pruneEmptyParents(artifact.absolutePath, cwd);
    } catch (err) {
      console.warn(
        chalk.yellow(
          `  ⚠ Failed to remove ${artifact.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }
  console.log(
    chalk.green(
      `✓ Converged: ${removed.length} legacy artifact(s) removed.`),
  );
  return { detected: plan, removed };
}
