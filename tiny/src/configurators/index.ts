/**
 * Platform Registry — Single source of truth for platform functions and
 * derived helpers (trellis-tiny: codex / zcode / dsh + dormant claude-code).
 *
 * All platform-specific lists (managed dirs, configured platforms, etc.)
 * are derived from AI_TOOLS in types/ai-tools.ts. Adding a platform requires:
 * 1. Adding to AI_TOOLS (data)
 * 2. Creating `configurators/<platform>.ts` with a `collect<Platform>Templates()`
 *    that returns the platform's file set — the one place it is described
 * 3. Adding to PLATFORM_FUNCTIONS below, normally `fromTemplates(collect…)`
 * 4. Creating the template directory
 *
 * Trimmed port of upstream `packages/cli/src/configurators/index.ts`
 * (21 platforms → 3 + 1 dormant slot; Windsurf legacy detection dropped).
 */

import {
  AI_TOOLS,
  getManagedPaths,
  isPlatformAvailable,
  type AITool,
  type CliFlag,
} from "../types/ai-tools.js";
import { loadHashes } from "../lib/template-hash.js";
import { collectCodexTemplates, configureCodex } from "./codex.js";
import { collectDshTemplates } from "./dsh.js";
import {
  renderTemplateMap,
  writeTemplateMap,
  type PlatformConfigureOptions,
} from "./shared.js";
import { collectZcodeTemplates, configureZcode } from "./zcode.js";

// =============================================================================
// Platform Functions Registry
// =============================================================================

interface PlatformFunctions {
  /** Configure platform during init (copy templates to project) */
  configure: (cwd: string, options?: PlatformConfigureOptions) => Promise<void>;
  /** Collect template files for update tracking. Undefined = platform skipped during update. */
  collectTemplates?: () => Map<string, string>;
}

/**
 * Registry entry for a platform whose configuration is exactly "write these
 * files": `configure` is derived from `collectTemplates`, so the file set is
 * described once and init and update cannot disagree about it.
 *
 * codex and zcode also do something a `Map<path, content>` cannot express
 * (an empty user extension dir; a console notice) and spell out both fields.
 */
function fromTemplates(
  collectTemplates: () => Map<string, string>,
): PlatformFunctions {
  return {
    configure: (cwd) => writeTemplateMap(cwd, collectTemplates()),
    collectTemplates,
  };
}

/**
 * Dormant extension slot entry: the claude-code registration data and
 * templates exist, but no configurator ships. Init/update must guard on
 * `AI_TOOLS[id].available` before touching this entry; `configure` rejects
 * loudly so an unguarded caller fails visibly instead of installing nothing.
 */
function dormantPlatform(id: AITool): PlatformFunctions {
  return {
    configure: async () => {
      throw new Error(
        `Platform "${id}" is a dormant extension slot in trellis-tiny ` +
          `(${AI_TOOLS[id].available === false ? "available: false" : "no configurator"}). ` +
          `Its templates are vendored but not installed.`,
      );
    },
  };
}

const PLATFORM_FUNCTIONS: Record<AITool, PlatformFunctions> = {
  "claude-code": dormantPlatform("claude-code"),
  codex: { configure: configureCodex, collectTemplates: collectCodexTemplates },
  dsh: fromTemplates(collectDshTemplates),
  zcode: { configure: configureZcode, collectTemplates: collectZcodeTemplates },
};

// =============================================================================
// Derived Helpers — all derived from AI_TOOLS registry
// =============================================================================

/** All platform IDs (including the dormant claude-code slot). */
export const PLATFORM_IDS = Object.keys(AI_TOOLS) as AITool[];

/** Platform IDs that are actually installable (dormant slots excluded). */
export const AVAILABLE_PLATFORM_IDS = PLATFORM_IDS.filter(isPlatformAvailable);

/** All platform config directory names (e.g., [".claude", ".codex", ".dsh", ".zcode"]) */
export const CONFIG_DIRS = PLATFORM_IDS.map((id) => AI_TOOLS[id].configDir);

