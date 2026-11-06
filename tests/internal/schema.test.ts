import { describe, expect, expectTypeOf, test } from "vitest";
import {
  CHANNELS,
  DIMENSIONS,
  LEVELS,
  STYLES,
  TOPIC_TYPES,
  compareLevels,
  levelRank,
  parseCatalogEntry,
  parseEvidence,
  parseSessionId,
  parseTopicId,
  requiredDimensions,
  type Channel,
  type Dimension,
  type Level,
  type Parsed,
  type SessionId,
  type Style,
  type TopicId,
  type TopicType,
} from "../../src/internal/schema.js";

const validEntry = {
  id: "context-window",
  title: "The context window",
  type: "concept",
  dependencies: [],
  keywords: ["context", "tokens"],
  targetLevel: "Understood",
  enabled: true,
};

const validEvidence = {
  channel: "quiz",
  topic: "context-window",
  result: "positive",
  at: 1000,
  session: "sess_1",
};

describe("constants", () => {
  test("LEVELS is ordered", () => {
    expect([...LEVELS]).toEqual([
      "Unseen",
      "Introduced",
      "Claimed",
      "Recalled",
      "Understood",
      "Applied",
      "Fluent",
    ]);
  });

  test("other tuples hold the contract members", () => {
    expect([...CHANNELS]).toEqual([
      "observed",
      "explain-back",
      "quiz",
      "self-report",
    ]);
    expect([...DIMENSIONS]).toEqual(["apply", "understand", "recall"]);
    expect([...TOPIC_TYPES]).toEqual([
      "terminology",
      "concept",
      "feature",
      "practice",
      "fast-moving",
    ]);
    expect([...STYLES]).toEqual([
      "socratic",
      "explain-demo",
      "recall-quiz",
      "reference",
    ]);
  });

  test("derived union types", () => {
    expectTypeOf<Level>().toEqualTypeOf<(typeof LEVELS)[number]>();
    expectTypeOf<Channel>().toEqualTypeOf<(typeof CHANNELS)[number]>();
    expectTypeOf<Dimension>().toEqualTypeOf<(typeof DIMENSIONS)[number]>();
    expectTypeOf<TopicType>().toEqualTypeOf<(typeof TOPIC_TYPES)[number]>();
    expectTypeOf<Style>().toEqualTypeOf<(typeof STYLES)[number]>();
  });

  test("ids are branded strings, distinct from each other", () => {
    expectTypeOf<TopicId>().toExtend<string>();
    expectTypeOf<SessionId>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<TopicId>();
    expectTypeOf<TopicId>().not.toEqualTypeOf<SessionId>();
  });

  test("Parsed is a discriminated union", () => {
    expectTypeOf<Parsed<number>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: number }
      | { readonly ok: false; readonly reason: string }
    >();
  });
});

describe("parseTopicId", () => {
  test.each(["a", "context-window", "a1-b2-c3", "x".repeat(64)])(
    "accepts %s",
    (id) => {
      const r = parseTopicId(id);
      expect(r).toEqual({ ok: true, value: id });
    },
  );

  test.each([
    ["empty", ""],
    ["uppercase", "Abc"],
    ["leading hyphen", "-a"],
    ["trailing hyphen", "a-"],
    ["double hyphen", "a--b"],
    ["underscore", "a_b"],
    ["space", "a b"],
    ["too long", "x".repeat(65)],
    ["number", 5],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
  ])("rejects %s", (_name, value) => {
    const r = parseTopicId(value);
    expect(r.ok).toBe(false);
  });

  test("reason does not echo the raw input", () => {
    const r = parseTopicId("SECRET-VALUE_xyz");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.reason).not.toContain("SECRET-VALUE_xyz");
    }
  });
});

describe("parseSessionId", () => {
  test.each(["a", "Abc_123-x", "S".repeat(128)])("accepts %s", (id) => {
    expect(parseSessionId(id)).toEqual({ ok: true, value: id });
  });

  test.each([
    ["empty", ""],
    ["space", "a b"],
    ["dot", "a.b"],
    ["slash", "a/b"],
    ["too long", "S".repeat(129)],
    ["number", 1],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(parseSessionId(value).ok).toBe(false);
  });
});

describe("parseEvidence", () => {
  test("accepts a valid evidence object", () => {
    expect(parseEvidence(validEvidence)).toEqual({
      ok: true,
      value: validEvidence,
    });
  });

  test("ignores and does not copy extra keys", () => {
    const r = parseEvidence({ ...validEvidence, extra: "nope" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual(
        ["at", "channel", "result", "session", "topic"].sort(),
      );
    }
  });

  test.each([
    ["null", null],
    ["array", [validEvidence]],
    ["string", "x"],
    ["number", 3],
    ["undefined", undefined],
  ])("rejects non-object %s", (_n, v) => {
    expect(parseEvidence(v).ok).toBe(false);
  });

  test.each([
    ["channel", { channel: "telepathy" }],
    ["topic", { topic: "Bad Id" }],
    ["result", { result: "maybe" }],
    ["session", { session: "bad id" }],
    ["at negative", { at: -1 }],
    ["at NaN", { at: Number.NaN }],
    ["at Infinity", { at: Number.POSITIVE_INFINITY }],
    ["at string", { at: "5" }],
  ])("rejects invalid %s", (_n, patch) => {
    expect(parseEvidence({ ...validEvidence, ...patch }).ok).toBe(false);
  });

  test("accepts at = 0 and negative result", () => {
    expect(
      parseEvidence({ ...validEvidence, at: 0, result: "negative" }).ok,
    ).toBe(true);
  });

  test.each(["channel", "topic", "result", "at", "session"])(
    "rejects missing %s",
    (key) => {
      const copy: Record<string, unknown> = { ...validEvidence };
      delete copy[key];
      expect(parseEvidence(copy).ok).toBe(false);
    },
  );

  test("rejects a field only present on the prototype", () => {
    const proto = { channel: "quiz" };
    const obj = Object.create(proto) as Record<string, unknown>;
    Object.assign(obj, { ...validEvidence });
    delete obj["channel"];
    expect(parseEvidence(obj).ok).toBe(false);
  });

  test("reads each field exactly once (accessor safety)", () => {
    const counts: Record<string, number> = {};
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(validEvidence)) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    expect(parseEvidence(obj).ok).toBe(true);
    for (const key of Object.keys(validEvidence)) {
      expect(counts[key]).toBe(1);
    }
  });

  test("an accessor that changes value between reads cannot smuggle a bad value", () => {
    let reads = 0;
    const obj = {
      ...validEvidence,
      get channel(): unknown {
        reads += 1;
        return reads === 1 ? "quiz" : "bogus";
      },
    };
    const r = parseEvidence(obj);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.channel).toBe("quiz");
    }
  });
});

