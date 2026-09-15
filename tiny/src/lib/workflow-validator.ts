/**
 * workflow-validator.ts — pure-function integrity checks for the
 * `[workflow-state:*]` breadcrumb blocks in `.trellis/workflow.md`
 * (design §6).
 *
 * The blocks are a runtime contract: `inject-workflow-state.py` parses them
 * on every turn, so a malformed edit degrades the breadcrumb silently. This
 * validator is the build-time guard (tests + future `tt` tooling). It mirrors
 * the parser's `\1` backreference semantics — a block only counts when open
 * and close carry the SAME status — and enforces:
 *
 *   1. pairing   — every open has a matching same-status close (no unclosed
 *                  blocks, orphan closes, mismatched closes, or nesting)
 *   2. charset   — STATUS matches `[A-Za-z0-9_-]+` (the hook's charset)
 *   3. required  — the five task-lifecycle statuses are all present
 *   4. no_task   — the no_task block carries no `[required` enforcement line
 *                  (R3: the fast path has no gated steps)
 *
 * Block markers are recognized exactly like the strip-side consumers: the tag
 * occupies a whole line (column 0, only trailing whitespace). Mid-line
 * mentions in prose (`` `[workflow-state:planning]` `` inside a sentence) are
 * NOT markers and are ignored — the vendored workflow.md is full of them.
 */

/** Statuses that must exist in every workflow.md (task-lifecycle contract). */
export const REQUIRED_WORKFLOW_STATUSES = [
  "planning",
  "planning-inline",
  "in_progress",
  "in_progress-inline",
  "completed",
] as const;

/** STATUS character set from the workflow-state contract. */
export const STATUS_CHARSET = /^[A-Za-z0-9_-]+$/;

export type WorkflowIssueRule =
  | "status-charset"
  | "unclosed-block"
  | "orphan-close"
  | "mismatched-close"
  | "nested-block"
  | "missing-required-status"
  | "no-task-required";

export interface WorkflowValidationIssue {
  rule: WorkflowIssueRule;
  message: string;
  /** 1-based line number, when attributable to one line. */
  line?: number;
}

export interface WorkflowValidationResult {
  ok: boolean;
  issues: WorkflowValidationIssue[];
}

interface OpenBlock {
  status: string;
  line: number;
  /** Body lines accumulated so far (used for the no_task rule). */
  body: string[];
}

const OPEN_TAG_RE = /^\[workflow-state:([^\]\n]*)\][ \t]*$/;
const CLOSE_TAG_RE = /^\[\/workflow-state:([^\]\n]*)\][ \t]*$/;

/**
 * Validate the workflow-state blocks of a workflow.md document. Never throws
 * — every problem becomes an issue with a stable `rule` id.
 */
export function validateWorkflowMarkdown(
  content: string,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const stack: OpenBlock[] = [];
  /** Statuses seen on well-formed opens (charset-valid), in first-seen order. */
  const seenStatuses = new Set<string>();
  /** Bodies of every no_task block (normally exactly one). */
  const noTaskBodies: string[][] = [];

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNumber = i + 1;

    const openMatch = OPEN_TAG_RE.exec(line);
    if (openMatch) {
      const status = openMatch[1] ?? "";
      if (!STATUS_CHARSET.test(status)) {
        issues.push({
          rule: "status-charset",
          message:
            `[workflow-state:${status}] has an invalid STATUS ` +
            `(allowed: letters, digits, underscore, hyphen).`,
          line: lineNumber,
        });
        continue; // not a marker as far as the runtime parser is concerned
      }
      if (stack.length > 0) {
        issues.push({
          rule: "nested-block",
          message:
            `[workflow-state:${status}] opens inside unterminated ` +
            `[workflow-state:${stack[stack.length - 1]?.status}].`,
          line: lineNumber,
        });
      }
      stack.push({ status, line: lineNumber, body: [] });
      seenStatuses.add(status);
      if (status === "no_task") noTaskBodies.push(stack[stack.length - 1]?.body ?? []);
      continue;
    }

    const closeMatch = CLOSE_TAG_RE.exec(line);
    if (closeMatch) {
      const status = closeMatch[1] ?? "";
      if (!STATUS_CHARSET.test(status)) {
        issues.push({
          rule: "status-charset",
          message:
            `[/workflow-state:${status}] has an invalid STATUS ` +
            `(allowed: letters, digits, underscore, hyphen).`,
          line: lineNumber,
        });
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top) {
        issues.push({
          rule: "orphan-close",
          message: `[/workflow-state:${status}] closes a block that was never opened.`,
          line: lineNumber,
        });
        continue;
      }
      if (top.status !== status) {
        issues.push({
          rule: "mismatched-close",
          message:
            `[/workflow-state:${status}] does not match the open ` +
            `[workflow-state:${top.status}] at line ${top.line}.`,
          line: lineNumber,
        });
        // Pop anyway so subsequent lines pair against the outer block.
        stack.pop();
        continue;
      }
      stack.pop();
      continue;
    }

    // Plain body line — accumulate into the innermost open block.
    const top = stack[stack.length - 1];
    if (top) top.body.push(line);
  }

  for (const block of stack) {
    issues.push({
      rule: "unclosed-block",
      message: `[workflow-state:${block.status}] (line ${block.line}) is never closed.`,
      line: block.line,
    });
  }

  for (const required of REQUIRED_WORKFLOW_STATUSES) {
    if (!seenStatuses.has(required)) {
      issues.push({
        rule: "missing-required-status",
        message: `required status block [workflow-state:${required}] is missing.`,
      });
    }
  }

  for (const body of noTaskBodies) {
    const requiredLine = body.find((l) => l.includes("[required"));
    if (requiredLine !== undefined) {
      issues.push({
        rule: "no-task-required",
        message:
          "the [workflow-state:no_task] block carries a `[required` " +
          "enforcement line — the fast path must stay ungated.",
      });
      break;
    }
  }

  return { ok: issues.length === 0, issues };
}
