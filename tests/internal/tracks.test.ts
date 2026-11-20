import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  CatalogEntry,
  Parsed,
  TopicId,
} from "../../src/internal/schema.ts";
import {
  checkTrackAgainstCatalog,
  parseTrack,
  type Track,
  type TrackCatalogCheck,
} from "../../src/internal/tracks.ts";
import { REMOVE, mutated, validTrack, type Edit } from "./fixtures/track.ts";

function reasonOf(value: unknown): string {
  const r = parseTrack(value);
  if (r.ok) throw new Error("expected failure");
  return r.reason;
}

describe("parseTrack happy path", () => {
  test("accepts a valid track and preserves its data", () => {
    const r = parseTrack(validTrack());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.code).toBe("CCAR-F");
    expect(r.value.tier).toBe("foundations");
    expect(r.value.assumes).toBeNull();
    expect(r.value.domains).toHaveLength(2);
    expect(r.value.domains[0]?.objectives[0]?.topics).toEqual([
      "plan-mode",
      "claude-md",
    ]);
    expect(r.value.format.itemKinds).toEqual(["single", "multiple"]);
  });
  test("trims the title", () => {
    const r = parseTrack(mutated([["title"], "  Padded  "]));
    expect(r.ok && r.value.title).toBe("Padded");
  });

  test("accepts YYYY-MM-DD effective date, assumes code, and no scenarios", () => {
    const r = parseTrack(
      mutated(
        [["guide", "effective"], "2026-03-15"],
        [["assumes"], "CCAR-F"],
        [["code"], "CCAR-P"],
        [["tier"], "professional"],
        [["scenarios"], REMOVE],
      ),
    );
    expect(r.ok).toBe(true);
  });

  test("ignores unknown extra keys", () => {
    const r = parseTrack(
      mutated(
        [["extra"], 1],
        [["guide", "extra"], 2],
        [["domains", 0, "extra"], 3],
      ),
    );
    expect(r.ok).toBe(true);
  });

  test("types", () => {
    expectTypeOf(parseTrack).parameter(0).toBeUnknown();
    expectTypeOf(parseTrack).returns.toEqualTypeOf<Parsed<Track>>();
    expectTypeOf<Track["tier"]>().toEqualTypeOf<
      "foundations" | "professional" | "associate"
    >();
    expectTypeOf<Track["schemaVersion"]>().toEqualTypeOf<1>();
    expectTypeOf<Track["assumes"]>().toEqualTypeOf<string | null>();
    expectTypeOf(
      checkTrackAgainstCatalog,
    ).returns.toEqualTypeOf<TrackCatalogCheck>();
    expectTypeOf<TrackCatalogCheck>().toEqualTypeOf<{
      unknownTopics: string[];
      disabledObjectives: string[];
    }>();
  });
});

describe("parseTrack rejects non-objects", () => {
  test.each([null, undefined, 1, "x", [], [validTrack()]])(
    "rejects %j without throwing",
    (value) => {
      expect(parseTrack(value).ok).toBe(false);
    },
  );
});

