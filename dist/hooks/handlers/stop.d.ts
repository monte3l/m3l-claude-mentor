import type { HookHandler } from "../runtime.js";
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
export declare const stopHandler: HookHandler;
//# sourceMappingURL=stop.d.ts.map