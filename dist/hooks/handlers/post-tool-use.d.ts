import type { HookHandler } from "../runtime.js";
/**
 * Handles `PostToolUse`. A no-op (resolving `null` without touching disk)
 * when the `session_id` is invalid, transcript analysis is off, or the event
 * yields no usage signal for an enabled catalog topic. Otherwise it loads the
 * state and fails closed on project exclusion: when any project is excluded
 * and the payload `cwd` is unknown (`null`) or lies inside an excluded
 * project (lexical path match, symlinks not resolved), it records nothing.
 * Else it appends one positive `observed` event per remaining signal,
 * skipping a topic that already has an `observed` event from the same
 * session among the last 500 events. That per-session rate limit is best
 * effort: parallel `PostToolUse` calls can both pass the check and both
 * append. Always resolves `null`; never recomputes levels or writes state.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { postToolUseHandler } from "./handlers/post-tool-use.js";
 * await runHook("PostToolUse", postToolUseHandler);
 * ```
 */
export declare const postToolUseHandler: HookHandler;
//# sourceMappingURL=post-tool-use.d.ts.map