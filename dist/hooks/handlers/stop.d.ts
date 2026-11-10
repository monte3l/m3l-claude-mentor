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
export declare const stopHandler: HookHandler;
//# sourceMappingURL=stop.d.ts.map