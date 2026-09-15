# trellis-tiny Package Contracts

> Executable contracts for the `tiny/` npm package (`tt` CLI). Read this before
> touching `tiny/src/commands/{init,update,uninstall,convergence}.ts`,
> `tiny/src/lib/template-hash.ts`, or anything under `tiny/src/configurators/`.
> Forged in dogfood (M8, 2026-09-14): every "Wrong" below is a bug that actually
> shipped and was caught on this repository.

---

## Scenario: template manifest lifecycle (init → update → uninstall)

### 1. Scope / Trigger

Any change to how files get tracked in `.trellis/.template-hashes.json`
("the manifest"), how `tt update` decides to overwrite/keep/retire, or how
`tt init` claims ownership of pre-existing files.

### 2. Signatures

```ts
// lib/template-hash.ts
loadKnownTemplatePaths(cwd: string): Set<string>   // ownership proof ONLY — never returns hashes
loadHashes(cwd): TemplateHashes                    // v2: { __version: 2, hashes: Record<posixKey, sha256> }
saveHashes(cwd, hashes): void
computeHash(content: string): string               // LF-normalized sha256 — the ONLY hash semantics tiny uses
isDerivedArtifactPath(posixKey: string): boolean   // __pycache__/ · *.pyc · .trellis/.runtime/
stripDerivedEntries(hashes): hashes                // purges derived keys, returns removed count
```

### 3. Contracts

- **Manifest keys are POSIX-relative paths** (`toPosix`-normalized); values are
  `computeHash` digests. `v1` upstream manifests are flat `{path: hash}` with
  **different hash semantics** — never copy their hash values into a v2 manifest.
- **Derived artifacts are never tracked**: `__pycache__/`, `*.pyc`,
  `.trellis/.runtime/**` are excluded at collect time (`EXCLUDE_FROM_HASH`),
  at legacy-manifest adoption time, and again at update-retire time.
- **Ownership adoption** (init over an upstream install): a path present in the
  legacy manifest proves "an installer owns this file" → re-hash the **disk
  bytes with `computeHash`** and record that. Upstream hash values are
  meaningless to tiny (v1 algorithm / CRLF semantics).
- **update classification** (per manifest key): `unchanged` (disk == expected),
  `autoUpdate` (disk == manifest, template moved), `changed` (disk ≠ manifest →
  keep / prompt / `.new`; non-TTY degrades to keep+report), `userDeleted`
  (missing on disk → respect), plus `new` files written directly. Retire
  candidates = manifest keys absent from the new expected set, **filtered
  through `isDerivedArtifactPath`** and the protected prefixes
  (`tasks/`, `workspace/`, `spec/`, `.developer`, `.current-task`,
  `.trellis/.runtime/`).

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| manifest contains `../` or absolute key | reject at `loadHashes` (chokepoint; also guards uninstall/retire `path.join`) |
| manifest contains derived key | stripped on read; update self-heals + reports count (one-time manifest rewrite, does not break AC7 idempotence) |
| update without manifest | `process.exit(1)` |
| uninstall non-TTY without `--yes` | fail-closed `exit(1)` |
| retire path under user data | filtered by protected prefixes — deletion is unreachable |

### 5. Good/Base/Bad Cases

- **Good**: init on upstream repo → manifest v2, all keys re-hashed from disk,
  no `__pycache__`/`.runtime` keys → `tt update` reports "Already up to date",
  twice, byte-identical manifest.
- **Base**: init on clean dir → only tiny-rendered files tracked.
- **Bad (shipped once)**: init adopted upstream hashes verbatim → after a
  template-only edit, update classified 9 untouched files as "locally modified"
  and kept them; template updates could not propagate.

### 6. Tests Required

- `test/commands/update.test.ts` — "never retires or tracks derived/runtime
  artifacts (M8 regression)": pre-seed runtime files + poisoned manifest keys →
  assert files survive, `retired` empty, manifest clean, second run zero-write.
- `test/commands/init.test.ts` — CRLF file + v1 manifest with junk hash →
  init records `computeHash(disk)`; subsequent update classifies the file as
  `autoUpdated`, not `kept`.
- `test/commands/update.test.ts` — AC7: three consecutive updates, zero writes,
  full-tree byte snapshot (manifest included) identical.

### 7. Wrong vs Correct

#### Wrong

```ts
// adopt ownership by copying the legacy hash
previousHashes = loadHashes();          // upstream v1 values
if (previousHashes[key] === computeHash(disk)) claim(key, previousHashes[key]);
```

#### Correct

```ts
// legacy manifest proves ownership; hash is always recomputed
if (loadKnownTemplatePaths(cwd).has(key)) claim(key, computeHash(disk));
```

---

## Contract: neutral skill rendering (single root)

- Skills shared by codex/zcode/dsh render through the **neutral renderer** and
  must be **byte-identical** across all three configurators — they all write
  `.agents/skills/` (zcode no longer writes `.zcode/skills/`; dsh adds 3
  platform-rendered entry skills under `.dsh/skills/`).
- Platform placeholders (`{{CLI_FLAG}}` …) are allowed **only** in
  platform-private roots. Shared-root files use `{{CMD_REF:*}}`-class neutral
  tokens only.
- Guarded by `test/configurators/platforms.test.ts` cross-platform
  byte-equality assertions; changing a renderer without keeping the three
  configurators aligned fails there first.

---

## Contract: convergence list (upstream artifact cleanup)

Rules live in `commands/convergence.ts` as numbered, individually-gated checks:

1. `.zcode/skills/trellis-*` (R2 duplicate root) — 2. `.zcode/cli/agents` —
3. `.trellis/scripts/hooks/linear_sync.py` — 3b. `.agents/skills/trellis-channel/`
— 3c. `.trellis/agents/{implement,check}.md` **content-gated** (deleted only if
matching `/trellis[\s-]?channel/i`) — 3d.
`.agents/skills/trellis-meta/references/local-architecture/multi-agent-channel.md`
(upstream-only filename) — 4. non-target platform dirs (delete only
trellis-named features inside; mixed-ownership files like `.claude/settings.json`
survive).

**Maintenance rules**:

- New entries must be **unambiguously upstream-named** or content-gated; never
  pattern-match generic filenames without a content check.
- `.trellis/tasks/**`, `.trellis/workspace/**`, `.trellis/spec/**` are user
  data — the deletion set can never contain them (spec is add-only).
- Every new entry gets a convergence unit test (pre-seed → init → gone; sibling
  user files → survive) and a `--dry-run` listing.
- `commands/convergence.*` is the **narrowly exempted** path in the AC5 channel
  scan (it must name `trellis-channel` to delete it); no other file may match
  channel markers.

---

## Common Mistake: manifest poisoning chain

**Symptom**: `tt update` deletes files nothing told it to delete ("Retired
templates" list contains `__pycache__` / `.runtime` / session JSONs).

**Cause**: init hashed the whole `.trellis/` tree into the manifest including
derived/runtime files; update then correctly retired "tracked but no longer
expected" keys. Retire was innocent — the manifest was poisoned upstream of it.

**Fix / Prevention**: three independent layers (exclude at collect, strip at
manifest load, filter at retire). If you add a new derived-artifact pattern,
add it to `EXCLUDE_FROM_HASH` **and** `isDerivedArtifactPath` — defense in
depth is the point; each layer has its own test.
