import type { HookHandler } from "../runtime.js";
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
export declare const postCompactHandler: HookHandler;
//# sourceMappingURL=post-compact.d.ts.map