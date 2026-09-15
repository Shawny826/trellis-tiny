/**
 * uninstall command tests (M5 exit criteria).
 *
 * - Manifest-driven reverse delete removes everything tiny wrote.
 * - Platform directories disappear entirely when all their content was
 *   tiny-written; `.trellis/` itself and tasks/workspace/spec survive.
 * - AGENTS.md is scrubbed (managed block stripped) instead of blind-deleted
 *   when the user added their own prose.
 * - `--dry-run` removes nothing; not-installed projects short-circuit.
 * - Non-TTY tests always pass `--yes`; the prompt path is the CLI layer's
 *   concern (M7).
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetResolvedPythonCommand } from "../../src/lib/python-resolver.js";
import { init } from "../../src/commands/init.js";
import { uninstall } from "../../src/commands/uninstall.js";
import {
  cleanupTempProject,
  useTempProject,
  type TempProject,
} from "./helpers.js";

let project: TempProject;

beforeEach(async () => {
  resetResolvedPythonCommand();
  project = useTempProject("trellis-tiny-uninstall-");
  await init({ yes: true, codex: true, zcode: true, force: true });
  // User data that must survive.
  project.write(".trellis/tasks/09-14-keep/prd.md", "# my task");
  project.write(".trellis/workspace/alice/journal-alice.md", "# journal");
  project.write(".trellis/spec/custom/my-notes.md", "# my spec notes");
});

afterEach(() => {
  cleanupTempProject(project);
});

describe("uninstall", () => {
  it("removes manifest files and empty managed dirs, keeps user data", async () => {
    const r = await uninstall({ yes: true });

    // Platform dirs fully removed (every content file was tiny-written).
    expect(project.exists(".zcode")).toBe(false);
    expect(project.exists(".codex")).toBe(false);
    expect(project.exists(".agents")).toBe(false);

    // `.trellis/` survives with user data…
    expect(project.exists(".trellis")).toBe(true);
    expect(project.read(".trellis/tasks/09-14-keep/prd.md")).toBe("# my task");
    expect(project.read(".trellis/workspace/alice/journal-alice.md")).toBe("# journal");
    expect(project.read(".trellis/spec/custom/my-notes.md")).toBe("# my spec notes");

    // …but every trellis-managed file inside is gone.
    expect(project.exists(".trellis/workflow.md")).toBe(false);
    expect(project.exists(".trellis/config.yaml")).toBe(false);
    expect(project.exists(".trellis/scripts")).toBe(false);
    expect(project.exists(".trellis/.gitignore")).toBe(false);
    expect(project.exists(".trellis/.template-hashes.json")).toBe(false);

    // Root artifacts: AGENTS.md was fully trellis-written → deleted;
    // additive .gitattributes stays.
    expect(project.exists("AGENTS.md")).toBe(false);
    expect(project.exists(".gitattributes")).toBe(true);

    expect(r.deleted.length).toBeGreaterThan(0);
    expect(r.notInstalled).toBe(false);
  });

  it("reports manifest entries already missing on disk", async () => {
    fs.rmSync(project.p(".zcode/config.json"));

    const r = await uninstall({ yes: true });

    expect(r.missing).toContain(".zcode/config.json");
    expect(project.exists(".zcode")).toBe(false);
  });

  it("scrubs the AGENTS.md managed block but keeps user prose", async () => {
    project.write("AGENTS.md", `${project.read("AGENTS.md")}\nMy own notes\n`);

    const r = await uninstall({ yes: true });

    expect(r.modified).toContain("AGENTS.md");
    expect(project.exists("AGENTS.md")).toBe(true);
    const content = project.read("AGENTS.md");
    expect(content).toContain("My own notes");
    expect(content).not.toContain("TRELLIS:START");
    expect(content).not.toContain("TRELLIS:END");
  });

  it("leaves AGENTS.md untouched when its managed block is gone", async () => {
    project.write("AGENTS.md", "# Entirely my own file\n");

    const r = await uninstall({ yes: true });

    expect(r.modified).not.toContain("AGENTS.md");
    expect(project.read("AGENTS.md")).toBe("# Entirely my own file\n");
  });

  it("dry-run removes nothing", async () => {
    const before = project.snapshot();

    const r = await uninstall({ dryRun: true });

    expect(r.deleted).toEqual([]);
    expect(project.snapshot()).toEqual(before);
  });

  it("a user file inside a platform dir keeps that dir alive", async () => {
    project.write(".zcode/my-own-notes.txt", "user content");

    await uninstall({ yes: true });

    expect(project.exists(".zcode")).toBe(true);
    expect(project.read(".zcode/my-own-notes.txt")).toBe("user content");
    // …while the tiny-written siblings are gone.
    expect(project.exists(".zcode/config.json")).toBe(false);
    expect(project.exists(".codex")).toBe(false);
  });
});

describe("uninstall on a non-trellis project", () => {
  it("short-circuits with notInstalled", async () => {
    // Fresh temp dir without init — replace the module-level fixture.
    cleanupTempProject(project);
    project = useTempProject("trellis-tiny-uninstall-bare-");

    const r = await uninstall({ yes: true });

    expect(r.notInstalled).toBe(true);
    expect(r.deleted).toEqual([]);
  });
});
