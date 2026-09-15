/**
 * `tt uninstall` — remove every file trellis-tiny wrote, in reverse of the
 * `.template-hashes.json` manifest (design §4).
 *
 * Differences from upstream uninstall (by design, PRD D5/R1 scope):
 * - user data is PRESERVED: `.trellis/tasks/`, `.trellis/workspace/` and
 *   `.trellis/spec/` are never deleted (upstream removes `.trellis/`
 *   wholesale) — the command prints a keep note instead;
 * - no scrubber matrix (23-platform uninstall-scrubbers dropped): structured
 *   platform configs are manifest-listed files and are removed outright,
 *   with AGENTS.md as the one mixed-ownership exception — its TRELLIS
 *   managed block is stripped and the file is deleted only when nothing
 *   user-authored remains;
 * - platform directories are removed only when every remaining entry was
 *   tiny-written (i.e. the dir is empty after manifest deletions — an empty
 *   user file keeps the dir alive);
 * - `.gitattributes` (journal merge=union) is additive and left in place.
 */

import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";
import inquirer from "inquirer";

import { PLATFORM_IDS } from "../configurators/index.js";
import { AI_TOOLS } from "../types/ai-tools.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../constants/paths.js";
import { loadHashes } from "../lib/template-hash.js";
import {
  homedirBypassEnabled,
  homedirGuardMessage,
  isCwdHomedir,
} from "../utils/cwd-guard.js";
import { writeFileAtomic } from "../utils/atomic-write.js";

export interface UninstallOptions {
  /** Skip the confirmation prompt (still protected by the dry-run guard). */
  yes?: boolean;
  /** Print the plan without deleting anything. */
  dryRun?: boolean;
}

export interface UninstallSummary {
  /** Manifest-listed files deleted. */
  deleted: string[];
  /** Mixed-ownership files whose managed block was stripped. */
  modified: string[];
  /** Files the manifest listed but that were already gone. */
  missing: string[];
  /** True when nothing was removed because trellis isn't installed. */
  notInstalled: boolean;
}

const TRELLIS_BLOCK_START = "<!-- TRELLIS:START -->";
const TRELLIS_BLOCK_END = "<!-- TRELLIS:END -->";

/** Directories uninstall never removes, nor removes files under (POSIX). */
const USER_DATA_DIRS: readonly string[] = [
  `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.TASKS}`,
  `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.WORKSPACE}`,
  `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}`,
];

/**
 * Untracked trellis-tiny runtime files under `.trellis/` (hash-excluded, so
 * absent from the manifest). Since tiny keeps `.trellis/` alive for user
 * data, these are removed explicitly. All are machine-written state — none
 * carry user prose.
 */
const RUNTIME_FILES: readonly string[] = [
  `${DIR_NAMES.WORKFLOW}/.template-hashes.json`,
  `${DIR_NAMES.WORKFLOW}/.gitignore`,
  PATHS.DEVELOPER_FILE,
  PATHS.CURRENT_TASK_FILE,
];

/** Managed roots considered for empty-dir pruning after file deletions. */
function managedRootDirs(): string[] {
  return [
    DIR_NAMES.WORKFLOW,
    ".agents",
    ...PLATFORM_IDS.map((id) => AI_TOOLS[id].configDir),
  ];
}

interface UninstallPlan {
  /** Existing manifest files that will be unlinked. */
  deletions: { relativePath: string; absolutePath: string }[];
  /** Untracked runtime files that will be removed. */
  runtimeDeletions: { relativePath: string; absolutePath: string }[];
  /** Manifest files that track AGENTS.md — scrub instead of blind delete. */
  scrubAgentsMd: boolean;
  /** Manifest entries already missing on disk. */
  missing: string[];
}

