import {
  CHANNEL_DIMENSION,
  FLUENCY_SESSIONS,
  FLUENCY_SPAN_MS,
  channelScore,
  checkCount,
  checkFinite,
  dimensionScore,
  isSatisfied,
} from "./mastery.js";
import {
  CHANNELS,
  DIMENSIONS,
  levelRank,
  requiredDimensions,
  type Dimension,
  type Evidence,
  type Level,
  type TopicType,
} from "./schema.js";

const RUNG: Readonly<Record<Dimension, Level>> = {
  apply: "Applied",
  understand: "Understood",
  recall: "Recalled",
};

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

interface Evaluation extends LevelResult {
  readonly selfReport: number;
}

function isFluent(
  events: readonly Evidence[],
  required: readonly Dimension[],
  satisfied: readonly Dimension[],
  sessionsNeeded: number,
): boolean {
  if (!required.every((dimension) => satisfied.includes(dimension))) {
    return false;
  }
  const channels = CHANNELS.filter((channel) => {
    const dimension = CHANNEL_DIMENSION[channel];
    return dimension !== null && required.includes(dimension);
  });
  const sessions = new Set<string>();
  let earliest = Infinity;
  let latest = -Infinity;
  for (const event of events) {
    if (event.result !== "positive" || !channels.includes(event.channel)) {
      continue;
    }
    sessions.add(event.session);
    earliest = Math.min(earliest, event.at);
    latest = Math.max(latest, event.at);
  }
  return (
    sessions.size >= sessionsNeeded && latest - earliest >= FLUENCY_SPAN_MS
  );
}

// Shared core of deriveLevel/reconcile: validates eagerly and takes
// already-read locals so each caller reads every input property exactly once.
function evaluate(
  type: TopicType,
  events: readonly Evidence[],
  introduced: boolean,
  now: number,
  halfLifeDays: number | undefined,
  fluencySessions: number | undefined,
): Evaluation {
  // channelScore and dimensionScore run the shared eager validation (`now`,
  // `halfLifeDays`, the event cap, one topic), even for an empty `events`.
  const options = halfLifeDays !== undefined ? { halfLifeDays } : {};
  const scores: Readonly<Record<Dimension, number>> = {
    apply: dimensionScore(events, "apply", now, options),
    understand: dimensionScore(events, "understand", now, options),
    recall: dimensionScore(events, "recall", now, options),
  };
  const sessionsNeeded = fluencySessions ?? FLUENCY_SESSIONS;
  checkCount("fluencySessions", sessionsNeeded);
  const selfReport = channelScore(events, "self-report", now, options);
  const satisfied = DIMENSIONS.filter((dimension) =>
    isSatisfied(scores[dimension]),
  );
  const hasEvents = events.length > 0;

  let level: Level;
  const highest = satisfied[0];
  if (type === "fast-moving") {
    level = hasEvents || introduced ? "Introduced" : "Unseen";
  } else if (!hasEvents && !introduced) {
    level = "Unseen";
  } else if (highest === undefined) {
    const anyNegative = DIMENSIONS.some((dimension) => scores[dimension] < 0);
    level = selfReport > 0 && !anyNegative ? "Claimed" : "Introduced";
  } else if (
    isFluent(events, requiredDimensions(type), satisfied, sessionsNeeded)
  ) {
    level = "Fluent";
  } else {
    // DIMENSIONS runs from the highest rung down, so the first is the highest.
    level = RUNG[highest];
  }
  return { level, scores, satisfied, selfReport };
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
export function deriveLevel(input: LevelInput): LevelResult {
  const { level, scores, satisfied } = evaluate(
    input.type,
    input.events,
    input.introduced,
    input.now,
    input.halfLifeDays,
    input.fluencySessions,
  );
  return { level, scores, satisfied };
}

/**
 * A mismatch between claimed and observed mastery (design table 4.5).
 *
 * @example
 * ```ts
 * import type { Diagnosis } from "./reconcile.js";
 * const d: Diagnosis = "weak-recall";
 * ```
 */
export type Diagnosis =
  | "overclaim"
  | "knows-not-applies"
  | "works-by-rote"
  | "weak-recall"
  | "underclaim";

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

// The claim rules of reconcile. Only dimensions whose rung is at or below the
// claimed level can refute it, so an under-claim is never read as an overclaim.
function classifyClaim(
  type: TopicType,
  claimedLevel: Level | undefined,
  evaluation: Evaluation,
): ClaimOutcome {
  const { level, scores, satisfied, selfReport } = evaluation;
  if (claimedLevel === undefined && selfReport <= 0) return "none";
  if (type === "fast-moving") return "unverified";
  const ceiling =
    claimedLevel === undefined ? Infinity : levelRank(claimedLevel);
  const refuted = DIMENSIONS.some(
    (dimension) =>
      levelRank(RUNG[dimension]) <= ceiling && scores[dimension] < 0,
  );
  if (refuted) return "refuted";
  const met =
    claimedLevel === undefined
      ? satisfied.length > 0
      : levelRank(level) >= ceiling;
  return met ? "confirmed" : "unverified";
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
export function reconcile(input: ReconcileInput): ReconcileResult {
  const type = input.type;
  const claimedLevel = input.claimedLevel;
  const { level, scores, satisfied, selfReport } = evaluate(
    type,
    input.events,
    input.introduced,
    input.now,
    input.halfLifeDays,
    input.fluencySessions,
  );

  const claim = classifyClaim(type, claimedLevel, {
    level,
    scores,
    satisfied,
    selfReport,
  });

  const diagnoses: Diagnosis[] = [];
  if (claim === "refuted") diagnoses.push("overclaim");
  if (satisfied.includes("recall") && scores.apply < 0) {
    diagnoses.push("knows-not-applies");
  }
  if (satisfied.includes("apply") && scores.understand < 0) {
    diagnoses.push("works-by-rote");
  }
  if (satisfied.includes("understand") && scores.recall < 0) {
    diagnoses.push("weak-recall");
  }
  if (
    claimedLevel !== undefined &&
    levelRank(level) > levelRank(claimedLevel)
  ) {
    diagnoses.push("underclaim");
  }
  return { level, scores, satisfied, diagnoses, claim };
}

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
export function applyProductChange(
  events: readonly Evidence[],
  changedAt: number,
): readonly Evidence[] {
  checkFinite("changedAt", changedAt);
  return events.filter((event) => event.at >= changedAt);
}

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

function increment(name: string, value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} would exceed Number.MAX_SAFE_INTEGER`);
  }
  return value + 1;
}

function readCalibration(c: Calibration): Calibration {
  const confirmed = c.confirmed;
  const refuted = c.refuted;
  checkCount("confirmed", confirmed);
  checkCount("refuted", refuted);
  return { confirmed, refuted };
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
export function updateCalibration(
  c: Calibration,
  outcome: ClaimOutcome,
): Calibration {
  const { confirmed, refuted } = readCalibration(c);
  switch (outcome) {
    case "confirmed":
      return { confirmed: increment("confirmed", confirmed), refuted };
    case "refuted":
      return { confirmed, refuted: increment("refuted", refuted) };
    case "none":
    case "unverified":
      return { confirmed, refuted };
  }
}

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
export function calibrationScore(c: Calibration): number {
  const { confirmed, refuted } = readCalibration(c);
  return (confirmed + 1) / (confirmed + refuted + 2);
}
