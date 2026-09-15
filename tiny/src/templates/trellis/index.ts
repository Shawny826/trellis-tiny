/**
 * Trellis workflow templates — the `.trellis/` skeleton written by init and
 * diffed by update.
 *
 * Directory structure (trellis-tiny vendored set):
 *   trellis/
 *   ├── scripts/           # Python workflow scripts (written with exec bit)
 *   ├── workflow.md        # Workflow guide (R3 zero-task fast path rewrite)
 *   ├── config.yaml        # Trellis configuration
 *   ├── gitignore.txt      # .trellis/.gitignore content
 *   └── gitattributes.txt  # project-root .gitattributes content
 *
 * Upstream's `agents/` (channel runtime) is deliberately NOT vendored (R4),
 * so this reader has no getAllAgents().
 *
 * Unlike the hand-listed upstream index, scripts are discovered by walking
 * the directory: the file set cannot drift from the vendored tree.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readTemplate(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

// Configuration files
export const workflowMdTemplate = readTemplate("workflow.md");
export const configYamlTemplate = readTemplate("config.yaml");
export const gitignoreTemplate = readTemplate("gitignore.txt");
export const gitattributesTemplate = readTemplate("gitattributes.txt");

/**
 * Get all Python workflow scripts as a map of script-relative path to
 * content. Keys are POSIX-style paths relative to `.trellis/scripts/`
 * (e.g. `common/paths.py`), so callers join them under PATHS.SCRIPTS.
 *
 * Only regular files are returned (a stray `__pycache__` from a local
 * template run is skipped).
 */
export function getAllScripts(): Map<string, string> {
  const scripts = new Map<string, string>();
  const root = join(__dirname, "scripts");

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const rel = relative(root, fullPath).split(sep).join("/");
        scripts.set(rel, readFileSync(fullPath, "utf-8"));
      }
    }
  }

  walk(root);
  return new Map([...scripts.entries()].sort());
}
