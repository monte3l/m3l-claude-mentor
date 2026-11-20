import { describe, expect, expectTypeOf, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import {
  parseExamItem,
  type ExamItem,
} from "../../src/internal/exam-schema.ts";
import { DAY_MS } from "../../src/internal/mastery.ts";
import {
  ACCURACY_BLEND,
  ITEM_HALF_LIFE_DAYS,
  LEVEL_CREDIT,
  MAX_ITEMS_PER_OBJECTIVE_PER_DAY,
  MIN_DOMAIN_ITEMS,
  MIN_EVIDENCE_WEIGHT_SHARE,
  MIN_TOTAL_ITEMS,
  computeReadiness,
  type Readiness,
  type ReadinessInput,
} from "../../src/internal/readiness.ts";
import {
  LEVELS,
  parseCatalogEntry,
  type CatalogEntry,
  type Level,
} from "../../src/internal/schema.ts";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.ts";
import { parseTrack, type Track } from "../../src/internal/tracks.ts";

const NOW = Date.UTC(2026, 10, 20);

/**
 * Objectives per fixture domain. Several, so `items` can spread a batch of
 * same-day items across them and stay under the per-objective daily cap.
 */
const OBJECTIVES_PER_DOMAIN = 8;

/** A track of N domains: Dn with objectives Dn.1..Dn.8, all mapped to topic-n. */
function makeTrack(weights: readonly number[], code = "CCAR-F"): Track {
  const parsed = parseTrack({
    schemaVersion: 1,
    code,
    title: "Fixture track",
    tier: "foundations",
    assumes: null,
    guide: {
      version: "1.0",
      effective: "2026-03",
      sourceUrl: "https://example.com/guide",
      reviewedAt: "2026-11-01",
    },
    format: {
      minutes: 120,
      passScaled: 720,
      scaleMax: 1000,
      itemKinds: ["single"],
    },
    scenarios: [],
    domains: weights.map((weight, i) => ({
      id: `D${String(i + 1)}`,
      name: `Domain ${String(i + 1)}`,
      weight,
      objectives: Array.from({ length: OBJECTIVES_PER_DOMAIN }, (_, o) => ({
        id: `D${String(i + 1)}.${String(o + 1)}`,
        summary: "An objective",
        topics: [`topic-${String(i + 1)}`],
      })),
    })),
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

function entry(id: string, enabled = true): CatalogEntry {
  const parsed = parseCatalogEntry({
    id,
    title: id,
    type: "concept",
    dependencies: [],
    keywords: [id],
    targetLevel: "Applied",
    enabled,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

function profileOf(levels: Readonly<Record<string, Level>>): Profile {
  const topics: Profile["topics"] = Object.fromEntries(
    Object.entries(levels).map(([id, level]) => [
      id,
      { introduced: level !== "Unseen", level, lastPassAt: null, passes: 0 },
    ]),
  );
  return { ...defaultProfile(), topics };
}

function item(
  track: string,
  domain: string,
  correct: boolean,
  at: number = NOW,
  objective = `${domain}.1`,
): ExamItem {
  const parsed = parseExamItem({
    v: 1,
    track,
    domain,
    objective,
    topic: "topic-1",
    kind: "single",
    mode: "drill",
    correct,
    at,
    session: "s1",
  });
  if (!parsed.ok) throw new Error(`bad fixture: ${parsed.reason}`);
  return parsed.value;
}

/**
 * `n` items for a domain, the first `right` of them correct, rotated across
 * the fixture objectives so the per-objective daily cap does not bind.
 */
function items(
  domain: string,
  n: number,
  right: number,
  at: number = NOW,
  track = "CCAR-F",
): ExamItem[] {
  return Array.from({ length: n }, (_, i) =>
    item(
      track,
      domain,
      i < right,
      at,
      `${domain}.${String((i % OBJECTIVES_PER_DOMAIN) + 1)}`,
    ),
  );
}

function catalogFor(count: number): CatalogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry(`topic-${String(i + 1)}`),
  );
}

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    track: makeTrack([60, 40]),
    catalog: catalogFor(2),
    profile: defaultProfile(),
    items: [],
    now: NOW,
    ...over,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const domainOf = (r: Readiness, id: string) => {
  const d = r.domains.find((x) => x.id === id);
  if (d === undefined) throw new Error(`no domain ${id}`);
  return d;
};

describe("constants", () => {
  test("pin the documented values", () => {
    expect(ITEM_HALF_LIFE_DAYS).toBe(21);
    expect(MIN_DOMAIN_ITEMS).toBe(4);
    expect(MIN_TOTAL_ITEMS).toBe(15);
    expect(MIN_EVIDENCE_WEIGHT_SHARE).toBe(60);
    expect(ACCURACY_BLEND).toBe(0.6);
    expect(MAX_ITEMS_PER_OBJECTIVE_PER_DAY).toBe(3);
  });

  test.each([
    ["Unseen", 0],
    ["Introduced", 0.1],
    ["Claimed", 0.1],
    ["Recalled", 0.5],
    ["Understood", 0.8],
    ["Applied", 1],
    ["Fluent", 1],
  ] as const)("LEVEL_CREDIT %s is %f", (level, credit) => {
    expect(LEVEL_CREDIT[level]).toBe(credit);
  });

  test("LEVEL_CREDIT covers every level", () => {
    expect(Object.keys(LEVEL_CREDIT).sort()).toEqual([...LEVELS].sort());
  });
});

describe("types", () => {
  test("the result shape is the contract", () => {
    expectTypeOf(computeReadiness).parameter(0).toEqualTypeOf<ReadinessInput>();
    expectTypeOf(computeReadiness).returns.toEqualTypeOf<Readiness>();
    expectTypeOf<Readiness["notAScorePrediction"]>().toEqualTypeOf<true>();
    expectTypeOf<Readiness["status"]>().toEqualTypeOf<
      "ok" | "insufficient-evidence"
    >();
    expectTypeOf<Readiness["index"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Readiness["domains"][number]["accuracy"]>().toEqualTypeOf<
      number | null
    >();
  });
});

describe("coverage", () => {
  test.each(LEVELS)("a topic at %s credits its level", (level) => {
    const r = computeReadiness(
      input({ profile: profileOf({ "topic-1": level }) }),
    );
    expect(domainOf(r, "D1").coverage).toBeCloseTo(LEVEL_CREDIT[level]);
    expect(domainOf(r, "D2").coverage).toBe(0);
  });

  test("an objective takes the best credit among its topics, and the domain averages objectives", () => {
    const track = parseTrack({
      ...JSON.parse(JSON.stringify(makeTrack([100]))),
      domains: [
        {
          id: "D1",
          name: "One",
          weight: 100,
          objectives: [
            { id: "D1.1", summary: "a", topics: ["topic-1", "topic-2"] },
            { id: "D1.2", summary: "b", topics: ["topic-3"] },
          ],
        },
      ],
    });
    if (!track.ok) throw new Error(track.reason);
    const r = computeReadiness(
      input({
        track: track.value,
        catalog: catalogFor(3),
        profile: profileOf({
          "topic-1": "Recalled",
          "topic-2": "Applied",
          "topic-3": "Understood",
        }),
      }),
    );
    // D1.1 = max(0.5, 1) = 1; D1.2 = 0.8; mean = 0.9
    expect(domainOf(r, "D1").coverage).toBeCloseTo(0.9);
  });

  test("a disabled topic is ignored", () => {
    const r = computeReadiness(
      input({
        catalog: [entry("topic-1", false), entry("topic-2")],
        profile: profileOf({ "topic-1": "Applied" }),
      }),
    );
    expect(domainOf(r, "D1").coverage).toBe(0);
  });

  test("a topic missing from the catalog is ignored", () => {
    const r = computeReadiness(
      input({
        catalog: [entry("topic-2")],
        profile: profileOf({ "topic-1": "Applied" }),
      }),
    );
    expect(domainOf(r, "D1").coverage).toBe(0);
  });

  test("a topic absent from the profile counts as Unseen", () => {
    const r = computeReadiness(
      input({ profile: profileOf({ "topic-2": "Applied" }) }),
    );
    expect(domainOf(r, "D1").coverage).toBe(0);
    expect(domainOf(r, "D2").coverage).toBe(1);
  });

  test("an empty profile gives zero coverage everywhere and insufficient evidence", () => {
    const r = computeReadiness(input());
    expect(r.domains.map((d) => d.coverage)).toEqual([0, 0]);
    expect(r.domains.map((d) => d.mastery)).toEqual([0, 0]);
    expect(r.status).toBe("insufficient-evidence");
  });
});

describe("blend arithmetic", () => {
  const profile = profileOf({
    "topic-1": "Applied",
    "topic-2": "Recalled",
  });

  test("evidenced domains blend 0.6 accuracy with 0.4 coverage", () => {
    // D1 coverage 1, 10 items 8 correct -> 0.6*0.8 + 0.4*1 = 0.88
    // D2 coverage 0.5, 5 items 5 correct -> 0.6*1 + 0.4*0.5 = 0.8
    const r = computeReadiness(
      input({
        profile,
        items: [...items("D1", 10, 8), ...items("D2", 5, 5)],
      }),
    );
    const d1 = domainOf(r, "D1");
    const d2 = domainOf(r, "D2");
    expect(d1.accuracy).toBeCloseTo(0.8);
    expect(d1.effectiveItems).toBeCloseTo(10);
    expect(d1.lowEvidence).toBe(false);
    expect(d1.mastery).toBeCloseTo(0.88);
    expect(d2.mastery).toBeCloseTo(0.8);
    expect(r.totalEffectiveItems).toBeCloseTo(15);
    expect(r.status).toBe("ok");
    // round(60*0.88 + 40*0.8) = round(52.8 + 32) = 85
    expect(r.index).toBe(85);
  });

  test("a low-evidence domain uses coverage alone but still reports accuracy", () => {
    const r = computeReadiness(input({ profile, items: items("D2", 3, 3) }));
    const d2 = domainOf(r, "D2");
    expect(d2.lowEvidence).toBe(true);
    expect(d2.accuracy).toBeCloseTo(1);
    expect(d2.mastery).toBeCloseTo(0.5);
  });

  test("a domain with no items has null accuracy and low evidence", () => {
    const d = domainOf(computeReadiness(input({ profile })), "D1");
    expect(d.accuracy).toBeNull();
    expect(d.effectiveItems).toBe(0);
    expect(d.lowEvidence).toBe(true);
    expect(d.mastery).toBeCloseTo(1);
  });
});

describe("decay", () => {
  test("an item at now weighs 1", () => {
    const d = domainOf(
      computeReadiness(input({ items: items("D1", 1, 1) })),
      "D1",
    );
    expect(d.effectiveItems).toBeCloseTo(1);
  });

  test("an item one half-life old weighs 0.5", () => {
    const d = domainOf(
      computeReadiness(
        input({ items: items("D1", 1, 1, NOW - ITEM_HALF_LIFE_DAYS * DAY_MS) }),
      ),
      "D1",
    );
    expect(d.effectiveItems).toBeCloseTo(0.5);
  });

  test("a future item has age 0 and weighs 1", () => {
    const d = domainOf(
      computeReadiness(input({ items: items("D1", 1, 1, NOW + 5 * DAY_MS) })),
      "D1",
    );
    expect(d.effectiveItems).toBeCloseTo(1);
  });

  test("accuracy is weighted: a fresh miss outweighs an old hit", () => {
    const d = domainOf(
      computeReadiness(
        input({
          items: [
            item("CCAR-F", "D1", true, NOW - ITEM_HALF_LIFE_DAYS * DAY_MS),
            item("CCAR-F", "D1", false, NOW),
          ],
        }),
      ),
      "D1",
    );
    // (0.5*1 + 1*0) / 1.5
    expect(d.accuracy).toBeCloseTo(1 / 3);
  });
});

describe("evidence boundaries", () => {
  const full = profileOf({ "topic-1": "Applied", "topic-2": "Applied" });

  test("a domain needs effective items of at least 4 to leave low evidence", () => {
    const below = computeReadiness(
      input({
        profile: full,
        // 3 fresh + 1 half-life-old = 3.5 effective
        items: [
          ...items("D1", 3, 3),
          item("CCAR-F", "D1", true, NOW - ITEM_HALF_LIFE_DAYS * DAY_MS),
        ],
      }),
    );
    const at = computeReadiness(
      input({ profile: full, items: items("D1", 4, 4) }),
    );
    const above = computeReadiness(
      input({ profile: full, items: items("D1", 5, 5) }),
    );
    expect(domainOf(below, "D1").lowEvidence).toBe(true);
    expect(domainOf(at, "D1").lowEvidence).toBe(false);
    expect(domainOf(above, "D1").lowEvidence).toBe(false);
  });

  test("total effective items: 14 is insufficient, 15 and 16 are ok", () => {
    const run = (n: number) =>
      computeReadiness(input({ profile: full, items: items("D1", n, n) }));
    expect(run(14).status).toBe("insufficient-evidence");
    expect(run(15).status).toBe("ok");
    expect(run(16).status).toBe("ok");
  });

  test("evidenced weight share: 59 is insufficient, 60 and 61 are ok", () => {
    const run = (w: number) =>
      computeReadiness({
        track: makeTrack([w, 100 - w]),
        catalog: catalogFor(2),
        profile: full,
        // D1 evidenced (12 items); D2 has 3 items (low evidence); total 15.
        items: [...items("D1", 12, 12), ...items("D2", 3, 3)],
        now: NOW,
      });
    expect(run(59).status).toBe("insufficient-evidence");
    expect(run(60).status).toBe("ok");
    expect(run(61).status).toBe("ok");
  });

  test("the index key is absent, not undefined, when insufficient", () => {
    const r = computeReadiness(input());
    expect(r.status).toBe("insufficient-evidence");
    expect(Object.hasOwn(r, "index")).toBe(false);
  });

  test("the index is an integer in 0..100 when ok", () => {
    const r = computeReadiness(
      input({ profile: full, items: items("D1", 15, 15) }),
    );
    expect(r.status).toBe("ok");
    expect(Number.isInteger(r.index)).toBe(true);
    expect(r.index).toBeGreaterThanOrEqual(0);
    expect(r.index).toBeLessThanOrEqual(100);
  });
});

describe("item filtering", () => {
  test("items from other tracks are ignored", () => {
    const r = computeReadiness(
      input({ items: items("D1", 6, 6, NOW, "CCDV-F") }),
    );
    expect(domainOf(r, "D1").effectiveItems).toBe(0);
    expect(r.totalEffectiveItems).toBe(0);
  });

  test.each([
    ["an objective number the domain lacks", "D1", "D1.9"],
    ["an objective of another domain", "D2", "D1.1"],
  ])(
    "an item with %s is ignored like another track's",
    (_n, domain, objective) => {
      // parseExamItem requires the objective prefix to equal the domain, so the
      // "another domain" case is built from a valid item and then re-pointed.
      const valid = item("CCAR-F", domain, true);
      const bad: ExamItem = { ...valid, objective };
      const bads = Array.from({ length: 6 }, () => bad);
      const r = computeReadiness(
        input({ items: [...bads, ...items("D1", 4, 2)] }),
      );
      expect(domainOf(r, "D1").effectiveItems).toBeCloseTo(4);
      expect(domainOf(r, "D1").accuracy).toBeCloseTo(0.5);
      expect(domainOf(r, "D2").effectiveItems).toBe(0);
      expect(domainOf(r, "D2").accuracy).toBeNull();
      expect(r.totalEffectiveItems).toBeCloseTo(4);
    },
  );

  test("items for an unknown domain are ignored without error", () => {
    const r = computeReadiness(input({ items: items("D9", 6, 6) }));
    expect(r.totalEffectiveItems).toBe(0);
    expect(r.domains.map((d) => d.id)).toEqual(["D1", "D2"]);
  });
});

describe("weakest", () => {
  const ids = (r: Readiness) => r.weakest;

  test("ranks by weight * (1 - mastery), descending", () => {
    const track = makeTrack([10, 20, 30, 40]);
    const r = computeReadiness(
      input({ track, catalog: catalogFor(4), profile: profileOf({}) }),
    );
    expect(ids(r)).toEqual(["D4", "D3", "D2"]);
  });

  test("a mastered heavy domain drops out of the weakest three", () => {
    const track = makeTrack([40, 30, 20, 10]);
    const r = computeReadiness(
      input({
        track,
        catalog: catalogFor(4),
        profile: profileOf({ "topic-1": "Applied" }),
      }),
    );
    expect(ids(r)).toEqual(["D2", "D3", "D4"]);
  });

  test("ties break by track domain order", () => {
    const track = makeTrack([25, 25, 25, 25]);
    const r = computeReadiness(
      input({ track, catalog: catalogFor(4), profile: profileOf({}) }),
    );
    expect(ids(r)).toEqual(["D1", "D2", "D3"]);
  });

  test("a track with fewer than three domains yields fewer", () => {
    expect(ids(computeReadiness(input()))).toEqual(["D1", "D2"]);
  });

  test("is reported in both statuses", () => {
    const full = profileOf({ "topic-1": "Applied", "topic-2": "Applied" });
    const ok = computeReadiness(
      input({ profile: full, items: items("D1", 15, 15) }),
    );
    const insufficient = computeReadiness(input({ profile: full }));
    expect(ok.status).toBe("ok");
    expect(insufficient.status).toBe("insufficient-evidence");
    expect(ok.weakest.length).toBeGreaterThan(0);
    expect(insufficient.weakest.length).toBeGreaterThan(0);
  });
});

describe("result envelope", () => {
  test("is never a score prediction and copies track metadata", () => {
    const track = makeTrack([60, 40]);
    const r = computeReadiness(input({ track }));
    expect(r.notAScorePrediction).toBe(true);
    expect(r.track).toBe(track.code);
    expect(r.guide).toEqual({
      version: track.guide.version,
      effective: track.guide.effective,
    });
  });

  test("preserves track domain order, names and exact weights", () => {
    const track = makeTrack([35, 65]);
    const r = computeReadiness(input({ track }));
    expect(r.domains.map((d) => [d.id, d.name, d.weight])).toEqual([
      ["D1", "Domain 1", 35],
      ["D2", "Domain 2", 65],
    ]);
  });
});

describe("purity", () => {
  test("does not mutate deep-frozen input and is deterministic", () => {
    const i = deepFreeze(
      input({
        profile: profileOf({ "topic-1": "Applied" }),
        items: [...items("D1", 10, 7), ...items("D2", 6, 2)],
      }),
    );
    const a = computeReadiness(i);
    const b = computeReadiness(i);
    expect(a).toEqual(b);
  });

  test("never yields NaN or Infinity and keeps mastery and coverage in [0,1]", () => {
    const r = computeReadiness(
      input({
        profile: profileOf({ "topic-1": "Fluent", "topic-2": "Claimed" }),
        items: [...items("D1", 20, 20), item("CCAR-F", "D2", false, 0)],
      }),
    );
    for (const d of r.domains) {
      for (const n of [d.coverage, d.mastery, d.effectiveItems]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      if (d.accuracy !== null) expect(Number.isFinite(d.accuracy)).toBe(true);
      expect(d.coverage).toBeGreaterThanOrEqual(0);
      expect(d.coverage).toBeLessThanOrEqual(1);
      expect(d.mastery).toBeGreaterThanOrEqual(0);
      expect(d.mastery).toBeLessThanOrEqual(1);
    }
  });
});

describe("per-objective daily cap", () => {
  const full = profileOf({ "topic-1": "Applied", "topic-2": "Applied" });
  const DAY_START = NOW; // NOW is a UTC midnight, so NOW + i ms stays in its day
  const run = (its: readonly ExamItem[], over: Partial<ReadinessInput> = {}) =>
    computeReadiness(input({ items: its, ...over }));

  test("10 same-day items on one objective count as exactly 3", () => {
    const its = Array.from({ length: 10 }, (_, i) =>
      item("CCAR-F", "D1", true, DAY_START + i * 1000, "D1.1"),
    );
    const r = run(its);
    expect(domainOf(r, "D1").effectiveItems).toBeCloseTo(3);
    expect(r.totalEffectiveItems).toBeCloseTo(3);
  });

  test("the first three by time count: right then wrong gives accuracy 1", () => {
    const its = Array.from({ length: 10 }, (_, i) =>
      item("CCAR-F", "D1", i < 3, DAY_START + i * 1000, "D1.1"),
    );
    expect(domainOf(run(its), "D1").accuracy).toBeCloseTo(1);
  });

  test("the first three by time count: wrong then right gives accuracy 0", () => {
    const its = Array.from({ length: 10 }, (_, i) =>
      item("CCAR-F", "D1", i >= 3, DAY_START + i * 1000, "D1.1"),
    );
    expect(domainOf(run(its), "D1").accuracy).toBeCloseTo(0);
  });

  test("three or fewer items are all counted", () => {
    const its = [0, 1, 2].map((i) =>
      item("CCAR-F", "D1", true, DAY_START + i, "D1.1"),
    );
    expect(domainOf(run(its), "D1").effectiveItems).toBeCloseTo(3);
  });

  test("a capped-out objective cannot reach evidence thresholds", () => {
    const its = Array.from({ length: 16 }, (_, i) =>
      item("CCAR-F", "D1", true, DAY_START + i, "D1.1"),
    );
    const r = run(its, { profile: full });
    expect(r.totalEffectiveItems).toBeCloseTo(3);
    expect(domainOf(r, "D1").lowEvidence).toBe(true);
    expect(r.status).toBe("insufficient-evidence");
  });

  test("each objective on the same day gets its own 3", () => {
    const its = ["D1.1", "D1.2", "D1.3"].flatMap((o) =>
      Array.from({ length: 5 }, (_, i) =>
        item("CCAR-F", "D1", true, DAY_START + i, o),
      ),
    );
    expect(domainOf(run(its), "D1").effectiveItems).toBeCloseTo(9);
  });

  test("the same objective on different UTC days gets 3 per day", () => {
    const its = [0, 1, 2].flatMap((d) =>
      Array.from({ length: 5 }, (_, i) =>
        item("CCAR-F", "D1", true, DAY_START - d * DAY_MS + i, "D1.1"),
      ),
    );
    // days are NOW's, NOW-1d's and NOW-2d's UTC days
    const w = (days: number) => 0.5 ** (days / ITEM_HALF_LIFE_DAYS);
    expect(domainOf(run(its), "D1").effectiveItems).toBeCloseTo(
      3 * (w(0) + w(1) + w(2)),
      2,
    );
  });

  test("the UTC midnight boundary splits days: at = k*DAY_MS - 1 and k*DAY_MS differ", () => {
    const k = NOW / DAY_MS;
    expect(Number.isInteger(k)).toBe(true);
    const before = Array.from({ length: 4 }, () =>
      item("CCAR-F", "D1", true, k * DAY_MS - 1, "D1.1"),
    );
    const after = Array.from({ length: 4 }, () =>
      item("CCAR-F", "D1", true, k * DAY_MS, "D1.1"),
    );
    const r = run([...before, ...after]);
    // 3 from each side of midnight; the 1ms-old items weigh ~1
    expect(domainOf(r, "D1").effectiveItems).toBeCloseTo(6, 3);
    // one side alone is capped at 3
    expect(domainOf(run(before), "D1").effectiveItems).toBeCloseTo(3, 3);
    expect(domainOf(run(after), "D1").effectiveItems).toBeCloseTo(3, 3);
  });

  test("equal timestamps break ties by input order: right-first gives accuracy 1", () => {
    const its = Array.from({ length: 6 }, (_, i) =>
      item("CCAR-F", "D1", i < 3, DAY_START, "D1.1"),
    );
    expect(domainOf(run(its), "D1").accuracy).toBeCloseTo(1);
  });

  test("equal timestamps break ties by input order: wrong-first gives accuracy 0", () => {
    const its = Array.from({ length: 6 }, (_, i) =>
      item("CCAR-F", "D1", i >= 3, DAY_START, "D1.1"),
    );
    expect(domainOf(run(its), "D1").accuracy).toBeCloseTo(0);
  });

  test("the result does not depend on input order when timestamps are distinct", () => {
    // earliest three are right; the later five are wrong
    const sorted = Array.from({ length: 8 }, (_, i) =>
      item("CCAR-F", "D1", i < 3, DAY_START + i * 1000, "D1.1"),
    );
    const baseline = run(sorted);
    expect(domainOf(baseline, "D1").accuracy).toBeCloseTo(1);
    const permutations: ExamItem[][] = [
      [...sorted].reverse(),
      [...sorted.slice(3), ...sorted.slice(0, 3)],
      [4, 0, 7, 2, 5, 1, 6, 3].map((i) => sorted[i] as ExamItem),
      [7, 6, 0, 1, 2, 3, 4, 5].map((i) => sorted[i] as ExamItem),
    ];
    for (const p of permutations) expect(run(p)).toEqual(baseline);
  });

  test("items excluded by other rules do not consume cap slots", () => {
    const valid = item("CCAR-F", "D1", true, DAY_START + 100, "D1.1");
    const otherTrack = Array.from({ length: 5 }, (_, i) =>
      item("CCDV-F", "D1", false, DAY_START + i, "D1.1"),
    );
    const unknownDomain = Array.from({ length: 5 }, (_, i) =>
      item("CCAR-F", "D9", false, DAY_START + i, "D9.1"),
    );
    // objective D1.1 filed under domain D2: outside its own domain
    const wrongDomain = Array.from({ length: 5 }, (_, i) => ({
      ...item("CCAR-F", "D2", false, DAY_START + i),
      objective: "D1.1",
    }));
    const r = run([
      ...otherTrack,
      ...unknownDomain,
      ...wrongDomain,
      valid,
      { ...valid, at: DAY_START + 101 },
      { ...valid, at: DAY_START + 102 },
    ]);
    expect(domainOf(r, "D1").effectiveItems).toBeCloseTo(3);
    expect(domainOf(r, "D1").accuracy).toBeCloseTo(1);
    expect(domainOf(r, "D2").effectiveItems).toBe(0);
    expect(r.totalEffectiveItems).toBeCloseTo(3);
  });

  test("the cap applies before decay weighting", () => {
    const base = NOW - 10 * DAY_MS;
    const its = Array.from({ length: 10 }, (_, i) =>
      item("CCAR-F", "D1", true, base + i * 1000, "D1.1"),
    );
    expect(domainOf(run(its), "D1").effectiveItems).toBeCloseTo(
      3 * 0.5 ** (10 / ITEM_HALF_LIFE_DAYS),
      3,
    );
  });

  test("does not mutate deep-frozen input", () => {
    const its = Array.from({ length: 10 }, (_, i) =>
      item("CCAR-F", "D1", i < 3, DAY_START + i, "D1.1"),
    );
    const i = deepFreeze(input({ profile: full, items: its }));
    const a = computeReadiness(i);
    expect(computeReadiness(i)).toEqual(a);
    expect(domainOf(a, "D1").accuracy).toBeCloseTo(1);
  });
});

describe("real bundled CCDV-F track", () => {
  test("produces a well-formed ok readiness from a synthetic profile and 30 items", async () => {
    const track = loadBundledTracks().find((t) => t.code === "CCDV-F");
    if (track === undefined) throw new Error("CCDV-F not bundled");
    const catalog = await loadBundledCatalog();

    const levels: Record<string, Level> = {};
    let n = 0;
    for (const d of track.domains) {
      for (const o of d.objectives) {
        for (const t of o.topics)
          levels[t] = LEVELS[n++ % LEVELS.length] as Level;
      }
    }

    // Give 4 items to the heaviest domains until their weight reaches 60,
    // then put the remainder on the heaviest domain.
    const byWeight = [...track.domains].sort((a, b) => b.weight - a.weight);
    // Items rotate over the domain's real objectives and roll to a new UTC day
    // every 3 per objective, so the per-objective daily cap never binds.
    const spread = (
      d: (typeof track.domains)[number],
      n: number,
      right: number,
      at: number,
    ): ExamItem[] =>
      Array.from({ length: n }, (_, i) => {
        const o = d.objectives[i % d.objectives.length];
        if (o === undefined) throw new Error("domain without objectives");
        const day = Math.floor(i / (d.objectives.length * 3));
        return item(track.code, d.id, i < right, at - day * DAY_MS, o.id);
      });
    const generated: ExamItem[] = [];
    let share = 0;
    for (const d of byWeight) {
      if (share >= 60) break;
      generated.push(...spread(d, 4, 3, NOW));
      share += d.weight;
    }
    const top = byWeight[0];
    if (top === undefined) throw new Error("no domains");
    generated.push(...spread(top, 30 - generated.length, 20, NOW - 2 * DAY_MS));
    expect(generated).toHaveLength(30);

    const r = computeReadiness({
      track,
      catalog,
      profile: profileOf(levels),
      items: generated,
      now: NOW,
    });

    expect(r.track).toBe("CCDV-F");
    expect(r.domains).toHaveLength(8);
    expect(r.domains.reduce((s, d) => s + d.weight, 0)).toBe(100);
    expect(r.status).toBe("ok");
    expect(r.index).toBeGreaterThanOrEqual(0);
    expect(r.index).toBeLessThanOrEqual(100);
    expect(Number.isInteger(r.index)).toBe(true);
    expect(r.weakest).toHaveLength(3);
    expect(r.notAScorePrediction).toBe(true);
  });
});
