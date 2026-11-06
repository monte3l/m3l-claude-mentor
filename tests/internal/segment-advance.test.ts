import { describe, expect, test } from "vitest";
import {
  DIAL_GAP_MULTIPLIER,
  SEGMENT_IDLE_GAP_MS,
  TIP_MIN_GAP_MS,
  advanceSegment,
  newSegment,
  recordTip,
  type SegmentState,
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
const B = topic("context-window");

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

describe("constants", () => {
  test("hand-written literal values", () => {
    expect(TIP_MIN_GAP_MS).toBe(900_000);
    expect(SEGMENT_IDLE_GAP_MS).toBe(1_800_000);
    expect(DIAL_GAP_MULTIPLIER).toEqual({ 1: 4, 2: 2, 3: 1, 4: 1, 5: 1 });
  });
});

describe("newSegment", () => {
  test("starts at id 0 with empty tip history", () => {
    expect(newSegment(T0)).toEqual({
      segmentId: 0,
      startedAt: T0,
      lastActivityAt: T0,
      tipsEmitted: 0,
      lastTipAt: null,
      lastTopic: null,
    });
  });

  test("accepts zero", () => {
    expect(newSegment(0).startedAt).toBe(0);
  });

  test.each([Number.NaN, Infinity, -Infinity, -1])(
    "rejects timestamp %s with RangeError",
    (bad) => {
      expect(() => newSegment(bad)).toThrowError(RangeError);
    },
  );
});

describe("advanceSegment: same segment", () => {
  test("activity inside the idle gap keeps the segment", () => {
    const s = state();
    const r = advanceSegment(s, { kind: "activity", at: T0 + MIN });
    expect(r.boundary).toBe("none");
    expect(r.state).toEqual({ ...s, lastActivityAt: T0 + MIN });
  });

  test("topic present is recorded when no topic was known", () => {
    const r = advanceSegment(state(), {
      kind: "activity",
      at: T0 + MIN,
      topic: A,
    });
    expect(r.boundary).toBe("none");
    expect(r.state.lastTopic).toBe(A);
    expect(r.state.segmentId).toBe(3);
  });

  test("same topic keeps the segment", () => {
    const r = advanceSegment(state({ lastTopic: A }), {
      kind: "activity",
      at: T0 + MIN,
      topic: A,
    });
    expect(r.boundary).toBe("none");
    expect(r.state.lastTopic).toBe(A);
  });

  test("absent topic keeps the previous lastTopic", () => {
    const r = advanceSegment(state({ lastTopic: A }), {
      kind: "activity",
      at: T0 + MIN,
    });
    expect(r.boundary).toBe("none");
    expect(r.state.lastTopic).toBe(A);
  });

  test("clock going backwards is treated as lastActivityAt", () => {
    const s = state({ lastTopic: A });
    const r = advanceSegment(s, { kind: "activity", at: T0 - 10 * MIN });
    expect(r.boundary).toBe("none");
    expect(r.state.lastActivityAt).toBe(T0);
    expect(r.state.segmentId).toBe(3);
  });
});

describe("advanceSegment: idle gap boundary", () => {
  test("gap of threshold minus one stays in the segment", () => {
    const r = advanceSegment(state(), {
      kind: "activity",
      at: T0 + 1_800_000 - 1,
    });
    expect(r.boundary).toBe("none");
    expect(r.state.segmentId).toBe(3);
  });

  test("gap of exactly the threshold starts a new segment", () => {
    const s = state({
      tipsEmitted: 1,
      lastTipAt: T0 - MIN,
      lastTopic: A,
    });
    const at = T0 + 1_800_000;
    const r = advanceSegment(s, { kind: "activity", at });
    expect(r.boundary).toBe("time-gap");
    expect(r.state).toEqual({
      segmentId: 4,
      startedAt: at,
      lastActivityAt: at,
      tipsEmitted: 0,
      lastTipAt: T0 - MIN,
      lastTopic: null,
    });
  });

  test("time-gap sets lastTopic to the event topic", () => {
    const r = advanceSegment(state({ lastTopic: A }), {
      kind: "activity",
      at: T0 + 1_800_000,
      topic: B,
    });
    expect(r.boundary).toBe("time-gap");
    expect(r.state.lastTopic).toBe(B);
  });

  test("time-gap wins when topic also changed", () => {
    const r = advanceSegment(state({ lastTopic: A }), {
      kind: "activity",
      at: T0 + 2_000_000,
      topic: B,
    });
    expect(r.boundary).toBe("time-gap");
  });
});

describe("advanceSegment: topic change", () => {
  test("differing topic starts a new segment keeping lastTipAt", () => {
    const s = state({ tipsEmitted: 1, lastTipAt: T0 - 2 * MIN, lastTopic: A });
    const at = T0 + MIN;
    const r = advanceSegment(s, { kind: "activity", at, topic: B });
    expect(r.boundary).toBe("topic-change");
    expect(r.state).toEqual({
      segmentId: 4,
      startedAt: at,
      lastActivityAt: at,
      tipsEmitted: 0,
      lastTipAt: T0 - 2 * MIN,
      lastTopic: B,
    });
  });
});

describe("advanceSegment: task-complete", () => {
  test("starts a new segment with lastTopic null and lastTipAt kept", () => {
    const s = state({ tipsEmitted: 1, lastTipAt: T0 - MIN, lastTopic: A });
    const at = T0 + 2 * MIN;
    const r = advanceSegment(s, { kind: "task-complete", at });
    expect(r.boundary).toBe("task-complete");
    expect(r.state).toEqual({
      segmentId: 4,
      startedAt: at,
      lastActivityAt: at,
      tipsEmitted: 0,
      lastTipAt: T0 - MIN,
      lastTopic: null,
    });
  });

  test("task-complete beats an idle gap", () => {
    const r = advanceSegment(state(), {
      kind: "task-complete",
      at: T0 + 2_000_000,
    });
    expect(r.boundary).toBe("task-complete");
  });

  test("backwards clock uses lastActivityAt as the start", () => {
    const r = advanceSegment(state(), {
      kind: "task-complete",
      at: T0 - 10 * MIN,
    });
    expect(r.state.startedAt).toBe(T0);
    expect(r.state.lastActivityAt).toBe(T0);
    expect(r.state.segmentId).toBe(4);
  });
});

describe("advanceSegment: immutability and errors", () => {
  test("never mutates the input state", () => {
    const s = state({ lastTopic: A });
    const snapshot = { ...s };
    advanceSegment(s, { kind: "activity", at: T0 + MIN, topic: B });
    advanceSegment(s, { kind: "task-complete", at: T0 + MIN });
    advanceSegment(s, { kind: "activity", at: T0 + 2_000_000 });
    expect(s).toEqual(snapshot);
    expect(Object.isFrozen(s)).toBe(true);
  });

  test.each([
    ["activity", Number.NaN],
    ["activity", -1],
    ["activity", Infinity],
    ["task-complete", Number.NaN],
    ["task-complete", -1],
  ] as const)("rejects %s event with at=%s", (kind, at) => {
    expect(() => advanceSegment(state(), { kind, at })).toThrowError(
      RangeError,
    );
  });

  test.each([-1, 1.5, Number.NaN])("rejects segmentId %s", (segmentId) => {
    expect(() =>
      advanceSegment(state({ segmentId }), { kind: "activity", at: T0 }),
    ).toThrowError(RangeError);
  });
});

describe("recordTip", () => {
  test("increments tipsEmitted, sets lastTipAt, keeps lastActivityAt", () => {
    const s = state({ lastTopic: A });
    const next = recordTip(s, T0 + 3 * MIN);
    expect(next).toEqual({ ...s, tipsEmitted: 1, lastTipAt: T0 + 3 * MIN });
    expect(next.lastActivityAt).toBe(T0);
  });

  test("never mutates the input", () => {
    const s = state();
    recordTip(s, T0 + MIN);
    expect(s.tipsEmitted).toBe(0);
    expect(s.lastTipAt).toBeNull();
  });

  test.each([Number.NaN, -1, Infinity])("rejects now=%s", (bad) => {
    expect(() => recordTip(state(), bad)).toThrowError(RangeError);
  });

  test.each([-1, 1.5, Number.NaN])("rejects tipsEmitted %s", (tipsEmitted) => {
    expect(() => recordTip(state({ tipsEmitted }), T0)).toThrowError(
      RangeError,
    );
  });
});
