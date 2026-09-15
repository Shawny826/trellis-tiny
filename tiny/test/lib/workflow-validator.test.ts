/**
 * Unit tests for the workflow.md [workflow-state:*] block validator
 * (design §6) — including the load-bearing assertion that the vendored
 * template passes.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_WORKFLOW_STATUSES,
  validateWorkflowMarkdown,
} from "../../src/lib/workflow-validator.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workflowMd = fs.readFileSync(
  path.resolve(testDir, "../../src/templates/trellis/workflow.md"),
  "utf-8",
);

/** Build a minimal document that satisfies every rule. */
function makeValidDoc(): string {
  const blocks: string[] = [];
  for (const status of ["no_task", "task_error", ...REQUIRED_WORKFLOW_STATUSES]) {
    blocks.push(`[workflow-state:${status}]`, `body of ${status}`, `[/workflow-state:${status}]`, "");
  }
  return blocks.join("\n");
}

describe("validateWorkflowMarkdown — vendored template", () => {
  it("the vendored templates/trellis/workflow.md passes all rules", () => {
    const result = validateWorkflowMarkdown(workflowMd);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("validateWorkflowMarkdown — pairing", () => {
  it("accepts a minimal well-formed document", () => {
    const result = validateWorkflowMarkdown(makeValidDoc());
    expect(result.issues).toEqual([]);
  });

  it("flags an unclosed block", () => {
    const content = makeValidDoc() + "\n[workflow-state:planning]\nstray body\n";
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.rule === "unclosed-block")).toBe(true);
  });

  it("flags a close whose STATUS does not match the open (backreference semantics)", () => {
    const content = [
      "[workflow-state:planning]",
      "body",
      "[/workflow-state:in_progress]",
      "",
    ].join("\n");
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.rule === "mismatched-close")).toBe(true);
  });

  it("flags a close without an open", () => {
    const content = makeValidDoc() + "\n[/workflow-state:planning]\n";
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.rule === "orphan-close")).toBe(true);
  });

  it("flags a block opened inside an unterminated block", () => {
    const content = [
      "[workflow-state:planning]",
      "[workflow-state:in_progress]",
      "body",
      "[/workflow-state:in_progress]",
      "[/workflow-state:planning]",
      "",
    ].join("\n");
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.rule === "nested-block")).toBe(true);
  });

  it("tolerates CRLF line endings", () => {
    const result = validateWorkflowMarkdown(makeValidDoc().replace(/\n/g, "\r\n"));
    expect(result.issues).toEqual([]);
  });

  it("ignores mid-line prose mentions of tags", () => {
    const content =
      makeValidDoc() +
      "\nThe breadcrumb auto-switches to `[workflow-state:planning]`, telling the AI to stay in planning.\n";
    const result = validateWorkflowMarkdown(content);
    expect(result.issues).toEqual([]);
  });
});

describe("validateWorkflowMarkdown — STATUS charset", () => {
  it("flags an open tag with characters outside [A-Za-z0-9_-]", () => {
    const content = makeValidDoc() + "\n[workflow-state:bad status!]\nbody\n[/workflow-state:bad status!]\n";
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    const charsetIssues = result.issues.filter((i) => i.rule === "status-charset");
    expect(charsetIssues.length).toBe(2); // open + close both reported
  });

  it("accepts hyphens, underscores and digits in STATUS", () => {
    const content = [
      "[workflow-state:no_task]",
      "b",
      "[/workflow-state:no_task]",
      "[workflow-state:stale_task-2]",
      "b",
      "[/workflow-state:stale_task-2]",
      ...REQUIRED_WORKFLOW_STATUSES.flatMap((s) => [
        `[workflow-state:${s}]`,
        "b",
        `[/workflow-state:${s}]`,
      ]),
      "",
    ].join("\n");
    const result = validateWorkflowMarkdown(content);
    expect(result.issues).toEqual([]);
  });
});

describe("validateWorkflowMarkdown — required statuses", () => {
  it("flags each missing required status", () => {
    const content = [
      "[workflow-state:no_task]",
      "b",
      "[/workflow-state:no_task]",
      "",
    ].join("\n");
    const result = validateWorkflowMarkdown(content);
    const missing = result.issues.filter((i) => i.rule === "missing-required-status");
    expect(missing.length).toBe(REQUIRED_WORKFLOW_STATUSES.length);
  });

  it("accepts the required statuses in any order with extra pseudo-statuses", () => {
    const content = makeValidDoc();
    expect(validateWorkflowMarkdown(content).ok).toBe(true);
  });
});

describe("validateWorkflowMarkdown — no_task fast-path rule", () => {
  it("flags a `[required` enforcement line inside the no_task block", () => {
    const content = [
      "[workflow-state:no_task]",
      "- 1.0 Create task `[required · once]`",
      "[/workflow-state:no_task]",
      ...REQUIRED_WORKFLOW_STATUSES.flatMap((s) => [
        `[workflow-state:${s}]`,
        "b",
        `[/workflow-state:${s}]`,
      ]),
      "",
    ].join("\n");
    const result = validateWorkflowMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.rule === "no-task-required")).toBe(true);
  });

  it("allows `[required` mentions OUTSIDE the no_task block", () => {
    const content =
      makeValidDoc() +
      "\n- 2.1 Implement `[required · repeatable]` (this line is in no block)\n";
    const result = validateWorkflowMarkdown(content);
    expect(result.issues).toEqual([]);
  });
});
