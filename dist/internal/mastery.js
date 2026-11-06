import { CHANNELS, } from "./schema.js";
/**
 * Default per-channel weights used by {@link topicScore}. Self-report carries
 * the smallest weight, which caps what it can contribute.
 *
 * @example
 * ```ts
 * import { DEFAULT_WEIGHTS } from "./mastery.js";
 * DEFAULT_WEIGHTS.observed; // 0.4
 * ```
 */
export const DEFAULT_WEIGHTS = Object.freeze({
    observed: 0.4,
    "explain-back": 0.3,
    quiz: 0.2,
    "self-report": 0.1,
});
/**
 * How much more a negative event weighs than a positive one of the same age.
 *
 * @example
 * ```ts
 * import { NEGATIVE_MULTIPLIER } from "./mastery.js";
 * NEGATIVE_MULTIPLIER; // 1.5
 * ```
 */
export const NEGATIVE_MULTIPLIER = 1.5;
/**
 * Default recency half-life, in days.
 *
 * @example
 * ```ts
 * import { DEFAULT_HALF_LIFE_DAYS } from "./mastery.js";
 * DEFAULT_HALF_LIFE_DAYS; // 30
 * ```
 */
export const DEFAULT_HALF_LIFE_DAYS = 30;
/**
 * The minimum dimension score that counts as satisfied.
 *
 * @example
 * ```ts
 * import { DIMENSION_THRESHOLD } from "./mastery.js";
 * DIMENSION_THRESHOLD; // 0.5
 * ```
 */
export const DIMENSION_THRESHOLD = 0.5;
/**
 * Default number of distinct sessions required for `Fluent`.
 *
 * @example
 * ```ts
 * import { FLUENCY_SESSIONS } from "./mastery.js";
 * FLUENCY_SESSIONS; // 3
 * ```
 */
export const FLUENCY_SESSIONS = 3;
/**
 * One day in milliseconds.
 *
 * @example
 * ```ts
 * import { DAY_MS } from "./mastery.js";
 * const week = 7 * DAY_MS;
 * ```
 */
export const DAY_MS = 86_400_000;
// One day, derived from DAY_MS rather than a second copy of its literal.
const FLUENCY_SPAN_DAYS = 1;
/**
 * Minimum span, in milliseconds, between the earliest and latest positive
 * evidence required for `Fluent` (one day).
 *
 * @example
 * ```ts
 * import { FLUENCY_SPAN_MS } from "./mastery.js";
 * FLUENCY_SPAN_MS; // 86_400_000
 * ```
 */
export const FLUENCY_SPAN_MS = FLUENCY_SPAN_DAYS * DAY_MS;
// The single source of the dimension <-> channel mapping; CHANNEL_DIMENSION is
// derived from it so the two directions cannot drift apart.
const DIMENSION_CHANNEL = {
    apply: "observed",
    understand: "explain-back",
    recall: "quiz",
};
/**
 * The dimension each channel measures; self-report measures none.
 *
 * @example
 * ```ts
 * import { CHANNEL_DIMENSION } from "./mastery.js";
 * CHANNEL_DIMENSION.quiz; // "recall"
 * CHANNEL_DIMENSION["self-report"]; // null
 * ```
 */
export const CHANNEL_DIMENSION = Object.freeze({
    [DIMENSION_CHANNEL.apply]: "apply",
    [DIMENSION_CHANNEL.understand]: "understand",
    [DIMENSION_CHANNEL.recall]: "recall",
    "self-report": null,
});
/**
 * Review spacing, in days, indexed by the number of passes so far (capped at
 * the last entry).
 *
 * @example
 * ```ts
 * import { REVIEW_INTERVAL_DAYS } from "./mastery.js";
 * REVIEW_INTERVAL_DAYS[0]; // 1
 * ```
 */
export const REVIEW_INTERVAL_DAYS = Object.freeze([
    1, 3, 7, 14, 30,
]);
const MAX_EVENTS = 10_000;
const LONGEST_INTERVAL_DAYS = Math.max(...REVIEW_INTERVAL_DAYS);
/**
 * Throws a `RangeError` naming `name` when `value` is not finite. Shared so
 * every module reports this caller error with the same message.
 *
 * @example
 * ```ts
 * import { checkFinite } from "./mastery.js";
 * checkFinite("changedAt", changedAt);
 * ```
 */
