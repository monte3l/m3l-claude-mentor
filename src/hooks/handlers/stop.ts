/**
 * The Stop hook: a finished turn only refreshes the activity time of the
 * current segment. Claude Code gives no reliable "task complete" signal and
 * fires Stop after every turn, and a long agent turn is not learner idle
 * time, so Stop never closes a segment: segments end on a topic change or an
 * idle gap seen by the next prompt, and task completion is not detected. It
 * never prints anything.
 */
import { touchActivity } from "../../internal/segment.js";
import { loadState, saveState } from "../../internal/store.js";
import { payloadSession } from "../common.js";
import type { HookHandler } from "../runtime.js";

/**
 * Handles `Stop`: moves the segment's `lastActivityAt` forward to now with
 * {@link touchActivity} (no boundary detection, so the segment, its tip
 * quota and its topic are kept even after a long turn) and saves the state.
 * Always resolves `null`: no context, no decision, no `continue`. An invalid
 * `session_id` makes it a no-op that touches nothing.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { stopHandler } from "./handlers/stop.js";
 * await runHook("Stop", stopHandler);
 * ```
 */
export const stopHandler: HookHandler = async (payload, deps) => {
  if (payloadSession(payload) === null) return null;
  const state = await loadState(deps.dir, deps.now);
  const segment = touchActivity(state.segment, deps.now);
  await saveState(deps.dir, { ...state, segment });
  return null;
};
