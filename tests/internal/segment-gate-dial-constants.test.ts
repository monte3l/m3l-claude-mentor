import { describe, expect, test } from "vitest";
import {
  DIAL_GAP_MULTIPLIER,
  TIP_MIN_GAP_MS,
  decideTip,
  type SegmentState,
  type TipGateInput,
} from "../../src/internal/segment.ts";
import { parseTopicId, type TopicId } from "../../src/internal/schema.ts";

const parsed = parseTopicId("plan-mode");
if (!parsed.ok) throw new Error("bad fixture");
const A: TopicId = parsed.value;

const NOW = 2_000_000_000;

function gate(
  lastTipAt: number | null,
  dial: number,
  overrides: Partial<TipGateInput> = {},
  stateOverrides: Partial<SegmentState> = {},
): TipGateInput {
  return {
    state: {
      segmentId: 1,
      startedAt: NOW - 60_000,
      lastActivityAt: NOW - 60_000,
      tipsEmitted: 0,
      lastTipAt,
      lastTopic: null,
      ...stateOverrides,
    },
    now: NOW,
    dial,
    muted: false,
    busy: false,
    related: { id: A, belowTarget: true },
    topicMuted: false,
    ...overrides,
  };
}

describe("tip gap constants", () => {
  test("the base gap is 15 minutes and the multipliers are pinned", () => {
    expect(TIP_MIN_GAP_MS).toBe(900_000);
    expect({ ...DIAL_GAP_MULTIPLIER }).toEqual({
      1: 4,
      2: 2,
      3: 1,
      4: 1,
      5: 1,
    });
  });
});

describe("decideTip: gap derived from the exported constants", () => {
  const dials = [1, 2, 3, 4, 5] as const;

  test.each(dials)("dial %i emits at exactly the derived gap", (dial) => {
    const gap = TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[dial];
    expect(decideTip(gate(NOW - gap, dial))).toEqual({ emit: true, topic: A });
  });

  test.each(dials)("dial %i declines 1 ms before the derived gap", (dial) => {
    const gap = TIP_MIN_GAP_MS * DIAL_GAP_MULTIPLIER[dial];
    expect(decideTip(gate(NOW - gap + 1, dial))).toEqual({
      emit: false,
      reason: "min-gap",
    });
  });

  test.each(dials)(
    "dial %i with lastTipAt null never reports min-gap",
    (dial) => {
      expect(decideTip(gate(null, dial))).toEqual({ emit: true, topic: A });
    },
  );

  test("at-target beats segment-quota and min-gap when both also fail", () => {
    const input = gate(
      NOW - 1,
      3,
      { related: { id: A, belowTarget: false } },
      { tipsEmitted: 1 },
    );
    expect(decideTip(input)).toEqual({ emit: false, reason: "at-target" });
  });

  test("segment-quota beats min-gap when both fail", () => {
    expect(decideTip(gate(NOW - 1, 3, {}, { tipsEmitted: 1 }))).toEqual({
      emit: false,
      reason: "segment-quota",
    });
  });
});
