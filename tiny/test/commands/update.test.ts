/**
 * update command tests (M5 exit criteria).
 *
 * - AC7: consecutive `update` runs after init are a true no-op — zero files
 *   written, byte-identical project snapshot including the manifest.
 * - User-modified files: keep (non-TTY default and --skipAll), overwrite
 *   (--force), and .new copy (--createNew) branches.
 * - User deletions are respected (no resurrection).
 * - Files removed from disk AND manifest come back as newFiles.
 * - Tracked files absent from the new template set are retired.
 * - Codex agent `model` keys never produce a false "modified by you".
 * - `--dry-run` makes no changes.
 *
 * Tests run non-TTY (vitest), so the interactive inquirer branch is exercised
 * through its flag short-circuits and the non-TTY keep degradation.
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectPlatformTemplates } from "../../src/configurators/index.js";
import { resetResolvedPythonCommand } from "../../src/lib/python-resolver.js";
import {
  loadHashes,
  removeHash,
  updateHashes,
} from "../../src/lib/template-hash.js";
import { init } from "../../src/commands/init.js";
import { update } from "../../src/commands/update.js";
import {
  cleanupTempProject,
  useTempProject,
  type TempProject,
} from "./helpers.js";

let project: TempProject;

beforeEach(async () => {
  resetResolvedPythonCommand();
  project = useTempProject("trellis-tiny-update-");
  await init({ yes: true, codex: true, zcode: true, force: true });
});

afterEach(() => {
  cleanupTempProject(project);
});

const ZCODE_CONFIG = ".zcode/config.json";
const IMPLEMENT_TOML = ".codex/agents/trellis-implement.toml";

function assertZeroWrites(...summaries: {
  newFiles: string[];
  autoUpdated: string[];
  overwritten: string[];
  createdNew: string[];
  retired: string[];
}[]): void {
  for (const s of summaries) {
    expect(s.newFiles).toEqual([]);
    expect(s.autoUpdated).toEqual([]);
    expect(s.overwritten).toEqual([]);
    expect(s.createdNew).toEqual([]);
    expect(s.retired).toEqual([]);
  }
}

describe("AC7: update idempotency", () => {
  it("consecutive runs are a true no-op (zero writes, byte-identical snapshot)", async () => {
    const before = project.snapshot();

    const r1 = await update({});
    expect(r1.upToDate).toBe(true);
    const r2 = await update({});
    expect(r2.upToDate).toBe(true);
    const r3 = await update({});
    expect(r3.upToDate).toBe(true);

    assertZeroWrites(r1, r2, r3);
    // Second run changed literally nothing on disk, manifest included.
    expect(project.snapshot()).toEqual(before);
  });
});

describe("user-modified files", () => {
  it("non-TTY default keeps the local edit and reports it", async () => {
    project.write(ZCODE_CONFIG, "{ custom: true }");

    const r = await update({});

    expect(r.kept).toContain(ZCODE_CONFIG);
    expect(project.read(ZCODE_CONFIG)).toBe("{ custom: true }");
    // The stored hash still points at the template, so a forced update
    // can still reconcile it later.
    expect(loadHashes(project.dir)[ZCODE_CONFIG]).toBeDefined();
  });

  it("--skipAll keeps every local edit", async () => {
    project.write(ZCODE_CONFIG, "{ custom: true }");
    project.write(".trellis/workflow.md", "my workflow override");

    const r = await update({ skipAll: true });

    expect(r.kept).toContain(ZCODE_CONFIG);
    expect(r.kept).toContain(".trellis/workflow.md");
    expect(project.read(ZCODE_CONFIG)).toBe("{ custom: true }");
    expect(project.read(".trellis/workflow.md")).toBe("my workflow override");
  });

  it("--force overwrites local edits, and the next run is clean", async () => {
    project.write(ZCODE_CONFIG, "{ custom: true }");

    const r = await update({ force: true });

    expect(r.overwritten).toContain(ZCODE_CONFIG);
    const expected = collectPlatformTemplates("zcode")?.get(ZCODE_CONFIG);
    expect(expected).toBeDefined();
    expect(project.read(ZCODE_CONFIG)).toBe(expected);

    // After the overwrite the manifest records the new bytes: no churn.
    const r2 = await update({});
    expect(r2.upToDate).toBe(true);
  });

  it("--createNew writes a .new copy and keeps the original", async () => {
    project.write(ZCODE_CONFIG, "{ custom: true }");

    const r = await update({ createNew: true });

    expect(r.createdNew).toContain(ZCODE_CONFIG);
    expect(project.read(ZCODE_CONFIG)).toBe("{ custom: true }");
    const expected = collectPlatformTemplates("zcode")?.get(ZCODE_CONFIG);
    expect(project.read(`${ZCODE_CONFIG}.new`)).toBe(expected);
  });

  it("--dry-run previews without touching anything", async () => {
    project.write(ZCODE_CONFIG, "{ custom: true }");
    const before = project.snapshot();

    const r = await update({ dryRun: true });

    expect(r.kept).toEqual([]);
    expect(project.snapshot()).toEqual(before);
  });
});

describe("deletions and retirements", () => {
  it("never retires or tracks derived/runtime artifacts (M8 regression)", async () => {
    // Disk state as found in the M8 dogfood: hook-written runtime state and
    // bytecode caches regenerated by running the workflow scripts.
    project.write(".trellis/.runtime/sessions/x.json", "{}");
    project.write(".trellis/.runtime/shell-tickets/t.json", "{}");
    project.write(
      ".trellis/scripts/common/__pycache__/mod.cpython-314.pyc",
      "bytecode",
    );
    // A legacy init could also have poisoned the manifest with such keys.
    updateHashes(
      project.dir,
      new Map([
        [".trellis/scripts/common/__pycache__/mod.cpython-314.pyc", "bytecode"],
        [".trellis/.runtime/sessions/x.json", "{}"],
      ]),
    );

    const r = await update({});

    // Nothing derived/runtime is retired; every file survives.
    expect(r.retired).toEqual([]);
    expect(project.read(".trellis/.runtime/sessions/x.json")).toBe("{}");
    expect(project.read(".trellis/.runtime/shell-tickets/t.json")).toBe("{}");
    expect(
      project.exists(".trellis/scripts/common/__pycache__/mod.cpython-314.pyc"),
    ).toBe(true);
    // The poisoned manifest was self-healed: no derived/runtime keys remain.
    const hashes = loadHashes(project.dir);
    expect(
      Object.keys(hashes).filter(
        (k) => k.includes("__pycache__") || k.includes(".runtime"),
      ),
    ).toEqual([]);
    // …and the next run is a clean no-op (no heal-save churn).
    const before = project.snapshot();
    const r2 = await update({});
    expect(r2.upToDate).toBe(true);
    expect(project.snapshot()).toEqual(before);
  });

  it("respects user deletion instead of resurrecting the file", async () => {
    expect(project.exists(".trellis/workflow.md")).toBe(true);
    fs.unlinkSync(project.p(".trellis/workflow.md"));

    const r = await update({ force: true });

    expect(r.userDeleted).toContain(".trellis/workflow.md");
    expect(project.exists(".trellis/workflow.md")).toBe(false);
    // Manifest entry survives so future runs keep respecting the deletion.
    expect(loadHashes(project.dir)[".trellis/workflow.md"]).toBeDefined();
  });

  it("recreates files deleted together with their manifest entry", async () => {
    fs.unlinkSync(project.p(ZCODE_CONFIG));
    removeHash(project.dir, ZCODE_CONFIG);

    const r = await update({});

    expect(r.newFiles).toContain(ZCODE_CONFIG);
    expect(project.exists(ZCODE_CONFIG)).toBe(true);
  });

  it("retires tracked files the current template set no longer ships", async () => {
    project.write(".zcode/legacy-hook.py", "# retired upstream");
    updateHashes(project.dir, new Map([[".zcode/legacy-hook.py", "# retired upstream"]]));

    const r = await update({});

    expect(r.retired).toContain(".zcode/legacy-hook.py");
    expect(project.exists(".zcode/legacy-hook.py")).toBe(false);
    expect(loadHashes(project.dir)[".zcode/legacy-hook.py"]).toBeUndefined();
  });

  it("never retires user-data paths even if a stale manifest entry exists", async () => {
    project.write(".trellis/workspace/alice/notes.md", "keep me");
    updateHashes(
      project.dir,
      new Map([[".trellis/workspace/alice/notes.md", "keep me"]]),
    );

    const r = await update({});

    expect(r.retired).not.toContain(".trellis/workspace/alice/notes.md");
    expect(project.read(".trellis/workspace/alice/notes.md")).toBe("keep me");
  });
});

describe("codex agent model preservation", () => {
  it("user-set model keys do not create a modified-file conflict", async () => {
    // Graft the model line exactly where applyCodexAgentModelKeys re-inserts
    // it (right after sandbox_mode), simulating a user edit + update round.
    const original = project.read(IMPLEMENT_TOML);
    const withModel = original.replace(
      /^(sandbox_mode\s*=\s*".*"\n)/m,
      `$1model = "gpt-5.2-turbo"\n`,
    );
    project.write(IMPLEMENT_TOML, withModel);

    const r = await update({});

    expect(r.upToDate).toBe(true);
    expect(r.kept).not.toContain(IMPLEMENT_TOML);
    expect(project.read(IMPLEMENT_TOML)).toContain('model = "gpt-5.2-turbo"');
  });
});
