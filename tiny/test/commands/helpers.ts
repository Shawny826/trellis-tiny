/**
 * Shared fixtures for command tests: isolated temp projects with chdir +
 * python-probe bypass, plus a byte-level project snapshot helper.
 *
 * Exec-bit note (Windows portability): tests assert recorded/write-state
 * semantics (file presence, content, manifest keys) — never real POSIX
 * modes, since chmod is a no-op on win32.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalCwd = process.cwd();

export interface TempProject {
  dir: string;
  /** Absolute path builder from a POSIX relative path. */
  p: (...segments: string[]) => string;
  /** Recursive file walk returning POSIX-relative paths, sorted. */
  files: () => string[];
  /** Byte-level snapshot: POSIX relPath → content. */
  snapshot: () => Record<string, string>;
  write: (relativePath: string, content: string) => void;
  exists: (relativePath: string) => boolean;
  read: (relativePath: string) => string;
}

/** Create a fresh temp project and chdir into it. */
export function useTempProject(prefix: string): TempProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  process.env.TRELLIS_SKIP_PYTHON_CHECK = "1";
  process.chdir(dir);

  const p = (...segments: string[]): string =>
    path.join(dir, ...segments.join("/").split("/"));

  const files = (): string[] => {
    const out: string[] = [];
    const walk = (abs: string): void => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          out.push(path.relative(dir, full).split(path.sep).join("/"));
        }
      }
    };
    walk(dir);
    return out.sort();
  };

  const snapshot = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const rel of files()) map[rel] = fs.readFileSync(p(rel), "utf-8");
    return map;
  };

  return {
    dir,
    p,
    files,
    snapshot,
    write: (relativePath, content) => {
      fs.mkdirSync(path.dirname(p(relativePath)), { recursive: true });
      fs.writeFileSync(p(relativePath), content);
    },
    exists: (relativePath) => fs.existsSync(p(relativePath)),
    read: (relativePath) => fs.readFileSync(p(relativePath), "utf-8"),
  };
}

/** chdir back to the original cwd and remove a temp project. */
export function cleanupTempProject(project: TempProject): void {
  process.chdir(originalCwd);
  fs.rmSync(project.dir, { recursive: true, force: true });
  delete process.env.TRELLIS_SKIP_PYTHON_CHECK;
}
