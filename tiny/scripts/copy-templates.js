#!/usr/bin/env node

/**
 * Cross-platform script to copy template files to dist/
 *
 * Copies src/templates/ to dist/templates/ (excluding .ts files and
 * Python cache artifacts).
 *
 * The templates are GENERIC templates for user projects:
 * - src/templates/trellis/       - Workflow scripts and config (.trellis/)
 * - src/templates/common/        - Skills and commands shared by all platforms
 * - src/templates/shared-hooks/  - Platform-independent Python hooks
 * - src/templates/codex/         - Codex agents, hooks, config
 * - src/templates/zcode/         - ZCode agents, config
 * - src/templates/dsh/           - DeepSeek Harness guide
 * - src/templates/claude/        - Claude Code extension slot (dormant)
 * - src/templates/markdown/      - Markdown templates (spec skeletons, AGENTS.md)
 *
 * Portability note: this script deliberately performs no chmod/permission
 * management. Executable-bit semantics for installed scripts are handled at
 * init time in portable TypeScript code, not in build tooling (Windows has no
 * POSIX permission model).
 */

import { cpSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const EXCLUDED_TEMPLATE_ENTRIES = new Set(["__pycache__", ".DS_Store"]);
const EXCLUDED_TEMPLATE_EXTENSIONS = new Set([".pyc", ".pyo", ".ts"]);

function shouldSkipTemplateEntry(entry) {
  return (
    EXCLUDED_TEMPLATE_ENTRIES.has(entry) ||
    EXCLUDED_TEMPLATE_EXTENSIONS.has(extname(entry))
  );
}

/**
 * Recursively copy directory, excluding source and runtime cache artifacts.
 * Python hooks are executed during local tests, so ignored `__pycache__`
 * directories can exist in src/templates; they must not be copied into the npm
 * tarball.
 *
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    if (shouldSkipTemplateEntry(entry)) {
      continue;
    }

    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

copyDir("src/templates", "dist/templates");
console.log("Copied src/templates/ to dist/templates/");

console.log("Template copy complete.");