export function checkFinite(name, value) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${name} must be a finite number`);
    }
}
/**
 * Throws a `RangeError` naming `name` unless `value` is an integer from 0 to
 * `Number.MAX_SAFE_INTEGER`. Shared so every module reports this caller error
 * with the same message.
 *
 * @example
 * ```ts
 * import { checkCount } from "./mastery.js";
 * checkCount("passes", passes);
 * ```
 */
export function checkCount(name, value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be an integer from 0 to Number.MAX_SAFE_INTEGER`);
    }
}
function resolveHalfLife(halfLifeDays) {
    const resolved = halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
    if (!Number.isFinite(resolved) || resolved <= 0) {
        throw new RangeError("halfLifeDays must be a finite number greater than 0");
    }
    // Every caller scales by DAY_MS; an Infinity product would turn the
    // first-match rescale in scoreChannel into Infinity / Infinity = NaN.
    if (!Number.isFinite(resolved * DAY_MS)) {
        throw new RangeError("halfLifeDays is too large to express in milliseconds");
    }
    return resolved;
}
// The shared, eager caller-error check every scoring entry point runs, even
// for an empty `events`. Messages name the argument, never event contents.
function validateCall(events, now, halfLifeDays) {
    checkFinite("now", now);
    const halfLife = resolveHalfLife(halfLifeDays);
    if (events.length > MAX_EVENTS) {
        throw new RangeError(`events must hold at most ${String(MAX_EVENTS)} items`);
    }
    const first = events[0];
    if (first !== undefined) {
        const topic = first.topic;
        for (const event of events) {
            if (event.topic !== topic) {
                throw new RangeError("events must all share one topic");
            }
        }
    }
    return halfLife;
}
// Unchecked core of channelScore, in one pass over `events`. Weights are
// relative to the newest matching event (capped at `now`), so that event
// always weighs 1 (or NEGATIVE_MULTIPLIER) and the weighted mean is never 0/0.
// When a newer event appears, the running sums are re-anchored to it. The
// confidence count `neff` decays with each event's absolute age instead.
function scoreChannel(events, channel, now, halfLife) {
    const halfLifeMs = halfLife * DAY_MS;
    let newest = -Infinity;
    let signed = 0;
    let total = 0;
    let neff = 0;
    for (const event of events) {
        if (event.channel !== channel)
            continue;
        const at = Math.min(event.at, now);
        neff += 0.5 ** ((now - at) / halfLifeMs);
        if (at > newest) {
            // On the first match `newest` is -Infinity and resolveHalfLife keeps
            // halfLifeMs finite, so the exponent is +Infinity and the rescale is 0,
            // which leaves the still-zero sums at 0.
            const rescale = 0.5 ** ((at - newest) / halfLifeMs);
            signed *= rescale;
            total *= rescale;
            newest = at;
        }
        const relative = 0.5 ** ((newest - at) / halfLifeMs);
        if (event.result === "positive") {
            signed += relative;
            total += relative;
        }
        else {
            const weight = relative * NEGATIVE_MULTIPLIER;
            signed -= weight;
            total += weight;
        }
    }
    if (newest === -Infinity)
        return 0;
    return (signed / total) * (neff / (neff + 2));
}
/**
 * The recency weight of an event `ageMs` old: `0.5 ** (age / halfLife)`.
 * A negative age (clock skew) is treated as 0 and yields 1.
 *
 * @param ageMs - Event age in milliseconds; must be finite.
 * @param halfLifeDays - Half-life in days; finite and greater than 0.
 * @throws RangeError when `ageMs` is not finite or `halfLifeDays` is invalid.
 *
 * @example
 * ```ts
 * import { DAY_MS, recencyFactor } from "./mastery.js";
 * recencyFactor(30 * DAY_MS); // 0.5
 * ```
 */
export function recencyFactor(ageMs, halfLifeDays) {
    checkFinite("ageMs", ageMs);
    const halfLife = resolveHalfLife(halfLifeDays);
    return 0.5 ** (Math.max(ageMs, 0) / (halfLife * DAY_MS));
}
/**
 * How much `count` events can be trusted: `count / (count + 2)`.
 *
 * @throws RangeError when `count` is not an integer from 0 to
 *   `Number.MAX_SAFE_INTEGER`.
 *
 * @example
 * ```ts
 * import { confidenceFactor } from "./mastery.js";
 * confidenceFactor(3); // 0.6
 * ```
 */
