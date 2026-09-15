/**
 * Vendored template contract tests (M1 exit criteria).
 *
 * - workflow.md [workflow-state:*] tag blocks: paired open/close tags, the
 *   five required statuses present, and the R3 fast-path semantics encoded
 *   in the no_task block (default direct path, consent only for complex,
 *   upgrade-on-demand) without carrying required steps.
 * - `trellis mem` -> `tt mem` mechanical replacement is complete.
 * - Channel system removal: no substantive channel markers anywhere in
 *   templates (generic English uses of the word "channel" are allowed).
 * - Vendored file-set shape: expected directories exist, channel runtime
 *   artifacts (trellis/agents/, bundled-skills/trellis-channel/) and
 *   linear_sync.py are absent, no .ts manifests were vendored.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(testDir, "../src/templates");
const workflowMd = fs.readFileSync(
  path.join(templatesDir, "trellis", "workflow.md"),
  "utf-8",
);

// =============================================================================
// workflow-state tag blocks
// =============================================================================

interface TagBlock {
  status: string;
  body: string;
}

function parseWorkflowStateBlocks(content: string): TagBlock[] {
  const openRe = /^\[workflow-state:([A-Za-z0-9_-]+)\][ \t]*$/gm;
  const blocks: TagBlock[] = [];

  for (const match of content.matchAll(openRe)) {
    const status = match[1];
    if (status === undefined) continue;
    const openEnd = (match.index ?? 0) + match[0].length;
    const rest = content.slice(openEnd);
    // First line-start closing tag with the same STATUS (backreference
    // semantics, mirroring inject-workflow-state.py's `_TAG_RE`).
    const closeRe = new RegExp(
      `\\n\\[/workflow-state:${status}\\][ \\t]*$`,
      "m",
    );
    const closeMatch = closeRe.exec(rest);
    if (!closeMatch) continue;
    blocks.push({ status, body: rest.slice(0, closeMatch.index) });
  }
  return blocks;
}

/** Count block-marker lines at line start (opens and closes separately). */
function countMarkers(content: string, opening: boolean): string[] {
  const re = opening
    ? /^\[workflow-state:([A-Za-z0-9_-]+)\][ \t]*$/gm
    : /^\[\/workflow-state:([A-Za-z0-9_-]+)\][ \t]*$/gm;
  return [...content.matchAll(re)].map((m) => m[1] ?? "");
}

