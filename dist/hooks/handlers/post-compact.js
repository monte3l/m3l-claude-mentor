/**
 * The PostCompact hook: a compaction counts as activity in the current
 * segment. It never prints anything.
 */
import { advanceSegment } from "../../internal/segment.js";
import { loadState, saveState } from "../../internal/store.js";
import { payloadSession } from "../common.js";
/**
 * Handles `PostCompact`: advances the segment with an activity event (which
 * may start a new segment after an idle gap) and saves the state. Always
 * resolves `null`. An invalid `session_id` makes it a no-op that touches
 * nothing.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { postCompactHandler } from "./handlers/post-compact.js";
 * await runHook("PostCompact", postCompactHandler);
 * ```
 */
export const postCompactHandler = async (payload, deps) => {
    if (payloadSession(payload) === null)
        return null;
    const state = await loadState(deps.dir, deps.now);
    const { state: segment } = advanceSegment(state.segment, {
        kind: "activity",
        at: deps.now,
    });
    await saveState(deps.dir, { ...state, segment });
    return null;
};
//# sourceMappingURL=post-compact.js.map