/** All managed paths for every platform (primary configDir + extra managed paths). */
export const PLATFORM_MANAGED_DIRS = PLATFORM_IDS.flatMap((id) =>
  getManagedPaths(id),
);

/** All directories managed by trellis-tiny (including .trellis itself) */
export const ALL_MANAGED_DIRS = [".trellis", ...new Set(PLATFORM_MANAGED_DIRS)];

/**
 * Detect platforms from Trellis-owned templates, not native config directories.
 *
 * A platform directory may predate Trellis. The template hash manifest records
 * only files Trellis actually wrote, while the platform template registry
 * supplies each platform's distinct file layout.
 */
export function getConfiguredPlatforms(cwd: string): Set<AITool> {
  const platforms = new Set<AITool>();
  const hashes = loadHashes(cwd);

  for (const id of PLATFORM_IDS) {
    if (!isPlatformAvailable(id)) continue;
    const configDir = AI_TOOLS[id].configDir;
    const templates = collectPlatformTemplates(id);
    const hasTrackedTemplate = [...(templates?.keys() ?? [])].some(
      (relativePath) =>
        (relativePath === configDir ||
          relativePath.startsWith(`${configDir}/`)) &&
        hashes[relativePath] !== undefined,
    );
    if (hasTrackedTemplate) {
      platforms.add(id);
    }
  }
  return platforms;
}

/**
 * Get platform IDs that have Python hooks (for Windows encoding detection).
 * Dormant slots are excluded — their hooks are never installed.
 */
export function getPlatformsWithPythonHooks(): AITool[] {
  return PLATFORM_IDS.filter(
    (id) => isPlatformAvailable(id) && AI_TOOLS[id].hasPythonHooks,
  );
}

/**
 * Check if a path starts with any managed directory
 */
export function isManagedPath(dirPath: string): boolean {
  // Normalize Windows backslashes to forward slashes for consistent matching
  const normalized = dirPath.replace(/\\/g, "/");
  return ALL_MANAGED_DIRS.some(
    (d) => normalized.startsWith(d + "/") || normalized === d,
  );
}

/**
 * Check if a directory name is a managed root directory (should not be deleted)
 */
export function isManagedRootDir(dirName: string): boolean {
  return ALL_MANAGED_DIRS.includes(dirName);
}

/**
 * Get all managed paths for a platform.
 */
export function getPlatformManagedPaths(platformId: AITool): string[] {
  return getManagedPaths(platformId);
}

/**
 * Get the configure function for a platform
 */
export function configurePlatform(
  platformId: AITool,
  cwd: string,
  options?: PlatformConfigureOptions,
): Promise<void> {
  return PLATFORM_FUNCTIONS[platformId].configure(cwd, options);
}

/**
 * Collect template files for a specific platform (for update tracking).
 * Returns undefined if the platform doesn't support template tracking
 * (true for the dormant claude-code slot).
 */
export function collectPlatformTemplates(
  platformId: AITool,
): Map<string, string> | undefined {
  const map = PLATFORM_FUNCTIONS[platformId].collectTemplates?.();
  return map ? renderTemplateMap(map) : map;
}

/**
 * Build TOOLS array for interactive init prompt, derived from AI_TOOLS registry.
 * Dormant slots are excluded — they cannot be installed.
 */
export function getInitToolChoices(): {
  key: CliFlag;
  name: string;
  defaultChecked: boolean;
  platformId: AITool;
}[] {
  return PLATFORM_IDS.filter(isPlatformAvailable).map((id) => ({
    key: AI_TOOLS[id].cliFlag,
    name: AI_TOOLS[id].name,
    defaultChecked: AI_TOOLS[id].defaultChecked,
    platformId: id,
  }));
}

/**
 * Resolve CLI flag name to AITool id (e.g., "claude" → "claude-code").
 * Dormant slots resolve too — callers must check `isPlatformAvailable`.
 */
export function resolveCliFlag(flag: string): AITool | undefined {
  return PLATFORM_IDS.find((id) => AI_TOOLS[id].cliFlag === flag);
}
