import { describe, expect, test } from "vitest";
import { parseTopicId } from "../../src/internal/schema.js";
import {
  touchActivity,
  type SegmentState,
} from "../../src/internal/segment.js";

const LAST = 5_000_000;

function seed(overrides: Partial<SegmentState> = {}): SegmentState {
  const topic = parseTopicId("plan-mode");
  if (!topic.ok) throw new Error("bad fixture");
  return Object.freeze({
    segmentId: 3,
    startedAt: 4_000_000,
    lastActivityAt: LAST,
    tipsEmitted: 1,
    lastTipAt: 4_500_000,
    lastTopic: topic.value,
    ...overrides,
  });
}

describe("touchActivity", () => {
  test.each([
    ["one ms before lastActivityAt", LAST - 1],
    ["equal to lastActivityAt", LAST],
    ["zero", 0],
  ])("returns the same object when now is %s", (_n, now) => {
    const s = seed();
    expect(touchActivity(s, now)).toBe(s);
  });

  test("one ms after lastActivityAt moves only lastActivityAt", () => {
    const s = seed();
    const next = touchActivity(s, LAST + 1);
    expect(next).not.toBe(s);
    expect(next).toEqual({ ...s, lastActivityAt: LAST + 1 });
  });

  test("a far-future now moves only lastActivityAt", () => {
    const s = seed({ lastTipAt: null, lastTopic: null });
    expect(touchActivity(s, LAST + 3_600_000)).toEqual({
      ...s,
      lastActivityAt: LAST + 3_600_000,
    });
  });

  test("does not mutate its (frozen) input", () => {
    const s = seed();
    const snapshot = structuredClone(s);
    touchActivity(s, LAST + 10);
    expect(s).toEqual(snapshot);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["-1", -1],
  ])("throws a RangeError for now = %s", (_n, now) => {
    expect(() => touchActivity(seed(), now)).toThrowError(RangeError);
  });
});
