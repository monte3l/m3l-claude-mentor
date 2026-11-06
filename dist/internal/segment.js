/**
 * Minimum time, in milliseconds, between two tips at dial 3 to 5 (15
 * minutes). Lower dials scale it by {@link DIAL_GAP_MULTIPLIER}.
 *
 * @example
 * ```ts
 * import { TIP_MIN_GAP_MS } from "./segment.js";
 * TIP_MIN_GAP_MS / 60_000; // 15
 * ```
 */
export const TIP_MIN_GAP_MS = 900_000;
/**
 * Inactivity, in milliseconds, after which the next activity starts a new
 * segment (30 minutes).
 *
 * @example
 * ```ts
 * import { SEGMENT_IDLE_GAP_MS } from "./segment.js";
 * SEGMENT_IDLE_GAP_MS / 60_000; // 30
 * ```
 */
export const SEGMENT_IDLE_GAP_MS = 1_800_000;
/**
 * Multiplier applied to {@link TIP_MIN_GAP_MS} for each non-zero dial
 * setting: a quieter dial waits longer between tips.
 *
 * @example
 * ```ts
 * import { DIAL_GAP_MULTIPLIER, TIP_MIN_GAP_MS } from "./segment.js";
 * TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[1]; // 3_600_000 (one hour)
 * ```
 */
export const DIAL_GAP_MULTIPLIER = Object.freeze({ 1: 4, 2: 2, 3: 1, 4: 1, 5: 1 });
function checkTimestamp(name, value) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite, non-negative number`);
    }
}
function checkCount(name, value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer`);
    }
}
function checkDial(value) {
    switch (value) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
            return value;
        default:
            throw new RangeError("dial must be an integer from 0 to 5");
    }
}
/**
 * Creates the first segment, starting at `now`, with no tip history.
 *
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @returns A state with id 0 and `startedAt = lastActivityAt = now`.
 * @throws RangeError when `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { newSegment } from "./segment.js";
 * newSegment(1_000).segmentId; // 0
 * ```
 */
export function newSegment(now) {
    checkTimestamp("now", now);
    return {
        segmentId: 0,
        startedAt: now,
        lastActivityAt: now,
        tipsEmitted: 0,
        lastTipAt: null,
        lastTopic: null,
    };
}
function startNext(segmentId, lastTipAt, at, lastTopic) {
    return {
        segmentId: segmentId + 1,
        startedAt: at,
        lastActivityAt: at,
        tipsEmitted: 0,
        lastTipAt,
        lastTopic,
    };
}
/**
 * Feeds one event into the segment tracker. In precedence order: a clock
 * that went backwards is clamped to `lastActivityAt`; `task-complete` starts
 * a new segment; activity after an idle gap of at least
 * {@link SEGMENT_IDLE_GAP_MS} starts one (`time-gap`); activity on a topic
 * different from a known `lastTopic` starts one (`topic-change`); otherwise
 * the segment continues. A new segment resets `tipsEmitted` but keeps
 * `lastTipAt`. The input state is never mutated.
 *
 * The backwards-clock clamp fails quiet: after a large backwards jump, later
 * events clamp to the old `lastActivityAt`, so the `time-gap` boundary cannot
 * fire until the clock catches up, while {@link decideTip} uses the raw `now`.
 *
 * @param state - The current segment state. It must come from the store
 * parser or from this module's functions: only `segmentId` is validated here,
 * so a malformed field such as a NaN `lastActivityAt` is stored unchanged.
 * @param event - The observed event.
 * @returns The next state and the boundary crossed (`"none"` if none).
 * @throws RangeError when `state.segmentId` is not a non-negative integer, or
 * `event.at` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { advanceSegment, newSegment } from "./segment.js";
 * const r = advanceSegment(newSegment(0), { kind: "task-complete", at: 60_000 });
 * r.boundary; // "task-complete"
 * r.state.segmentId; // 1
 * ```
 */
