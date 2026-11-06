/**
 * The SessionStart hook: gives the model a compact summary of the learner's
 * state at session start and after compaction. It never writes anything.
 */
import { isReviewDue } from "../../internal/mastery.js";
import { levelRank, } from "../../internal/schema.js";
import { loadGoals, loadProfile, loadState } from "../../internal/store.js";
import { payloadField, payloadSession } from "../common.js";
const MAX_SUMMARY_CHARS = 2_000;
const MAX_BELOW_TARGET = 8;
const MAX_REVIEWS = 5;
const MAX_GOALS_CHARS = 400;
const CLOSING_LINE = "Use /m3l-claude-mentor:profile to see or change settings.";
/** Whether the summary follows a compaction (else it is a session start). */
function isCompact(payload) {
    return payloadField(payload, "source") === "compact";
}
/** The first `max` UTF-16 units of `text`, never splitting a surrogate pair. */
function headOf(text, max) {
    if (text.length <= max)
        return text;
    let head = text.slice(0, max);
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff)
        head = head.slice(0, -1);
    return head;
}
/**
 * Up to {@link MAX_BELOW_TARGET} `<id>: <level> (target <target>)` lines for
 * enabled, unmuted topics below target: touched topics (introduced or above
 * Unseen) first, then Unseen ones, each group in catalog order.
 */
function belowTargetLines(entries, profile) {
    const touched = [];
    const untouched = [];
    for (const entry of entries) {
        const topic = Object.hasOwn(profile.topics, entry.id)
            ? profile.topics[entry.id]
            : undefined;
        const level = topic?.level ?? "Unseen";
        if (levelRank(level) >= levelRank(entry.targetLevel))
            continue;
        const line = `${entry.id}: ${level} (target ${entry.targetLevel})`;
        if (topic?.introduced === true || levelRank(level) > 0)
            touched.push(line);
        else
            untouched.push(line);
    }
    return [...touched, ...untouched].slice(0, MAX_BELOW_TARGET);
}
/** Up to {@link MAX_REVIEWS} `review due: <id>` lines, in catalog order. */
function reviewLines(entries, profile, now) {
    const lines = [];
    for (const entry of entries) {
        if (lines.length >= MAX_REVIEWS)
            break;
        const topic = Object.hasOwn(profile.topics, entry.id)
            ? profile.topics[entry.id]
            : undefined;
        if (topic === undefined || topic.lastPassAt === null)
            continue;
        if (isReviewDue(topic.lastPassAt, topic.passes, now)) {
            lines.push(`review due: ${entry.id}`);
        }
    }
    return lines;
}
/**
 * Joins the fixed head, the droppable topic lines and the fixed tail,
 * dropping topic lines from the end until the text fits
 * {@link MAX_SUMMARY_CHARS}, so no line is ever cut.
 */
function fit(head, topics, tail) {
    const kept = [...topics];
    let text = [...head, ...kept, ...tail].join("\n");
    while (text.length > MAX_SUMMARY_CHARS && kept.length > 0) {
        kept.pop();
        text = [...head, ...kept, ...tail].join("\n");
    }
    return text;
}
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
export const sessionStartHandler = async (payload, deps) => {
    if (payloadSession(payload) === null)
        return null;
    const compact = isCompact(payload);
    if (deps.settings.dial === 0)
        return null;
    const state = await loadState(deps.dir, deps.now);
    if (state.muted)
        return null;
    const profile = await loadProfile(deps.dir, deps.now);
    const goals = headOf(await loadGoals(deps.dir), MAX_GOALS_CHARS);
    const muted = new Set(state.mutedTopics);
    const entries = deps.catalog.filter((entry) => entry.enabled && !muted.has(entry.id));
    const below = belowTargetLines(entries, profile);
    const reviews = reviewLines(entries, profile, deps.now);
    const head = [
        `m3l-claude-mentor learner state (${compact ? "restored after compaction" : "session start"})`,
        `tip dial: ${String(deps.settings.dial)} (0 off, 5 most frequent)`,
    ];
    const topics = [
        ...(below.length > 0 ? ["topics below target:", ...below] : []),
        ...reviews,
    ];
    const tail = [
        ...(goals.trim() !== "" ? ["goals:", goals] : []),
        CLOSING_LINE,
    ];
    return {
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: fit(head, topics, tail),
        },
    };
};
//# sourceMappingURL=session-start.js.map