import type { HookHandler } from "../runtime.js";
/**
 * Handles `SessionStart`: resolves `null` when the `session_id` is invalid,
 * the learner muted the mentor, or the dial is 0. Otherwise returns, as
 * `additionalContext`, a plain-text summary of at most 2,000 chars: a header
 * (`session start`, or `restored after compaction` for source `compact`),
 * the dial, up to 8 below-target topics (touched ones first), up to 5 due
 * reviews, the first 400 chars of the learner's goals, and a pointer to the
 * profile command. Muted topics are omitted; evidence is never included;
 * nothing is written.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { sessionStartHandler } from "./handlers/session-start.js";
 * await runHook("SessionStart", sessionStartHandler);
 * ```
 */
export declare const sessionStartHandler: HookHandler;
//# sourceMappingURL=session-start.d.ts.map