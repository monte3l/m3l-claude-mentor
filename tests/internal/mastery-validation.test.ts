import { describe, expect, test } from "vitest";
import {
  channelScore,
  confidenceFactor,
  isReviewDue,
  recencyFactor,
  topicScore,
} from "../../src/internal/mastery.js";
import {
  calibrationScore,
  deriveLevel,
  updateCalibration,
} from "../../src/internal/reconcile.js";
import type { Channel } from "../../src/internal/schema.js";
import { NOW, ev, repeat } from "./fixtures/evidence.js";

const MAX = Number.MAX_SAFE_INTEGER;

describe("helper validation", () => {
  test.each([-1, 1.5, NaN])("confidenceFactor(%d) throws RangeError", (n) => {
    expect(() => confidenceFactor(n)).toThrowError(RangeError);
  });

  test.each([NaN, Infinity, -Infinity])(
    "recencyFactor with non-finite ageMs %d throws RangeError",
    (age) => {
      expect(() => recencyFactor(age)).toThrowError(RangeError);
    },
  );

  test.each([0, -1, NaN, Infinity])(
    "recencyFactor with invalid halfLifeDays %d throws RangeError",
    (hl) => {
      expect(() => recencyFactor(1000, hl)).toThrowError(RangeError);
    },
  );

  test.each([
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, -Infinity],
  ])("isReviewDue(%d, 0, %d) throws RangeError", (last, now) => {
    expect(() => isReviewDue(last, 0, now)).toThrowError(RangeError);
  });
});

describe("empty-events validation still runs", () => {
  test.each([0, -1, NaN])("halfLifeDays %d with no events", (halfLifeDays) => {
    expect(() => channelScore([], "quiz", NOW, { halfLifeDays })).toThrowError(
      /halfLifeDays/,
    );
    expect(() => topicScore([], NOW, { halfLifeDays })).toThrowError(
      RangeError,
    );
  });

  test("a weights record missing a channel key", () => {
    const weights = {
      observed: 1,
      quiz: 1,
      "self-report": 1,
    } as unknown as Record<Channel, number>;
    expect(() => topicScore([], NOW, { weights })).toThrowError(RangeError);
    expect(() => topicScore([], NOW, { weights })).toThrowError(/weights/);
  });

  test("weights whose sum is not finite", () => {
    const weights = {
      observed: 1e308,
      "explain-back": 1e308,
      quiz: 0,
      "self-report": 0,
    };
    expect(() => topicScore([], NOW, { weights })).toThrowError(RangeError);
    expect(() => topicScore([], NOW, { weights })).toThrowError(/weights/);
  });
});

describe("calibration bounds", () => {
  test.each([
    { confirmed: -1, refuted: 0 },
    { confirmed: 0, refuted: 1.5 },
    { confirmed: MAX + 1, refuted: 0 },
    { confirmed: 0, refuted: MAX + 1 },
    { confirmed: NaN, refuted: 0 },
  ])("calibrationScore rejects %j", (c) => {
    expect(() => calibrationScore(c)).toThrowError(RangeError);
  });

  test("calibrationScore accepts MAX_SAFE_INTEGER and stays within 0..1", () => {
    const score = calibrationScore({ confirmed: MAX, refuted: 0 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("updateCalibration rejects counts above MAX_SAFE_INTEGER", () => {
    expect(() =>
      updateCalibration({ confirmed: MAX + 1, refuted: 0 }, "none"),
    ).toThrowError(RangeError);
  });

  test("updateCalibration throws when the increment would exceed MAX_SAFE_INTEGER", () => {
    expect(() =>
      updateCalibration({ confirmed: MAX, refuted: 0 }, "confirmed"),
    ).toThrowError(RangeError);
    expect(() =>
      updateCalibration({ confirmed: 0, refuted: MAX }, "refuted"),
    ).toThrowError(RangeError);
  });

  test("updateCalibration reaches MAX_SAFE_INTEGER exactly", () => {
    expect(
      updateCalibration({ confirmed: MAX - 1, refuted: 0 }, "confirmed"),
    ).toEqual({ confirmed: MAX, refuted: 0 });
  });
});

describe("halfLifeDays whose millisecond product overflows", () => {
  test.each([1e301, 1e308, Number.MAX_VALUE])(
    "halfLifeDays %d throws RangeError naming halfLifeDays",
    (halfLifeDays) => {
      const base = { type: "concept", introduced: true, now: NOW } as const;
      for (const events of [[], [ev("quiz")]]) {
        expect(() => recencyFactor(1000, halfLifeDays)).toThrowError(
          /halfLifeDays/,
        );
        expect(() =>
          channelScore(events, "quiz", NOW, { halfLifeDays }),
        ).toThrowError(RangeError);
        expect(() =>
          channelScore(events, "quiz", NOW, { halfLifeDays }),
        ).toThrowError(/halfLifeDays/);
        expect(() => topicScore(events, NOW, { halfLifeDays })).toThrowError(
          /halfLifeDays/,
        );
        expect(() =>
          deriveLevel({ ...base, events, halfLifeDays }),
        ).toThrowError(/halfLifeDays/);
      }
      expect(() => recencyFactor(1000, halfLifeDays)).toThrowError(RangeError);
    },
  );

  test("halfLifeDays 1e300 is accepted and stays finite", () => {
    const score = channelScore(repeat(3, "quiz"), "quiz", NOW, {
      halfLifeDays: 1e300,
    });
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeCloseTo(0.6, 6);
  });
});
