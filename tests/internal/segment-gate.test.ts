import { describe, expect, expectTypeOf, test } from "vitest";
import {
  advanceSegment,
  decideTip,
  newSegment,
  recordTip,
  type AdvanceResult,
  type SegmentBoundary,
  type SegmentState,
  type TipDecision,
  type TipGateInput,
} from "../../src/internal/segment.js";
import { parseTopicId, type TopicId } from "../../src/internal/schema.js";

const MIN = 60_000;
const T0 = 1_000_000_000;

function topic(value: string): TopicId {
  const parsed = parseTopicId(value);
  if (!parsed.ok) {
    throw new Error(`bad fixture: ${parsed.reason}`);
  }
  return parsed.value;
}

const A = topic("plan-mode");

/** A frozen state; overrides replace the defaults. */
function state(overrides: Partial<SegmentState> = {}): SegmentState {
  return Object.freeze({
    segmentId: 3,
    startedAt: T0 - 5 * MIN,
    lastActivityAt: T0,
    tipsEmitted: 0,
    lastTipAt: null,
    lastTopic: null,
    ...overrides,
  });
}

const NOW = T0 + 100 * MIN;

function gate(overrides: Partial<TipGateInput> = {}): TipGateInput {
  return Object.freeze({
    state: state({ lastActivityAt: NOW - MIN }),
    now: NOW,
    dial: 3,
    muted: false,
    busy: false,
    related: Object.freeze({ id: A, belowTarget: true }),
    topicMuted: false,
    ...overrides,
  });
}

/** Failure overrides per check, index 0 = check 1. Each fires on its own. */
const FAILS: readonly Partial<TipGateInput>[] = [
  { dial: 0 },
  { muted: true },
  { busy: true },
  { related: null },
  { topicMuted: true },
  { related: { id: A, belowTarget: false } },
  { state: state({ tipsEmitted: 1 }) },
  { state: state({ lastTipAt: NOW - 899_999 }) },
];
const REASONS = [
  "dial-off",
  "muted",
  "busy",
  "no-related-topic",
  "topic-muted",
  "at-target",
  "segment-quota",
  "min-gap",
] as const;

/** Applies checks k..8 together; earlier checks win overlapping keys. */
function failingFrom(k: number): TipGateInput {
  let merged: Partial<TipGateInput> = {};
  for (const f of FAILS.slice(k).reverse()) {
    merged = { ...merged, ...f };
  }
  return gate(merged);
}

describe("decideTip: skip reasons", () => {
  test("baseline emits the related topic", () => {
    expect(decideTip(gate())).toEqual({ emit: true, topic: A });
  });

  test.each(REASONS.map((reason, i) => [reason, i] as const))(
    "%s fires alone",
    (reason, i) => {
      expect(decideTip(gate(FAILS[i]))).toEqual({ emit: false, reason });
    },
  );

  test.each(REASONS.map((reason, i) => [reason, i] as const))(
    "%s wins when every later check also fails",
    (reason, i) => {
      expect(decideTip(failingFrom(i))).toEqual({ emit: false, reason });
    },
  );

  test("muted and busy together report muted", () => {
    expect(decideTip(gate({ muted: true, busy: true }))).toEqual({
      emit: false,
      reason: "muted",
    });
  });

  test("no related topic with topicMuted reports no-related-topic", () => {
    expect(decideTip(gate({ related: null, topicMuted: true }))).toEqual({
      emit: false,
      reason: "no-related-topic",
    });
  });

  test("segment-quota beats min-gap", () => {
    const s = state({ tipsEmitted: 1, lastTipAt: NOW - MIN });
    expect(decideTip(gate({ state: s }))).toEqual({
      emit: false,
      reason: "segment-quota",
    });
  });

  test("a segment with two tips is still segment-quota", () => {
    const s = state({ tipsEmitted: 2 });
    expect(decideTip(gate({ state: s }))).toEqual({
      emit: false,
      reason: "segment-quota",
    });
  });
});

