import { describe, expect, expectTypeOf, test } from "vitest";
import {
  recomputeProfile,
  type RecomputeOutcome,
} from "../../src/internal/recompute.js";
import { parseCatalog } from "../../src/internal/catalog.js";
import type {
  CatalogEntry,
  Evidence,
  Level,
  TopicId,
} from "../../src/internal/schema.js";
import type { Profile, TopicProfile } from "../../src/internal/state-schema.js";
import { DAY, NOW, days, ev } from "./fixtures/evidence.js";

function entry(
  id: string,
  type: string,
  targetLevel: Level,
  enabled = true,
): Record<string, unknown> {
  return {
    id,
    title: id,
    type,
    dependencies: [],
    keywords: [id],
    targetLevel,
    enabled,
  };
}

function catalogOf(...raw: Record<string, unknown>[]): readonly CatalogEntry[] {
  const parsed = parseCatalog(raw);
  if (!parsed.ok) throw new Error(`bad catalog fixture: ${parsed.reason}`);
  return parsed.value;
}

const CONCEPT = "context-window";
const FEATURE = "claude-md";
const FAST = "new-features";
const CATALOG = catalogOf(
  entry(CONCEPT, "concept", "Understood"),
  entry(FEATURE, "feature", "Applied"),
  entry(FAST, "fast-moving", "Introduced"),
  entry("off-topic", "concept", "Understood", false),
);

function profileOf(
  topics: Record<string, Partial<TopicProfile>> = {},
): Profile {
  const full: Record<string, TopicProfile> = {};
  for (const [id, t] of Object.entries(topics)) {
    full[id] = {
      introduced: false,
      level: "Unseen",
      lastPassAt: null,
      passes: 0,
      ...t,
    };
  }
  return {
    schemaVersion: 1,
    topics: full,
    calibration: { confirmed: 3, refuted: 1 },
  };
}

function run(
  events: readonly Evidence[],
  profile: Profile = profileOf(),
  scoring: { halfLifeDays?: number; fluencySessions?: number } = {},
  catalog: readonly CatalogEntry[] = CATALOG,
  raiseOnly?: boolean,
): RecomputeOutcome {
  return recomputeProfile({
    profile,
    events,
    catalog,
    scoring,
    now: NOW,
    ...(raiseOnly === undefined ? {} : { raiseOnly }),
  });
}

function levelOf(outcome: RecomputeOutcome, id: string): Level | undefined {
  return Object.hasOwn(outcome.profile.topics, id)
    ? outcome.profile.topics[id]?.level
    : undefined;
}

