import { describe, expect, expectTypeOf, test } from "vitest";
import {
  parseScoringConfig,
  type ScoringConfig,
} from "../../src/internal/scoring-config.js";
import type { Channel } from "../../src/internal/schema.js";

const goodWeights = {
  observed: 1,
  "explain-back": 0.8,
  quiz: 0.6,
  "self-report": 0.3,
};

function w(over: Record<string, unknown>): {
  weights: Record<string, unknown>;
} {
  return { weights: { ...goodWeights, ...over } };
}

describe("parseScoringConfig basics", () => {
  test("empty object -> {}", () => {
    expect(parseScoringConfig({})).toEqual({ ok: true, value: {} });
  });

  test("full config is returned", () => {
    const input = {
      weights: goodWeights,
      halfLifeDays: 30,
      fluencySessions: 5,
    };
    expect(parseScoringConfig(input)).toEqual({ ok: true, value: input });
  });

  test("absent keys are omitted, not undefined", () => {
    const r = parseScoringConfig({ halfLifeDays: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ halfLifeDays: 10 });
      expect(Object.hasOwn(r.value, "weights")).toBe(false);
      expect(Object.hasOwn(r.value, "fluencySessions")).toBe(false);
    }
  });

  test("unknown keys ignored and not copied", () => {
    const r = parseScoringConfig({ halfLifeDays: 10, other: 1 });
    expect(r.ok && Object.hasOwn(r.value, "other")).toBe(false);
    expect(r.ok).toBe(true);
  });

  test.each([null, undefined, [], "x", 1, true])(
    "non-object %s rejected",
    (v) => {
      expect(parseScoringConfig(v).ok).toBe(false);
    },
  );

  test("result type lines up with the scorer options", () => {
    expectTypeOf<ScoringConfig["weights"]>().toEqualTypeOf<
      Readonly<Record<Channel, number>> | undefined
    >();
    expectTypeOf<ScoringConfig["halfLifeDays"]>().toEqualTypeOf<
      number | undefined
    >();
  });

  test("reads each key exactly once", () => {
    const counts: Record<string, number> = {};
    const vals: Record<string, unknown> = {
      weights: goodWeights,
      halfLifeDays: 30,
      fluencySessions: 5,
    };
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(vals)) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    expect(parseScoringConfig(obj).ok).toBe(true);
    expect(counts).toEqual({ weights: 1, halfLifeDays: 1, fluencySessions: 1 });
  });

  test("reads each weight exactly once", () => {
    const counts: Record<string, number> = {};
    const weights: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(goodWeights)) {
      Object.defineProperty(weights, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    expect(parseScoringConfig({ weights }).ok).toBe(true);
    expect(Object.values(counts)).toEqual([1, 1, 1, 1]);
  });

  test("reason names the field and never echoes the value", () => {
    const r = parseScoringConfig({ halfLifeDays: "LEAK_MARKER_1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("halfLifeDays");
      expect(r.reason).not.toContain("LEAK_MARKER_1");
    }
  });
});

