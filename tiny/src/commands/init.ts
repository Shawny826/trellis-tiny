/**
 * `tt init` — install the trellis-tiny workflow into the current project.
 *
 * Rewritten for the 3-platform matrix (codex / zcode / dsh + dormant claude
 * slot) per design §4. Flow:
 *
 *   1. cwd-guard (refuse $HOME)
 *   2. Python detection (TRELLIS_PYTHON_CMD > TRELLIS_SKIP_PYTHON_CHECK >
 *      candidate probe — `lib/python-resolver.ts`)
 *   3. Platform selection: explicit flags or interactive checkbox (defaults:
 *      zcode + codex; dsh stays opt-in). `--claude` prints the dormant-slot
 *      notice.
 *   4. Convergence (D5): detect + remove upstream leftovers (`--dry-run`
 *      prints the list only) — `commands/convergence.ts`
 *   5. `.trellis/` skeleton: scripts (exec bit), workflow.md (R3), config,
 *      gitignore/gitattributes (journal merge=union), spec minimal set,
 *      workspace/, tasks/
 *   6. Per-platform files via `configurePlatform`; every write goes through
 *      the recording file-writer so the hash manifest covers exactly what
 *      tiny wrote.
 *   7. `.trellis/.template-hashes.json` (v2 schema) from the recorded writes.
 *
 * Dropped from upstream init (design §7): figlet banner, project detection,
 * monorepo flows, remote spec templates, bootstrap/joiner task creation,
 * `.version` stamping, workflow variants.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";

import chalk from "chalk";
import inquirer from "inquirer";

import {
  configurePlatform,
  getInitToolChoices,
  getPlatformsWithPythonHooks,
  resolveCliFlag,
} from "../configurators/index.js";
import { replacePythonCommandLiterals } from "../configurators/shared.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../constants/paths.js";
import {
  initializeHashes,
  isDerivedArtifactPath,
  loadKnownTemplatePaths,
} from "../lib/template-hash.js";
import { resolveSupportedPython } from "../lib/python-resolver.js";
import {
  agentsMdContent,
  getSpecTemplates,
  workspaceIndexContent,
} from "../templates/markdown/index.js";
import {
  configYamlTemplate,
  getAllScripts,
  gitattributesTemplate,
  gitignoreTemplate,
  workflowMdTemplate,
} from "../templates/trellis/index.js";
import type { AITool, CliFlag } from "../types/ai-tools.js";
import {
  homedirBypassEnabled,
  homedirGuardMessage,
  isCwdHomedir,
} from "../utils/cwd-guard.js";
import {
  ensureDir,
  setWriteMode,
  startRecordingWrites,
  stopRecordingWrites,
  writeFile,
  type WriteMode,
} from "../utils/file-writer.js";
import { convergeLegacyArtifacts } from "./convergence.js";

export interface InitOptions {
  zcode?: boolean;
  codex?: boolean;
  dsh?: boolean;
  /** Dormant extension slot — prints a notice, installs nothing. */
  claude?: boolean;
  /** Non-interactive mode: default platforms, skip existing files. */
  yes?: boolean;
  /** Overwrite existing files. */
  force?: boolean;
  /** Skip files that already exist. */
  skipExisting?: boolean;
  /** Detect + print (incl. the convergence list) without writing/deleting. */
  dryRun?: boolean;
  /** Developer name (default: `git config user.name`, else interactive). */
  user?: string;
}

/** Machine-readable outcome of an init run (also the test seam). */
export interface InitSummary {
  dryRun: boolean;
  /** Platform ids actually selected for install. */
  platforms: AITool[];
  /** Legacy artifacts removed by convergence (empty under --dry-run). */
  converged: string[];
  /** Files the recording writer wrote this run. */
  wroteCount: number;
  /** Entries in the freshly written `.template-hashes.json`. */
  hashedCount: number;
  developer?: string;
}

/**
 * Regex used to detect an existing `journal-*.md merge=union` gitattributes
 * rule, so `ensureGitattributes` never appends a duplicate entry to a
 * project's pre-existing `.gitattributes`.
 */
