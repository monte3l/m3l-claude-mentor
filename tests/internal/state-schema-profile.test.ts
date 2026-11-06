import { describe, expect, test } from "vitest";
import { LEVELS } from "../../src/internal/schema.js";
import {
  defaultProfile,
  parseProfile,
} from "../../src/internal/state-schema.js";

const topic = {
  introduced: true,
  level: "Recalled",
  lastPassAt: 1000,
  passes: 2,
};

function profile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    topics: { "context-window": { ...topic } },
    calibration: { confirmed: 3, refuted: 1 },
    ...over,
  };
}

function withTopic(over: Record<string, unknown>): Record<string, unknown> {
  return profile({ topics: { a: { ...topic, ...over } } });
}

describe("defaultProfile", () => {
  test("pins the default and round-trips", () => {
    const d = defaultProfile();
    expect(d).toEqual({
      schemaVersion: 1,
      topics: {},
      calibration: { confirmed: 0, refuted: 0 },
    });
    expect(parseProfile(d)).toEqual({ ok: true, value: d });
  });

  test("returns a fresh object each call", () => {
    expect(defaultProfile().topics).not.toBe(defaultProfile().topics);
  });
});

describe("parseProfile", () => {
  test("accepts a valid profile", () => {
    const input = profile();
    expect(parseProfile(input)).toEqual({ ok: true, value: input });
  });

  test.each(LEVELS)("accepts level %s", (level) => {
    expect(parseProfile(withTopic({ level })).ok).toBe(true);
  });

  test.each([
    ["level unknown", { level: "Master" }],
    ["level lowercase", { level: "fluent" }],
    ["level number", { level: 3 }],
    ["introduced string", { introduced: "yes" }],
    ["lastPassAt negative", { lastPassAt: -1 }],
    ["lastPassAt NaN", { lastPassAt: Number.NaN }],
    ["lastPassAt Infinity", { lastPassAt: Number.POSITIVE_INFINITY }],
    ["lastPassAt string", { lastPassAt: "1" }],
    ["passes negative", { passes: -1 }],
    ["passes fractional", { passes: 1.5 }],
    ["passes NaN", { passes: Number.NaN }],
    ["passes string", { passes: "1" }],
    ["passes over cap", { passes: 1_000_000_001 }],
  ])("rejects %s", (_l, over) => {
    expect(parseProfile(withTopic(over)).ok).toBe(false);
  });

  test("passes boundary pair 1e9 ok / 1e9+1 rejected, 0 ok", () => {
    expect(parseProfile(withTopic({ passes: 1_000_000_000 })).ok).toBe(true);
    expect(parseProfile(withTopic({ passes: 0 })).ok).toBe(true);
  });

  test("lastPassAt null and 0 accepted", () => {
    expect(parseProfile(withTopic({ lastPassAt: null })).ok).toBe(true);
    expect(parseProfile(withTopic({ lastPassAt: 0 })).ok).toBe(true);
  });

  test.each(["introduced", "level", "lastPassAt", "passes"])(
    "missing topic field %s rejected naming it",
    (field) => {
      const t: Record<string, unknown> = { ...topic };
      delete t[field];
      const r = parseProfile(profile({ topics: { a: t } }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain(field);
      }
    },
  );

  test.each([
    ["missing", undefined],
    ["0", 0],
    ["2", 2],
    ["string", "1"],
  ])("schemaVersion %s rejected", (_l, v) => {
    const input = profile();
    if (v === undefined) {
      delete input["schemaVersion"];
    } else {
      input["schemaVersion"] = v;
    }
    const r = parseProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("schemaVersion");
    }
  });

  test.each([
    ["uppercase key", { Bad: topic }],
    ["underscore key", { a_b: topic }],
    ["empty key", { "": topic }],
    [
      "__proto__ own key",
      JSON.parse(`{"__proto__": ${JSON.stringify(topic)}}`),
    ],
    ["array", [topic]],
    ["null", null],
    ["string", "x"],
  ])("topics %s rejected", (_l, topics) => {
    expect(parseProfile(profile({ topics })).ok).toBe(false);
  });

  test("500 topics ok, 501 rejected", () => {
    const mk = (n: number): Record<string, unknown> =>
      Object.fromEntries(
        Array.from({ length: n }, (_v, i) => [`t${String(i)}`, { ...topic }]),
      );
    expect(parseProfile(profile({ topics: mk(500) })).ok).toBe(true);
    expect(parseProfile(profile({ topics: mk(501) })).ok).toBe(false);
  });

  test("an own __proto__ key from JSON.parse is rejected", () => {
    const input: unknown = JSON.parse(
      `{"schemaVersion":1,"topics":{"__proto__":${JSON.stringify(topic)}},"calibration":{"confirmed":0,"refuted":0}}`,
    );
    const r = parseProfile(input);
    expect(r.ok).toBe(false);
    expect(Object.hasOwn({}, "level")).toBe(false);
  });

  test.each([
    ["confirmed negative", { confirmed: -1, refuted: 0 }],
    ["refuted negative", { confirmed: 0, refuted: -1 }],
    ["confirmed fractional", { confirmed: 0.5, refuted: 0 }],
    ["refuted NaN", { confirmed: 0, refuted: Number.NaN }],
    ["confirmed unsafe", { confirmed: 2 ** 53, refuted: 0 }],
    ["refuted string", { confirmed: 0, refuted: "0" }],
    ["confirmed missing", { refuted: 0 }],
    ["refuted missing", { confirmed: 0 }],
    ["not object", 5],
    ["null", null],
  ])("calibration %s rejected", (_l, calibration) => {
    expect(parseProfile(profile({ calibration })).ok).toBe(false);
  });

  test("calibration MAX_SAFE_INTEGER and 0 accepted", () => {
    const calibration = { confirmed: Number.MAX_SAFE_INTEGER, refuted: 0 };
    expect(parseProfile(profile({ calibration })).ok).toBe(true);
  });

  test("missing topics or calibration rejected", () => {
    const a = profile();
    delete a["topics"];
    const b = profile();
    delete b["calibration"];
    expect(parseProfile(a).ok).toBe(false);
    expect(parseProfile(b).ok).toBe(false);
  });

  test("extra keys not copied at any level", () => {
    const r = parseProfile(
      profile({
        extra: 1,
        topics: { a: { ...topic, junk: 1 } },
        calibration: { confirmed: 0, refuted: 0, junk: 1 },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value, "extra")).toBe(false);
      expect(Object.hasOwn(r.value.topics["a"] ?? {}, "junk")).toBe(false);
      expect(Object.hasOwn(r.value.calibration, "junk")).toBe(false);
    }
  });

  test("reason never echoes the raw value", () => {
    const r = parseProfile(withTopic({ level: "LEAK_MARKER_7" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain("LEAK_MARKER_7");
    }
  });

  test("reads each top-level and topic field exactly once", () => {
    const counts: Record<string, number> = {};
    const track = (
      prefix: string,
      src: Record<string, unknown>,
    ): Record<string, unknown> => {
      const obj: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(src)) {
        Object.defineProperty(obj, key, {
          enumerable: true,
          get() {
            const k = `${prefix}.${key}`;
            counts[k] = (counts[k] ?? 0) + 1;
            return val;
          },
        });
      }
      return obj;
    };
    const input = track("p", {
      schemaVersion: 1,
      topics: track("topics", { a: track("t", { ...topic }) }),
      calibration: track("c", { confirmed: 1, refuted: 2 }),
    });
    expect(parseProfile(input).ok).toBe(true);
    expect(Object.keys(counts).sort()).toEqual(
      [
        "p.schemaVersion",
        "p.topics",
        "p.calibration",
        "topics.a",
        "t.introduced",
        "t.level",
        "t.lastPassAt",
        "t.passes",
        "c.confirmed",
        "c.refuted",
      ].sort(),
    );
    for (const v of Object.values(counts)) {
      expect(v).toBe(1);
    }
  });

  test("hostile values never throw", () => {
    for (const v of [
      null,
      undefined,
      [],
      [[]],
      "x",
      1n,
      Object.create(null),
      profile({ topics: { a: null } }),
      profile({ topics: { a: [] } }),
      profile({ calibration: [] }),
    ]) {
      expect(() => parseProfile(v)).not.toThrow();
      expect(parseProfile(v).ok).toBe(false);
    }
  });
});
