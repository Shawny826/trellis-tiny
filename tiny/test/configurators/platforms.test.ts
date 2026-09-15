/**
 * Configurator registry tests (M3 exit criteria).
 *
 * - Per-platform collect*Templates() file-set snapshot assertions (platform
 *   private roots + the shared `.agents/skills/` + commands/agents/hooks
 *   output surfaces).
 * - Neutral byte-identity contract: every `.agents/skills/` path written by
 *   more than one configurator is byte-identical across codex / zcode / dsh.
 * - R2 assertion: `.zcode/skills/` appears in no collect result.
 * - claude-code dormancy: registration data present with available:false, no
 *   collectTemplates, configure rejects.
 * - Whole-registry parity oracle: configurePlatform writes exactly the
 *   collected map, byte-for-byte, idempotently (codex's empty `.codex/skills`
 *   residual excepted).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AVAILABLE_PLATFORM_IDS,
  PLATFORM_IDS,
  collectPlatformTemplates,
  configurePlatform,
  getConfiguredPlatforms,
  getInitToolChoices,
  resolveCliFlag,
} from "../../src/configurators/index.js";
import { getBundledSkillTemplates } from "../../src/templates/common/index.js";
import { AI_TOOLS, isPlatformAvailable } from "../../src/types/ai-tools.js";

function keysOf(map: Map<string, string>): string[] {
  return [...map.keys()].sort();
}

const WORKFLOW_SKILLS = [
  "trellis-before-dev",
  "trellis-brainstorm",
  "trellis-break-loop",
  "trellis-check",
  "trellis-update-spec",
].map((n) => `.agents/skills/${n}/SKILL.md`);

/** Full bundled file tree, derived from the template reader (not the maps). */
function expectedBundledKeys(): string[] {
  return getBundledSkillTemplates().flatMap((skill) =>
    skill.files.map((f) => `.agents/skills/${skill.name}/${f.relativePath}`),
  );
}

/** Named spot-checks guarding "bundled skills were passed at all". */
const BUNDLED_NAMED_PATHS = [
  ".agents/skills/trellis-meta/SKILL.md",
  ".agents/skills/trellis-meta/references/platform-files/overview.md",
  ".agents/skills/trellis-session-insight/SKILL.md",
  ".agents/skills/trellis-spec-bootstrap/references/spec-writing.md",
];

describe("platform registry data", () => {
  it("registers exactly the tiny platform matrix", () => {
    expect(PLATFORM_IDS.sort()).toEqual([
      "claude-code",
      "codex",
      "dsh",
      "zcode",
    ]);
  });

  it("marks claude-code as the dormant slot and the other three available", () => {
    expect(AI_TOOLS["claude-code"].available).toBe(false);
    expect(isPlatformAvailable("claude-code")).toBe(false);
    for (const id of ["codex", "dsh", "zcode"] as const) {
      expect(isPlatformAvailable(id)).toBe(true);
    }
  });

  it("exposes AVAILABLE_PLATFORM_IDS without claude-code", () => {
    expect(AVAILABLE_PLATFORM_IDS.sort()).toEqual(["codex", "dsh", "zcode"]);
  });

  it("resolves CLI flags for dormant platforms too, but init choices exclude them", () => {
    expect(resolveCliFlag("claude")).toBe("claude-code");
    expect(resolveCliFlag("zcode")).toBe("zcode");
    expect(getInitToolChoices().map((c) => c.platformId).sort()).toEqual([
      "codex",
      "dsh",
      "zcode",
    ]);
  });

  it("derives managed paths including the shared skills root", () => {
    expect(AI_TOOLS.codex.supportsAgentSkills).toBe(true);
    expect(AI_TOOLS.dsh.supportsAgentSkills).toBe(true);
    // zcode keeps `.zcode/skills` OUT of managed paths (R2: never written).
    expect(AI_TOOLS.zcode.extraManagedPaths).not.toContain(".zcode/skills");
  });
});

