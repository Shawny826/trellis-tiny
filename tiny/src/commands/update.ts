/**
 * `tt update` — refresh installed trellis-tiny templates via a three-way
 * comparison against `.trellis/.template-hashes.json` (design §4).
 *
 * For every file in the freshly rendered desired set:
 *   - disk missing, no stored hash        → new file, write
 *   - disk missing, stored hash exists    → user deleted it, respect that
 *   - disk == template                    → unchanged, no write
 *   - disk ≠ template, disk == stored     → template updated, auto-write
 *   - disk ≠ template, disk ≠ stored      → user modified, ask
 *     (keep / overwrite / .new copy; non-TTY degrades to keep + report)
 *
 * Manifest entries the new desired set no longer contains are retired
 * (template removed upstream → file deleted, entry dropped).
 *
 * Idempotency (AC7): with no template change the run writes nothing and the
 * manifest is only rewritten when its content actually changes.
 *
 * Dropped from upstream update (design §7): migrations, version gating /
 * `.version`, backups, `update.skip` config, npm advisory, config-section
 * merge, `.new`-style AGENTS block hashes. Kept: the AGENTS.md managed-block
 * merge (mixed-ownership file) and codex `model` / `model_reasoning_effort`
 * preservation.
 */

import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";
import inquirer from "inquirer";

import {
  collectPlatformTemplates,
  getConfiguredPlatforms,
} from "../configurators/index.js";
import { preserveCodexAgentModelKeys } from "../configurators/codex.js";
import { renderTemplateMap } from "../configurators/shared.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../constants/paths.js";
import {
  computeHash,
  isDerivedArtifactPath,
  loadHashes,
  saveHashes,
  stripDerivedEntries,
  type TemplateHashes,
} from "../lib/template-hash.js";
import {
  agentsMdContent,
} from "../templates/markdown/index.js";
import {
  configYamlTemplate,
  getAllScripts,
  gitignoreTemplate,
  workflowMdTemplate,
} from "../templates/trellis/index.js";
import type { AITool } from "../types/ai-tools.js";
import { toPosix } from "../utils/posix.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { ensureDir } from "../utils/file-writer.js";

export interface UpdateOptions {
  dryRun?: boolean;
  /** Overwrite every user-modified file without asking. */
  force?: boolean;
  /** Keep every user-modified file without asking. */
  skipAll?: boolean;
  /** Write user-modified files as `<path>.new` copies. */
  createNew?: boolean;
}

/** A template file in the desired set. */
interface FileChange {
  relativePath: string;
  newContent: string;
}

interface ChangeAnalysis {
  newFiles: FileChange[];
  unchangedFiles: FileChange[];
  autoUpdateFiles: FileChange[];
  changedFiles: FileChange[];
  userDeletedFiles: FileChange[];
}

type ConflictAction = "overwrite" | "skip" | "create-new";

export interface UpdateSummary {
  newFiles: string[];
  autoUpdated: string[];
  overwritten: string[];
  /** User-modified files kept (skip / non-TTY degradation). */
  kept: string[];
  createdNew: string[];
  /** Deletions by the user that update respected. */
  userDeleted: string[];
  /** Tracked files the current template set no longer ships (removed). */
  retired: string[];
  /** True when nothing needed to be written at all. */
  upToDate: boolean;
}

/** Manifest paths that must never be retired or rewritten (user data). */
const RETIRE_PROTECTED_PREFIXES = [
  `${PATHS.TASKS}/`,
  `${PATHS.WORKSPACE}/`,
  `${PATHS.SPEC}/`,
  `${DIR_NAMES.WORKFLOW}/.runtime/`, // hook/session runtime state (session pointers!)
  PATHS.DEVELOPER_FILE,
  PATHS.CURRENT_TASK_FILE,
];

const SCRIPT_SUFFIXES = [".py", ".sh"];

// ---------------------------------------------------------------------------
// Desired file set
// ---------------------------------------------------------------------------

const TRELLIS_BLOCK_START = "<!-- TRELLIS:START -->";
const TRELLIS_BLOCK_END = "<!-- TRELLIS:END -->";

function buildAgentsMdTemplate(cwd: string): string {
  const fullPath = path.join(cwd, FILE_NAMES.AGENTS);
  if (!fs.existsSync(fullPath)) return agentsMdContent;

  const existing = fs.readFileSync(fullPath, "utf-8");
  const start = existing.indexOf(TRELLIS_BLOCK_START);
  if (start === -1) return agentsMdContent;
  const end = existing.indexOf(TRELLIS_BLOCK_END, start);
  if (end === -1) return agentsMdContent;

  const templateStart = agentsMdContent.indexOf(TRELLIS_BLOCK_START);
  const templateEnd = agentsMdContent.indexOf(TRELLIS_BLOCK_END, templateStart);
  if (templateStart === -1 || templateEnd === -1) return agentsMdContent;

  return (
    existing.slice(0, start) +
    agentsMdContent.slice(templateStart, templateEnd + TRELLIS_BLOCK_END.length) +
    existing.slice(end + TRELLIS_BLOCK_END.length)
  );
}

