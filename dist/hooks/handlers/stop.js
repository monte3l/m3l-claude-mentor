/**
 * The Stop hook: closes the current segment so the next task starts with a
 * fresh tip quota. It never prints anything.
 */
import { advanceSegment } from "../../internal/segment.js";
import { loadState, saveState } from "../../internal/store.js";
import { payloadSession } from "../common.js";
/**
 * Handles `Stop`: advances the segment with a task-complete event and saves
 * the state. Always resolves `null`: no context, no decision, no
 * `continue`. An invalid `session_id` makes it a no-op that touches nothing.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { stopHandler } from "./handlers/stop.js";
 * await runHook("Stop", stopHandler);
 * ```
 */
export const stopHandler = async (payload, deps) => {
    if (payloadSession(payload) === null)
        return null;
    const state = await loadState(deps.dir, deps.now);
    const { state: segment } = advanceSegment(state.segment, {
        kind: "task-complete",
        at: deps.now,
    });
    await saveState(deps.dir, { ...state, segment });
    return null;
};
//# sourceMappingURL=stop.js.map