const failures: [string, readonly Edit[], string][] = [
  ["schemaVersion 2", [[["schemaVersion"], 2]], "schemaVersion"],
  ["schemaVersion missing", [[["schemaVersion"], REMOVE]], "schemaVersion"],
  ["code lowercase", [[["code"], "ccar-f"]], "code"],
  ["code too long", [[["code"], "CCARX-F"]], "code"],
  ["code non-string", [[["code"], 5]], "code"],
  ["title empty after trim", [[["title"], "   "]], "title"],
  ["title too long", [[["title"], "x".repeat(121)]], "title"],
  ["tier unknown", [[["tier"], "expert"]], "tier"],
  ["assumes bad code", [[["assumes"], "nope"]], "assumes"],
  ["assumes number", [[["assumes"], 3]], "assumes"],
  ["guide missing", [[["guide"], REMOVE]], "guide"],
  ["guide.version empty", [[["guide", "version"], ""]], "version"],
  ["guide.effective bad", [[["guide", "effective"], "March"]], "effective"],
  [
    "guide.effective bad month",
    [[["guide", "effective"], "2026-13"]],
    "effective",
  ],
  [
    "guide.effective non-string",
    [[["guide", "effective"], 202603]],
    "effective",
  ],
  [
    "guide.sourceUrl http",
    [[["guide", "sourceUrl"], "http://example.com/g"]],
    "sourceUrl",
  ],
  [
    "guide.sourceUrl not a url",
    [[["guide", "sourceUrl"], "not a url"]],
    "sourceUrl",
  ],
  [
    "guide.reviewedAt month only",
    [[["guide", "reviewedAt"], "2026-11"]],
    "reviewedAt",
  ],
  [
    "guide.reviewedAt non-string",
    [[["guide", "reviewedAt"], 20261101]],
    "reviewedAt",
  ],
  ["format missing", [[["format"], REMOVE]], "format"],
  ["format.minutes zero", [[["format", "minutes"], 0]], "minutes"],
  ["format.minutes float", [[["format", "minutes"], 1.5]], "minutes"],
  ["format.passScaled neg", [[["format", "passScaled"], -1]], "passScaled"],
  ["format.scaleMax below pass", [[["format", "scaleMax"], 100]], "scaleMax"],
  ["format.itemKinds empty", [[["format", "itemKinds"], []]], "itemKinds"],
  [
    "format.itemKinds unknown",
    [[["format", "itemKinds"], ["essay"]]],
    "itemKinds",
  ],
  ["scenarios not array", [[["scenarios"], "x"]], "scenarios"],
  [
    "scenario not an object",
    [[["scenarios", 0], 5]],
    "scenario must be an object",
  ],
  ["scenario id bad", [[["scenarios", 0, "id"], "X1"]], "scenario id"],
  [
    "scenario summary too long",
    [[["scenarios", 0, "summary"], "x".repeat(101)]],
    "summary",
  ],
  [
    "scenario domains not an array",
    [[["scenarios", 0, "domains"], "D1"]],
    "scenario S1 domains",
  ],
  [
    "scenario domains empty",
    [[["scenarios", 0, "domains"], []]],
    "scenario S1 domains",
  ],
  [
    "scenario domain not a domain id",
    [[["scenarios", 0, "domains"], [5]]],
    "scenario S1 domains",
  ],
  [
    "scenario domain malformed id",
    [[["scenarios", 0, "domains"], ["nope"]]],
    "scenario S1 domains",
  ],
  ["scenario unknown domain", [[["scenarios", 0, "domains"], ["D9"]]], "D9"],
  [
    "scenario duplicate domain",
    [
      [
        ["scenarios", 0, "domains"],
        ["D1", "D1"],
      ],
    ],
    "distinct",
  ],
  ["domains empty", [[["domains"], []]], "domains"],
  ["domains missing", [[["domains"], REMOVE]], "domains"],
  ["domain not an object", [[["domains", 0], 5]], "domain must be an object"],
  ["domain id bad", [[["domains", 0, "id"], "X1"]], "domain id must look like"],
  ["domain name empty", [[["domains", 0, "name"], ""]], "name"],
  ["domain name too long", [[["domains", 0, "name"], "x".repeat(121)]], "name"],
  [
    "weight float",
    [[["domains", 0, "weight"], 60.5]],
    "weight must be an integer",
  ],
  ["weight zero", [[["domains", 0, "weight"], 0]], "weight must be an integer"],
  [
    "weight over 100",
    [[["domains", 0, "weight"], 101]],
    "weight must be an integer",
  ],
  ["weights sum 99", [[["domains", 1, "weight"], 39]], "sum to 100"],
  ["weights sum 101", [[["domains", 1, "weight"], 41]], "sum to 100"],
  ["duplicate domain id", [[["domains", 1, "id"], "D1"]], "D1"],
  ["objectives empty", [[["domains", 0, "objectives"], []]], "objectives"],
  [
    "objective not an object",
    [[["domains", 0, "objectives", 0], 5]],
    "objective must be an object",
  ],
  [
    "objective id bad shape",
    [[["domains", 0, "objectives", 0, "id"], "D1"]],
    "objective id must look like",
  ],
  [
    "objective prefix mismatch",
    [[["domains", 0, "objectives", 0, "id"], "D2.1"]],
    "D2.1",
  ],
  [
    "duplicate objective id",
    [[["domains", 0, "objectives", 1, "id"], "D1.1"]],
    "D1.1",
  ],
  [
    "objective summary too long",
    [[["domains", 0, "objectives", 0, "summary"], "x".repeat(141)]],
    "summary",
  ],
  [
    "objective summary empty",
    [[["domains", 0, "objectives", 0, "summary"], ""]],
    "summary",
  ],
  [
    "officialRef non-string",
    [[["domains", 0, "objectives", 0, "officialRef"], 1]],
    "officialRef",
  ],
  ["zero topics", [[["domains", 0, "objectives", 0, "topics"], []]], "topics"],
  [
    "seven topics",
    [
      [
        ["domains", 0, "objectives", 0, "topics"],
        ["a", "b", "c", "d", "e", "f", "g"],
      ],
    ],
    "topics",
  ],
  [
    "invalid topic id",
    [[["domains", 0, "objectives", 0, "topics"], ["Not Valid"]]],
    "topics",
  ],
  [
    "duplicate topic ids in one objective",
    [
      [
        ["domains", 0, "objectives", 0, "topics"],
        ["plan-mode", "plan-mode"],
      ],
    ],
    "distinct",
  ],
  [
    "external empty string",
    [[["domains", 0, "objectives", 0, "external"], [""]]],
    "external",
  ],
  [
    "external not array",
    [[["domains", 0, "objectives", 0, "external"], "x"]],
    "external",
  ],
  [
    "duplicate scenario id",
    [[["scenarios", 1], { id: "S1", summary: "Again", domains: ["D1"] }]],
    "S1",
  ],
];

