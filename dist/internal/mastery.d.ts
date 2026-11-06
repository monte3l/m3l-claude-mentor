import { type Channel, type Dimension, type Evidence } from "./schema.js";
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
export declare const DEFAULT_WEIGHTS: Readonly<Record<Channel, number>>;
/**
 * How much more a negative event weighs than a positive one of the same age.
 *
 * @example
 * ```ts
 * import { NEGATIVE_MULTIPLIER } from "./mastery.js";
 * NEGATIVE_MULTIPLIER; // 1.5
 * ```
 */
export declare const NEGATIVE_MULTIPLIER = 1.5;
/**
 * Default recency half-life, in days.
 *
 * @example
 * ```ts
 * import { DEFAULT_HALF_LIFE_DAYS } from "./mastery.js";
 * DEFAULT_HALF_LIFE_DAYS; // 30
 * ```
 */
export declare const DEFAULT_HALF_LIFE_DAYS = 30;
/**
 * The minimum dimension score that counts as satisfied.
 *
 * @example
 * ```ts
 * import { DIMENSION_THRESHOLD } from "./mastery.js";
 * DIMENSION_THRESHOLD; // 0.5
 * ```
 */
export declare const DIMENSION_THRESHOLD = 0.5;
/**
 * Default number of distinct sessions required for `Fluent`.
 *
 * @example
 * ```ts
 * import { FLUENCY_SESSIONS } from "./mastery.js";
 * FLUENCY_SESSIONS; // 3
 * ```
 */
export declare const FLUENCY_SESSIONS = 3;
/**
 * One day in milliseconds.
 *
 * @example
 * ```ts
 * import { DAY_MS } from "./mastery.js";
 * const week = 7 * DAY_MS;
 * ```
 */
export declare const DAY_MS = 86400000;
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
export declare const FLUENCY_SPAN_MS: number;
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
export declare const CHANNEL_DIMENSION: Readonly<Record<Channel, Dimension | null>>;
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
export declare const REVIEW_INTERVAL_DAYS: readonly [1, 3, 7, 14, 30];
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
export declare function checkFinite(name: string, value: number): void;
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
export declare function checkCount(name: string, value: number): void;
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
export declare function recencyFactor(ageMs: number, halfLifeDays?: number): number;
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
export declare function confidenceFactor(count: number): number;
/**
 * Options shared by the scoring functions.
 *
 * @example
 * ```ts
 * import type { ScoreOptions } from "./mastery.js";
 * const options: ScoreOptions = { halfLifeDays: 14 };
 * ```
 */
export interface ScoreOptions {
    /** Recency half-life in days; defaults to {@link DEFAULT_HALF_LIFE_DAYS}. */
    readonly halfLifeDays?: number;
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
export declare function channelScore(events: readonly Evidence[], channel: Channel, now: number, options?: ScoreOptions): number;
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
export declare function dimensionScore(events: readonly Evidence[], dimension: Dimension, now: number, options?: ScoreOptions): number;
/**
 * Whether a dimension score reaches {@link DIMENSION_THRESHOLD}.
 *
 * @example
 * ```ts
 * import { isSatisfied } from "./mastery.js";
 * isSatisfied(0.5); // true
 * ```
 */
export declare function isSatisfied(score: number): boolean;
/**
 * Options for {@link topicScore}.
 *
 * @example
 * ```ts
 * import type { TopicScoreOptions } from "./mastery.js";
 * const options: TopicScoreOptions = {
 *   weights: { observed: 1, "explain-back": 1, quiz: 1, "self-report": 0 },
 * };
 * ```
 */
export interface TopicScoreOptions extends ScoreOptions {
    /** Per-channel weights; each finite and non-negative, summing to more than 0. */
    readonly weights?: Readonly<Record<Channel, number>>;
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
export declare function topicScore(events: readonly Evidence[], now: number, options?: TopicScoreOptions): number;
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
export declare function reviewIntervalMs(passes: number): number;
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
export declare function isReviewDue(lastPassAt: number, passes: number, now: number): boolean;
//# sourceMappingURL=mastery.d.ts.map