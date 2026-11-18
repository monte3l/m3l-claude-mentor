/**
 * The PostCompact hook: a compaction only refreshes the activity time of the
 * current segment; it never starts a new one. It never prints anything.
 */
import { touchActivity } from "../../internal/segment.ts";
import { withStateLock } from "../../internal/lock.ts";
import { loadState, saveState } from "../../internal/store.ts";
import { payloadSession } from "../common.ts";
import type { HookHandler } from "../runtime.ts";

/**
 * Handles `PostCompact`: moves the segment's `lastActivityAt` forward to now
 * with {@link touchActivity} (no boundary detection, so the segment, its tip
 * quota and its topic are kept even after an idle gap) and saves the state.
 * Always resolves `null`. An invalid `session_id` makes it a no-op that
 * touches nothing. The load and save run under the data lock
 * (`withStateLock`); a lock timeout propagates, so the runtime writes one
 * `LOCK_TIMEOUT` stderr line and nothing is saved.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.ts";
 * import { postCompactHandler } from "./handlers/post-compact.ts";
 * await runHook("PostCompact", postCompactHandler);
 * ```
 */
export const postCompactHandler: HookHandler = async (payload, deps) => {
  if (payloadSession(payload) === null) return null;
  await withStateLock(
    deps.dir,
    async () => {
      const state = await loadState(deps.dir, deps.now);
      const segment = touchActivity(state.segment, deps.now);
      await saveState(deps.dir, { ...state, segment });
    },
    deps.lockOptions,
  );
  return null;
};