describe("parseTrack validation", () => {
  test.each(failures)("%s fails naming the field", (_name, edits, needle) => {
    const reason = reasonOf(mutated(...edits));
    expect(reason).toContain(needle);
  });

  test("six topics is accepted (boundary)", () => {
    const r = parseTrack(
      mutated([
        ["domains", 0, "objectives", 0, "topics"],
        ["a", "b", "c", "d", "e", "f"],
      ]),
    );
    expect(r.ok).toBe(true);
  });

  test("scaleMax equal to passScaled is accepted (boundary)", () => {
    const r = parseTrack(mutated([["format", "scaleMax"], 720]));
    expect(r.ok).toBe(true);
  });

  test("failure reason does not echo secret-like raw input", () => {
    const reason = reasonOf(mutated([["tier"], "SECRET-TOKEN-123"]));
    expect(reason).not.toContain("SECRET-TOKEN-123");
  });
});

function entry(id: string, enabled = true): CatalogEntry {
  return {
    id: id as TopicId,
    title: id,
    type: "feature",
    dependencies: [],
    keywords: [id],
    targetLevel: "Applied",
    enabled,
  };
}

function trackOf(objectives: Record<string, string[]>): Track {
  const r = parseTrack(
    mutated(
      [["scenarios"], []],
      [
        ["domains"],
        [
          {
            id: "D1",
            name: "Only",
            weight: 100,
            objectives: Object.entries(objectives).map(([id, topics]) => ({
              id,
              summary: "s",
              topics,
            })),
          },
        ],
      ],
    ),
  );
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

describe("checkTrackAgainstCatalog", () => {
  test("clean track reports nothing", () => {
    const track = trackOf({ "D1.1": ["aa", "bb"] });
    expect(checkTrackAgainstCatalog(track, [entry("aa"), entry("bb")])).toEqual(
      {
        unknownTopics: [],
        disabledObjectives: [],
      },
    );
  });

  test("reports unknown topics deduped and sorted", () => {
    const track = trackOf({
      "D1.1": ["zz", "aa", "known"],
      "D1.2": ["zz", "mm", "known"],
    });
    const out = checkTrackAgainstCatalog(track, [entry("known")]);
    expect(out.unknownTopics).toEqual(["aa", "mm", "zz"]);
  });

  test("objective with all topics disabled is reported", () => {
    const track = trackOf({
      "D1.1": ["off1", "off2"],
      "D1.2": ["off1", "on"],
    });
    const out = checkTrackAgainstCatalog(track, [
      entry("off1", false),
      entry("off2", false),
      entry("on"),
    ]);
    expect(out.disabledObjectives).toEqual(["D1.1"]);
    expect(out.unknownTopics).toEqual([]);
  });

  test("objective mixing disabled and unknown topics is reported; one enabled saves it", () => {
    const track = trackOf({
      "D1.1": ["off", "ghost"],
      "D1.2": ["ghost", "on"],
    });
    const out = checkTrackAgainstCatalog(track, [
      entry("off", false),
      entry("on"),
    ]);
    expect(out.disabledObjectives).toEqual(["D1.1"]);
    expect(out.unknownTopics).toEqual(["ghost"]);
  });

  test("disabledObjectives are sorted", () => {
    const track = trackOf({
      "D1.2": ["off"],
      "D1.1": ["off"],
    });
    const out = checkTrackAgainstCatalog(track, [entry("off", false)]);
    expect(out.disabledObjectives).toEqual(["D1.1", "D1.2"]);
  });
});

const domainsOf = (count: number, weight: number): unknown[] =>
  Array.from({ length: count }, (_unused, i) => ({
    id: `D${String(i + 1)}`,
    name: "Domain",
    weight,
    objectives: [
      { id: `D${String(i + 1)}.1`, summary: "Objective", topics: ["hooks"] },
    ],
  }));

const objectivesOf = (count: number): unknown[] =>
  Array.from({ length: count }, (_unused, i) => ({
    id: `D1.${String(i + 1)}`,
    summary: "Objective",
    topics: ["hooks"],
  }));

const scenariosOf = (count: number): unknown[] =>
  Array.from({ length: count }, (_unused, i) => ({
    id: `S${String(i + 1)}`,
    summary: "Scenario",
    domains: ["D1"],
  }));

const OBJ = ["domains", 0, "objectives", 0] as const;
const EXT = [...OBJ, "external"] as const;

/** Each limit: the value at the limit passes, one over fails naming `needle`. */
const limits: [
  name: string,
  atLimit: readonly Edit[],
  overLimit: readonly Edit[],
  needle: string,
][] = [
  [
    "domains 20/21",
    [[["domains"], domainsOf(20, 5)]],
    [[["domains"], domainsOf(21, 1)]],
    "track domains must be an array of 1 to 20",
  ],
  [
    "objectives per domain 50/51",
    [[["domains", 0, "objectives"], objectivesOf(50)]],
    [[["domains", 0, "objectives"], objectivesOf(51)]],
    "domain D1 objectives must be an array of 1 to 50",
  ],
  [
    "scenarios 20/21",
    [[["scenarios"], scenariosOf(20)]],
    [[["scenarios"], scenariosOf(21)]],
    "track scenarios must be an array of at most 20",
  ],
  [
    "scenario domains 20/21",
    [
      [["domains"], domainsOf(20, 5)],
      [
        ["scenarios", 0, "domains"],
        domainsOf(20, 5).map((d) => (d as { id: string }).id),
      ],
    ],
    [
      [["domains"], domainsOf(20, 5)],
      [
        ["scenarios", 0, "domains"],
        [...domainsOf(20, 5).map((d) => (d as { id: string }).id), "D21"],
      ],
    ],
    "scenario S1 domains must be an array of 1 to 20",
  ],
  [
    "guide.version 20/21 chars",
    [[["guide", "version"], "v".repeat(20)]],
    [[["guide", "version"], "v".repeat(21)]],
    "track guide.version",
  ],
  [
    "officialRef 40/41 chars",
    [[[...OBJ, "officialRef"], "r".repeat(40)]],
    [[[...OBJ, "officialRef"], "r".repeat(41)]],
    "objective D1.1 officialRef",
  ],
  [
    "external item 120/121 chars",
    [[EXT, ["e".repeat(120)]]],
    [[EXT, ["e".repeat(121)]]],
    "objective D1.1 external item",
  ],
  [
    "external count 10/11",
    [[EXT, Array.from({ length: 10 }, (_u, i) => `ref ${String(i)}`)]],
    [[EXT, Array.from({ length: 11 }, (_u, i) => `ref ${String(i)}`)]],
    "objective D1.1 external must be an array of 1 to 10",
  ],
  [
    "guide.reviewedAt 2028-02-29 leap day / 2026-02-30",
    [[["guide", "reviewedAt"], "2028-02-29"]],
    [[["guide", "reviewedAt"], "2026-02-30"]],
    "reviewedAt",
  ],
  [
    "guide.effective 2028-02-29 leap day / 2026-02-30",
    [[["guide", "effective"], "2028-02-29"]],
    [[["guide", "effective"], "2026-02-30"]],
    "effective",
  ],
  [
    "code 2-letter prefix / 5-letter prefix",
    [[["code"], "AB-F"]],
    [[["code"], "ABCDE-F"]],
    "track code must look like",
  ],
  [
    "code 2-letter suffix / 3-letter suffix",
    [[["code"], "CCAR-FX"]],
    [[["code"], "CCAR-FXY"]],
    "track code must look like",
  ],
];

describe("parseTrack limits", () => {
  test.each(limits)("%s", (_name, atLimit, overLimit, needle) => {
    expect(parseTrack(mutated(...atLimit)).ok).toBe(true);
    expect(reasonOf(mutated(...overLimit))).toContain(needle);
  });
});

describe("parseTrack assumes", () => {
  test("a track assuming itself is rejected naming assumes", () => {
    expect(reasonOf(mutated([["assumes"], "CCAR-F"]))).toContain("assumes");
  });

  test("a track assuming a different code is accepted", () => {
    const r = parseTrack(mutated([["assumes"], "CCAR-P"]));
    expect(r.ok && r.value.assumes).toBe("CCAR-P");
  });
});

describe("parseTrack external", () => {
  test("absent external is valid and omitted from the objective", () => {
    const r = parseTrack(mutated([[...EXT], REMOVE]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.domains[0]?.objectives[0]).not.toHaveProperty("external");
  });

  test("items are trimmed in the result", () => {
    const r = parseTrack(mutated([[...EXT], ["  padded  "]]));
    expect(r.ok && r.value.domains[0]?.objectives[0]?.external).toEqual([
      "padded",
    ]);
  });

  test.each<[string, unknown[], string]>([
    ["empty array", [], "external must be an array of 1 to 10"],
    ["duplicate items", ["same", "same"], "external items must be distinct"],
    [
      "duplicates differing only by whitespace",
      ["same", "  same "],
      "external items must be distinct",
    ],
    ["blank item", ["   "], "external item"],
  ])("%s is rejected", (_name, value, needle) => {
    expect(reasonOf(mutated([[...EXT], value]))).toContain(needle);
  });
});

describe("parseTrack own-property reads", () => {
  test("an inherited officialRef is ignored", () => {
    const objective = Object.assign(
      Object.create({ officialRef: "inherited" }) as object,
      { id: "D1.2", summary: "Objective two", topics: ["plan-mode"] },
    );
    const r = parseTrack(mutated([["domains", 0, "objectives", 1], objective]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.domains[0]?.objectives[1]).not.toHaveProperty("officialRef");
  });
});