describe("decideTip: tip gap boundary per dial", () => {
  const cases = [
    [1, 3_600_000],
    [2, 1_800_000],
    [3, 900_000],
    [4, 900_000],
    [5, 900_000],
  ] as const;

  test.each(cases)("dial %i: threshold minus one is min-gap", (dial, gap) => {
    const s = state({ lastTipAt: NOW - (gap - 1) });
    expect(decideTip(gate({ dial, state: s }))).toEqual({
      emit: false,
      reason: "min-gap",
    });
  });

  test.each(cases)("dial %i: exactly the threshold emits", (dial, gap) => {
    const s = state({ lastTipAt: NOW - gap });
    expect(decideTip(gate({ dial, state: s }))).toEqual({
      emit: true,
      topic: A,
    });
  });

  test("never having tipped passes the gap check", () => {
    expect(decideTip(gate({ dial: 1 })).emit).toBe(true);
  });
});

describe("decideTip: purity and errors", () => {
  test("does not mutate input and is repeatable", () => {
    const input = gate();
    const first = decideTip(input);
    expect(decideTip(input)).toEqual(first);
    expect(input.state.tipsEmitted).toBe(0);
    expect(input.state.lastTipAt).toBeNull();
  });

  test.each([6, -1, 2.5, Number.NaN, Infinity])("rejects dial %s", (dial) => {
    expect(() => decideTip(gate({ dial }))).toThrowError(RangeError);
  });

  test.each([Number.NaN, -1, Infinity])("rejects now=%s", (now) => {
    expect(() => decideTip(gate({ now }))).toThrowError(RangeError);
  });

  test.each([
    ["dial-off with now NaN", { dial: 0, now: Number.NaN }],
    ["dial-off with now -1", { dial: 0, now: -1 }],
    ["muted with dial 6", { muted: true, dial: 6 }],
    ["muted with dial 2.5", { muted: true, dial: 2.5 }],
    ["busy with now Infinity", { busy: true, now: Infinity }],
    ["no related topic with dial -1", { related: null, dial: -1 }],
  ] as const)(
    "validates eagerly: %s throws instead of skipping",
    (_name, overrides) => {
      expect(() => decideTip(gate(overrides))).toThrowError(RangeError);
    },
  );
});

describe("scenario: tip, quota, task boundary, min-gap", () => {
  test("follows the segment and gate rules across a sequence", () => {
    const s0 = newSegment(T0);
    const s1 = advanceSegment(s0, {
      kind: "activity",
      at: T0 + MIN,
      topic: A,
    }).state;
    const tipAt = T0 + 2 * MIN;
    const related = { id: A, belowTarget: true };
    const base = { dial: 3, muted: false, busy: false, topicMuted: false };

    expect(decideTip({ ...base, state: s1, now: tipAt, related })).toEqual({
      emit: true,
      topic: A,
    });
    const s2 = recordTip(s1, tipAt);

    // 20 minutes later, same segment: quota.
    const later = advanceSegment(s2, {
      kind: "activity",
      at: tipAt + 20 * MIN,
      topic: A,
    });
    expect(later.boundary).toBe("none");
    expect(
      decideTip({
        ...base,
        state: later.state,
        now: tipAt + 20 * MIN,
        related,
      }),
    ).toEqual({ emit: false, reason: "segment-quota" });

    // Task completes 6 min after the tip: new segment, floor still applies.
    const done = advanceSegment(s2, {
      kind: "task-complete",
      at: tipAt + 6 * MIN,
    });
    expect(done.boundary).toBe("task-complete");
    expect(done.state.lastTipAt).toBe(tipAt);
    expect(
      decideTip({
        ...base,
        state: done.state,
        now: tipAt + 10 * MIN,
        related,
      }),
    ).toEqual({ emit: false, reason: "min-gap" });
    expect(
      decideTip({
        ...base,
        state: done.state,
        now: tipAt + 15 * MIN,
        related,
      }),
    ).toEqual({ emit: true, topic: A });
  });
});

describe("types", () => {
  test("decision and boundary unions", () => {
    expectTypeOf<SegmentBoundary>().toEqualTypeOf<
      "none" | "time-gap" | "topic-change" | "task-complete"
    >();
    expectTypeOf<TipDecision>().toEqualTypeOf<
      | { readonly emit: true; readonly topic: TopicId }
      | {
          readonly emit: false;
          readonly reason:
            | "dial-off"
            | "muted"
            | "busy"
            | "no-related-topic"
            | "topic-muted"
            | "at-target"
            | "segment-quota"
            | "min-gap";
        }
    >();
    expectTypeOf<AdvanceResult["state"]>().toEqualTypeOf<SegmentState>();
    expectTypeOf<SegmentState["lastTipAt"]>().toEqualTypeOf<number | null>();
  });
});
