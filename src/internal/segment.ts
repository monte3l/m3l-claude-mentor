import type { TopicId } from "./schema.js";

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
export const DIAL_GAP_MULTIPLIER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> =
  Object.freeze({ 1: 4, 2: 2, 3: 1, 4: 1, 5: 1 });

/**
 * The ambient engine's view of the current work segment. A segment ends at
 * task completion, a topic change, or an idle gap. {@link decideTip} allows
 * at most one tip per segment (it skips when `tipsEmitted >= 1`); the type
 * itself does not enforce this, and calling {@link recordTip} twice yields
 * `tipsEmitted: 2`. Obtain a state only from the store parser or from this
 * module's functions: beyond the specific checks each function documents,
 * the fields are not validated here (a NaN `lastActivityAt`, for example, is
 * carried through unchanged).
 *
 * @example
 * ```ts
 * import { newSegment, type SegmentState } from "./segment.js";
 * const s: SegmentState = newSegment(Date.now());
 * ```
 */
export interface SegmentState {
  /** Non-negative integer, incremented on every new segment. */
  readonly segmentId: number;
  /** Timestamp (ms) at which this segment started. */
  readonly startedAt: number;
  /** Timestamp (ms) of the latest activity seen in this segment. */
  readonly lastActivityAt: number;
  /** Tips emitted in this segment only. */
  readonly tipsEmitted: number;
  /** Timestamp (ms) of the latest tip; carried across segments. */
  readonly lastTipAt: number | null;
  /** Topic of the latest activity that named one, if any. */
  readonly lastTopic: TopicId | null;
}

/**
 * An observation fed to {@link advanceSegment}: either learner activity
 * (optionally tied to a topic) or the completion of a task.
 *
 * @example
 * ```ts
 * import type { SegmentEvent } from "./segment.js";
 * const e: SegmentEvent = { kind: "task-complete", at: Date.now() };
 * ```
 */
export type SegmentEvent =
  | { readonly kind: "activity"; readonly at: number; readonly topic?: TopicId }
  | { readonly kind: "task-complete"; readonly at: number };

/**
 * Why {@link advanceSegment} did or did not start a new segment.
 *
 * @example
 * ```ts
 * import type { SegmentBoundary } from "./segment.js";
 * const b: SegmentBoundary = "topic-change";
 * ```
 */
export type SegmentBoundary =
  "none" | "time-gap" | "topic-change" | "task-complete";

/**
 * Result of {@link advanceSegment}: the next state and the boundary crossed.
 *
 * @example
 * ```ts
 * import { advanceSegment, newSegment, type AdvanceResult } from "./segment.js";
 * const r: AdvanceResult = advanceSegment(newSegment(0), { kind: "activity", at: 1 });
 * r.boundary; // "none"
 * ```
 */
export interface AdvanceResult {
  readonly state: SegmentState;
  readonly boundary: SegmentBoundary;
}

/**
 * The topic a candidate tip would teach, with whether the learner is still
 * below their target level on it.
 *
 * @example
 * ```ts
 * import { parseTopicId } from "./schema.js";
 * import type { RelatedTopic } from "./segment.js";
 * const p = parseTopicId("plan-mode");
 * const related: RelatedTopic | null = p.ok ? { id: p.value, belowTarget: true } : null;
 * ```
 */
export interface RelatedTopic {
  readonly id: TopicId;
  readonly belowTarget: boolean;
}

/**
 * Everything {@link decideTip} needs to decide whether to emit a tip now.
 *
 * @example
 * ```ts
 * import { newSegment, type TipGateInput } from "./segment.js";
 * const now = Date.now();
 * const input: TipGateInput = {
 *   state: newSegment(now),
 *   now,
 *   dial: 3,
 *   muted: false,
 *   busy: false,
 *   related: null,
 *   topicMuted: false,
 * };
 * ```
 */
