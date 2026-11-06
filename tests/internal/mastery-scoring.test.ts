import { describe, expect, test } from "vitest";
import {
  CHANNEL_DIMENSION,
  DAY_MS,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_WEIGHTS,
  DIMENSION_THRESHOLD,
  FLUENCY_SESSIONS,
  FLUENCY_SPAN_MS,
  NEGATIVE_MULTIPLIER,
  REVIEW_INTERVAL_DAYS,
  channelScore,
  confidenceFactor,
  dimensionScore,
  isReviewDue,
  isSatisfied,
  recencyFactor,
  reviewIntervalMs,
  topicScore,
} from "../../src/internal/mastery.js";
import {
  calibrationScore,
  updateCalibration,
  type Calibration,
} from "../../src/internal/reconcile.js";
import { DAY, NOW, days, ev, repeat } from "./fixtures/evidence.js";
import type { Evidence } from "../../src/internal/schema.js";

describe("constants", () => {
  test("pin the documented values", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      observed: 0.4,
      "explain-back": 0.3,
      quiz: 0.2,
      "self-report": 0.1,
    });
    expect(NEGATIVE_MULTIPLIER).toBe(1.5);
    expect(DEFAULT_HALF_LIFE_DAYS).toBe(30);
    expect(DIMENSION_THRESHOLD).toBe(0.5);
    expect(FLUENCY_SESSIONS).toBe(3);
    expect(FLUENCY_SPAN_MS).toBe(86_400_000);
    expect(DAY_MS).toBe(86_400_000);
    expect(CHANNEL_DIMENSION).toEqual({
      observed: "apply",
      "explain-back": "understand",
      quiz: "recall",
      "self-report": null,
    });
    expect([...REVIEW_INTERVAL_DAYS]).toEqual([1, 3, 7, 14, 30]);
  });
});

describe("recencyFactor", () => {
  test.each([
    [0, 1],
    [days(30), 0.5],
    [days(60), 0.25],
    [days(90), 0.125],
  ])("age %d ms with the default half-life -> %d", (age, expected) => {
    expect(recencyFactor(age)).toBeCloseTo(expected, 6);
  });

  test("honours a custom half-life", () => {
    expect(recencyFactor(days(10), 10)).toBeCloseTo(0.5, 6);
    expect(recencyFactor(days(20), 10)).toBeCloseTo(0.25, 6);
  });

  test("a negative age is clamped to 1", () => {
    expect(recencyFactor(-days(5))).toBe(1);
  });
});

describe("confidenceFactor", () => {
  test.each([
    [0, 0],
    [1, 1 / 3],
    [3, 0.6],
    [8, 0.8],
  ])("count %d -> %d", (count, expected) => {
    expect(confidenceFactor(count)).toBeCloseTo(expected, 6);
  });
});