describe("weights", () => {
  test("accepted", () => {
    expect(parseScoringConfig({ weights: goodWeights }).ok).toBe(true);
  });

  test.each(["observed", "explain-back", "quiz", "self-report"])(
    "missing %s rejected",
    (key) => {
      const weights: Record<string, number> = { ...goodWeights };
      delete weights[key];
      const r = parseScoringConfig({ weights });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("weights");
      }
    },
  );

  test.each([
    ["negative", { quiz: -0.1 }],
    ["NaN", { quiz: Number.NaN }],
    ["Infinity", { quiz: Number.POSITIVE_INFINITY }],
    ["string", { quiz: "1" }],
    ["null", { quiz: null }],
  ])("bad value %s rejected", (_l, over) => {
    expect(parseScoringConfig(w(over)).ok).toBe(false);
  });

  test("zero weight accepted when self-report is also zero", () => {
    expect(
      parseScoringConfig({
        weights: {
          observed: 1,
          "explain-back": 0.8,
          quiz: 0,
          "self-report": 0,
        },
      }).ok,
    ).toBe(true);
  });

  test("self-report above a zero channel is rejected naming self-report", () => {
    const r = parseScoringConfig({
      weights: {
        observed: 1,
        "explain-back": 0.8,
        quiz: 0,
        "self-report": 0.3,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("self-report");
    }
  });

  test("all evidence channels zero with self-report > 0 is rejected", () => {
    expect(
      parseScoringConfig({
        weights: { observed: 0, "explain-back": 0, quiz: 0, "self-report": 1 },
      }).ok,
    ).toBe(false);
  });

  test("all zero -> sum not > 0 rejected", () => {
    expect(
      parseScoringConfig({
        weights: { observed: 0, "explain-back": 0, quiz: 0, "self-report": 0 },
      }).ok,
    ).toBe(false);
  });

  test("sum overflow rejected", () => {
    const big = Number.MAX_VALUE;
    expect(
      parseScoringConfig({
        weights: {
          observed: big,
          "explain-back": big,
          quiz: big,
          "self-report": big,
        },
      }).ok,
    ).toBe(false);
  });

  test.each(["observed", "explain-back", "quiz"])(
    "self-report equal to %s passes, greater fails",
    (other) => {
      const base = { observed: 2, "explain-back": 2, quiz: 2 };
      expect(
        parseScoringConfig({
          weights: { ...base, "self-report": 2 },
        }).ok,
      ).toBe(true);
      // Make `other` the sole minimum so only it can trigger the cap.
      const lowered = { ...base, [other]: 1 };
      expect(
        parseScoringConfig({ weights: { ...lowered, "self-report": 1 } }).ok,
      ).toBe(true);
      expect(
        parseScoringConfig({ weights: { ...lowered, "self-report": 1.5 } }).ok,
      ).toBe(false);
    },
  );

  test("not an object rejected", () => {
    expect(parseScoringConfig({ weights: [] }).ok).toBe(false);
    expect(parseScoringConfig({ weights: null }).ok).toBe(false);
    expect(parseScoringConfig({ weights: 1 }).ok).toBe(false);
  });

  test("extra weight keys ignored and not copied", () => {
    const r = parseScoringConfig({ weights: { ...goodWeights, bonus: 5 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value.weights ?? {}, "bonus")).toBe(false);
      expect(r.value.weights).toEqual(goodWeights);
    }
  });
});

describe("halfLifeDays", () => {
  test.each([0.001, 1, 30, 1e300])("accepts %s", (v) => {
    expect(parseScoringConfig({ halfLifeDays: v })).toEqual({
      ok: true,
      value: { halfLifeDays: v },
    });
  });

  test.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["1e301 overflows when multiplied", 1e301],
    ["string", "30"],
    ["null", null],
  ])("rejects %s", (_l, v) => {
    expect(parseScoringConfig({ halfLifeDays: v }).ok).toBe(false);
  });
});

describe("fluencySessions", () => {
  test.each([1, 2, 1000])("accepts %i", (v) => {
    expect(parseScoringConfig({ fluencySessions: v })).toEqual({
      ok: true,
      value: { fluencySessions: v },
    });
  });

  test.each([
    ["0", 0],
    ["1001", 1001],
    ["2.5", 2.5],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["string", "5"],
    ["null", null],
  ])("rejects %s", (_l, v) => {
    expect(parseScoringConfig({ fluencySessions: v }).ok).toBe(false);
  });
});

describe("inherited fields are ignored", () => {
  test("prototype-carried halfLifeDays, fluencySessions and weights", () => {
    const input = Object.create({
      halfLifeDays: 30,
      fluencySessions: 5,
      weights: goodWeights,
    }) as Record<string, unknown>;
    expect(parseScoringConfig(input)).toEqual({ ok: true, value: {} });
  });

  test("prototype-carried weight keys do not satisfy the all-channels rule", () => {
    const weights = Object.create(goodWeights) as Record<string, unknown>;
    expect(parseScoringConfig({ weights }).ok).toBe(false);
  });
});
