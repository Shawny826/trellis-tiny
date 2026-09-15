/**
 * AC5: no channel code paths anywhere in trellis-tiny.
 *
 * - No substantive channel markers in tiny/src (source + vendored templates)
 *   or tiny/dist (compiled output + copied templates). The marker set and
 *   the "generic English 'channel' is allowed" exemption policy follow the
 *   existing templates.test judgment.
 * - The CLI entry registers no `channel` subcommand.
 *
 * The dist scan only runs when dist exists (run `pnpm -C tiny build` first);
 * otherwise that assertion is skipped as no-compile-needed.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(testDir, "..");
const srcDir = path.join(packageDir, "src");
const distDir = path.join(packageDir, "dist");

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

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
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

/**
 * Files that legitimately carry substantive markers: `commands/convergence`
 * is the REMOVAL machinery for the upstream channel artifacts — it must name
 * `.agents/skills/trellis-channel` and the channel agent markers to detect
 * and delete them (D5/R4). It contains no channel code path. The predicate
 * covers every build artifact of that one module (src .ts, dist .js/.d.ts);
 * keep it to that module only — anything else matching a marker is a
 * regression.
 */
function isConvergenceModule(file: string): boolean {
  const normalized = file.split(path.sep).join("/");
  return /\/commands\/convergence\.(ts|js|d\.ts)$/.test(normalized);
}

interface Offender {
  file: string;
  marker: string;
}

function findChannelMarkers(rootDir: string): Offender[] {
  const offenders: Offender[] = [];
  for (const file of walkFiles(rootDir)) {
    if (isConvergenceModule(file)) continue;
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue; // unreadable/binary — not a channel code path
    }
    const haystack = content.toLowerCase();
    for (const marker of CHANNEL_MARKERS) {
      if (haystack.includes(marker.toLowerCase())) {
        offenders.push({
          file: path.relative(packageDir, file),
          marker,
        });
      }
    }
  }
  return offenders;
}

describe("AC5: channel system removal", () => {
  it("has no substantive channel markers anywhere in tiny/src", () => {
    expect(findChannelMarkers(srcDir)).toEqual([]);
  });

  it.skipIf(!fs.existsSync(distDir))(
    "has no substantive channel markers anywhere in tiny/dist (run the build first; skipped because dist is absent)",
    () => {
      expect(findChannelMarkers(distDir)).toEqual([]);
    },
  );

  it("registers no channel subcommand in the CLI entry", () => {
    const entryFiles = [
      path.join(srcDir, "cli", "index.ts"),
      ...(fs.existsSync(path.join(distDir, "cli", "index.js"))
        ? [path.join(distDir, "cli", "index.js")]
        : []),
    ];
    expect(entryFiles.length).toBeGreaterThanOrEqual(1);
    for (const file of entryFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content.includes("registerChannelCommand"), `${file}`).toBe(false);
      expect(content.includes(`command("channel")`), `${file}`).toBe(false);
    }
  });
});