describe("channelScore", () => {
  test("no matching events scores 0", () => {
    expect(channelScore([], "quiz", NOW)).toBe(0);
    expect(channelScore([ev("observed")], "quiz", NOW)).toBe(0);
  });

  test.each([
    ["1 positive", repeat(1, "quiz"), 1 / 3],
    ["3 positives", repeat(3, "quiz"), 0.6],
    [
      "2 positives + 1 negative",
      [...repeat(2, "quiz"), ...repeat(1, "quiz", "negative")],
      0.0857142857,
    ],
    ["1 negative", repeat(1, "quiz", "negative"), -1 / 3],
  ])("fresh events: %s", (_name, events, expected) => {
    expect(channelScore(events, "quiz", NOW)).toBeCloseTo(expected, 6);
  });

  test("ignores events of other channels", () => {
    const events = [...repeat(3, "quiz"), ...repeat(5, "observed", "negative")];
    expect(channelScore(events, "quiz", NOW)).toBeCloseTo(0.6, 6);
  });

  test("a negative outweighs a positive by NEGATIVE_MULTIPLIER (1 vs 1.5)", () => {
    // raw = (1 - 1.5) / 2.5 = -0.2, times confidence 2/4 = -0.1
    const events = [ev("quiz"), ev("quiz", "negative")];
    expect(channelScore(events, "quiz", NOW)).toBeCloseTo(-0.1, 6);
  });

  test("a recent negative beats old positives; an old negative does not", () => {
    const recentNegative = [
      ...repeat(5, "quiz", "positive", days(60)),
      ev("quiz", "negative", 0),
    ];
    const oldNegative = [
      ...repeat(5, "quiz", "positive", 0),
      ev("quiz", "negative", days(60)),
    ];
    // recent: raw (1.25 - 1.5) / 2.75 = -1/11, neff 1.25 + 1 = 2.25 -> * 2.25/4.25
    expect(channelScore(recentNegative, "quiz", NOW)).toBeCloseTo(
      -0.0481283,
      6,
    );
    // old: raw (5 - 0.375) / 5.375, neff 5.25 -> * 5.25/7.25
    expect(channelScore(oldNegative, "quiz", NOW)).toBeCloseTo(0.6230954, 6);
  });

  test("a custom half-life changes the decay", () => {
    // pos now, neg 10 days old, half-life 10: w 1 and 0.5*1.5 = 0.75,
    // raw 1/7, neff 1.5 -> 1/7 * 1.5/3.5
    const events = [ev("quiz"), ev("quiz", "negative", days(10))];
    expect(channelScore(events, "quiz", NOW, { halfLifeDays: 10 })).toBeCloseTo(
      0.0612245,
      6,
    );
  });

  test.each([
    ["1 positive aged 30 days", repeat(1, "quiz", "positive", days(30)), 0.2],
    [
      "3 positives aged 60 days",
      repeat(3, "quiz", "positive", days(60)),
      0.272727,
    ],
    [
      "positive now + negative 30 days old",
      [ev("quiz"), ev("quiz", "negative", days(30))],
      0.0612245,
    ],
  ])("uniformly old evidence fades: %s", (_name, events, expected) => {
    expect(channelScore(events, "quiz", NOW)).toBeCloseTo(expected, 6);
  });

  test("tiny half-life: fresh stays 0.6, long-aged underflows to a finite ~0", () => {
    const hl = { halfLifeDays: 0.001 };
    expect(channelScore(repeat(3, "quiz"), "quiz", NOW, hl)).toBeCloseTo(
      0.6,
      6,
    );
    const aged = channelScore(
      repeat(3, "quiz", "positive", 26 * 3_600_000),
      "quiz",
      NOW,
      hl,
    );
    expect(Number.isFinite(aged)).toBe(true);
    expect(Math.abs(aged)).toBeLessThan(1e-6);
  });

  const ages = [0, 1, 10, 30, 60, 365, 900].map((d) => days(d));
  test.each(ages.slice(1).map((age, i) => [ages[i] ?? 0, age] as const))(
    "all-positive score never rises as age grows (%d ms -> %d ms)",
    (younger, older) => {
      const a = channelScore(
        repeat(3, "quiz", "positive", younger),
        "quiz",
        NOW,
      );
      const b = channelScore(repeat(3, "quiz", "positive", older), "quiz", NOW);
      expect(Number.isNaN(a)).toBe(false);
      expect(Number.isNaN(b)).toBe(false);
      expect(b).toBeLessThanOrEqual(a);
    },
  );

  test("an event in the future counts as age 0", () => {
    expect(
      channelScore([ev("quiz", "positive", -days(3))], "quiz", NOW),
    ).toBeCloseTo(1 / 3, 6);
    const skewed = [ev("quiz", "positive", -days(3)), ev("quiz", "negative")];
    expect(channelScore(skewed, "quiz", NOW)).toBeCloseTo(-0.1, 6);
  });
});

describe("dimensionScore", () => {
  const events = [
    ...repeat(3, "observed"),
    ...repeat(1, "explain-back"),
    ...repeat(1, "quiz", "negative"),
    ...repeat(3, "self-report"),
  ];

  test.each([
    ["apply", 0.6],
    ["understand", 1 / 3],
    ["recall", -1 / 3],
  ] as const)("%s reads only its mapped channel", (dimension, expected) => {
    expect(dimensionScore(events, dimension, NOW)).toBeCloseTo(expected, 6);
  });
});

describe("isSatisfied", () => {
  test("one fresh positive is not satisfied, two are", () => {
    expect(isSatisfied(channelScore(repeat(1, "quiz"), "quiz", NOW))).toBe(
      false,
    );
    expect(isSatisfied(channelScore(repeat(2, "quiz"), "quiz", NOW))).toBe(
      true,
    );
  });

  test.each([
    [0.5, true],
    [0.4999, false],
    [1, true],
    [-1, false],
  ])("score %d -> %s", (score, expected) => {
    expect(isSatisfied(score)).toBe(expected);
  });
});

