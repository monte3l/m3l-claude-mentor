/**
 * Feature-usage signals read from a Claude Code `PostToolUse` hook payload.
 *
 * Pure: no I/O, no environment, no clock. The extractor reads only the
 * payload's own `tool_name` and `tool_input` fields (never `tool_response`,
 * which may carry file contents or secrets) and builds its output solely from
 * the fixed allowlist below, so no substring of the payload is ever returned.
 */
import { type Evidence, type SessionId, type TopicId } from "./schema.js";
/**
 * Every kind of feature usage the extractor can report, frozen.
 *
 * @example
 * ```ts
 * import { USAGE_KINDS } from "./signals.js";
 * USAGE_KINDS.includes("invoked-skill"); // true
 * ```
 */
export declare const USAGE_KINDS: readonly [
    "created-skill",
    "wrote-agent",
    "wrote-command",
    "wrote-output-style",
    "edited-claude-md",
    "edited-settings",
    "configured-hook",
    "edited-mcp-config",
    "edited-plugin-manifest",
    "added-mcp-server",
    "used-worktree",
    "used-plugin-cli",
    "invoked-skill",
    "dispatched-subagent",
    "used-plan-mode"
];
/**
 * One kind of feature usage, a member of {@link USAGE_KINDS}.
 *
 * @example
 * ```ts
 * import type { UsageKind } from "./signals.js";
 * const k: UsageKind = "used-plan-mode";
 * ```
 */
export type UsageKind = (typeof USAGE_KINDS)[number];
/**
 * One observed use of a Claude Code feature: the catalog topic it exercises
 * and the kind of use.
 *
 * @example
 * ```ts
 * import { extractUsageSignals, type UsageSignal } from "./signals.js";
 * const [s]: readonly UsageSignal[] = extractUsageSignals({
 *   tool_name: "Skill",
 *   tool_input: {},
 * });
 * s?.topic; // "skills"
 * ```
 */
export interface UsageSignal {
    readonly topic: TopicId;
    readonly kind: UsageKind;
}
/**
 * The most signals {@link extractUsageSignals} returns for one event.
 *
 * @example
 * ```ts
 * import { MAX_SIGNALS_PER_EVENT } from "./signals.js";
 * MAX_SIGNALS_PER_EVENT; // 4
 * ```
 */
export declare const MAX_SIGNALS_PER_EVENT = 4;
/**
 * Extracts feature-usage signals from a `PostToolUse` hook payload.
 *
 * Reads only the payload's own `tool_name` (a string) and `tool_input` (an
 * object); a payload missing either, or holding the wrong type, yields `[]`.
 * Path fields are compared on their forward-slash form, case-sensitively;
 * only the first 2,000 chars of a Bash `command` and the first 100,000 chars
 * of `content`/`new_string` are inspected. The result is deduplicated by
 * topic and kind, in table order, and capped at
 * {@link MAX_SIGNALS_PER_EVENT}. Never throws on JSON-plain input, and never
 * returns any text from the payload: only fixed topics and kinds.
 *
 * @example
 * ```ts
 * import { extractUsageSignals } from "./signals.js";
 * extractUsageSignals({
 *   tool_name: "Bash",
 *   tool_input: { command: "claude mcp add docs" },
 * }); // [{ topic: "mcp", kind: "added-mcp-server" }]
 * ```
 */
export declare function extractUsageSignals(payload: unknown): readonly UsageSignal[];
/**
 * Turns a usage signal into positive `observed` evidence for its topic.
 *
 * @throws RangeError when `at` is not finite or is negative (the same check
 * `parseEvidence` makes).
 *
 * @example
 * ```ts
 * import { parseSessionId } from "./schema.js";
 * import { extractUsageSignals, signalToEvidence } from "./signals.js";
 * const session = parseSessionId("sess_1");
 * const [s] = extractUsageSignals({ tool_name: "Skill", tool_input: {} });
 * if (session.ok && s !== undefined) {
 *   signalToEvidence(s, session.value, Date.now()).channel; // "observed"
 * }
 * ```
 */
export declare function signalToEvidence(usage: UsageSignal, session: SessionId, at: number): Evidence;
//# sourceMappingURL=signals.d.ts.map