const JOURNAL_MERGE_UNION_PATTERN = /journal-\*\.md\s+merge=union/;

/**
 * Ensure the project-root `.gitattributes` carries the journal `merge=union`
 * rule without ever overwriting a user's file: write the template when the
 * file is missing, append otherwise, no-op when the rule already exists.
 * Intentionally bypasses the conflict-prompt flow (additive-only file) and
 * the write recorder (shared ownership — uninstall must not delete it).
 */
export function ensureGitattributes(cwd: string): void {
  const targetPath = path.join(cwd, ".gitattributes");

  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, gitattributesTemplate);
    return;
  }

  const existing = fs.readFileSync(targetPath, "utf-8");
  if (JOURNAL_MERGE_UNION_PATTERN.test(existing)) {
    return;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(targetPath, existing + separator + gitattributesTemplate);
}

/**
 * Create the `.trellis/` workflow skeleton. Spec content is the generic
 * minimal set (guides + backend + frontend) — project detection was dropped
 * (design §7). `.trellis/spec/` files are written through the conflict-aware
 * writer, so a re-init never clobbers customized spec docs without consent.
 */
async function createWorkflowStructure(cwd: string): Promise<void> {
  ensureDir(path.join(cwd, DIR_NAMES.WORKFLOW));

  // Python workflow scripts. The python3 rewrite happens HERE and again in
  // update's renderTemplateMap — both sides idempotent, so init-time and
  // update-time bytes stay identical (the AC7 load-bearing invariant). The
  // exec-bit flag is recorded semantics; on Windows chmod is a no-op.
  for (const [scriptPath, content] of getAllScripts()) {
    const absPath = path.join(cwd, PATHS.SCRIPTS, ...scriptPath.split("/"));
    ensureDir(path.dirname(absPath));
    await writeFile(absPath, replacePythonCommandLiterals(content), {
      executable: /\.(py|sh)$/.test(scriptPath),
    });
  }

  await writeFile(
    path.join(cwd, PATHS.WORKFLOW_GUIDE_FILE),
    replacePythonCommandLiterals(workflowMdTemplate),
  );
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, ".gitignore"),
    gitignoreTemplate,
  );
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml"),
    configYamlTemplate,
  );

  ensureGitattributes(cwd);

  // workspace/ + index.md (NO `.trellis/agents/` — channel runtime, R4)
  ensureDir(path.join(cwd, PATHS.WORKSPACE));
  await writeFile(
    path.join(cwd, PATHS.WORKSPACE, "index.md"),
    replacePythonCommandLiterals(workspaceIndexContent),
  );

  ensureDir(path.join(cwd, PATHS.TASKS));

  // Generic minimal spec set: `.trellis/spec/{guides,backend,frontend}/`.
  for (const spec of getSpecTemplates()) {
    const absPath = path.join(cwd, PATHS.SPEC, ...spec.relativePath.split("/"));
    ensureDir(path.dirname(absPath));
    await writeFile(absPath, spec.content);
  }
}

/** Root-level files: AGENTS.md (managed block, skip-existing aware). */
async function createRootFiles(cwd: string): Promise<void> {
  const agentsWritten = await writeFile(
    path.join(cwd, FILE_NAMES.AGENTS),
    agentsMdContent,
  );
  if (agentsWritten) {
    console.log(chalk.blue("📄 Created AGENTS.md"));
  }
}

interface PlatformSelection {
  platforms: AITool[];
  claudeRequested: boolean;
}

/**
 * Resolve target platforms from explicit flags, `-y` defaults, or the
 * interactive checkbox. Explicit flags win over everything; non-TTY runs
 * without flags fall back to the registry defaults instead of crashing on a
 * prompt it cannot render.
 */