describe("topicScore", () => {
  test("no events scores 0", () => {
    expect(topicScore([], NOW)).toBe(0);
  });

  test("all channels at 0.6 give 0.6", () => {
    const events = [
      ...repeat(3, "observed"),
      ...repeat(3, "explain-back"),
      ...repeat(3, "quiz"),
      ...repeat(3, "self-report"),
    ];
    expect(topicScore(events, NOW)).toBeCloseTo(0.6, 6);
  });

  test.each([
    ["observed", 0.24],
    ["explain-back", 0.18],
    ["quiz", 0.12],
    ["self-report", 0.06],
  ] as const)(
    "%s alone is weighted by DEFAULT_WEIGHTS",
    (channel, expected) => {
      expect(topicScore(repeat(3, channel), NOW)).toBeCloseTo(expected, 6);
    },
  );

  test("self-report alone is capped well below the satisfaction threshold", () => {
    expect(topicScore(repeat(50, "self-report"), NOW)).toBeLessThan(0.1);
  });

  test("custom weights replace the defaults", () => {
    const weights = {
      observed: 1,
      "explain-back": 0,
      quiz: 0,
      "self-report": 0,
    };
    const events = [...repeat(3, "observed"), ...repeat(3, "quiz", "negative")];
    expect(topicScore(events, NOW, { weights })).toBeCloseTo(0.6, 6);
  });

  test.each([
    [
      "negative",
      { observed: -1, "explain-back": 1, quiz: 1, "self-report": 1 },
    ],
    ["NaN", { observed: NaN, "explain-back": 1, quiz: 1, "self-report": 1 }],
    [
      "infinite",
      { observed: Infinity, "explain-back": 1, quiz: 1, "self-report": 1 },
    ],
    ["all zero", { observed: 0, "explain-back": 0, quiz: 0, "self-report": 0 }],
  ])("rejects %s weights with RangeError", (_name, weights) => {
    expect(() => topicScore([ev("quiz")], NOW, { weights })).toThrowError(
      RangeError,
    );
  });
});

describe("caller errors", () => {
  test.each([NaN, Infinity, -Infinity])("non-finite now %d", (now) => {
    expect(() => channelScore([ev("quiz")], "quiz", now)).toThrowError(/now/);
    expect(() => channelScore([ev("quiz")], "quiz", now)).toThrowError(
      RangeError,
    );
    expect(() => dimensionScore([], "recall", now)).toThrowError(RangeError);
    expect(() => topicScore([], now)).toThrowError(RangeError);
  });

  test.each([0, -1, NaN, Infinity])(
    "invalid halfLifeDays %d",
    (halfLifeDays) => {
      const run = (): number =>
        channelScore([ev("quiz")], "quiz", NOW, { halfLifeDays });
      expect(run).toThrowError(RangeError);
      expect(run).toThrowError(/halfLifeDays/);
    },
  );

  test("more than 10_000 events is rejected; exactly 10_000 is accepted", () => {
    expect(() =>
      channelScore(repeat(10_001, "quiz"), "quiz", NOW),
    ).toThrowError(RangeError);
    expect(() =>
      channelScore(repeat(10_000, "quiz"), "quiz", NOW),
    ).not.toThrowError();
  });

  test("events about more than one topic are rejected", () => {
    const mixed = [ev("quiz"), ev("quiz", "positive", 0, "s1", "other-topic")];
    expect(() => channelScore(mixed, "quiz", NOW)).toThrowError(RangeError);
    expect(() => channelScore(mixed, "quiz", NOW)).toThrowError(/topic/);
    expect(() => topicScore(mixed, NOW)).toThrowError(RangeError);
  });

  test("the error message does not echo event contents", () => {
    const mixed = [
      ev("quiz", "positive", 0, "secret-sess"),
      ev("quiz", "positive", 0, "s1", "other-topic"),
    ];
    expect(() => channelScore(mixed, "quiz", NOW)).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining("secret-sess") as unknown,
      }) as Error,
    );
  });
});