/**
 * The complete "what should be on disk" snapshot for the configured
 * platforms. Single pass, shared by the diff and the manifest rewrite.
 */
function collectDesiredFiles(
  cwd: string,
  platforms: ReadonlySet<AITool>,
): Map<string, string> {
  const files = new Map<string, string>();

  // Python workflow scripts (single source of truth: getAllScripts()).
  for (const [scriptPath, content] of getAllScripts()) {
    files.set(`${PATHS.SCRIPTS}/${scriptPath}`, content);
  }

  // Core runtime files. workspace/index.md stays excluded — it is
  // runtime-appended by add_session.py.
  files.set(`${DIR_NAMES.WORKFLOW}/config.yaml`, configYamlTemplate);
  files.set(`${DIR_NAMES.WORKFLOW}/.gitignore`, gitignoreTemplate);
  files.set(PATHS.WORKFLOW_GUIDE_FILE, workflowMdTemplate);
  files.set(FILE_NAMES.AGENTS, buildAgentsMdTemplate(cwd));

  // Per-platform files (collectPlatformTemplates renders placeholders).
  for (const platformId of platforms) {
    const platformFiles = collectPlatformTemplates(platformId);
    if (!platformFiles) continue;
    for (const [filePath, content] of platformFiles) {
      files.set(filePath, content);
    }
  }

  // Preserve user-set codex agent model keys before any comparison so the
  // only-local-edit case never becomes a conflict.
  if (platforms.has("codex")) {
    preserveCodexAgentModelKeys(cwd, files);
  }

  // Final python3 rewrite pass — byte-parity with init-time writes
  // (collectPlatformTemplates already rendered; the pass is idempotent).
  return renderTemplateMap(files);
}

// ---------------------------------------------------------------------------
// Three-way analysis
// ---------------------------------------------------------------------------

function analyzeChanges(
  cwd: string,
  hashes: TemplateHashes,
  templates: Map<string, string>,
): ChangeAnalysis {
  const result: ChangeAnalysis = {
    newFiles: [],
    unchangedFiles: [],
    autoUpdateFiles: [],
    changedFiles: [],
    userDeletedFiles: [],
  };

  for (const [relativePath, newContent] of templates) {
    const fullPath = path.join(cwd, ...relativePath.split("/"));
    const change: FileChange = { relativePath, newContent };

    if (!fs.existsSync(fullPath)) {
      if (hashes[relativePath] !== undefined) {
        result.userDeletedFiles.push(change);
      } else {
        result.newFiles.push(change);
      }
      continue;
    }

    const existingContent = fs.readFileSync(fullPath, "utf-8");
    if (existingContent === newContent) {
      result.unchangedFiles.push(change);
      continue;
    }

    const storedHash = hashes[relativePath];
    if (storedHash !== undefined && storedHash === computeHash(existingContent)) {
      // Tracked content unchanged since install → the template moved on.
      result.autoUpdateFiles.push(change);
    } else {
      result.changedFiles.push(change);
    }
  }

  return result;
}

/** Is any path under a retired key user data? */
function isRetireProtected(relativePath: string): boolean {
  return RETIRE_PROTECTED_PREFIXES.some(
    (p) => relativePath === p || relativePath.startsWith(p),
  );
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

async function promptConflictResolution(
  file: FileChange,
  options: UpdateOptions,
  applyToAll: { action: ConflictAction | null },
): Promise<ConflictAction> {
  if (applyToAll.action) return applyToAll.action;
  if (options.force) return "overwrite";
  if (options.skipAll) return "skip";
  if (options.createNew) return "create-new";

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: "list",
      name: "action",
      message: `${file.relativePath} has local changes.`,
      choices: [
        { name: "[1] Overwrite - replace with the new template", value: "overwrite" },
        { name: "[2] Keep - preserve your current version", value: "skip" },
        { name: "[3] Create copy - save the new version as .new", value: "create-new" },
        { name: "[a] Apply Overwrite to all", value: "overwrite-all" },
        { name: "[s] Apply Keep to all", value: "skip-all" },
        { name: "[n] Apply Create copy to all", value: "create-new-all" },
      ],
      default: "skip",
    },
  ]);

  if (action === "overwrite-all") {
    applyToAll.action = "overwrite";
    return "overwrite";
  }
  if (action === "skip-all") {
    applyToAll.action = "skip";
    return "skip";
  }
  if (action === "create-new-all") {
    applyToAll.action = "create-new";
    return "create-new";
  }
  return action as ConflictAction;
}