async function resolveTargetPlatforms(
  options: InitOptions,
): Promise<PlatformSelection> {
  const choices = getInitToolChoices();
  const explicit = choices
    .filter((c) => options[c.key as keyof InitOptions] === true)
    .map((c) => c.platformId);
  const claudeRequested = options.claude === true;
  const defaults = choices
    .filter((c) => c.defaultChecked)
    .map((c) => c.platformId);

  if (explicit.length > 0) {
    return { platforms: explicit, claudeRequested };
  }
  if (options.yes) {
    return { platforms: defaults, claudeRequested };
  }
  if (process.stdin.isTTY) {
    const answers = await inquirer.prompt<{ tools: CliFlag[] }>([
      {
        type: "checkbox",
        name: "tools",
        message: "Select AI tools to configure:",
        choices: choices.map((t) => ({
          name: t.name,
          value: t.key,
          checked: t.defaultChecked,
        })),
      },
    ]);
    return {
      platforms: answers.tools
        .map((flag) => resolveCliFlag(flag))
        .filter((id): id is AITool => id !== undefined),
      claudeRequested,
    };
  }
  console.log(
    chalk.gray(
      "Non-interactive run without explicit platform flags — using defaults " +
        "(zcode + codex). Pass --codex/--zcode/--dsh to override.",
    ),
  );
  return { platforms: defaults, claudeRequested };
}

