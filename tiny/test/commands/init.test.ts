/**
 * init command tests (M4 exit criteria).
 *
 * - AC1: a clean init produces only the selected platform dirs + `.trellis/`
 *   — no fourth-platform files anywhere.
 * - AC2: `.agents/skills/` is the single trellis skill root; `.zcode/skills/`
 *   does not exist; dsh's three entry skills live in `.dsh/skills/`; every
 *   trellis skill exists exactly once project-wide.
 * - AC8 (fs part): pre-seeded fake upstream artifacts (`.zcode/skills/`,
 *   `.zcode/cli/agents`, `linear_sync.py`, trellis features in `.claude/`)
 *   vanish after init while user data under tasks/workspace/spec survives.
 * - `--dry-run` prints the convergence plan but writes and deletes nothing.
 * - `--claude` is a dormant slot: notice only, installs nothing.
 * - Exec-bit semantics are asserted through recorded write state, never real
 *   POSIX modes (chmod is a no-op on Windows).
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectLegacyArtifacts } from "../../src/commands/convergence.js";
import { init } from "../../src/commands/init.js";
import { update } from "../../src/commands/update.js";
import { resetResolvedPythonCommand } from "../../src/lib/python-resolver.js";
import { computeHash, loadHashes } from "../../src/lib/template-hash.js";
import { collectPlatformTemplates } from "../../src/configurators/index.js";
import {
  cleanupTempProject,
  useTempProject,
  type TempProject,
} from "./helpers.js";

let project: TempProject;

beforeEach(() => {
  resetResolvedPythonCommand();
  project = useTempProject("trellis-tiny-init-");
});

afterEach(() => {
  cleanupTempProject(project);
});

function rootDirs(): string[] {
  return fs
    .readdirSync(project.dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("AC1: clean init file set", () => {
  it("produces only the selected platform dirs plus .trellis", async () => {
    const summary = await init({ yes: true, codex: true, zcode: true });

    expect(rootDirs()).toEqual([".agents", ".codex", ".trellis", ".zcode"]);
    expect(summary.platforms.sort()).toEqual(["codex", "zcode"]);
    expect(summary.dryRun).toBe(false);
    expect(project.exists(".dsh")).toBe(false);
    expect(project.exists(".claude")).toBe(false);
  });

  it("writes the .trellis skeleton and the hash manifest", async () => {
    const summary = await init({ yes: true, codex: true, zcode: true });

    for (const rel of [
      ".trellis/workflow.md",
      ".trellis/config.yaml",
      ".trellis/.gitignore",
      ".trellis/scripts/task.py",
      ".trellis/scripts/common/paths.py",
      ".trellis/workspace/index.md",
      ".trellis/spec/guides/index.md",
      ".trellis/spec/backend/index.md",
      ".trellis/spec/frontend/index.md",
      ".gitattributes",
      "AGENTS.md",
    ]) {
      expect(project.exists(rel), `missing ${rel}`).toBe(true);
    }
    expect(project.exists(".trellis/agents")).toBe(false); // channel runtime (R4)

    // tasks/ exists and stays empty (no bootstrap task in tiny).
    expect(project.exists(".trellis/tasks")).toBe(true);

    // Manifest written and non-empty.
    const hashes = loadHashes(project.dir);
    expect(Object.keys(hashes).length).toBeGreaterThan(0);
    expect(summary.hashedCount).toBe(Object.keys(hashes).length);
    // Manifest schema is v2.
    const raw = JSON.parse(project.read(".trellis/.template-hashes.json")) as {
      __version: number;
    };
    expect(raw.__version).toBe(2);
  });

  it("renders workflow.md with the resolved python command (init/update byte parity)", async () => {
    await init({ yes: true, codex: true, zcode: true });
    const workflow = project.read(".trellis/workflow.md");
    // On win32 the resolved command is `python`; either way it must never
    // diverge from what update renders (renderTemplateMap is the same pass).
    expect(workflow).not.toContain("{{PYTHON_CMD}}");
  });

  it("re-init with identical content is byte-stable", async () => {
    await init({ yes: true, codex: true, zcode: true, force: true });
    const before = project.snapshot();
    await init({ yes: true, codex: true, zcode: true, force: true });
    expect(project.snapshot()).toEqual(before);
  });
});

describe("AC2: single skill root", () => {
  it("keeps .agents/skills as the only workflow skill root", async () => {
    await init({ yes: true, codex: true, zcode: true, dsh: true });

    expect(project.exists(".zcode/skills")).toBe(false);
    expect(project.exists(".agents/skills")).toBe(true);

    // dsh's three command-entry skills live in the private root.
    const dshSkills = project
      .files()
      .filter((f) => f.startsWith(".dsh/skills/"))
      .map((f) => f.split("/")[2]);
    expect([...new Set(dshSkills)].sort()).toEqual([
      "trellis-continue",
      "trellis-finish-work",
      "trellis-start",
    ]);
  });

  it("every trellis skill exists exactly once project-wide", async () => {
    await init({ yes: true, codex: true, zcode: true, dsh: true });

    const skillMdFiles = project
      .files()
      .filter((f) => f.endsWith("/SKILL.md") && f.includes("trellis-"));
    const skillPaths = skillMdFiles.map((f) => f.split("/").slice(0, -1).join("/"));

    // No duplicate skill directories: each trellis-* skill dir exists at
    // exactly one path (the old double-root layout is gone).
    expect(new Set(skillPaths).size).toBe(skillPaths.length);
    // Skill roots: only the shared `.agents/skills/` and dsh's private one.
    const skillRoots = new Set(skillMdFiles.map((f) => f.split("/").slice(0, 2).join("/")));
    expect([...skillRoots].sort()).toEqual([".agents/skills", ".dsh/skills"]);
    // 11 in the shared root (5 workflow + 3 codex-folded commands + 3 bundled)
    // plus dsh's 3 private entries.
    expect(skillMdFiles.filter((f) => f.startsWith(".agents/skills/"))).toHaveLength(11);
    expect(skillMdFiles.filter((f) => f.startsWith(".dsh/skills/"))).toHaveLength(3);
    // Content uniqueness of the SKILL.md files themselves.
    const contents = skillMdFiles.map((f) => project.read(f));
    expect(new Set(contents).size).toBe(contents.length);
  });
});

describe("AC8 (fs): upstream artifact convergence", () => {
  function seedUpstreamArtifacts(): void {
    project.write(".zcode/skills/trellis-check/SKILL.md", "legacy skill copy");
    project.write(".zcode/skills/trellis-start/SKILL.md", "legacy start copy");
    project.write(".zcode/cli/agents/legacy-agent.toml", "legacy agent");
    project.write(".trellis/scripts/hooks/linear_sync.py", "# linear sync");
    project.write(".claude/skills/trellis-start/SKILL.md", "claude legacy skill");
    project.write(".claude/settings.json", '{ "userSetting": true }');
  }

  function seedUserData(): void {
    project.write(".trellis/tasks/09-14-keep/prd.md", "# my task");
    project.write(".trellis/workspace/alice/journal-alice.md", "# journal");
    project.write(".trellis/spec/custom/my-notes.md", "# my spec notes");
  }

  it("removes upstream artifacts and keeps user data", async () => {
    seedUpstreamArtifacts();
    seedUserData();

    const summary = await init({ yes: true, codex: true, zcode: true });

    // R2 core: the duplicate zcode skill root is gone entirely.
    expect(project.exists(".zcode/skills")).toBe(false);
    // Upstream transition path gone (dir pruned when empty).
    expect(project.exists(".zcode/cli")).toBe(false);
    // Linear integration gone (empty hooks dir pruned).
    expect(project.exists(".trellis/scripts/hooks")).toBe(false);
    // Legacy claude features gone, user-owned settings kept.
    expect(project.exists(".claude/skills")).toBe(false);
    expect(project.read(".claude/settings.json")).toContain("userSetting");

    // User data untouched.
    expect(project.read(".trellis/tasks/09-14-keep/prd.md")).toBe("# my task");
    expect(project.read(".trellis/workspace/alice/journal-alice.md")).toBe("# journal");
    expect(project.read(".trellis/spec/custom/my-notes.md")).toBe("# my spec notes");

    // The plan reported what it removed.
    expect(summary.converged).toContain(".zcode/skills/trellis-check");
    expect(summary.converged).toContain(".zcode/cli/agents");
    expect(summary.converged).toContain(".trellis/scripts/hooks/linear_sync.py");
    expect(summary.converged).toContain(".claude/skills/trellis-start");
  });

  it("tiny still installs into .zcode after convergence", async () => {
    seedUpstreamArtifacts();
    await init({ yes: true, codex: true, zcode: true });

    expect(project.exists(".zcode/config.json")).toBe(true);
    expect(project.exists(".zcode/hooks/session-start.py")).toBe(true);
    expect(project.exists(".zcode/commands/trellis/continue.md")).toBe(true);
  });

  it("removes the upstream channel skill from the shared root (R4)", async () => {
    // Upstream double-root write: the bundled channel skill also lands in
    // the shared root. Sibling skills (tiny-owned or user-owned) must stay.
    project.write(".agents/skills/trellis-channel/SKILL.md", "# channel skill");
    project.write(".agents/skills/trellis-channel/references/x.md", "# channel ref");
    project.write(".agents/skills/my-own-skill/SKILL.md", "# user skill");

    const summary = await init({ yes: true, codex: true, zcode: true });

    // Whole channel skill directory gone (references die with it).
    expect(project.exists(".agents/skills/trellis-channel")).toBe(false);
    // Non-channel siblings untouched by convergence.
    expect(project.exists(".agents/skills/my-own-skill")).toBe(true);
    // Reported in the convergence plan.
    expect(summary.converged).toContain(".agents/skills/trellis-channel");
  });

  it("removes channel runtime agents under .trellis/agents (content-gated)", async () => {
    project.write(
      ".trellis/agents/implement.md",
      "You are the Implement Agent spawned by `trellis channel spawn`.",
    );
    project.write(
      ".trellis/agents/check.md",
      "Code implementation expert for the Trellis channel runtime.",
    );
    project.write(".trellis/agents/custom.md", "# my own agent");

    const summary = await init({ yes: true, codex: true, zcode: true });

    expect(project.exists(".trellis/agents/implement.md")).toBe(false);
    expect(project.exists(".trellis/agents/check.md")).toBe(false);
    // User-authored agent with a non-template name stays.
    expect(project.read(".trellis/agents/custom.md")).toBe("# my own agent");
    expect(summary.converged).toContain(".trellis/agents/implement.md");
    expect(summary.converged).toContain(".trellis/agents/check.md");
  });

  it("keeps a user-authored implement.md lacking the channel marker", async () => {
    project.write(".trellis/agents/implement.md", "# my own implement guide");

    await init({ yes: true, codex: true, zcode: true });

    expect(project.read(".trellis/agents/implement.md")).toBe(
      "# my own implement guide",
    );
  });

  it("removes the upstream-only trellis-meta channel reference (R4)", async () => {
    // Upstream ships this page inside trellis-meta; tiny's vendored copy
    // dropped it. Siblings in the same directory must survive init.
    project.write(
      ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md",
      "# multi-agent channel architecture",
    );
    project.write(
      ".agents/skills/trellis-meta/references/local-architecture/generated-files.md",
      "# custom sibling the user edited",
    );

    const summary = await init({ yes: true, codex: true, zcode: true });

    expect(
      project.exists(
        ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md",
      ),
    ).toBe(false);
    expect(
      project.read(
        ".agents/skills/trellis-meta/references/local-architecture/generated-files.md",
      ),
    ).toBe("# custom sibling the user edited");
    expect(summary.converged).toContain(
      ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md",
    );
  });
});

describe("dry-run", () => {
  it("prints the plan, deletes nothing, writes nothing", async () => {
    project.write(".zcode/skills/trellis-check/SKILL.md", "legacy skill copy");

    const summary = await init({ dryRun: true, codex: true, zcode: true });

    expect(summary.dryRun).toBe(true);
    // Legacy artifact still on disk (not deleted).
    expect(project.exists(".zcode/skills/trellis-check/SKILL.md")).toBe(true);
    // Nothing was written at all.
    expect(project.exists(".trellis")).toBe(false);
    expect(project.exists(".agents")).toBe(false);
    expect(project.exists("AGENTS.md")).toBe(false);
  });
});

describe("dormant claude slot", () => {
  it("installs nothing for --claude and falls back to -y defaults", async () => {
    const summary = await init({ yes: true, claude: true });

    expect(summary.platforms.sort()).toEqual(["codex", "zcode"]);
    expect(project.exists(".claude")).toBe(false);
  });
});

describe("legacy manifest ownership carry-over", () => {
  it("re-owns CRLF files from a legacy v1 manifest with tiny-computed hashes", async () => {
    const rel = ".zcode/config.json";
    const rendered = collectPlatformTemplates("zcode")?.get(rel);
    if (rendered === undefined) {
      throw new Error("expected .zcode/config.json in the zcode template set");
    }
    // Disk copy with CRLF line endings, as left by a previous Windows
    // install whose manifest used a foreign hash algorithm.
    project.write(rel, rendered.replace(/\n/g, "\r\n"));
    // Legacy v1 manifest: flat path → hash. The hash value is junk —
    // ownership must come from the path, never from the recorded hash.
    project.write(
      ".trellis/.template-hashes.json",
      JSON.stringify({ [rel]: "deadbeef" }),
    );

    await init({ yes: true, codex: true, zcode: true });

    // The path is owned by tiny and hashed with tiny's algorithm
    // (LF-normalized), not the junk value from the legacy manifest.
    const hashes = loadHashes(project.dir);
    expect(hashes[rel]).toBeDefined();
    expect(hashes[rel]).not.toBe("deadbeef");
    expect(hashes[rel]).toBe(computeHash(project.read(rel)));

    // update classifies the CRLF file as a template refresh (autoUpdate —
    // the stored hash matches disk), NOT as "locally modified" (kept).
    const summary = await update({});
    expect(summary.autoUpdated).toContain(rel);
    expect(summary.kept).not.toContain(rel);
    expect(project.read(rel)).toBe(rendered);
  });

  it("still ignores derived/runtime keys from a legacy manifest", async () => {
    project.write(".trellis/scripts/common/__pycache__/x.pyc", "bytecode");
    project.write(
      ".trellis/.template-hashes.json",
      JSON.stringify({
        ".trellis/scripts/common/__pycache__/x.pyc": "junk",
        ".zcode/config.json": "junk",
      }),
    );

    await init({ yes: true, codex: true, zcode: true });

    const hashes = loadHashes(project.dir);
    expect(hashes[".zcode/config.json"]).toBeDefined();
    expect(
      Object.keys(hashes).filter((k) => k.includes("__pycache__")),
    ).toEqual([]);
    expect(project.exists(".trellis/scripts/common/__pycache__/x.pyc")).toBe(
      true,
    );
  });
});

describe("detectLegacyArtifacts", () => {
  it("detects each legacy class with reasons, ignoring user data", () => {
    project.write(".zcode/skills/trellis-meta/SKILL.md", "x");
    project.write(".zcode/cli/agents/a.toml", "x");
    project.write(".trellis/scripts/hooks/linear_sync.py", "x");
    project.write(".agents/skills/trellis-channel/SKILL.md", "x");
    project.write(
      ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md",
      "x",
    );
    project.write(
      ".trellis/agents/check.md",
      "spawned by trellis channel spawn",
    );
    project.write(".cursor/skills/trellis-check/SKILL.md", "x");
    project.write(".trellis/tasks/keep/prd.md", "user data");
    project.write(".zcode/skills/user-own-skill/SKILL.md", "not trellis");
    project.write(".trellis/agents/mine.md", "my own agent");

    const detected = detectLegacyArtifacts(project.dir).map((a) => a.relativePath);
    expect(detected).toContain(".zcode/skills/trellis-meta");
    expect(detected).toContain(".zcode/cli/agents");
    expect(detected).toContain(".trellis/scripts/hooks/linear_sync.py");
    expect(detected).toContain(".agents/skills/trellis-channel");
    expect(detected).toContain(
      ".agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md",
    );
    expect(detected).toContain(".trellis/agents/check.md");
    expect(detected).toContain(".cursor/skills/trellis-check");
    // User content is never a candidate.
    expect(detected).not.toContain(".trellis/tasks/keep/prd.md");
    expect(detected.join("\n")).not.toContain("user-own-skill");
    // Non-template filenames under .trellis/agents stay (content-gated).
    expect(detected).not.toContain(".trellis/agents/mine.md");
  });
});
