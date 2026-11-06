import { type Dimension, type Evidence, type Level, type TopicType } from "./schema.js";
/**
 * Input to {@link deriveLevel}.
 *
 * @example
 * ```ts
 * import type { LevelInput } from "./reconcile.js";
 * const input: LevelInput = {
 *   type: "concept",
 *   events: [],
 *   introduced: true,
 *   now: Date.now(),
 * };
 * ```
 */
export interface LevelInput {
    readonly type: TopicType;
    /** Evidence about this one topic; at most `MAX_EVENTS` items. */
    readonly events: readonly Evidence[];
    /** The mentor has taught or shown the topic. */
    readonly introduced: boolean;
    /** The current time in epoch milliseconds. */
    readonly now: number;
    readonly halfLifeDays?: number;
    /** Distinct sessions needed for `Fluent`; defaults to {@link FLUENCY_SESSIONS}. */
    readonly fluencySessions?: number;
}
/**
 * The level derived from evidence, with the per-dimension scores behind it.
 *
 * @example
 * ```ts
 * import { deriveLevel, type LevelResult } from "./reconcile.js";
 * const result: LevelResult = deriveLevel(input);
 * result.satisfied; // e.g. ["understand", "recall"]
 * ```
 */
export interface LevelResult {
    readonly level: Level;
    readonly scores: Readonly<Record<Dimension, number>>;
    /** Satisfied dimensions, in `DIMENSIONS` order. */
    readonly satisfied: readonly Dimension[];
}
/**
 * Derives a topic's mastery level from its evidence (design section 4).
 * `fast-moving` topics never rise above `Introduced`; `Claimed` needs a
 * positive self-report and no negative dimension; otherwise the highest
 * satisfied rung wins. `Fluent` needs every required dimension satisfied,
 * and counts only POSITIVE events on the channels of those REQUIRED
 * dimensions: they must come from at least `fluencySessions` distinct
 * sessions, with the earliest and latest at least {@link FLUENCY_SPAN_MS}
 * apart.
 *
 * @throws RangeError when `now`, `halfLifeDays` or `fluencySessions` is
 *   invalid, `events` is too long, or the events span more than one topic.
 *
 * @example
 * ```ts
 * import { deriveLevel } from "./reconcile.js";
 * const { level } = deriveLevel({
 *   type: "concept",
 *   events,
 *   introduced: true,
 *   now: Date.now(),
 * });
 * ```
 */
export declare function deriveLevel(input: LevelInput): LevelResult;
/**
 * A mismatch between claimed and observed mastery (design table 4.5).
 *
 * @example
 * ```ts
 * import type { Diagnosis } from "./reconcile.js";
 * const d: Diagnosis = "weak-recall";
 * ```
 */
export type Diagnosis = "overclaim" | "knows-not-applies" | "works-by-rote" | "weak-recall" | "underclaim";
/**
 * What the evidence says about the learner's claim.
 *
 * @example
 * ```ts
 * import type { ClaimOutcome } from "./reconcile.js";
 * const outcome: ClaimOutcome = "confirmed";
 * ```
 */
export type ClaimOutcome = "none" | "unverified" | "confirmed" | "refuted";
/**
 * Input to {@link reconcile}.
 *
 * @example
 * ```ts
 * import type { ReconcileInput } from "./reconcile.js";
 * const input: ReconcileInput = {
 *   type: "feature",
 *   events: [],
 *   introduced: true,
 *   now: Date.now(),
 *   claimedLevel: "Applied",
 * };
 * ```
 */
export interface ReconcileInput extends LevelInput {
    /** The level the learner says they are at. */
    readonly claimedLevel?: Level;
}
/**
 * The derived level plus the claim outcome and diagnoses.
 *
 * @example
 * ```ts
 * import { reconcile, type ReconcileResult } from "./reconcile.js";
 * const result: ReconcileResult = reconcile(input);
 * result.diagnoses; // e.g. ["overclaim"]
 * ```
 */
export interface ReconcileResult extends LevelResult {
    /** In the order of {@link Diagnosis}, without duplicates. */
    readonly diagnoses: readonly Diagnosis[];
    readonly claim: ClaimOutcome;
}
/**
 * Reconciles self-reported and probed evidence (design table 4.5). The
 * returned `level`, `scores` and `satisfied` equal {@link deriveLevel}'s for
 * the same input: the level is derived from evidence only, so a claim never
 * raises it, and a `claimedLevel` without self-report events does not produce
 * `Claimed` (record a self-report event for that).
 *
 * A claim exists when `claimedLevel` is given or the self-report score is
 * positive. It is `refuted` when a dimension at or below the claimed rung
 * (every dimension when `claimedLevel` is absent) scores below 0, `confirmed`
 * when not refuted and the derived level reaches `claimedLevel` (or, with no
 * `claimedLevel`, some dimension is satisfied), else `unverified`. A
 * `fast-moving` topic's claim is never `confirmed` or `refuted`.
 *
 * @throws RangeError under the same conditions as {@link deriveLevel}.
 *
 * @example
 * ```ts
 * import { reconcile } from "./reconcile.js";
 * const { claim, diagnoses } = reconcile({
 *   type: "feature",
 *   events,
 *   introduced: true,
 *   now: Date.now(),
 *   claimedLevel: "Applied",
 * });
 * ```
 */
export declare function reconcile(input: ReconcileInput): ReconcileResult;
/**
 * Drops evidence older than a product change: keeps events with
 * `at >= changedAt`. Returns a new array and never mutates `events`.
 *
 * @throws RangeError when `changedAt` is not finite.
 *
 * @example
 * ```ts
 * import { applyProductChange } from "./reconcile.js";
 * const current = applyProductChange(events, releaseDate);
 * ```
 */
export declare function applyProductChange(events: readonly Evidence[], changedAt: number): readonly Evidence[];
/**
 * Running tally of how often the learner's claims held up.
 *
 * @example
 * ```ts
 * import type { Calibration } from "./reconcile.js";
 * const empty: Calibration = { confirmed: 0, refuted: 0 };
 * ```
 */
export interface Calibration {
    readonly confirmed: number;
    readonly refuted: number;
}
/**
 * Records a claim outcome: `confirmed` and `refuted` increment their counter;
 * `none` and `unverified` return an equal copy. Never mutates `c`.
 *
 * @throws RangeError when a count is not an integer from 0 to
 *   `Number.MAX_SAFE_INTEGER`, or the increment would exceed it.
 *
 * @example
 * ```ts
 * import { updateCalibration } from "./reconcile.js";
 * updateCalibration({ confirmed: 0, refuted: 0 }, "confirmed");
 * // { confirmed: 1, refuted: 0 }
 * ```
 */
export declare function updateCalibration(c: Calibration, outcome: ClaimOutcome): Calibration;
/**
 * How trustworthy the learner's claims are; the result lies in the closed
 * interval 0..1:
 * `(confirmed + 1) / (confirmed + refuted + 2)`.
 *
 * @throws RangeError when a count is not an integer from 0 to
 *   `Number.MAX_SAFE_INTEGER`.
 *
 * @example
 * ```ts
 * import { calibrationScore } from "./reconcile.js";
 * calibrationScore({ confirmed: 3, refuted: 0 }); // 0.8
 * ```
 */
export declare function calibrationScore(c: Calibration): number;
//# sourceMappingURL=reconcile.d.ts.map