/** Detect developer name from options or git config. */
function detectDeveloperName(cwd: string, options: InitOptions): string | undefined {
  if (options.user?.trim()) return options.user.trim();
  if (!fs.existsSync(path.join(cwd, ".git"))) return undefined;
  try {
    const name = execSync("git config user.name", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Minimal readline input (no inquirer flicker), upstream parity. */
function askInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function logPythonAdaptationNotice(command: string): void {
  console.log(
    chalk.blue(
      `📌 Python commands were rendered as "${command}" in generated hooks, settings, and help text`,
    ),
  );
}

/**
 * Init entry point. Throws on unrecoverable setup errors (Python missing);
 * exits via the homedir guard when run in $HOME.
 */
export async function init(options: InitOptions = {}): Promise<InitSummary> {
  if (isCwdHomedir() && !homedirBypassEnabled()) {
    console.error(chalk.red(homedirGuardMessage("init")));
    process.exit(1);
  }

  const cwd = process.cwd();
  const dryRun = options.dryRun === true;

  console.log(chalk.cyan("\ntrellis-tiny init"));
  console.log(
    chalk.gray(
      "   Slim Trellis distribution — codex / zcode / dsh · zero-task fast path · no channel\n",
    ),
  );

  // Python detection happens before anything else so a broken environment
  // fails before any filesystem mutation.
  const { command: pythonCmd } = resolveSupportedPython();

  // Write mode: explicit flags win; `-y` implies non-interactive skip. The
  // init flow always calls setWriteMode explicitly — the file-writer only
  // auto-degrades "ask" on non-TTY as a safety net.
  let writeMode: WriteMode = "ask";
  if (options.force) {
    writeMode = "force";
    console.log(chalk.gray("Mode: Force overwrite existing files\n"));
  } else if (options.skipExisting) {
    writeMode = "skip";
    console.log(chalk.gray("Mode: Skip existing files\n"));
  } else if (options.yes) {
    writeMode = "skip";
    console.log(chalk.gray("Mode: Non-interactive (skip existing files)\n"));
  }
  if (!dryRun) {
    setWriteMode(writeMode);
  }

  const { platforms, claudeRequested } = await resolveTargetPlatforms(options);
  if (claudeRequested) {
    console.log(
      chalk.yellow(
        "ℹ --claude: Claude Code is a dormant extension slot in trellis-tiny — nothing was installed for it.",
      ),
    );
  }
  if (platforms.length === 0) {
    console.log(
      chalk.yellow("No tools selected. At least one tool is required."),
    );
    return {
      dryRun,
      platforms: [],
      converged: [],
      wroteCount: 0,
      hashedCount: 0,
    };
  }
  console.log(
    chalk.blue("🎯 Platforms:"), chalk.gray(platforms.join(", ")),
  );

  // Developer identity — needed only for init_developer.py later.
  let developerName = detectDeveloperName(cwd, options);
  if (!developerName && !options.yes && process.stdin.isTTY && !dryRun) {
    developerName = await askInput("Your name (git username): ");
  }
  if (developerName) {
    console.log(chalk.blue("👤 Developer:"), chalk.gray(developerName));
  }

  // Convergence (D5): upstream leftovers, printed then removed. Dry-run
  // stops here with the full plan ("只打印清单").
  const convergence = convergeLegacyArtifacts(cwd, dryRun);
  if (dryRun) {
    console.log(
      chalk.gray(
        `\nDry run — no files were written or deleted. Would install: ${platforms.join(", ")}.`,
      ),
    );
    return {
      dryRun: true,
      platforms,
      converged: [],
      wroteCount: 0,
      hashedCount: 0,
      developer: developerName,
    };
  }

  // Record every write from here so the manifest covers exactly what this
  // run wrote — never pre-existing user files.
  const writtenPaths = startRecordingWrites(cwd);
  try {
    console.log(chalk.blue("📁 Creating .trellis/ workflow structure..."));
    await createWorkflowStructure(cwd);

    for (const platformId of platforms) {
      console.log(chalk.blue(`📝 Configuring ${platformId}...`));
      await configurePlatform(platformId, cwd);
    }

    const pythonPlatforms = getPlatformsWithPythonHooks();
    if (pythonPlatforms.some((id) => platforms.includes(id))) {
      logPythonAdaptationNotice(pythonCmd);
    }

    await createRootFiles(cwd);
  } finally {
    stopRecordingWrites();
  }

  // Hash manifest — v2 schema, rebuilt wholesale each init.
  //
  // Ownership rule: recorded writes are always tracked. A re-init that
  // overwrites trellis-owned files with byte-identical content produces NO
  // recorded writes (file-writer skips identical files to protect
  // pre-existing user files), so paths recorded by ANY previous installer
  // manifest are carried over as an ownership credential — including a
  // legacy v1/upstream manifest, whose hash values use a foreign algorithm
  // and are never copied or compared (M9 defect: CRLF/foreign-hash mismatch
  // made update flag pristine files as "locally modified").
  // initializeHashes re-hashes carried paths with tiny's own computeHash.
  const previousPaths = loadKnownTemplatePaths(cwd);
  const trackedPaths = new Set(writtenPaths);
  for (const key of previousPaths) {
    if (key.startsWith(".trellis/")) continue; // covered by the walk below
    // A legacy manifest may carry derived/runtime entries (bytecode caches,
    // hook-written state) — never carry those into the fresh manifest.
    if (isDerivedArtifactPath(key)) continue;
    if (trackedPaths.has(key)) continue;
    if (!fs.existsSync(path.join(cwd, ...key.split("/")))) continue;
    trackedPaths.add(key);
  }
  const hashedCount = initializeHashes(cwd, { trackedPaths });
  console.log(
    chalk.gray(
      `📋 Tracking ${hashedCount} template files for updates ` +
        `(${writtenPaths.size} written this run).`,
    ),
  );

  // Developer identity (best-effort; failure is non-fatal).
  if (developerName) {
    try {
      const scriptPath = path.join(cwd, PATHS.SCRIPTS, "init_developer.py");
      execSync(`${pythonCmd} "${scriptPath}" "${developerName}"`, {
        cwd,
        stdio: "pipe",
      });
    } catch {
      console.log(
        chalk.gray(
          "   init_developer.py could not run — identity can be set later:",
        ),
      );
      console.log(
        chalk.gray(`   ${pythonCmd} ./.trellis/scripts/init_developer.py <name>`),
      );
    }
  }

  console.log(chalk.green("\n✓ trellis-tiny initialized."));
  console.log(
    chalk.gray("   Simple tasks now run direct (no task dir); complex ones still use the full task workflow.\n"),
  );

  return {
    dryRun: false,
    platforms,
    converged: convergence.removed,
    wroteCount: writtenPaths.size,
    hashedCount,
    developer: developerName,
  };
}