export function confidenceFactor(count) {
    checkCount("count", count);
    return count / (count + 2);
}
/**
 * Scores one channel; the result lies in the closed interval -1..1 and is
 * continuous in the event ages. It is the signed weighted mean of the events
 * on that channel, each weighted by its recency relative to the newest such
 * event (negatives also by {@link NEGATIVE_MULTIPLIER}), scaled by
 * `neff / (neff + 2)`, where `neff` sums each event's
 * {@link recencyFactor} against `now`, so uniformly old evidence fades.
 * No matching events score 0.
 *
 * @param events - Evidence about a single topic; at most `MAX_EVENTS` items.
 * @param now - The current time in epoch milliseconds; events after it count as age 0.
 * @throws RangeError when `now` or `halfLifeDays` is invalid, `events` is too
 *   long, or the events span more than one topic.
 *
 * @example
 * ```ts
 * import { channelScore } from "./mastery.js";
 * const score = channelScore(events, "quiz", Date.now());
 * ```
 */
export function channelScore(events, channel, now, options) {
    const halfLife = validateCall(events, now, options?.halfLifeDays);
    return scoreChannel(events, channel, now, halfLife);
}
/**
 * Scores a dimension as the {@link channelScore} of the channel mapped to it
 * by {@link CHANNEL_DIMENSION}.
 *
 * @throws RangeError under the same conditions as {@link channelScore}.
 *
 * @example
 * ```ts
 * import { dimensionScore } from "./mastery.js";
 * const recall = dimensionScore(events, "recall", Date.now());
 * ```
 */
export function dimensionScore(events, dimension, now, options) {
    const halfLife = validateCall(events, now, options?.halfLifeDays);
    return scoreChannel(events, DIMENSION_CHANNEL[dimension], now, halfLife);
}
/**
 * Whether a dimension score reaches {@link DIMENSION_THRESHOLD}.
 *
 * @example
 * ```ts
 * import { isSatisfied } from "./mastery.js";
 * isSatisfied(0.5); // true
 * ```
 */
export function isSatisfied(score) {
    return score >= DIMENSION_THRESHOLD;
}
function resolveWeights(weights) {
    const source = weights ?? DEFAULT_WEIGHTS;
    const pairs = [];
    let sum = 0;
    for (const channel of CHANNELS) {
        const weight = Object.hasOwn(source, channel)
            ? source[channel]
            : undefined;
        if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
            throw new RangeError(`weights.${channel} must be a finite number >= 0`);
        }
        pairs.push([channel, weight]);
        sum += weight;
    }
    if (!Number.isFinite(sum) || sum <= 0) {
        throw new RangeError("weights must have a finite sum greater than 0");
    }
    return { pairs, sum };
}
/**
 * The weighted mean of the four channel scores, using `weights` (default
 * {@link DEFAULT_WEIGHTS}).
 *
 * @throws RangeError under the same conditions as {@link channelScore}, or
 *   when a weight is missing, not finite or negative, or the weights do
 *   not have a finite sum greater than 0.
 *
 * @example
 * ```ts
 * import { topicScore } from "./mastery.js";
 * const overall = topicScore(events, Date.now());
 * ```
 */
export function topicScore(events, now, options) {
    const halfLifeDays = options?.halfLifeDays;
    const weights = options?.weights;
    const halfLife = validateCall(events, now, halfLifeDays);
    const { pairs, sum } = resolveWeights(weights);
    let weighted = 0;
    for (const [channel, weight] of pairs) {
        if (weight > 0) {
            weighted += weight * scoreChannel(events, channel, now, halfLife);
        }
    }
    return weighted / sum;
}
/**
 * The review interval after `passes` successful reviews, in milliseconds.
 *
 * @throws RangeError when `passes` is not an integer from 0 to
 *   `Number.MAX_SAFE_INTEGER`.
 *
 * @example
 * ```ts
 * import { reviewIntervalMs } from "./mastery.js";
 * reviewIntervalMs(2); // 7 days in ms
 * ```
 */
export function reviewIntervalMs(passes) {
    checkCount("passes", passes);
    const index = Math.min(passes, REVIEW_INTERVAL_DAYS.length - 1);
    return (REVIEW_INTERVAL_DAYS[index] ?? LONGEST_INTERVAL_DAYS) * DAY_MS;
}
/**
 * Whether a review is due: at least {@link reviewIntervalMs} has elapsed
 * since the last pass.
 *
 * @throws RangeError when `lastPassAt` or `now` is not finite, or `passes`
 *   is invalid.
 *
 * @example
 * ```ts
 * import { isReviewDue } from "./mastery.js";
 * const due = isReviewDue(lastPassAt, 2, Date.now());
 * ```
 */
export function isReviewDue(lastPassAt, passes, now) {
    checkFinite("lastPassAt", lastPassAt);
    checkFinite("now", now);
    return now - lastPassAt >= reviewIntervalMs(passes);
}
//# sourceMappingURL=mastery.js.map