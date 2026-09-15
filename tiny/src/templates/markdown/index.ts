/**
 * Markdown templates — root files and the generic spec skeleton for new
 * projects.
 *
 * Structure templates use the `.md.txt` extension so tooling does not treat
 * them as project docs. trellis-tiny ships the fullstack superset as the
 * "generic minimal set" (design §7: project-detector dropped) — init writes
 * guides + backend + frontend unconditionally and never removes or overwrites
 * user-customized spec content afterwards (`.trellis/spec/` is user data).
 *
 * Ported from upstream `packages/cli/src/templates/markdown/index.ts`.
 * `worktree.yaml.txt` is not exported: the `trellis workflow` command that
 * consumed it was dropped (design §7).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readLocalTemplate(filename: string): string {
  return readFileSync(join(__dirname, filename), "utf-8");
}

// =============================================================================
// Root files for new projects
// =============================================================================

/** Root AGENTS.md — the TRELLIS managed block other tools parse. */
export const agentsMdContent = readLocalTemplate("agents.md");

/** Workspace index template (developer work records). */
export const workspaceIndexContent = readLocalTemplate("workspace-index.md");

// NOTE: `markdown/gitignore.txt` exists in the vendored tree but is not
// exported — it is an upstream legacy variant with no consumer. `.trellis/
// .gitignore` comes from `templates/trellis/index.ts` (gitignoreTemplate).

export interface SpecTemplateFile {
  /** POSIX path relative to `.trellis/spec/`, e.g. "backend/index.md" */
  relativePath: string;
  content: string;
}

/**
 * Get every generic spec template, discovered by walking `spec/**\/*.md.txt`.
 * The `.md.txt` suffix maps to `.md`; the on-disk layout under `spec/` maps
 * 1:1 to the layout under `.trellis/spec/`.
 */
export function getSpecTemplates(): SpecTemplateFile[] {
  const files: SpecTemplateFile[] = [];
  const root = join(__dirname, "spec");

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && entry.endsWith(".md.txt")) {
        const rel =
          relative(root, fullPath)
            .split(sep)
            .join("/")
            .replace(/\.md\.txt$/, ".md");
        files.push({ relativePath: rel, content: readFileSync(fullPath, "utf-8") });
      }
    }
  }

  walk(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