describe("collectCodexTemplates file set", () => {
  const map = collectPlatformTemplates("codex") as Map<string, string>;

  it("is defined", () => {
    expect(map).toBeDefined();
  });

  it("has the exact expected key set", () => {
    expect(keysOf(map)).toEqual(
      [
        // Shared skills root — 3 command-folded + 5 workflow skills
        // (codex hasHooks=false keeps trellis-start) + full bundled trees.
        ".agents/skills/trellis-start/SKILL.md",
        ".agents/skills/trellis-continue/SKILL.md",
        ".agents/skills/trellis-finish-work/SKILL.md",
        ...WORKFLOW_SKILLS,
        ...expectedBundledKeys(),
        // Codex-private roots
        ".codex/agents/trellis-check.toml",
        ".codex/agents/trellis-implement.toml",
        ".codex/agents/trellis-research.toml",
        ".codex/hooks/session-start.py",
        ".codex/hooks/inject-subagent-context.py",
        ".codex/hooks/inject-workflow-state.py",
        ".codex/hooks.json",
        ".codex/config.toml",
      ].sort(),
    );
  });

  it("includes the full bundled skill file trees", () => {
    for (const named of BUNDLED_NAMED_PATHS) {
      expect(map.has(named), `missing bundled file ${named}`).toBe(true);
    }
    const bundled = keysOf(map);
    expect(bundled.filter((k) => k.startsWith(".agents/skills/trellis-meta/")))
      .toHaveLength(23);
    expect(
      bundled.filter((k) =>
        k.startsWith(".agents/skills/trellis-session-insight/"),
      ),
    ).toHaveLength(3);
    expect(
      bundled.filter((k) =>
        k.startsWith(".agents/skills/trellis-spec-bootstrap/"),
      ),
    ).toHaveLength(5);
  });
});

describe("collectZcodeTemplates file set", () => {
  const map = collectPlatformTemplates("zcode") as Map<string, string>;

  it("is defined", () => {
    expect(map).toBeDefined();
  });

  it("has the exact expected key set (skills under .agents/skills/)", () => {
    expect(keysOf(map)).toEqual(
      [
        ...WORKFLOW_SKILLS,
        ...expectedBundledKeys(),
        ".zcode/commands/trellis/continue.md",
        ".zcode/commands/trellis/finish-work.md",
        ".zcode/agents/trellis-check.md",
        ".zcode/agents/trellis-implement.md",
        ".zcode/agents/trellis-research.md",
        ".zcode/hooks/session-start.py",
        ".zcode/hooks/inject-shell-session-context.py",
        ".zcode/hooks/inject-workflow-state.py",
        ".zcode/hooks/inject-subagent-context.py",
        ".zcode/config.json",
      ].sort(),
    );
  });

  it("never writes .zcode/skills/ (R2 single skill root)", () => {
    expect(keysOf(map).filter((k) => k.startsWith(".zcode/skills"))).toEqual(
      [],
    );
  });

  it("does not fold command entries into skills (native command surface)", () => {
    expect(keysOf(map).filter((k) => k.includes("trellis-start"))).toEqual([]);
    expect(
      keysOf(map).filter((k) => k.includes("trellis-finish-work")),
    ).toEqual([]);
  });

  it("renders .zcode/config.json with the resolved python command", () => {
    const config = map.get(".zcode/config.json") ?? "";
    expect(config).not.toContain("{{PYTHON_CMD}}");
    expect(config).toMatch(/hooks/);
  });
});

describe("collectDshTemplates file set", () => {
  const map = collectPlatformTemplates("dsh") as Map<string, string>;

  it("is defined", () => {
    expect(map).toBeDefined();
  });

  it("has the exact expected key set", () => {
    expect(keysOf(map)).toEqual(
      [
        ...WORKFLOW_SKILLS,
        ...expectedBundledKeys(),
        ".dsh/skills/trellis-start/SKILL.md",
        ".dsh/skills/trellis-continue/SKILL.md",
        ".dsh/skills/trellis-finish-work/SKILL.md",
        ".dsh/DSH.md",
      ].sort(),
    );
  });

  it("keeps dsh-private entry skills out of the shared root", () => {
    expect(
      keysOf(map).filter(
        (k) => k.startsWith(".agents/skills/") && k.includes("trellis-start"),
      ),
    ).toEqual([]);
  });
});