function writeResolvedFile(
  cwd: string,
  relativePath: string,
  content: string,
): void {
  const absPath = path.join(cwd, ...relativePath.split("/"));
  ensureDir(path.dirname(absPath));
  writeFileAtomic(absPath, content);
  if (SCRIPT_SUFFIXES.some((s) => relativePath.endsWith(s))) {
    // Exec-bit semantics for hook/workflow scripts. On Windows chmod is a
    // no-op; POSIX hosts get the conventional 755.
    fs.chmodSync(absPath, "755");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function update(options: UpdateOptions = {}): Promise<UpdateSummary> {
  const summary: UpdateSummary = {
    newFiles: [],
    autoUpdated: [],
    overwritten: [],
    kept: [],
    createdNew: [],
    userDeleted: [],
    retired: [],
    upToDate: false,
  };

  const cwd = process.cwd();
  const trellisDir = path.join(cwd, DIR_NAMES.WORKFLOW);
  if (!fs.existsSync(trellisDir)) {
    console.log(
      chalk.gray(
        "trellis-tiny is not installed in this project (no .trellis/ directory). Run `tt init` first.",
      ),
    );
    return summary;
  }

  // Self-heal (M8): a manifest written by an older init may carry derived /
  // runtime entries (bytecode caches, `.trellis/.runtime/**` state) that the
  // retire pass would otherwise DELETE — session pointers included. Purge
  // them at read time and persist the repair immediately, so even a run
  // with nothing else to do leaves a clean manifest behind. Retire is and
  // stays manifest-driven (design §4); the manifest itself must never
  // describe derived files.
  const loadedHashes = loadHashes(cwd);
  const hashes = stripDerivedEntries(loadedHashes);
  const purgedDerivedCount =
    Object.keys(loadedHashes).length - Object.keys(hashes).length;
  if (Object.keys(hashes).length === 0) {
    console.error(
      chalk.red(
        "No valid template manifest found (.trellis/.template-hashes.json). " +
          "Run `tt init` to (re)install and generate it — update needs the manifest " +
          "to tell template updates apart from your local edits.",
      ),
    );
    process.exit(1);
  }
  if (purgedDerivedCount > 0) {
    saveHashes(cwd, hashes);
    console.log(
      chalk.gray(
        `   Pruned ${purgedDerivedCount} derived/runtime manifest entries (never templates).`,
      ),
    );
  }

  const platforms = getConfiguredPlatforms(cwd);

  const templates = collectDesiredFiles(cwd, platforms);
  const changes = analyzeChanges(cwd, hashes, templates);
  summary.userDeleted = changes.userDeletedFiles.map((f) => f.relativePath);

  // Templates retired from the desired set: tracked but no longer shipped.
  // Belt-and-braces: derived/runtime keys are excluded twice — they cannot
  // enter `hashes` (purged above) and cannot pass this guard.
  const desiredKeys = new Set(templates.keys());
  const retired = Object.keys(hashes).filter(
    (key) =>
      !desiredKeys.has(key) &&
      !isRetireProtected(key) &&
      !isDerivedArtifactPath(key) &&
      hashes[key] !== undefined,
  );

  // ---------------------------------------------------------------- plan
  const hasConflictWork = changes.changedFiles.length > 0;
  const totalWrites =
    changes.newFiles.length +
    changes.autoUpdateFiles.length +
    (hasConflictWork ? changes.changedFiles.length : 0) +
    retired.length;

  if (totalWrites === 0 && changes.userDeletedFiles.length === 0) {
    console.log(chalk.green("✓ Already up to date!"));
    summary.upToDate = true;
    return summary;
  }

  console.log(chalk.bold("\ntrellis-tiny update plan\n"));
  if (changes.newFiles.length > 0) {
    console.log(chalk.green(`New files (${changes.newFiles.length}):`));
    for (const f of changes.newFiles) console.log(`  ${chalk.green("+")} ${f.relativePath}`);
  }
  if (changes.autoUpdateFiles.length > 0) {
    console.log(chalk.cyan(`Template updates (${changes.autoUpdateFiles.length}):`));
    for (const f of changes.autoUpdateFiles) console.log(`  ${chalk.cyan("↻")} ${f.relativePath}`);
  }
  if (changes.changedFiles.length > 0) {
    console.log(chalk.yellow(`Locally modified (${changes.changedFiles.length}):`));
    for (const f of changes.changedFiles) console.log(`  ${chalk.yellow("~")} ${f.relativePath}`);
  }
  if (changes.userDeletedFiles.length > 0) {
    console.log(chalk.gray(`Deleted by you, kept deleted (${changes.userDeletedFiles.length}):`));
    for (const f of changes.userDeletedFiles) console.log(`  ${chalk.gray("-")} ${f.relativePath}`);
  }
  if (retired.length > 0) {
    console.log(chalk.red(`Retired templates (${retired.length}):`));
    for (const p of retired) console.log(`  ${chalk.red("-")} ${p}`);
  }
  console.log("");

  if (options.dryRun) {
    console.log(chalk.gray("Dry run — no files were modified."));
    return summary;
  }

  // ---------------------------------------------------------------- apply
  for (const f of changes.newFiles) {
    writeResolvedFile(cwd, f.relativePath, f.newContent);
    summary.newFiles.push(f.relativePath);
  }
  for (const f of changes.autoUpdateFiles) {
    writeResolvedFile(cwd, f.relativePath, f.newContent);
    summary.autoUpdated.push(f.relativePath);
  }

  if (changes.changedFiles.length > 0 && !process.stdin.isTTY &&
      !options.force && !options.skipAll && !options.createNew) {
    // Non-interactive degradation: keep user edits, surface them loudly.
    console.log(
      chalk.yellow(
        "Non-interactive session — keeping your local modifications (re-run with --force/--skipAll/--createNew to decide).",
      ),
    );
    for (const f of changes.changedFiles) {
      summary.kept.push(f.relativePath);
      console.log(chalk.gray(`  ○ Kept: ${f.relativePath}`));
    }
  } else {
    const applyToAll: { action: ConflictAction | null } = { action: null };
    for (const f of changes.changedFiles) {
      const action = await promptConflictResolution(f, options, applyToAll);
      if (action === "overwrite") {
        writeResolvedFile(cwd, f.relativePath, f.newContent);
        summary.overwritten.push(f.relativePath);
        console.log(chalk.yellow(`  ↻ Overwritten: ${f.relativePath}`));
      } else if (action === "create-new") {
        const absPath = path.join(cwd, ...f.relativePath.split("/"));
        ensureDir(path.dirname(absPath));
        writeFileAtomic(`${absPath}.new`, f.newContent);
        summary.createdNew.push(f.relativePath);
        console.log(chalk.blue(`  + Created ${f.relativePath}.new`));
      } else {
        summary.kept.push(f.relativePath);
        console.log(chalk.gray(`  ○ Kept: ${f.relativePath}`));
      }
    }
  }

  if (retired.length > 0) {
    for (const relativePath of retired) {
      const absPath = path.join(cwd, ...relativePath.split("/"));
      try {
        fs.rmSync(absPath, { force: true });
        summary.retired.push(relativePath);
      } catch (err) {
        console.warn(
          chalk.yellow(
            `  ⚠ Failed to remove retired template ${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }

  // ------------------------------------------------------ manifest rewrite
  // Only files this run actually wrote get fresh hashes; kept/skipped files
  // keep their stored hash so a future run can still tell "still the old
  // template" (auto-update) from "user content" (conflict). The manifest is
  // rewritten only when its content changed — the AC7 zero-write guarantee.
  const retiredKeys = new Set(summary.retired.map((p) => toPosix(p)));
  const nextHashes: TemplateHashes = {};
  for (const [key, value] of Object.entries(hashes)) {
    if (!retiredKeys.has(key)) nextHashes[key] = value;
  }
  const writtenContents: FileChange[] = [
    ...changes.newFiles,
    ...changes.autoUpdateFiles,
    ...changes.changedFiles.filter((f) => summary.overwritten.includes(f.relativePath)),
  ];
  for (const f of writtenContents) {
    nextHashes[toPosix(f.relativePath)] = computeHash(f.newContent);
  }
  if (JSON.stringify(nextHashes) !== JSON.stringify(hashes)) {
    saveHashes(cwd, nextHashes);
  }

  // ----------------------------------------------------------------- report
  const writtenCount =
    summary.newFiles.length +
    summary.autoUpdated.length +
    summary.overwritten.length;
  console.log(
    chalk.green(
      `\n✓ Update complete: ${writtenCount} file(s) written, ` +
        `${summary.retired.length} retired, ${summary.kept.length} kept.`,
    ),
  );
  if (summary.createdNew.length > 0) {
    console.log(
      chalk.gray("   Review the .new copies and merge them manually."),
    );
  }
  return summary;
}
