import type { HookHandler } from "../runtime.js";
/**
 * Handles `UserPromptSubmit`. A no-op (resolving `null`, touching nothing)
 * when the `session_id` is invalid or `prompt` is not a string. Otherwise:
 * applies "stop tips" / "resume tips" / "stop tips about <topic>" (the
 * topic mute list stops at 500) with a user-visible `systemMessage`; advances
 * the segment with the matched topic; asks {@link decideTip} whether a tip
 * is due and records it; saves the state only when it changed. The
 * `additionalContext` joins, in order, a style hint (when a topic matched or
 * the learner said "just tell me"), the tip directive, and a teach-next
 * offer. Resolves `null` when there is nothing to say, and when tips are
 * muted and no notice applies.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { userPromptSubmitHandler } from "./handlers/user-prompt-submit.js";
 * await runHook("UserPromptSubmit", userPromptSubmitHandler);
 * ```
 */
export declare const userPromptSubmitHandler: HookHandler;
//# sourceMappingURL=user-prompt-submit.d.ts.map