export function advanceSegment(state, event) {
    const segmentId = state.segmentId;
    const startedAt = state.startedAt;
    const tipsEmitted = state.tipsEmitted;
    const lastActivityAt = state.lastActivityAt;
    const lastTipAt = state.lastTipAt;
    const lastTopic = state.lastTopic;
    const rawAt = event.at;
    checkCount("state.segmentId", segmentId);
    checkTimestamp("event.at", rawAt);
    const at = Math.max(rawAt, lastActivityAt);
    if (event.kind === "task-complete") {
        return {
            state: startNext(segmentId, lastTipAt, at, null),
            boundary: "task-complete",
        };
    }
    const topic = event.topic ?? null;
    if (at - lastActivityAt >= SEGMENT_IDLE_GAP_MS) {
        return {
            state: startNext(segmentId, lastTipAt, at, topic),
            boundary: "time-gap",
        };
    }
    if (topic !== null && lastTopic !== null && topic !== lastTopic) {
        return {
            state: startNext(segmentId, lastTipAt, at, topic),
            boundary: "topic-change",
        };
    }
    return {
        state: {
            segmentId,
            startedAt,
            lastActivityAt: at,
            tipsEmitted,
            lastTipAt,
            lastTopic: topic ?? lastTopic,
        },
        boundary: "none",
    };
}
/**
 * Records that a tip was emitted at `now`: increments `tipsEmitted` and sets
 * `lastTipAt`, leaving `lastActivityAt` unchanged. A `now` earlier than
 * `lastActivityAt` is accepted as given. The input state is never mutated.
 *
 * @param state - The current segment state. It must come from the store
 * parser or from this module's functions: only `tipsEmitted` is validated
 * here, so a malformed field such as a NaN `lastActivityAt` is stored
 * unchanged.
 * @param now - Timestamp of the tip in milliseconds; finite and non-negative.
 * @returns The next state.
 * @throws RangeError when `state.tipsEmitted` is not a non-negative integer,
 * or `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { newSegment, recordTip } from "./segment.js";
 * recordTip(newSegment(0), 1_000).lastTipAt; // 1_000
 * ```
 */
export function recordTip(state, now) {
    const { segmentId, startedAt, lastActivityAt, tipsEmitted, lastTopic } = state;
    checkCount("state.tipsEmitted", tipsEmitted);
    checkTimestamp("now", now);
    return {
        segmentId,
        startedAt,
        lastActivityAt,
        tipsEmitted: tipsEmitted + 1,
        lastTipAt: now,
        lastTopic,
    };
}
/**
 * Decides whether to emit a tip now. Checks run in this order and the first
 * failure is the reported reason: `dial-off` (dial 0), `muted`, `busy`,
 * `no-related-topic`, `topic-muted`, `at-target` (related topic not below
 * target), `segment-quota` (a tip was already emitted this segment), and
 * `min-gap` (less than `TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[dial]` since the
 * last tip; a gap exactly equal to the threshold passes). Only `dial` and
 * `now` are validated, and they are validated before any check, so an error
 * in either is never masked by a skip. A malformed `state` (for example a NaN
 * `tipsEmitted` or `lastTipAt`) is not detected here. Pure: it never records
 * the tip; call {@link recordTip} for that.
 *
 * @param input - The gate inputs. `input.state` must come from the store
 * parser or from this module's functions, because its fields are not
 * validated here (a NaN `lastTipAt`, for example, is used unchanged).
 * @returns `{ emit: true, topic }` or `{ emit: false, reason }`.
 * @throws RangeError when `dial` is not an integer from 0 to 5, or `now` is
 * non-finite or negative.
 *
 * @example
 * ```ts
 * import { decideTip, newSegment, recordTip } from "./segment.js";
 * import { parseTopicId } from "./schema.js";
 * const p = parseTopicId("plan-mode");
 * if (p.ok) {
 *   let state = newSegment(0);
 *   const d = decideTip({
 *     state,
 *     now: 60_000,
 *     dial: 3,
 *     muted: false,
 *     busy: false,
 *     related: { id: p.value, belowTarget: true },
 *     topicMuted: false,
 *   });
 *   if (d.emit) state = recordTip(state, 60_000);
 * }
 * ```
 */
export function decideTip(input) {
    const dial = checkDial(input.dial);
    const now = input.now;
    checkTimestamp("now", now);
    const related = input.related;
    const state = input.state;
    const tipsEmitted = state.tipsEmitted;
    const lastTipAt = state.lastTipAt;
    if (dial === 0)
        return { emit: false, reason: "dial-off" };
    if (input.muted)
        return { emit: false, reason: "muted" };
    if (input.busy)
        return { emit: false, reason: "busy" };
    if (related === null)
        return { emit: false, reason: "no-related-topic" };
    if (input.topicMuted)
        return { emit: false, reason: "topic-muted" };
    if (!related.belowTarget)
        return { emit: false, reason: "at-target" };
    if (tipsEmitted >= 1)
        return { emit: false, reason: "segment-quota" };
    if (lastTipAt !== null &&
        now - lastTipAt < TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[dial]) {
        return { emit: false, reason: "min-gap" };
    }
    return { emit: true, topic: related.id };
}
//# sourceMappingURL=segment.js.map