describe("neutral byte-identity contract (.agents/skills/)", () => {
  const codexMap = collectPlatformTemplates("codex") as Map<string, string>;
  const zcodeMap = collectPlatformTemplates("zcode") as Map<string, string>;
  const dshMap = collectPlatformTemplates("dsh") as Map<string, string>;

  function sharedPaths(
    a: Map<string, string>,
    b: Map<string, string>,
  ): string[] {
    return keysOf(a).filter(
      (k) => k.startsWith(".agents/skills/") && b.has(k),
    );
  }

  it("zcode and dsh write identical shared-root sets", () => {
    const zcodeShared = keysOf(zcodeMap).filter((k) =>
      k.startsWith(".agents/skills/"),
    );
    const dshShared = keysOf(dshMap).filter((k) =>
      k.startsWith(".agents/skills/"),
    );
    expect(zcodeShared).toEqual(dshShared);
  });

  it("every .agents/skills/ path is byte-identical across codex/zcode/dsh", () => {
    for (const [a, b] of [
      [zcodeMap, codexMap],
      [dshMap, codexMap],
      [zcodeMap, dshMap],
    ] as const) {
      const paths = sharedPaths(a, b);
      // Non-vacuity: each pairwise overlap must include the 5 workflow
      // skills plus at least one bundled skill file.
      expect(paths.length).toBeGreaterThanOrEqual(6);
      for (const p of paths) {
        expect(a.get(p), `${p} differs between configurators`).toBe(
          b.get(p),
        );
      }
    }
  });

  it("neutral rendering removed every platform-specific command reference", () => {
    for (const map of [codexMap, zcodeMap, dshMap]) {
      // Only update-spec.md carries {{CMD_REF}} among the workflow skills;
      // it must be rendered in the neutral form in the shared root.
      const workflow =
        map.get(".agents/skills/trellis-update-spec/SKILL.md") ?? "";
      expect(workflow).toContain("(Trellis command)");
      expect(workflow).not.toContain("{{CMD_REF:");
      expect(workflow).not.toContain("/trellis:");
      // Codex prefix ($) must never leak into the shared root.
      expect(workflow).not.toMatch(/\$trellis-\w+/);
      expect(workflow).not.toContain("$break-loop");
      // dsh bare-name prefix would double the trellis- prefix.
      expect(workflow).not.toContain("trellis-trellis-");
    }
  });

  it("no collect result contains .zcode/skills (R2, all platforms)", () => {
    for (const id of AVAILABLE_PLATFORM_IDS) {
      const map = collectPlatformTemplates(id) as Map<string, string>;
      expect(
        keysOf(map).filter((k) => k.startsWith(".zcode/skills")),
        `${id} writes .zcode/skills`,
      ).toEqual([]);
    }
  });
});

describe("configure ⟷ collectTemplates parity oracle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-tiny-configurators-"),
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function walkFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walkFiles(full));
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  function snapshot(dir: string): Map<string, string> {
    return new Map(
      walkFiles(dir).map((abs) => [
        path.relative(dir, abs).split(path.sep).join("/"),
        fs.readFileSync(abs, "utf-8"),
      ]),
    );
  }

  for (const id of ["codex", "zcode", "dsh"] as const) {
    it(`${id}: configurePlatform writes exactly the collected map`, async () => {
      const expected = collectPlatformTemplates(id) as Map<string, string>;
      await configurePlatform(id, tmpDir);

      const written = walkFiles(tmpDir)
        .map((abs) => path.relative(tmpDir, abs).split(path.sep).join("/"))
        .sort();
      expect(written).toEqual(keysOf(expected));

      for (const [relPath, content] of expected) {
        const onDisk = fs.readFileSync(
          path.join(tmpDir, ...relPath.split("/")),
          "utf-8",
        );
        expect(onDisk, `${relPath} content mismatch`).toBe(content);
      }

      // Residual for codex: the intentionally empty user extension dir.
      if (id === "codex") {
        expect(fs.existsSync(path.join(tmpDir, ".codex", "skills"))).toBe(true);
      }
      // R2: no .zcode/skills directory is even created.
      if (id === "zcode") {
        expect(fs.existsSync(path.join(tmpDir, ".zcode", "skills"))).toBe(
          false,
        );
      }
    });

    it(`${id}: configurePlatform is idempotent (byte-stable second run)`, async () => {
      await configurePlatform(id, tmpDir);
      const before = snapshot(tmpDir);
      await configurePlatform(id, tmpDir);
      const after = snapshot(tmpDir);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [k, v] of after) {
        expect(v, `${k} changed on second configure`).toBe(before.get(k));
      }
    });
  }
});

describe("claude-code dormant slot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-tiny-dormant-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects no templates for the dormant slot", () => {
    expect(collectPlatformTemplates("claude-code")).toBeUndefined();
  });

  it("configure rejects loudly for the dormant slot", async () => {
    await expect(configurePlatform("claude-code", tmpDir)).rejects.toThrow(
      /dormant extension slot/,
    );
    // Nothing was written.
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it("is never detected as configured even if hash entries existed", () => {
    expect(getConfiguredPlatforms(tmpDir).size).toBe(0);
  });
});