function buildPlan(cwd: string): UninstallPlan {
  const hashes = loadHashes(cwd);
  const deletions: UninstallPlan["deletions"] = [];
  const missing: string[] = [];

  for (const relativePath of Object.keys(hashes).sort()) {
    if (USER_DATA_DIRS.some((d) => relativePath.startsWith(`${d}/`))) {
      // Defensive: user data can never be in the manifest, but a poisoned
      // one must not turn into deletions here.
      continue;
    }
    const absolutePath = path.join(cwd, ...relativePath.split("/"));
    if (fs.existsSync(absolutePath)) {
      deletions.push({ relativePath, absolutePath });
    } else {
      missing.push(relativePath);
    }
  }

  const runtimeDeletions = RUNTIME_FILES.map((relativePath) => ({
    relativePath,
    absolutePath: path.join(cwd, ...relativePath.split("/")),
  })).filter((f) => fs.existsSync(f.absolutePath));

  const scrubAgentsMd = deletions.some(
    (d) => d.relativePath === FILE_NAMES.AGENTS,
  );
  return { deletions, runtimeDeletions, scrubAgentsMd, missing };
}

function renderPlan(cwd: string, plan: UninstallPlan): void {
  console.log(chalk.bold("\ntrellis-tiny uninstall plan\n"));
  const total = plan.deletions.length + plan.runtimeDeletions.length;
  console.log(chalk.red.bold(`Will be deleted (${total} files):`));
  for (const d of plan.deletions) {
    console.log(`  ${chalk.red("-")} ${d.relativePath}`);
  }
  for (const d of plan.runtimeDeletions) {
    console.log(`  ${chalk.red("-")} ${d.relativePath}  ${chalk.gray("(runtime state)")}`);
  }
  if (plan.scrubAgentsMd) {
    console.log(
      chalk.yellow(
        `  ~ ${FILE_NAMES.AGENTS} — only the TRELLIS managed block is removed; ` +
          `the file is deleted if nothing user-authored remains.`,
      ),
    );
  }
  if (plan.missing.length > 0) {
    console.log(
      chalk.gray(
        `\n(${plan.missing.length} manifest entries already missing on disk — skipped.)`,
      ),
    );
  }
  console.log(
    chalk.green.bold("\nWill be kept (your data):"),
  );
  for (const d of USER_DATA_DIRS) {
    if (fs.existsSync(path.join(cwd, d))) {
      console.log(`  ${chalk.green("+")} ${d}/`);
    }
  }
  console.log(chalk.green(`  ${chalk.green("+")} .gitattributes (journal merge=union rule stays)`));
  console.log("");
}

async function promptContinue(): Promise<boolean> {
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: "Continue?",
      default: true,
    },
  ]);
  return proceed;
}

/**
 * Strip the TRELLIS managed block from AGENTS.md content. Returns the
 * remaining content, or null when there is no (complete) block to strip.
 */
export function stripManagedBlock(content: string): string | null {
  const start = content.indexOf(TRELLIS_BLOCK_START);
  if (start === -1) return null;
  const end = content.indexOf(TRELLIS_BLOCK_END, start);
  if (end === -1) return null;
  return (
    content.slice(0, start) +
    content.slice(end + TRELLIS_BLOCK_END.length)
  );
}

/**
 * Recursively remove empty directories under `dir`, bottom-up. Protected
 * directories are never removed themselves — but `.trellis/` is still
 * descended into so its prunable children (scripts/, platform files) are
 * cleaned. User-data subtrees are neither removed nor descended into.
 */
function pruneEmptyDirs(
  dir: string,
  projectRoot: string,
  protectedDirs: ReadonlySet<string>,
  sealedDirs: ReadonlySet<string>,
): number {
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(projectRoot)) return 0;
  if (sealedDirs.has(resolved)) return 0;

  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removed += pruneEmptyDirs(
        path.join(resolved, entry.name),
        projectRoot,
        protectedDirs,
        sealedDirs,
      );
    }
  }

  if (protectedDirs.has(resolved)) return removed;
  try {
    if (fs.readdirSync(resolved).length === 0) {
      fs.rmdirSync(resolved);
      removed += 1;
    }
  } catch {
    // Left in place on failure — never fatal for uninstall.
  }
  return removed;
}