describe("calibration", () => {
  test("updateCalibration increments the matching counter only", () => {
    const c: Calibration = { confirmed: 2, refuted: 1 };
    expect(updateCalibration(c, "confirmed")).toEqual({
      confirmed: 3,
      refuted: 1,
    });
    expect(updateCalibration(c, "refuted")).toEqual({
      confirmed: 2,
      refuted: 2,
    });
  });

  test.each(["none", "unverified"] as const)(
    "%s returns an equal copy",
    (outcome) => {
      const c: Calibration = { confirmed: 2, refuted: 1 };
      const next = updateCalibration(c, outcome);
      expect(next).toEqual(c);
      expect(next).not.toBe(c);
    },
  );

  test("does not mutate its input", () => {
    const c: Calibration = { confirmed: 0, refuted: 0 };
    updateCalibration(c, "confirmed");
    expect(c).toEqual({ confirmed: 0, refuted: 0 });
  });

  test.each([
    { confirmed: -1, refuted: 0 },
    { confirmed: 0, refuted: -1 },
    { confirmed: 1.5, refuted: 0 },
    { confirmed: 0, refuted: 0.5 },
  ])("invalid counts %j throw RangeError", (c) => {
    expect(() => updateCalibration(c, "confirmed")).toThrowError(RangeError);
  });

  test.each([
    [{ confirmed: 0, refuted: 0 }, 0.5],
    [{ confirmed: 3, refuted: 0 }, 0.8],
    [{ confirmed: 0, refuted: 3 }, 0.2],
    [{ confirmed: 1, refuted: 1 }, 0.5],
  ])("calibrationScore %j -> %d", (c, expected) => {
    expect(calibrationScore(c)).toBeCloseTo(expected, 6);
  });
});

describe("review scheduling", () => {
  test.each([
    [0, 1],
    [1, 3],
    [2, 7],
    [3, 14],
    [4, 30],
    [5, 30],
    [99, 30],
  ])("passes %d -> %d days", (passes, expectedDays) => {
    expect(reviewIntervalMs(passes)).toBe(expectedDays * DAY);
  });

  test.each([-1, 1.5, NaN])("invalid passes %d throws RangeError", (passes) => {
    expect(() => reviewIntervalMs(passes)).toThrowError(RangeError);
  });

  test("isReviewDue is true at exactly the interval, false one ms before", () => {
    const last = 5_000;
    expect(isReviewDue(last, 1, last + 3 * DAY)).toBe(true);
    expect(isReviewDue(last, 1, last + 3 * DAY - 1)).toBe(false);
    expect(isReviewDue(last, 0, last + DAY)).toBe(true);
    expect(isReviewDue(last, 9, last + 30 * DAY - 1)).toBe(false);
  });
});

describe("channelScore order independence", () => {
  // Quiz events, half-life 30 days, newest = now (the future event is capped).
  // positives: ages 0, -2 d (capped to 0), 10, 20, 30 days; negatives: ages
  // 10 and 20 days (ties on `at` with a positive each).
  // pos weights: 1 + 1 + 0.793701 + 0.629961 + 0.5 = 3.923661
  // neg weights: 1.5 * (0.793701 + 0.629961) = 2.135492
  // raw = (3.923661 - 2.135492) / (3.923661 + 2.135492) = 0.295119
  // neff = 1 + 1 + 2 * 0.793701 + 2 * 0.629961 + 0.5 = 5.347322
  // score = 0.295119 * 5.347322 / 7.347322 = 0.214785
  const sorted = [
    ev("quiz", "positive", days(30), "s1"),
    ev("quiz", "positive", days(20), "s1"),
    ev("quiz", "negative", days(20), "s2"),
    ev("quiz", "positive", days(10), "s1"),
    ev("quiz", "negative", days(10), "s2"),
    ev("quiz", "positive", 0, "s1"),
    ev("quiz", "positive", -days(2), "s3"),
  ];
  const shuffled = [3, 6, 0, 4, 2, 5, 1].map((i) => sorted[i] as Evidence);

  test.each([
    ["sorted", sorted],
    ["reversed", [...sorted].reverse()],
    ["shuffled", shuffled],
  ])("%s order gives the hand-pinned score", (_name, events) => {
    expect(channelScore(events, "quiz", NOW)).toBeCloseTo(0.21478505047, 9);
  });
});
