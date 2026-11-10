/**
 * The PostCompact hook: a compaction only refreshes the activity time of the
 * current segment; it never starts a new one. It never prints anything.
 */
import { touchActivity } from "../../internal/segment.js";
import { loadState, saveState } from "../../internal/store.js";
import { payloadSession } from "../common.js";
import type { HookHandler } from "../runtime.js";

/**
 * Handles `PostCompact`: moves the segment's `lastActivityAt` forward to now
 * with {@link touchActivity} (no boundary detection, so the segment, its tip
 * quota and its topic are kept even after an idle gap) and saves the state.
 * Always resolves `null`. An invalid `session_id` makes it a no-op that
 * touches nothing.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { postCompactHandler } from "./handlers/post-compact.js";
 * await runHook("PostCompact", postCompactHandler);
 * ```
 */
export const postCompactHandler: HookHandler = async (payload, deps) => {
  if (payloadSession(payload) === null) return null;
  const state = await loadState(deps.dir, deps.now);
  const segment = touchActivity(state.segment, deps.now);
  await saveState(deps.dir, { ...state, segment });
  return null;
};