describe("workflow.md workflow-state tag blocks", () => {
  it("closes every [workflow-state:X] with a matching [/workflow-state:X]", () => {
    const opens = countMarkers(workflowMd, true);
    const closes = countMarkers(workflowMd, false);
    expect(opens.length).toBeGreaterThan(0);
    expect(opens).toEqual(closes);
  });

  it("contains the five required status blocks", () => {
    for (const status of [
      "planning",
      "planning-inline",
      "in_progress",
      "in_progress-inline",
      "completed",
    ]) {
      expect(
        workflowMd.includes(`[workflow-state:${status}]`),
        `missing [workflow-state:${status}]`,
      ).toBe(true);
    }
  });

  it("keeps pseudo-status blocks for no_task and task_error", () => {
    expect(workflowMd.includes("[workflow-state:no_task]")).toBe(true);
    expect(workflowMd.includes("[workflow-state:task_error]")).toBe(true);
  });

  it("parses every block body non-empty (naive extractor sanity)", () => {
    const blocks = parseWorkflowStateBlocks(workflowMd);
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    for (const block of blocks) {
      expect(block.body.trim().length, `empty body: ${block.status}`).toBeGreaterThan(
        0,
      );
    }
  });

  describe("R3 fast path in [workflow-state:no_task]", () => {
    const noTaskBody = parseWorkflowStateBlocks(workflowMd).find(
      (b) => b.status === "no_task",
    )?.body;

    it("exists", () => {
      expect(noTaskBody).toBeDefined();
    });

    it("defaults simple work to the zero-task direct path and forbids asking", () => {
      expect(noTaskBody).toMatch(/fast path|direct path/i);
      expect(noTaskBody).toMatch(/do NOT create a task directory and do NOT ask/i);
      expect(noTaskBody).toMatch(/trellis-before-dev/);
      expect(noTaskBody).toMatch(/trellis-check/);
    });

    it("preserves task-creation consent for complex work only", () => {
      expect(noTaskBody).toMatch(/[Cc]omplex/);
      expect(noTaskBody).toMatch(/task-creation consent/);
    });

    it("documents the upgrade-to-task escape hatch", () => {
      expect(noTaskBody).toMatch(/upgrade/);
      expect(noTaskBody).toMatch(/Phase 1\.0/);
    });

    it("carries no [required] step enforcement lines", () => {
      expect(noTaskBody).not.toMatch(/\[required/);
    });
  });

  describe("Request Triage alignment", () => {
    const triage = workflowMd.match(
      /### Request Triage\n([\s\S]*?)\n### /,
    )?.[1];

    it("exists", () => {
      expect(triage).toBeDefined();
    });

    it("routes simple work to the direct path without asking", () => {
      expect(triage).toMatch(/zero-task direct path/);
      expect(triage).toMatch(/do NOT create a task directory and do NOT ask/);
    });

    it("keeps the consent question for complex work", () => {
      expect(triage).toMatch(/Complex task.*ask whether you may create a Trellis task/s);
    });

    it("mentions the upgrade path", () => {
      expect(triage).toMatch(/upgrade a direct-path turn/);
    });
  });
});

// =============================================================================
// trellis mem -> tt mem replacement
// =============================================================================

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

const templateFiles = walkFiles(templatesDir);

// Template loader modules shipped as source (M3). These are the ONLY .ts
// files allowed under src/templates — anything else means upstream source
// leaked into the vendored set.
const TEMPLATE_LOADER_MODULES = [
  "common/index.ts",
  "markdown/index.ts",
  "shared-hooks/index.ts",
  "trellis/index.ts",
  "codex/index.ts",
  "zcode/index.ts",
  "dsh/index.ts",
  "template-utils.ts",
].map((p) => path.join(templatesDir, ...p.split("/")));

describe("vendored template text contract", () => {
  it("contains no `trellis mem` references (replaced with `tt mem`)", () => {
    const offenders = templateFiles.filter((f) => {
      const content = fs.readFileSync(f, "utf-8");
      return content.includes("trellis mem");
    });
    expect(offenders).toEqual([]);
  });

  it("uses `tt mem` in the session-insight skill docs", () => {
    const skill = fs.readFileSync(
      path.join(
        templatesDir,
        "common",
        "bundled-skills",
        "trellis-session-insight",
        "SKILL.md",
      ),
      "utf-8",
    );
    expect(skill).toMatch(/tt mem/);
  });
});

// =============================================================================
// Channel removal (AC5 template-side)
// =============================================================================

/** Substantive markers of the removed Channel system. Generic English uses
 *  of the bare word "channel" are permitted; these are not. */
const CHANNEL_MARKERS = [
  "trellis-channel",
  "trellis channel",
  "TRELLIS_CHANNEL",
  "channel spawn",
  "worker_guard",
  "channels/<project>",
  "/channel SDK",
  "@mindfoldhq/trellis-core/channel",
  "channel-driven",
];

describe("channel system removal", () => {
  it("has no substantive channel markers in any vendored template", () => {
    const offenders: string[] = [];
    for (const file of templateFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const marker of CHANNEL_MARKERS) {
        if (content.toLowerCase().includes(marker.toLowerCase())) {
          offenders.push(`${path.relative(templatesDir, file)}: ${marker}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not ship the trellis-channel bundled skill", () => {
    expect(
      fs.existsSync(path.join(templatesDir, "common", "bundled-skills", "trellis-channel")),
    ).toBe(false);
  });

  it("does not ship the channel runtime agent definitions", () => {
    expect(fs.existsSync(path.join(templatesDir, "trellis", "agents"))).toBe(false);
  });
});

// =============================================================================
// Vendored file-set shape
// =============================================================================

describe("vendored file-set shape", () => {
  it("ships only the known template loader modules as .ts, no vendored source", () => {
    const tsFiles = templateFiles.filter((f) => f.endsWith(".ts"));
    expect([...tsFiles].sort()).toEqual([...TEMPLATE_LOADER_MODULES].sort());
  });

  it("does not ship linear_sync.py", () => {
    const offenders = templateFiles.filter((f) =>
      f.endsWith("linear_sync.py"),
    );
    expect(offenders).toEqual([]);
  });

  it("ships the workflow Python scripts", () => {
    for (const rel of [
      "task.py",
      "get_context.py",
      "add_session.py",
      "get_developer.py",
      "init_developer.py",
      "common/task_store.py",
      "common/active_task.py",
      "common/workflow_phase.py",
      "common/cli_adapter.py",
    ]) {
      expect(
        fs.existsSync(path.join(templatesDir, "trellis", "scripts", ...rel.split("/"))),
        `missing trellis/scripts/${rel}`,
      ).toBe(true);
    }
  });

  it("ships the four shared hooks", () => {
    for (const name of [
      "session-start.py",
      "inject-workflow-state.py",
      "inject-subagent-context.py",
      "inject-shell-session-context.py",
    ]) {
      expect(
        fs.existsSync(path.join(templatesDir, "shared-hooks", name)),
        `missing shared-hooks/${name}`,
      ).toBe(true);
    }
  });

  it("ships codex / zcode / dsh platform templates and the dormant claude slot", () => {
    expect(fs.existsSync(path.join(templatesDir, "codex", "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "codex", "hooks.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(templatesDir, "codex", "agents", "trellis-implement.toml")),
    ).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "zcode", "config.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(templatesDir, "zcode", "agents", "trellis-check.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "dsh", "DSH.md"))).toBe(true);
    // Dormant extension slot — files exist, registry marks available:false (M3).
    expect(fs.existsSync(path.join(templatesDir, "claude", "settings.json"))).toBe(true);
  });

  it("ships common skills, commands, and bundled skills", () => {
    for (const rel of [
      "skills/before-dev.md",
      "skills/check.md",
      "commands/start.md",
      "commands/continue.md",
      "commands/finish-work.md",
      "bundled-skills/trellis-meta/SKILL.md",
      "bundled-skills/trellis-session-insight/SKILL.md",
      "bundled-skills/trellis-spec-bootstrap/SKILL.md",
    ]) {
      expect(
        fs.existsSync(path.join(templatesDir, "common", ...rel.split("/"))),
        `missing common/${rel}`,
      ).toBe(true);
    }
  });

  it("ships the spec skeleton templates", () => {
    expect(
      fs.existsSync(path.join(templatesDir, "markdown", "spec", "guides", "index.md.txt")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templatesDir, "markdown", "agents.md")),
    ).toBe(true);
  });
});
