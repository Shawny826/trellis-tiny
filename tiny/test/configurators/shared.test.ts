/**
 * Unit tests for configurators/shared.ts — placeholder rendering contract.
 *
 * Mirrors upstream test/configurators/index.test.ts scope, trimmed to the
 * tiny helper roster: both renderers, conditional blocks, python literal
 * rewrite, frontmatter wrapping, start filtering, map rendering, shared hook
 * collection.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectSharedHooks,
  getPythonCommandForPlatform,
  renderTemplateMap,
  replacePythonCommandLiterals,
  resetResolvedPythonCommand,
  resolveCommands,
  resolvePlaceholders,
  resolvePlaceholdersNeutral,
  resolveSkillsNeutral,
  setResolvedPythonCommand,
  wrapWithSkillFrontmatter,
} from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const codexCtx = AI_TOOLS.codex.templateContext;
const zcodeCtx = AI_TOOLS.zcode.templateContext;

describe("python command resolution", () => {
  beforeEach(() => {
    resetResolvedPythonCommand();
  });
  afterEach(() => {
    resetResolvedPythonCommand();
  });

  it("defaults to the static platform default", () => {
    expect(getPythonCommandForPlatform("win32")).toBe("python");
    expect(getPythonCommandForPlatform("linux")).toBe("python3");
  });

  it("uses the resolved command after setResolvedPythonCommand", () => {
    setResolvedPythonCommand("py -3");
    expect(getPythonCommandForPlatform()).toBe("py -3");
  });

  it("replacePythonCommandLiterals rewrites python3 except shebangs", () => {
    setResolvedPythonCommand("py -3");
    const input = "python3 a.py\n#!python3\nrun python3 --flag";
    expect(replacePythonCommandLiterals(input)).toBe(
      "py -3 a.py\n#!python3\nrun py -3 --flag",
    );
  });

  it("replacePythonCommandLiterals is idempotent", () => {
    setResolvedPythonCommand("python");
    const once = replacePythonCommandLiterals("python3 && python3 -V");
    expect(replacePythonCommandLiterals(once)).toBe(once);
  });

  it("replacePythonCommandLiterals is a no-op when resolved is python3", () => {
    setResolvedPythonCommand("python3");
    const input = "python3 a.py";
    expect(replacePythonCommandLiterals(input)).toBe(input);
  });
});

describe("resolvePlaceholders", () => {
  beforeEach(() => {
    resetResolvedPythonCommand();
  });
  afterEach(() => {
    resetResolvedPythonCommand();
  });

  it("resolves {{PYTHON_CMD}} without a context (legacy mode)", () => {
    setResolvedPythonCommand("py -3");
    expect(resolvePlaceholders("run {{PYTHON_CMD}} -x")).toBe("run py -3 -x");
  });

  it("resolves CMD_REF with the platform prefix", () => {
    expect(resolvePlaceholders("{{CMD_REF:continue}}", codexCtx)).toBe(
      "$continue",
    );
    expect(resolvePlaceholders("{{CMD_REF:continue}}", zcodeCtx)).toBe(
      "/trellis:continue",
    );
  });

  it("resolves EXECUTOR_AI / USER_ACTION_LABEL / CLI_FLAG", () => {
    const out = resolvePlaceholders(
      "{{EXECUTOR_AI}} | {{USER_ACTION_LABEL}} | {{CLI_FLAG}}",
      codexCtx,
    );
    expect(out).toBe(
      "Bash scripts or tool calls | Skills | codex",
    );
  });

  it("resolves conditional blocks per flag value and collapses blank lines", () => {
    const tmpl = [
      "head",
      "",
      "{{#HAS_HOOKS}}hooked{{/HAS_HOOKS}}",
      "",
      "{{^HAS_HOOKS}}unhooked{{/HAS_HOOKS}}",
      "",
      "",
      "tail",
    ].join("\n");
    expect(resolvePlaceholders(tmpl, zcodeCtx)).toBe("head\n\nhooked\n\ntail");
    expect(resolvePlaceholders(tmpl, codexCtx)).toBe(
      "head\n\nunhooked\n\ntail",
    );
  });

  it("leaves unknown {{...}} text untouched", () => {
    expect(resolvePlaceholders("{{NOT_A_PLACEHOLDER}}", codexCtx)).toBe(
      "{{NOT_A_PLACEHOLDER}}",
    );
  });
});

describe("resolvePlaceholdersNeutral", () => {
  beforeEach(() => {
    resetResolvedPythonCommand();
  });
  afterEach(() => {
    resetResolvedPythonCommand();
  });

  it("renders CMD_REF in the neutral form for every platform", () => {
    for (const ctx of [codexCtx, zcodeCtx, AI_TOOLS.dsh.templateContext]) {
      expect(resolvePlaceholdersNeutral("{{CMD_REF:check}}", ctx)).toBe(
        "`check` (Trellis command)",
      );
    }
  });

  it("matches resolvePlaceholders byte-for-byte when no CMD_REF appears", () => {
    const tmpl = "{{CLI_FLAG}} {{EXECUTOR_AI}} {{#HAS_HOOKS}}h{{/HAS_HOOKS}}";
    expect(resolvePlaceholdersNeutral(tmpl, codexCtx)).toBe(
      resolvePlaceholders(tmpl, codexCtx),
    );
  });
});

describe("skill frontmatter and resolvers", () => {
  it("wraps with skill frontmatter from the description registry", () => {
    const wrapped = wrapWithSkillFrontmatter(
      "trellis-check",
      "body text",
    );
    expect(wrapped.startsWith("---\nname: trellis-check\n")).toBe(true);
    expect(wrapped).toMatch(/^description: ".+"$/m);
    expect(wrapped.endsWith("\n\nbody text")).toBe(true);
  });

  it("throws on a skill missing from the description registry", () => {
    expect(() => wrapWithSkillFrontmatter("trellis-nonexistent", "x")).toThrow(
      /Missing skill description/,
    );
  });

  it("resolveCommands filters start only on agentCapable && hasHooks platforms", () => {
    expect(resolveCommands(zcodeCtx).map((c) => c.name)).toEqual([
      "continue",
      "finish-work",
    ]);
    expect(resolveCommands(codexCtx).map((c) => c.name)).toEqual([
      "continue",
      "finish-work",
      "start",
    ]);
  });

  it("resolveSkillsNeutral renders workflow skills with neutral CMD_REFs", () => {
    const skills = resolveSkillsNeutral(zcodeCtx);
    expect(skills.map((s) => s.name).sort()).toEqual([
      "trellis-before-dev",
      "trellis-brainstorm",
      "trellis-break-loop",
      "trellis-check",
      "trellis-update-spec",
    ]);
    // Only update-spec.md carries {{CMD_REF}} among the workflow skills.
    const body =
      skills.find((s) => s.name === "trellis-update-spec")?.content ?? "";
    expect(body).toContain("(Trellis command)");
    expect(body).not.toContain("/trellis:");
    expect(body).not.toContain("{{CMD_REF:");
  });
});

describe("map builders", () => {
  beforeEach(() => {
    resetResolvedPythonCommand();
  });
  afterEach(() => {
    resetResolvedPythonCommand();
  });

  it("renderTemplateMap applies the python rewrite to every value", () => {
    setResolvedPythonCommand("python");
    const files = new Map<string, string>([
      ["a.txt", "python3 here"],
      ["b.txt", "no mention"],
    ]);
    const rendered = renderTemplateMap(files);
    expect(rendered.get("a.txt")).toBe("python here");
    expect(rendered.get("b.txt")).toBe("no mention");
    // Input map is not mutated.
    expect(files.get("a.txt")).toBe("python3 here");
  });

  it("collectSharedHooks is driven by SHARED_HOOKS_BY_PLATFORM", () => {
    const zcodeHooks = collectSharedHooks(".zcode/hooks", "zcode");
    expect([...zcodeHooks.keys()].sort()).toEqual([
      ".zcode/hooks/inject-shell-session-context.py",
      ".zcode/hooks/inject-subagent-context.py",
      ".zcode/hooks/inject-workflow-state.py",
      ".zcode/hooks/session-start.py",
    ]);
    const codexHooks = collectSharedHooks(".codex/hooks", "codex");
    expect([...codexHooks.keys()].sort()).toEqual([
      ".codex/hooks/inject-subagent-context.py",
      ".codex/hooks/inject-workflow-state.py",
    ]);
  });
});
