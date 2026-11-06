import { afterEach, describe, expect, test } from "vitest";
import {
  SCHEMA_VERSION,
  defaultState,
  parseSegmentState,
  parseState,
} from "../../src/internal/state-schema.js";

const seg = {
  segmentId: 3,
  startedAt: 1000,
  lastActivityAt: 2000,
  tipsEmitted: 1,
  lastTipAt: 1500,
  lastTopic: "context-window",
};

function state(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    muted: false,
    mutedTopics: [],
    excludedProjects: [],
    lastChangelogVersion: null,
    segment: { ...seg },
    ...over,
  };
}

function reasonOf(r: { ok: boolean; reason?: string }): string {
  expect(r.ok).toBe(false);
  return r.reason ?? "";
}

describe("defaultState", () => {
  test("pins the default shape", () => {
    expect(defaultState(500)).toEqual({
      schemaVersion: 1,
      muted: false,
      mutedTopics: [],
      excludedProjects: [],
      lastChangelogVersion: null,
      segment: {
        segmentId: 0,
        startedAt: 500,
        lastActivityAt: 500,
        tipsEmitted: 0,
        lastTipAt: null,
        lastTopic: null,
      },
    });
    expect(SCHEMA_VERSION).toBe(1);
  });

  test("round-trips through parseState", () => {
    const d = defaultState(1234);
    expect(parseState(d)).toEqual({ ok: true, value: d });
  });

  test("accepts now = 0", () => {
    expect(defaultState(0).segment.startedAt).toBe(0);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("throws RangeError naming now for %s", (_l, now) => {
    expect(() => defaultState(now)).toThrowError(RangeError);
    expect(() => defaultState(now)).toThrowError(/now/);
  });
});

describe("parseState", () => {
  test("accepts a full valid state and returns equal value", () => {
    const input = state({
      muted: true,
      mutedTopics: ["a", "b-c"],
      excludedProjects: ["/p/one"],
      lastChangelogVersion: "1.2.3-rc.1+build",
    });
    expect(parseState(input)).toEqual({ ok: true, value: input });
  });

  test.each([
    ["missing", undefined],
    ["0", 0],
    ["2", 2],
    ["string 1", "1"],
    ["null", null],
  ])("schemaVersion %s is unsupported", (_l, v) => {
    const input = state();
    if (v === undefined) {
      delete input["schemaVersion"];
    } else {
      input["schemaVersion"] = v;
    }
    expect(reasonOf(parseState(input))).toContain("schemaVersion");
  });

  test("a newer schemaVersion says unsupported schemaVersion", () => {
    expect(reasonOf(parseState(state({ schemaVersion: 2 })))).toContain(
      "unsupported schemaVersion",
    );
  });

  test.each([
    ["null", null],
    ["array", []],
    ["string", "x"],
    ["number", 1],
    ["undefined", undefined],
  ])("rejects non-object %s", (_l, v) => {
    expect(parseState(v).ok).toBe(false);
  });

  test.each([
    ["muted missing", "muted", undefined],
    ["muted string", "muted", "true"],
    ["muted number", "muted", 1],
    ["mutedTopics missing", "mutedTopics", undefined],
    ["mutedTopics not array", "mutedTopics", {}],
    ["excludedProjects missing", "excludedProjects", undefined],
    ["excludedProjects not array", "excludedProjects", "x"],
    ["lastChangelogVersion missing", "lastChangelogVersion", undefined],
    ["lastChangelogVersion number", "lastChangelogVersion", 1],
    ["segment missing", "segment", undefined],
    ["segment null", "segment", null],
  ])("%s fails naming the field", (_l, field, v) => {
    const input = state();
    if (v === undefined) {
      delete input[field];
    } else {
      input[field] = v;
    }
    expect(reasonOf(parseState(input))).toContain(field);
  });

  describe("mutedTopics", () => {
    const topics = (n: number): string[] =>
      Array.from({ length: n }, (_v, i) => `t${i.toString(36)}-x`);

    test("500 accepted", () => {
      expect(parseState(state({ mutedTopics: topics(500) })).ok).toBe(true);
    });
    test("501 rejected", () => {
      expect(
        reasonOf(parseState(state({ mutedTopics: topics(501) }))),
      ).toContain("mutedTopics");
    });
    test("invalid topic id rejected", () => {
      expect(parseState(state({ mutedTopics: ["Bad_Id"] })).ok).toBe(false);
    });
    test("non-string entry rejected", () => {
      expect(parseState(state({ mutedTopics: [5] })).ok).toBe(false);
    });
    test("duplicate rejected", () => {
      expect(parseState(state({ mutedTopics: ["a", "b", "a"] })).ok).toBe(
        false,
      );
    });
  });

  describe("excludedProjects", () => {
    const projs = (n: number): string[] =>
      Array.from({ length: n }, (_v, i) => `p${String(i)}`);

    test("200 accepted", () => {
      expect(parseState(state({ excludedProjects: projs(200) })).ok).toBe(true);
    });
    test("201 rejected", () => {
      expect(
        reasonOf(parseState(state({ excludedProjects: projs(201) }))),
      ).toContain("excludedProjects");
    });
    test("1024 chars accepted", () => {
      expect(
        parseState(state({ excludedProjects: ["x".repeat(1024)] })).ok,
      ).toBe(true);
    });
    test("1025 chars rejected", () => {
      expect(
        parseState(state({ excludedProjects: ["x".repeat(1025)] })).ok,
      ).toBe(false);
    });
    test("1 char accepted", () => {
      expect(parseState(state({ excludedProjects: ["x"] })).ok).toBe(true);
    });
    test("empty string rejected", () => {
      expect(parseState(state({ excludedProjects: [""] })).ok).toBe(false);
    });
    test("NUL rejected", () => {
      expect(parseState(state({ excludedProjects: ["a\0b"] })).ok).toBe(false);
    });
    test("non-string rejected", () => {
      expect(parseState(state({ excludedProjects: [1] })).ok).toBe(false);
    });
    test("duplicate rejected", () => {
      expect(parseState(state({ excludedProjects: ["a", "a"] })).ok).toBe(
        false,
      );
    });
  });

  describe("lastChangelogVersion", () => {
    test.each(["1", "1.2.3", "v1.0.0-rc.1+b", "A-z.9", "x".repeat(64)])(
      "accepts %s",
      (v) => {
        expect(parseState(state({ lastChangelogVersion: v })).ok).toBe(true);
      },
    );
    test.each([
      ["65 chars", "x".repeat(65)],
      ["empty", ""],
      ["space", "1 2"],
      ["slash", "1/2"],
      ["underscore", "1_2"],
      ["newline", "1\n"],
    ])("rejects %s", (_l, v) => {
      expect(parseState(state({ lastChangelogVersion: v })).ok).toBe(false);
    });
  });

  test("segment errors propagate", () => {
    expect(parseState(state({ segment: { ...seg, startedAt: 5000 } })).ok).toBe(
      false,
    );
  });

  test("extra keys are ignored and not copied", () => {
    const r = parseState(state({ extra: 1, segment: { ...seg, junk: 2 } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value, "extra")).toBe(false);
      expect(Object.hasOwn(r.value.segment, "junk")).toBe(false);
    }
  });

  test("returned lists are fresh copies", () => {
    const input = state({ mutedTopics: ["a"] });
    const r = parseState(input);
    expect(r.ok && r.value.mutedTopics !== input["mutedTopics"]).toBe(true);
  });

  test("reads each top-level field exactly once", () => {
    const counts: Record<string, number> = {};
    const base = state({ mutedTopics: ["a"] });
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(base)) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    expect(parseState(obj).ok).toBe(true);
    for (const key of Object.keys(base)) {
      expect(counts[key]).toBe(1);
    }
  });

  test.each([
    ["__proto__ muted topic", { mutedTopics: ["__proto__"] }],
    ["deep array of arrays", { mutedTopics: [[["a"]]] }],
    ["segment array", { segment: [] }],
  ])("hostile shape %s never throws", (_l, over) => {
    expect(() => parseState(state(over))).not.toThrow();
    expect(parseState(state(over)).ok).toBe(false);
  });

  test("hostile top-level values never throw", () => {
    for (const v of [
      Object.create(null),
      [[]],
      new Map(),
      () => 1,
      1n,
      Symbol("s"),
    ]) {
      expect(() => parseState(v)).not.toThrow();
    }
  });
});

describe("parseSegmentState", () => {
  test("accepts a valid segment", () => {
    expect(parseSegmentState(seg)).toEqual({ ok: true, value: seg });
  });

  test("accepts null lastTipAt/lastTopic and equal timestamps", () => {
    const s = {
      ...seg,
      startedAt: 7,
      lastActivityAt: 7,
      lastTipAt: null,
      lastTopic: null,
    };
    expect(parseSegmentState(s)).toEqual({ ok: true, value: s });
  });

  test("startedAt = 0 accepted", () => {
    expect(
      parseSegmentState({ ...seg, startedAt: 0, lastActivityAt: 0 }).ok,
    ).toBe(true);
  });

  test("startedAt > lastActivityAt rejected, startedAt = lastActivityAt ok", () => {
    expect(reasonOf(parseSegmentState({ ...seg, startedAt: 2001 }))).toContain(
      "startedAt",
    );
    expect(parseSegmentState({ ...seg, startedAt: 2000 }).ok).toBe(true);
  });

  test("segmentId boundary pair", () => {
    expect(
      parseSegmentState({ ...seg, segmentId: Number.MAX_SAFE_INTEGER - 1 }).ok,
    ).toBe(true);
    expect(
      parseSegmentState({ ...seg, segmentId: Number.MAX_SAFE_INTEGER }).ok,
    ).toBe(false);
    expect(parseSegmentState({ ...seg, segmentId: 0 }).ok).toBe(true);
    expect(parseSegmentState({ ...seg, segmentId: -1 }).ok).toBe(false);
  });

  test.each([
    ["segmentId", [1.5, "1", null, Number.NaN, Number.POSITIVE_INFINITY]],
    ["startedAt", [-1, "1", null, Number.NaN, Number.POSITIVE_INFINITY]],
    ["lastActivityAt", [-1, "1", null, Number.NaN, Number.POSITIVE_INFINITY]],
    ["tipsEmitted", [-1, 1.5, "1", null, Number.NaN, 2 ** 53]],
    ["lastTipAt", [-1, "1", Number.NaN, Number.POSITIVE_INFINITY, undefined]],
    ["lastTopic", ["Bad_Id", "", 5, undefined]],
  ] as const)("bad %s values are rejected naming the field", (field, bads) => {
    for (const bad of bads) {
      const r = parseSegmentState({ ...seg, [field]: bad });
      expect(r.ok, `${field}=${String(bad)}`).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain(field);
      }
    }
  });

  test("tipsEmitted 0 accepted", () => {
    expect(parseSegmentState({ ...seg, tipsEmitted: 0 }).ok).toBe(true);
  });

  test.each([
    "segmentId",
    "startedAt",
    "lastActivityAt",
    "tipsEmitted",
    "lastTipAt",
    "lastTopic",
  ])("missing %s rejected", (field) => {
    const s: Record<string, unknown> = { ...seg };
    delete s[field];
    expect(parseSegmentState(s).ok).toBe(false);
  });

  test("reason never echoes the raw value", () => {
    const r = parseSegmentState({ ...seg, lastTopic: "LEAK_MARKER_9" });
    expect(reasonOf(r)).not.toContain("LEAK_MARKER_9");
  });

  test("extra keys not copied", () => {
    const r = parseSegmentState({ ...seg, extra: 1 });
    expect(r.ok && Object.hasOwn(r.value, "extra")).toBe(false);
  });

  test("reads each field exactly once", () => {
    const counts: Record<string, number> = {};
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(seg)) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    expect(parseSegmentState(obj).ok).toBe(true);
    for (const key of Object.keys(seg)) {
      expect(counts[key]).toBe(1);
    }
  });

  test.each([null, undefined, [], "x", 1, true])(
    "non-object %s rejected without throwing",
    (v) => {
      expect(parseSegmentState(v).ok).toBe(false);
    },
  );
});

describe("sparse lists", () => {
  afterEach(() => {
    Reflect.deleteProperty(Array.prototype, "0");
  });

  function sparse(value: string): unknown[] {
    const arr: unknown[] = new Array<unknown>(2);
    arr[1] = value;
    return arr;
  }

  test.each([
    ["mutedTopics", "b"],
    ["excludedProjects", "/p/b"],
  ])("a hole in %s is rejected naming the field", (field, value) => {
    const r = parseState(state({ [field]: sparse(value) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain(field);
    }
  });

  test.each([
    ["mutedTopics", "b"],
    ["excludedProjects", "/p/b"],
  ])(
    "a hole in %s is rejected even when Array.prototype[0] is valid",
    (field, value) => {
      Object.defineProperty(Array.prototype, "0", {
        value: "polluted",
        configurable: true,
        writable: true,
        enumerable: false,
      });
      const r = parseState(state({ [field]: sparse(value) }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain(field);
      }
    },
  );
});
