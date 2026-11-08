import type { HookHandler } from "../runtime.js";
/**
 * Handles `SessionStart`. With an invalid `session_id` it resolves `null`
 * and touches nothing. Otherwise it first re-derives the level of every
 * enabled topic that has evidence (also when tips are off, so levels stay
 * right), raising levels only (never lowering one), and writes
 * `profile.json` only when a level is raised. Then it
 * resolves `null` when the learner muted the mentor or the dial is 0, and
 * otherwise returns, as
 * `additionalContext`, a plain-text summary of at most 2,000 chars: a header
 * (`session start`, or `restored after compaction` for source `compact`),
 * the dial, up to 8 below-target topics (touched ones first), up to 5 due
 * reviews, the first 400 chars of the learner's goals, and a pointer to the
 * profile command, all from the updated profile. Muted topics are omitted;
 * evidence content is never included; `state.json` is never written.
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