function many(
  count: number,
  channel: Parameters<typeof ev>[0],
  topic: string,
  result: "positive" | "negative" = "positive",
  ageMs = 0,
): Evidence[] {
  return Array.from({ length: count }, () =>
    ev(channel, result, ageMs, "s1", topic),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("recomputeProfile level derivation", () => {
  test("one positive quiz is Introduced and two (boundary) are Recalled", () => {
    expect(levelOf(run(many(1, "quiz", CONCEPT)), CONCEPT)).toBe("Introduced");
    expect(levelOf(run(many(2, "quiz", CONCEPT)), CONCEPT)).toBe("Recalled");
  });

  test("one positive observed is Introduced and two are Applied (feature)", () => {
    expect(levelOf(run(many(1, "observed", FEATURE)), FEATURE)).toBe(
      "Introduced",
    );
    expect(levelOf(run(many(2, "observed", FEATURE)), FEATURE)).toBe("Applied");
  });

  test("quiz plus explain-back on a concept reaches Understood", () => {
    const events = [
      ...many(2, "quiz", CONCEPT),
      ...many(2, "explain-back", CONCEPT),
    ];
    expect(levelOf(run(events), CONCEPT)).toBe("Understood");
  });

  test("a positive self-report alone is Claimed", () => {
    expect(levelOf(run(many(1, "self-report", CONCEPT)), CONCEPT)).toBe(
      "Claimed",
    );
  });

  test("a negative quiz alone is Introduced", () => {
    expect(levelOf(run(many(1, "quiz", CONCEPT, "negative")), CONCEPT)).toBe(
      "Introduced",
    );
  });

  test("a fast-moving topic never rises above Introduced", () => {
    expect(levelOf(run(many(5, "observed", FAST)), FAST)).toBe("Introduced");
  });

  function fluentEvents(spanMs: number): Evidence[] {
    const sessions = ["s1", "s2", "s3"];
    return sessions.flatMap((session, i) =>
      (["quiz", "explain-back"] as const).map((channel) =>
        ev(channel, "positive", (spanMs * (2 - i)) / 2, session, CONCEPT),
      ),
    );
  }

  test("three sessions spanning a day reach Fluent", () => {
    expect(levelOf(run(fluentEvents(DAY)), CONCEPT)).toBe("Fluent");
  });

  test("three sessions spanning under a day stay Understood", () => {
    expect(levelOf(run(fluentEvents(DAY - 2)), CONCEPT)).toBe("Understood");
  });

  test("fluencySessions override raises the bar", () => {
    const events = fluentEvents(DAY);
    expect(
      levelOf(run(events, profileOf(), { fluencySessions: 3 }), CONCEPT),
    ).toBe("Fluent");
    expect(
      levelOf(run(events, profileOf(), { fluencySessions: 4 }), CONCEPT),
    ).toBe("Understood");
  });

  test("halfLifeDays override changes how much old evidence counts", () => {
    const old = many(3, "observed", FEATURE, "positive", days(30));
    expect(levelOf(run(old), FEATURE)).toBe("Introduced");
    expect(
      levelOf(run(old, profileOf(), { halfLifeDays: 3650 }), FEATURE),
    ).toBe("Applied");
  });

  test("only that topic's events feed its level", () => {
    const events = [
      ...many(2, "observed", FEATURE),
      ...many(1, "observed", CONCEPT),
    ];
    const out = run(events);
    expect(levelOf(out, FEATURE)).toBe("Applied");
    expect(levelOf(out, CONCEPT)).toBe("Introduced");
  });
});

describe("recomputeProfile profile updates", () => {
  test("a new entry gets introduced false, lastPassAt null, passes 0", () => {
    const out = run(many(2, "quiz", CONCEPT));
    expect(out.profile.topics[CONCEPT]).toEqual({
      introduced: false,
      level: "Recalled",
      lastPassAt: null,
      passes: 0,
    });
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("an existing entry with another level keeps introduced, passes, lastPassAt", () => {
    const profile = profileOf({
      [CONCEPT]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: 12_345,
        passes: 4,
      },
    });
    const out = run(many(2, "quiz", CONCEPT), profile);
    expect(out.profile.topics[CONCEPT]).toEqual({
      introduced: true,
      level: "Recalled",
      lastPassAt: 12_345,
      passes: 4,
    });
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("a stored level above the derived one is lowered", () => {
    const profile = profileOf({ [CONCEPT]: { level: "Fluent", passes: 2 } });
    const out = run(many(1, "quiz", CONCEPT, "negative"), profile);
    expect(levelOf(out, CONCEPT)).toBe("Introduced");
    expect(out.profile.topics[CONCEPT]?.passes).toBe(2);
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("an entry already at the derived level is untouched and the same profile comes back", () => {
    const profile = profileOf({
      [CONCEPT]: { introduced: true, level: "Recalled", passes: 1 },
    });
    const out = run(many(2, "quiz", CONCEPT), profile);
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("a topic with no events keeps its stored level without decay", () => {
    const profile = profileOf({ [FEATURE]: { level: "Applied" } });
    const out = run(many(2, "quiz", CONCEPT), profile);
    expect(levelOf(out, FEATURE)).toBe("Applied");
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("no events at all returns the same profile and no change", () => {
    const profile = profileOf({ [FEATURE]: { level: "Applied" } });
    const out = run([], profile);
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("events for disabled or unknown topics are ignored", () => {
    const profile = profileOf();
    const out = run(
      [...many(2, "quiz", "off-topic"), ...many(2, "quiz", "not-in-catalog")],
      profile,
    );
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("changed follows catalog order regardless of event order", () => {
    const events = [
      ...many(2, "observed", FAST),
      ...many(2, "observed", FEATURE),
      ...many(2, "quiz", CONCEPT),
    ];
    expect(run(events).changed).toEqual([CONCEPT, FEATURE, FAST]);
  });

  test("the calibration is carried through unchanged", () => {
    const out = run(many(2, "quiz", CONCEPT));
    expect(out.profile.calibration).toEqual({ confirmed: 3, refuted: 1 });
    expect(out.profile.schemaVersion).toBe(1);
  });

  test("an inherited Object.prototype name is not read as an existing entry", () => {
    const catalog = catalogOf(entry("constructor", "concept", "Understood"));
    const out = run(many(2, "quiz", "constructor"), profileOf(), {}, catalog);
    expect(Object.hasOwn(out.profile.topics, "constructor")).toBe(true);
    expect(levelOf(out, "constructor")).toBe("Recalled");
    expect(out.changed).toEqual(["constructor"]);
  });

  // Not tested: "no entry + derived Unseen creates nothing" is an equivalent
  // mutant, since reconcile never returns Unseen when events exist.
  test("never creates more than 500 entries", () => {
    const existing: Record<string, Partial<TopicProfile>> = {};
    for (let i = 0; i < 499; i += 1) existing[`other-${String(i)}`] = {};
    const profile = profileOf(existing);
    const events = [
      ...many(2, "observed", FEATURE),
      ...many(2, "quiz", CONCEPT),
    ];
    const out = run(events, profile);
    expect(Object.keys(out.profile.topics)).toHaveLength(500);
    expect(out.changed).toEqual([CONCEPT]);
    expect(levelOf(out, CONCEPT)).toBe("Recalled");
    expect(Object.hasOwn(out.profile.topics, FEATURE)).toBe(false);
  });

  test("uses only the newest 10,000 events of a topic (oldest dropped)", () => {
    // Index 0 and 1 are the only observed events. Dropping the oldest leaves
    // one (not satisfied, self-report makes it Claimed); dropping the newest
    // end would keep both (Applied).
    const events = [
      ...many(2, "observed", FEATURE),
      ...many(9_999, "self-report", FEATURE),
    ];
    expect(events).toHaveLength(10_001);
    expect(levelOf(run(events), FEATURE)).toBe("Claimed");
  });
});

describe("recomputeProfile raiseOnly", () => {
  const oldApplied = (): Evidence[] =>
    many(2, "observed", FEATURE, "positive", days(30));

  test("by default a decayed derived level still lowers the stored one", () => {
    const profile = profileOf({ [FEATURE]: { level: "Applied" } });
    const out = run(oldApplied(), profile);
    expect(levelOf(out, FEATURE)).toBe("Introduced");
    expect(out.changed).toEqual([FEATURE]);
    const explicit = run(oldApplied(), profile, {}, CATALOG, false);
    expect(levelOf(explicit, FEATURE)).toBe("Introduced");
  });

  test("a lower derived level leaves the same profile object and no change", () => {
    const profile = profileOf({ [FEATURE]: { level: "Applied" } });
    const out = run(oldApplied(), profile, {}, CATALOG, true);
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("a negative-evidence derived level does not lower a stored Fluent", () => {
    const profile = profileOf({ [CONCEPT]: { level: "Fluent" } });
    const out = run(
      many(1, "quiz", CONCEPT, "negative"),
      profile,
      {},
      CATALOG,
      true,
    );
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("a derived level exactly one rank lower is not applied", () => {
    // Understood (rank 4) stored; two positive quizzes derive Recalled (rank 3).
    const profile = profileOf({ [CONCEPT]: { level: "Understood" } });
    const out = run(many(2, "quiz", CONCEPT), profile, {}, CATALOG, true);
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("an equal derived level is no change", () => {
    const profile = profileOf({ [CONCEPT]: { level: "Recalled" } });
    const out = run(many(2, "quiz", CONCEPT), profile, {}, CATALOG, true);
    expect(out.profile).toBe(profile);
    expect(out.changed).toEqual([]);
  });

  test("a higher derived level raises and keeps the other fields", () => {
    const profile = profileOf({
      [CONCEPT]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: 99,
        passes: 2,
      },
    });
    const out = run(many(2, "quiz", CONCEPT), profile, {}, CATALOG, true);
    expect(out.profile.topics[CONCEPT]).toEqual({
      introduced: true,
      level: "Recalled",
      lastPassAt: 99,
      passes: 2,
    });
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("a new entry is still created above Unseen", () => {
    const out = run(many(2, "quiz", CONCEPT), profileOf(), {}, CATALOG, true);
    expect(out.profile.topics[CONCEPT]).toEqual({
      introduced: false,
      level: "Recalled",
      lastPassAt: null,
      passes: 0,
    });
    expect(out.changed).toEqual([CONCEPT]);
  });

  test("raising and keeping mix in one run", () => {
    const profile = profileOf({
      [FEATURE]: { level: "Applied" },
      [CONCEPT]: { level: "Introduced" },
    });
    const events = [...oldApplied(), ...many(2, "quiz", CONCEPT)];
    const out = run(events, profile, {}, CATALOG, true);
    expect(levelOf(out, FEATURE)).toBe("Applied");
    expect(levelOf(out, CONCEPT)).toBe("Recalled");
    expect(out.changed).toEqual([CONCEPT]);
  });
});

describe("recomputeProfile validation and purity", () => {
  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("rejects a %s now with RangeError", (_name, now) => {
    expect(() =>
      recomputeProfile({
        profile: profileOf(),
        events: many(2, "quiz", CONCEPT),
        catalog: CATALOG,
        scoring: {},
        now,
      }),
    ).toThrowError(RangeError);
  });

  test("accepts now of 0", () => {
    expect(() =>
      recomputeProfile({
        profile: profileOf(),
        events: [],
        catalog: CATALOG,
        scoring: {},
        now: 0,
      }),
    ).not.toThrow();
  });

  test("never mutates frozen inputs", () => {
    const profile = deepFreeze(
      profileOf({ [CONCEPT]: { level: "Introduced" } }),
    );
    const events = deepFreeze([
      ...many(2, "quiz", CONCEPT),
      ...many(2, "observed", FEATURE),
    ]);
    const catalog = deepFreeze([...CATALOG]);
    const scoring = deepFreeze({ halfLifeDays: 30 });
    const out = recomputeProfile({
      profile,
      events,
      catalog,
      scoring,
      now: NOW,
    });
    expect(out.changed).toEqual([CONCEPT, FEATURE]);
    expect(profile.topics[CONCEPT]?.level).toBe("Introduced");
    expect(Object.hasOwn(profile.topics, FEATURE)).toBe(false);
  });

  test("the outcome has typed fields", () => {
    expectTypeOf<RecomputeOutcome["profile"]>().toEqualTypeOf<Profile>();
    expectTypeOf<RecomputeOutcome["changed"]>().toEqualTypeOf<
      readonly TopicId[]
    >();
  });
});
