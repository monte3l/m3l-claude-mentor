import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  matchTopics,
  mergeCatalog,
  parseCatalog,
  parseUserCatalog,
} from "../../src/internal/catalog.js";
import type { CatalogEntry } from "../../src/internal/schema.js";

function raw(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Title ${id}`,
    type: "concept",
    dependencies: [],
    keywords: [],
    targetLevel: "Understood",
    enabled: true,
    ...extra,
  };
}

function parsed(id: string, extra: Record<string, unknown> = {}): CatalogEntry {
  const r = parseCatalog([raw(id, extra)]);
  if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
  const [entry] = r.value;
  if (entry === undefined) throw new Error("fixture empty");
  return entry;
}

function ids(entries: readonly CatalogEntry[]): string[] {
  return entries.map((e) => e.id);
}

describe("parseCatalog", () => {
  test("preserves input order", () => {
    const r = parseCatalog([
      raw("c"),
      raw("a", { dependencies: ["c"] }),
      raw("b"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(ids(r.value)).toEqual(["c", "a", "b"]);
  });

  test("accepts an empty array", () => {
    expect(parseCatalog([])).toEqual({ ok: true, value: [] });
  });

  test.each([
    ["object", {}],
    ["null", null],
    ["string", "x"],
  ])("rejects non-array %s", (_n, v) => {
    expect(parseCatalog(v).ok).toBe(false);
  });

  test("a bad entry reason names its index", () => {
    const r = parseCatalog([raw("a"), raw("b"), raw("Bad Id")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("2");
  });

  test("rejects duplicate ids", () => {
    expect(parseCatalog([raw("a"), raw("b"), raw("a")]).ok).toBe(false);
  });

  test("rejects an unknown dependency", () => {
    expect(parseCatalog([raw("a", { dependencies: ["ghost"] })]).ok).toBe(
      false,
    );
  });

  test("accepts a diamond (shared dependency, no cycle)", () => {
    const r = parseCatalog([
      raw("a"),
      raw("b", { dependencies: ["a"] }),
      raw("c", { dependencies: ["a"] }),
      raw("d", { dependencies: ["b", "c"] }),
    ]);
    expect(r.ok).toBe(true);
  });

  test("rejects a 2-cycle", () => {
    const r = parseCatalog([
      raw("a", { dependencies: ["b"] }),
      raw("b", { dependencies: ["a"] }),
    ]);
    expect(r.ok).toBe(false);
  });

  test("rejects a longer cycle reachable from an acyclic entry", () => {
    const r = parseCatalog([
      raw("root"),
      raw("a", { dependencies: ["root", "c"] }),
      raw("b", { dependencies: ["a"] }),
      raw("c", { dependencies: ["b"] }),
    ]);
    expect(r.ok).toBe(false);
  });

  test("caps at 500 entries", () => {
    const make = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) => raw(`t${String(i)}`));
    expect(parseCatalog(make(500)).ok).toBe(true);
    expect(parseCatalog(make(501)).ok).toBe(false);
  });

  test("the shipped catalog parses with the expected shape", () => {
    const text = readFileSync(
      new URL("../../data/topic-catalog.json", import.meta.url),
      "utf8",
    );
    const r = parseCatalog(JSON.parse(text) as unknown);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(25);
    const fast = r.value.filter((e) => e.type === "fast-moving");
    expect(fast.length).toBeGreaterThan(0);
    for (const e of fast) expect(e.targetLevel).toBe("Introduced");
    for (const e of r.value.filter((x) => x.type !== "fast-moving")) {
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("parseUserCatalog", () => {
  test("missing overrides and custom default to empty", () => {
    const r = parseUserCatalog({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.overrides).toEqual({});
      expect(r.value.custom).toEqual([]);
    }
  });

  test.each([
    ["null", null],
    ["array", []],
    ["string", "x"],
  ])("rejects non-object %s", (_n, v) => {
    expect(parseUserCatalog(v).ok).toBe(false);
  });

  test("accepts valid overrides and custom entries", () => {
    const r = parseUserCatalog({
      overrides: {
        "plan-mode": {
          enabled: false,
          targetLevel: "Applied",
          style: "reference",
          keywords: ["  PLAN "],
        },
      },
      custom: [raw("mine")],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.overrides["plan-mode"]).toEqual({
        enabled: false,
        targetLevel: "Applied",
        style: "reference",
        keywords: ["plan"],
      });
      expect(ids(r.value.custom)).toEqual(["mine"]);
    }
  });

  test("ignores unknown override keys", () => {
    const r = parseUserCatalog({
      overrides: { a: { enabled: true, bogus: 1 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.value.overrides["a"];
      expect(o).toBeDefined();
      expect(o?.enabled).toBe(true);
      expect(Object.hasOwn(o ?? {}, "bogus")).toBe(false);
    }
  });

  test.each([
    ["enabled", { enabled: "yes" }],
    ["targetLevel", { targetLevel: "Master" }],
    ["style", { style: "nope" }],
    ["keywords type", { keywords: "x" }],
    ["keyword too long", { keywords: ["k".repeat(41)] }],
    ["keyword empty", { keywords: [" "] }],
  ])("rejects wrong-typed override %s", (_n, override) => {
    expect(parseUserCatalog({ overrides: { a: override } }).ok).toBe(false);
  });

  test("rejects a non-object override", () => {
    expect(parseUserCatalog({ overrides: { a: 5 } }).ok).toBe(false);
  });

  test("rejects an override key that is not a topic id", () => {
    expect(parseUserCatalog({ overrides: { "Bad Id": {} } }).ok).toBe(false);
  });

  test("rejects an own __proto__ override key without polluting", () => {
    const input = JSON.parse(
      '{"overrides":{"__proto__":{"enabled":false}}}',
    ) as unknown;
    const r = parseUserCatalog(input);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>)["enabled"]).toBeUndefined();
  });

  test("rejects bad overrides / custom containers and bad custom entries", () => {
    expect(parseUserCatalog({ overrides: [] }).ok).toBe(false);
    expect(parseUserCatalog({ custom: {} }).ok).toBe(false);
    expect(parseUserCatalog({ custom: [raw("Bad Id")] }).ok).toBe(false);
  });
});

describe("mergeCatalog", () => {
  const bundledResult = parseCatalog([
    raw("a", { keywords: ["alpha"] }),
    raw("b", { dependencies: ["a"] }),
  ]);
  if (!bundledResult.ok) throw new Error("fixture invalid");
  const bundled = bundledResult.value;
  const userOf = (
    u: Record<string, unknown>,
  ): Parameters<typeof mergeCatalog>[1] => {
    const r = parseUserCatalog(u);
    if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
    return r.value;
  };

  test("with an empty user catalog returns bundled unchanged", () => {
    const r = mergeCatalog(bundled, userOf({}));
    expect(r).toEqual({ ok: true, value: bundled });
  });

  test("applies overrides and appends custom after bundled", () => {
    const r = mergeCatalog(
      bundled,
      userOf({
        overrides: {
          a: {
            enabled: false,
            targetLevel: "Fluent",
            style: "socratic",
            keywords: ["Beta"],
          },
        },
        custom: [raw("z", { dependencies: ["b"] }), raw("y")],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.value)).toEqual(["a", "b", "z", "y"]);
    const a = r.value[0];
    expect(a?.enabled).toBe(false);
    expect(a?.targetLevel).toBe("Fluent");
    expect(a?.style).toBe("socratic");
    expect(a?.keywords).toEqual(["beta"]);
    expect(r.value[1]).toEqual(bundled[1]);
  });

  test("an override can target a custom entry", () => {
    const r = mergeCatalog(
      bundled,
      userOf({ custom: [raw("z")], overrides: { z: { enabled: false } } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[2]?.enabled).toBe(false);
  });

  test("does not mutate the bundled input", () => {
    const before = structuredClone(bundled);
    mergeCatalog(bundled, userOf({ overrides: { a: { enabled: false } } }));
    expect(bundled).toEqual(before);
  });

  test("fails when an override names an unknown id", () => {
    expect(
      mergeCatalog(
        bundled,
        userOf({ overrides: { ghost: { enabled: false } } }),
      ).ok,
    ).toBe(false);
  });

  test("fails when a custom id equals a bundled id", () => {
    expect(mergeCatalog(bundled, userOf({ custom: [raw("a")] })).ok).toBe(
      false,
    );
  });

  test("fails on duplicate custom ids", () => {
    expect(
      mergeCatalog(bundled, userOf({ custom: [raw("z"), raw("z")] })).ok,
    ).toBe(false);
  });

  test("fails on a custom entry with an unknown dependency", () => {
    expect(
      mergeCatalog(
        bundled,
        userOf({ custom: [raw("z", { dependencies: ["ghost"] })] }),
      ).ok,
    ).toBe(false);
  });

  test("fails on a cycle introduced by custom entries", () => {
    const r = mergeCatalog(
      bundled,
      userOf({
        custom: [
          raw("x", { dependencies: ["y"] }),
          raw("y", { dependencies: ["x"] }),
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  test("allows disabling a topic another enabled topic depends on", () => {
    const r = mergeCatalog(
      bundled,
      userOf({ overrides: { a: { enabled: false } } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[1]?.enabled).toBe(true);
  });
});

describe("matchTopics", () => {
  const entry = (
    id: string,
    keywords: string[],
    enabled = true,
  ): CatalogEntry => parsed(id, { keywords, enabled });

  test("matches whole words case-insensitively", () => {
    const cat = [entry("plan", ["plan"])];
    expect(ids(matchTopics(cat, "Enter PLAN mode"))).toEqual(["plan"]);
    expect(ids(matchTopics(cat, "a plan."))).toEqual(["plan"]);
    expect(ids(matchTopics(cat, "plan"))).toEqual(["plan"]);
  });

  test.each(["explanation", "planning", "airplane", "plan2"])(
    "does not match inside %s",
    (text) => {
      expect(matchTopics([entry("plan", ["plan"])], text)).toEqual([]);
    },
  );

  test("matches multi-word keywords", () => {
    const cat = [entry("cw", ["context window"])];
    expect(ids(matchTopics(cat, "the context window is full"))).toEqual(["cw"]);
  });

  test("the dot in a keyword is literal", () => {
    const cat = [entry("md", ["claude.md"])];
    expect(ids(matchTopics(cat, "edit claude.md now"))).toEqual(["md"]);
    expect(matchTopics(cat, "edit claudeXmd now")).toEqual([]);
  });

  test("ignores disabled entries", () => {
    const cat = [entry("off", ["plan"], false), entry("on", ["plan"])];
    expect(ids(matchTopics(cat, "plan"))).toEqual(["on"]);
  });

  test("excludes entries with zero matches", () => {
    expect(matchTopics([entry("a", ["alpha"])], "nothing here")).toEqual([]);
  });

  test("counts distinct keywords and ranks by count descending", () => {
    const cat = [
      entry("one", ["alpha"]),
      entry("two", ["alpha", "beta"]),
      entry("three", ["alpha", "beta", "gamma"]),
    ];
    expect(ids(matchTopics(cat, "alpha beta gamma"))).toEqual([
      "three",
      "two",
      "one",
    ]);
  });

  test("repeated occurrences of one keyword count once", () => {
    const cat = [entry("rep", ["alpha"]), entry("two", ["alpha", "beta"])];
    expect(ids(matchTopics(cat, "alpha alpha alpha alpha beta"))).toEqual([
      "two",
      "rep",
    ]);
  });

  test("ties are broken by catalog order", () => {
    const cat = [entry("first", ["x"]), entry("second", ["x"])];
    expect(ids(matchTopics(cat, "x"))).toEqual(["first", "second"]);
  });

  test("default limit is 3; explicit limit honored", () => {
    const cat = ["a", "b", "c", "d", "e"].map((i) => entry(i, ["x"]));
    expect(matchTopics(cat, "x")).toHaveLength(3);
    expect(matchTopics(cat, "x", 5)).toHaveLength(5);
    expect(ids(matchTopics(cat, "x", 1))).toEqual(["a"]);
  });

  test.each([0, -1])("limit %i returns []", (limit) => {
    expect(matchTopics([entry("a", ["x"])], "x", limit)).toEqual([]);
  });

  test("truncates text to its first 20000 chars", () => {
    const cat = [entry("late", ["needle"])];
    expect(matchTopics(cat, `${"a ".repeat(10000)}needle`)).toEqual([]);
    expect(ids(matchTopics(cat, `${"a ".repeat(9990)}needle`))).toEqual([
      "late",
    ]);
  });
});