describe("levels", () => {
  test.each(LEVELS.map((l, i) => [l, i] as const))(
    "levelRank(%s) is %i",
    (level, index) => {
      expect(levelRank(level)).toBe(index);
    },
  );

  test("compareLevels orders like Array.sort", () => {
    expect(compareLevels("Unseen", "Fluent")).toBeLessThan(0);
    expect(compareLevels("Fluent", "Unseen")).toBeGreaterThan(0);
    expect(compareLevels("Applied", "Applied")).toBe(0);
    const shuffled: Level[] = ["Fluent", "Unseen", "Recalled", "Claimed"];
    expect(shuffled.sort(compareLevels)).toEqual([
      "Unseen",
      "Claimed",
      "Recalled",
      "Fluent",
    ]);
  });
});

describe("requiredDimensions", () => {
  test.each([
    ["terminology", ["recall"]],
    ["concept", ["understand", "recall"]],
    ["feature", ["apply", "understand"]],
    ["practice", ["apply", "understand"]],
    ["fast-moving", []],
  ] as const)("%s", (type, expected) => {
    expect([...requiredDimensions(type)]).toEqual(expected);
  });

  test("covers every topic type", () => {
    for (const type of TOPIC_TYPES) {
      expect(Array.isArray(requiredDimensions(type))).toBe(true);
    }
  });
});

describe("parseCatalogEntry", () => {
  test("accepts a valid entry, omitting absent style", () => {
    const r = parseCatalogEntry(validEntry);
    expect(r).toEqual({ ok: true, value: validEntry });
    if (r.ok) {
      expect(Object.hasOwn(r.value, "style")).toBe(false);
    }
  });

  test("keeps a supplied style", () => {
    const r = parseCatalogEntry({ ...validEntry, style: "socratic" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.style).toBe("socratic");
    }
  });

  test("lowercases and trims keywords", () => {
    const r = parseCatalogEntry({
      ...validEntry,
      keywords: ["  Plan Mode ", "CLAUDE.md"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.keywords).toEqual(["plan mode", "claude.md"]);
    }
  });

  test.each([
    ["null", null],
    ["array", []],
    ["bad id", { ...validEntry, id: "Bad" }],
    ["empty title", { ...validEntry, title: "" }],
    ["blank title", { ...validEntry, title: "   " }],
    ["long title", { ...validEntry, title: "t".repeat(121) }],
    ["bad type", { ...validEntry, type: "nope" }],
    ["bad level", { ...validEntry, targetLevel: "Master" }],
    ["bad style", { ...validEntry, style: "nope" }],
    ["enabled not boolean", { ...validEntry, enabled: "yes" }],
    ["dependencies not array", { ...validEntry, dependencies: "a" }],
    ["bad dependency id", { ...validEntry, dependencies: ["Bad Id"] }],
    ["duplicate dependency", { ...validEntry, dependencies: ["a", "a"] }],
    ["self dependency", { ...validEntry, dependencies: ["context-window"] }],
    ["keywords not array", { ...validEntry, keywords: "x" }],
    ["empty keyword", { ...validEntry, keywords: ["  "] }],
    ["long keyword", { ...validEntry, keywords: ["k".repeat(41)] }],
    [
      "too many keywords",
      {
        ...validEntry,
        keywords: Array.from({ length: 21 }, (_, i) => `k${i}`),
      },
    ],
  ])("rejects %s", (_n, v) => {
    const r = parseCatalogEntry(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  test("boundary: title of 120 chars, keyword of 40, 20 keywords accepted", () => {
    const r = parseCatalogEntry({
      ...validEntry,
      title: "t".repeat(120),
      keywords: Array.from(
        { length: 20 },
        (_, i) => `${"k".repeat(38)}${String(i).padStart(2, "0")}`,
      ),
    });
    expect(r.ok).toBe(true);
  });

  test("rejects a missing required field", () => {
    const copy: Record<string, unknown> = { ...validEntry };
    delete copy["enabled"];
    expect(parseCatalogEntry(copy).ok).toBe(false);
  });

  test("bad field reason names the field and not the value", () => {
    const r = parseCatalogEntry({ ...validEntry, type: "SECRET-TYPE" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("type");
      expect(r.reason).not.toContain("SECRET-TYPE");
    }
  });
});
