/**
 * AI tool registry data — trimmed to the trellis-tiny platform matrix.
 *
 * Upstream ships 21 platforms; tiny supports exactly three (codex / zcode /
 * dsh) plus a dormant claude-code extension slot. The slot keeps its full
 * registration data (configDir, cliFlag, templateContext, vendored templates
 * under `src/templates/claude/`) but is marked `available: false`: init and
 * update must guard on `available` before touching its templates, and no
 * configurator module exists for it (M4 wires the `--claude` "not enabled"
 * notice).
 */

export type AITool = "claude-code" | "codex" | "dsh" | "zcode";

export type TemplateDir = "common" | "claude" | "codex" | "dsh" | "zcode";

export type CliFlag = "claude" | "codex" | "dsh" | "zcode";

/**
 * Template context for placeholder resolution.
 * Controls how common templates are rendered per platform.
 */
export interface TemplateContext {
  /**
   * Prefix for cross-referencing other commands/skills. Trimmed from the
   * upstream 7-value union to the three forms the tiny matrix uses.
   */
  cmdRefPrefix: "/trellis:" | "$" | "trellis-";
  /** Description of AI executor actions shown in role tables */
  executorAI:
    | "Bash scripts or Task calls"
    | "Bash scripts or tool calls"
    | "Bash scripts or Agent calls";
  /** Label for user-invocable actions */
  userActionLabel: "Slash commands" | "Skills";
  /** Platform supports spawning sub-agents with isolated context */
  agentCapable: boolean;
  /** Platform has hook system (SessionStart, PreToolUse) */
  hasHooks: boolean;
  /**
   * CLI flag value for this platform (e.g. "claude", "codex", "dsh").
   * Substituted into template commands via {{CLI_FLAG}} so rendered skill /
   * command files can pass `--platform <flag>` to scripts that need to know
   * the invoking platform, removing the need to re-detect at runtime.
   * Duplicates the top-level `AIToolConfig.cliFlag` for convenience — the
   * invariant is maintained in `AI_TOOLS` config blocks.
   */
  cliFlag: CliFlag;
}

/**
 * Configuration for an AI tool
 */
export interface AIToolConfig {
  /** Display name of the tool */
  name: string;
  /** Command template directory names to include */
  templateDirs: TemplateDir[];
  /** Config directory name in the project root (e.g., ".claude") */
  configDir: string;
  /**
   * Whether the platform supports the shared `.agents/skills/` layer
   * (agentskills.io open standard). When true, `.agents/skills` is added
   * to the platform's managed paths automatically.
   */
  supportsAgentSkills?: boolean;
  /** Additional managed paths beyond configDir (e.g., .zcode/commands) */
  extraManagedPaths?: string[];
  /** CLI flag name for --flag options (e.g., "codex" for --codex) */
  cliFlag: CliFlag;
  /** Whether this tool is checked by default in interactive init prompt */
  defaultChecked: boolean;
  /** Whether this tool uses Python hooks (affects Windows encoding detection) */
  hasPythonHooks: boolean;
  /**
   * trellis-tiny addition: when false the platform is a dormant extension
   * slot — its registration data and templates are vendored, but no
   * configurator exists and init/update must not install it.
   */
  available?: boolean;
  /**
   * Optional user-global compatibility plugin for platform versions where
   * project-level integration is unavailable. Trellis may surface a manual
   * installation hint, but leaves installation and lifecycle management to
   * the platform UI.
   */
  globalHookPlugin?: {
    name: string;
    marketplaceUrl: string;
  };
  /** Template context for placeholder resolution in common templates */
  templateContext: TemplateContext;
}

/**
 * Registry of all supported AI tools and their configurations.
 * This is the single source of truth for platform data.
 *
 * When adding a new platform, add an entry here and create:
 * 1. src/configurators/{platform}.ts — configure function / collectTemplates
 * 2. src/templates/{platform}/ — template files
 * 3. Register in src/configurators/index.ts — PLATFORM_FUNCTIONS
 * 4. Add CLI flag in src/cli/index.ts (M4)
 * 5. Add to InitOptions in src/commands/init.ts (M4)
 */
export const AI_TOOLS: Record<AITool, AIToolConfig> = {
  "claude-code": {
    name: "Claude Code",
    templateDirs: ["common", "claude"],
    configDir: ".claude",
    cliFlag: "claude",
    // Dormant extension slot: templates are vendored under
    // src/templates/claude/ but tiny does not install them. Flip to
    // `available: true` (and add a configurator + CLI wiring) to revive.
    available: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
      cliFlag: "claude",
    },
  },
  codex: {
    // Codex also writes .agents/skills/ (the shared agentskills.io root),
    // which the other tiny platforms read natively.
    name: "Codex",
    templateDirs: ["common", "codex"],
    configDir: ".codex",
    supportsAgentSkills: true,
    cliFlag: "codex",
    defaultChecked: true,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Skills",
      agentCapable: true,
      hasHooks: false,
      cliFlag: "codex",
    },
  },
  dsh: {
    // DeepSeek Harness (dsh) is a skills-first pull-based host: it reads
    // `.agents/skills/` (agentskills.io, rank-200 project root) and its own
    // `.dsh/skills/` (rank-100 project root) natively and the agent loads
    // skills by name through its skill-loader tool. No session-start hook
    // ships in the default web/headless profiles, so `hasHooks: false` and
    // `trellis-start` stays as a user-invocable skill. Entry skills reference
    // other skills by bare name (`trellis-<name>`), hence `cmdRefPrefix:
    // "trellis-"`.
    name: "DeepSeek Harness (dsh)",
    templateDirs: ["common", "dsh"],
    configDir: ".dsh",
    supportsAgentSkills: true,
    cliFlag: "dsh",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "trellis-",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Skills",
      agentCapable: true,
      hasHooks: false,
      cliFlag: "dsh",
    },
  },
  zcode: {
    name: "ZCode",
    templateDirs: ["common", "zcode"],
    configDir: ".zcode",
    // trellis-tiny R2: `.zcode/skills/` is no longer written (skills live in
    // the shared `.agents/skills/` root). The legacy `.zcode/cli/agents`
    // transition path from upstream is an M4 convergence concern, not a
    // managed path of this distribution.
    extraManagedPaths: [".zcode/agents", ".zcode/commands", ".zcode/hooks"],
    cliFlag: "zcode",
    defaultChecked: true,
    hasPythonHooks: true,
    globalHookPlugin: {
      name: "trellis-bridge",
      marketplaceUrl: "https://github.com/CNHLAIA/ZCode-Trellis-Plugin.git",
    },
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or Agent calls",
      userActionLabel: "Skills",
      agentCapable: true,
      // ZCode supports project hook registration through .zcode/config.json.
      // On builds that disable it, the optional global trellis-bridge plugin
      // registers the same events and delegates to the project hook scripts.
      // PreToolUse can mutate sub-agent prompts, so either path is class-1.
      hasHooks: true,
      cliFlag: "zcode",
    },
  },
};

/** A platform is installable unless explicitly marked dormant. */
export function isPlatformAvailable(tool: AITool): boolean {
  return AI_TOOLS[tool].available !== false;
}

/**
 * All managed paths for a platform: its configDir, plus `.agents/skills`
 * when it supports the shared skills layer, plus any extra managed paths.
 */
export function getManagedPaths(tool: AITool): string[] {
  const config = AI_TOOLS[tool];
  const paths = [config.configDir];
  if (config.supportsAgentSkills) {
    paths.push(".agents/skills");
  }
  if (config.extraManagedPaths) {
    paths.push(...config.extraManagedPaths);
  }
  return paths;
}
