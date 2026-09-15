/**
 * Canonical task.json shape — single source of truth shared by all TS
 * writers. The canonical types and factory live in the local task library
 * (`src/lib/task`); this module re-exports them under the legacy
 * `TaskJson` / `emptyTaskJson` names for CLI call sites.
 *
 * New code should prefer `TrellisTaskRecord` / `emptyTaskRecord` from
 * `../lib/task/index.js` directly.
 */

import {
  emptyTaskRecord,
  type TrellisTaskRecord,
} from "../lib/task/index.js";

export type TaskJson = TrellisTaskRecord;

export const emptyTaskJson = emptyTaskRecord;
