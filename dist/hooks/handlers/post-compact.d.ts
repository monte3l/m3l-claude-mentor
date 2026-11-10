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
export declare const postCompactHandler: HookHandler;
//# sourceMappingURL=post-compact.d.ts.map