export interface TipGateInput {
  readonly state: SegmentState;
  /** Current timestamp (ms); finite and non-negative. */
  readonly now: number;
  /** Tip frequency dial: an integer from 0 (off) to 5. */
  readonly dial: number;
  readonly muted: boolean;
  readonly busy: boolean;
  /** The topic this tip would teach, if any matches the task. */
  readonly related: RelatedTopic | null;
  /** Whether `related` is individually muted. */
  readonly topicMuted: boolean;
}

/**
 * Why {@link decideTip} declined to emit, listed in check order.
 *
 * @example
 * ```ts
 * import type { TipSkipReason } from "./segment.js";
 * const r: TipSkipReason = "min-gap";
 * ```
 */
export type TipSkipReason =
  | "dial-off"
  | "muted"
  | "busy"
  | "no-related-topic"
  | "topic-muted"
  | "at-target"
  | "segment-quota"
  | "min-gap";

/**
 * Outcome of {@link decideTip}: emit a tip on `topic`, or skip for `reason`.
 *
 * @example
 * ```ts
 * import type { TipDecision } from "./segment.js";
 * function describe(d: TipDecision): string {
 *   return d.emit ? `tip on ${d.topic}` : `skipped: ${d.reason}`;
 * }
 * ```
 */
export type TipDecision =
  | { readonly emit: true; readonly topic: TopicId }
  | { readonly emit: false; readonly reason: TipSkipReason };

type Dial = 0 | 1 | 2 | 3 | 4 | 5;

function checkTimestamp(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
}

function checkCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function checkDial(value: number): Dial {
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
export function newSegment(now: number): SegmentState {
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

function startNext(
  segmentId: number,
  lastTipAt: number | null,
  at: number,
  lastTopic: TopicId | null,
): SegmentState {
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
export function advanceSegment(
  state: SegmentState,
  event: SegmentEvent,
): AdvanceResult {
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
 * Records activity at `now` WITHOUT boundary detection: no idle-gap,
 * topic-change or task-complete rule runs, so the segment, its tip quota and
 * its topic are kept. Only `lastActivityAt` moves, and only forward
 * (`max(lastActivityAt, now)`), so `startedAt <= lastActivityAt` still holds.
 * Use it for events that are not learner activity (a finished turn, a
 * compaction); a new segment then starts only on the next real activity
 * event fed to {@link advanceSegment}. The input state is never mutated.
 *
 * @param state - The current segment state, from the store parser or from
 * this module's functions.
 * @param now - The event time in milliseconds; finite and non-negative.
 * @returns `state` itself when `now <= state.lastActivityAt`, else a copy
 * with only `lastActivityAt` set to `now`.
 * @throws RangeError when `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { newSegment, touchActivity } from "./segment.js";
 * touchActivity(newSegment(0), 5_000).lastActivityAt; // 5_000
 * ```
 */
export function touchActivity(state: SegmentState, now: number): SegmentState {
  checkTimestamp("now", now);
  return now <= state.lastActivityAt
    ? state
    : { ...state, lastActivityAt: now };
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
export function recordTip(state: SegmentState, now: number): SegmentState {
  const { segmentId, startedAt, lastActivityAt, tipsEmitted, lastTopic } =
    state;
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
export function decideTip(input: TipGateInput): TipDecision {
  const dial = checkDial(input.dial);
  const now = input.now;
  checkTimestamp("now", now);
  const related = input.related;
  const state = input.state;
  const tipsEmitted = state.tipsEmitted;
  const lastTipAt = state.lastTipAt;

  if (dial === 0) return { emit: false, reason: "dial-off" };
  if (input.muted) return { emit: false, reason: "muted" };
  if (input.busy) return { emit: false, reason: "busy" };
  if (related === null) return { emit: false, reason: "no-related-topic" };
  if (input.topicMuted) return { emit: false, reason: "topic-muted" };
  if (!related.belowTarget) return { emit: false, reason: "at-target" };
  if (tipsEmitted >= 1) return { emit: false, reason: "segment-quota" };
  if (
    lastTipAt !== null &&
    now - lastTipAt < TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[dial]
  ) {
    return { emit: false, reason: "min-gap" };
  }
  return { emit: true, topic: related.id };
}
