/**
 * tt — trellis-tiny CLI entry.
 *
 * Subcommands: init / update / uninstall / mem. Slimmed down from upstream
 * (design §7): no channel / ablate / restore / upgrade / workflow / platforms
 * commands, no 23-platform flag matrix, and no `.version` update-check
 * preamble (tiny does not stamp `.trellis/.version`).
 *
 * Exit-code contract: init/update/uninstall already call `process.exit(1)`
 * internally for their specific guards (homedir, missing manifest, non-TTY
 * confirmation). This layer only converts thrown errors into exit 1 —
 * graceful paths (e.g. update/uninstall in an uninstalled project) return
 * their summary output and exit 0.
 */

import chalk from "chalk";
import { Command } from "commander";

import { init } from "../commands/init.js";
import type { InitOptions } from "../commands/init.js";
import { runMem } from "../commands/mem.js";
import { uninstall } from "../commands/uninstall.js";
import type { UninstallOptions } from "../commands/uninstall.js";
import { update } from "../commands/update.js";
import type { UpdateOptions } from "../commands/update.js";
import { PACKAGE_NAME, VERSION } from "../constants/version.js";

// Re-export for backwards compatibility (consumers should prefer
// constants/version.js).
export { VERSION, PACKAGE_NAME };

function fail(error: unknown): never {
  console.error(
    chalk.red("Error:"),
    error instanceof Error ? error.message : error,
  );
  if (process.env.DEBUG || process.env.TRELLIS_DEBUG) {
    console.error(error instanceof Error ? error.stack : error);
  }
  process.exit(1);
}

const program = new Command();

program
  .name("tt")
  .description(
    "trellis-tiny — slimmed-down Trellis workflow: codex / zcode / dsh, zero-task fast path, no channel",
  )
  .version(VERSION, "-v, --version", "output the version number");

program
  .command("init")
  .description("Initialize trellis-tiny in the current project")
  .option("--zcode", "Include ZCode integration")
  .option("--codex", "Include Codex integration")
  .option("--dsh", "Include DeepSeek Harness (dsh) integration")
  .option(
    "--claude",
    "Claude Code extension slot (dormant — prints a notice, installs nothing)",
  )
  .option("-y, --yes", "Non-interactive: default platforms, skip existing files")
  .option("-u, --user <name>", "Initialize developer identity with this name")
  .option("-f, --force", "Overwrite existing files without asking")
  .option("--skip-existing", "Skip files that already exist")
  .option(
    "--dry-run",
    "Detect + print the plan (including the legacy-convergence list) without writing or deleting anything",
  )
  .action(async (options: Record<string, unknown>) => {
    try {
      await init(options as InitOptions);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("update")
  .description("Update trellis-tiny template files to the shipped version")
  .option("--dry-run", "Preview the update plan without applying it")
  .option("-f, --force", "Overwrite all locally modified files without asking")
  .option("--skip-all", "Keep all locally modified files without asking")
  .option("-n, --create-new", "Write locally modified files as <path>.new copies")
  .action(async (options: Record<string, unknown>) => {
    try {
      await update({
        dryRun: options.dryRun === true,
        force: options.force === true,
        skipAll: options.skipAll === true,
        createNew: options.createNew === true,
      } satisfies UpdateOptions);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("uninstall")
  .description(
    "Remove trellis-tiny-written files from this project (user data under .trellis/tasks, .trellis/workspace and .trellis/spec is preserved)",
  )
  .option("-y, --yes", "Skip the confirmation prompt")
  .option("--dry-run", "List what would be removed without changing anything")
  .action(async (options: Record<string, unknown>) => {
    try {
      await uninstall({
        yes: options.yes === true,
        dryRun: options.dryRun === true,
      } satisfies UninstallOptions);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("mem")
  .description(
    "Search/recall AI conversation history across Claude Code, Codex, ZCode and more (run 'tt mem help' for subcommands and flags)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .argument(
    "[args...]",
    "subcommand and arguments (list|search|context|extract|projects|help)",
  )
  .action((args: string[] = []) => {
    try {
      runMem(args);
    } catch (error) {
      fail(error);
    }
  });

program.parse();