export async function uninstall(
  options: UninstallOptions = {},
): Promise<UninstallSummary> {
  const summary: UninstallSummary = {
    deleted: [],
    modified: [],
    missing: [],
    notInstalled: false,
  };

  if (isCwdHomedir() && !homedirBypassEnabled()) {
    console.error(chalk.red(homedirGuardMessage("uninstall")));
    process.exit(1);
  }

  const cwd = process.cwd();
  const trellisDir = path.join(cwd, DIR_NAMES.WORKFLOW);

  if (!fs.existsSync(trellisDir)) {
    console.log(
      chalk.gray(
        "trellis-tiny is not installed in this project (no .trellis/ directory found).",
      ),
    );
    summary.notInstalled = true;
    return summary;
  }

  if (Object.keys(loadHashes(cwd)).length === 0) {
    console.error(
      chalk.red(
        "Found .trellis/ but no valid template manifest — cannot tell tiny-written " +
          "files from your own. Run `tt init` to regenerate the manifest, or delete " +
          ".trellis/ manually if you are sure.",
      ),
    );
    process.exit(1);
  }

  const plan = buildPlan(cwd);
  summary.missing = plan.missing;
  renderPlan(cwd, plan);

  if (options.dryRun) {
    console.log(chalk.gray("Dry run — no files were modified."));
    return summary;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        chalk.red(
          "Refusing to prompt for confirmation in a non-interactive shell. " +
            "Pass --yes/-y to confirm or --dry-run to preview.",
        ),
      );
      process.exit(1);
    }
    const ok = await promptContinue();
    if (!ok) {
      console.log(chalk.yellow("Uninstall cancelled. No files modified."));
      return summary;
    }
  }

  // 1. Unlink every manifest-listed file (AGENTS.md handled after).
  const allDeletions = [...plan.deletions, ...plan.runtimeDeletions];
  for (const d of allDeletions) {
    if (d.relativePath === FILE_NAMES.AGENTS) continue;
    try {
      fs.rmSync(d.absolutePath, { force: true });
      summary.deleted.push(d.relativePath);
    } catch (err) {
      console.warn(
        chalk.yellow(
          `  ⚠ Failed to remove ${d.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  // 2. AGENTS.md: strip the managed block; delete only when empty.
  if (plan.scrubAgentsMd) {
    const agentsPath = path.join(cwd, FILE_NAMES.AGENTS);
    try {
      const content = fs.readFileSync(agentsPath, "utf-8");
      const stripped = stripManagedBlock(content);
      if (stripped === null) {
        // No complete managed block — content is not recognizably
        // trellis-authored. Never blind-delete user-authored prose.
        console.warn(
          chalk.yellow(
            `  ⚠ ${FILE_NAMES.AGENTS} has no complete TRELLIS managed block — left untouched.`,
          ),
        );
      } else if (stripped.trim() === "") {
        fs.rmSync(agentsPath, { force: true });
        summary.deleted.push(FILE_NAMES.AGENTS);
      } else {
        writeFileAtomic(agentsPath, stripped);
        summary.modified.push(FILE_NAMES.AGENTS);
      }
    } catch (err) {
      console.warn(
        chalk.yellow(
          `  ⚠ Failed to scrub ${FILE_NAMES.AGENTS}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  // 3. Prune now-empty directories inside managed roots. `.trellis/` itself
  //    and the user-data dirs always survive; user-data subtrees are sealed
  //    (not even descended into).
  const protectedDirs = new Set<string>([
    path.resolve(trellisDir),
    ...USER_DATA_DIRS.map((d) => path.resolve(path.join(cwd, d))),
  ]);
  const sealedDirs = new Set<string>(
    USER_DATA_DIRS.map((d) => path.resolve(path.join(cwd, d))),
  );
  let removedDirs = 0;
  for (const root of managedRootDirs()) {
    const rootPath = path.join(cwd, ...root.split("/"));
    if (fs.existsSync(rootPath)) {
      removedDirs += pruneEmptyDirs(rootPath, cwd, protectedDirs, sealedDirs);
    }
  }

  console.log(
    chalk.green(
      `\n✓ Uninstalled trellis-tiny: ${summary.deleted.length} file(s) deleted, ` +
        `${summary.modified.length} file(s) scrubbed, ${removedDirs} empty dir(s) removed.`,
    ),
  );
  console.log(
    chalk.gray(
      "   Your .trellis/tasks, .trellis/workspace and .trellis/spec data was kept.",
    ),
  );
  return summary;
}
