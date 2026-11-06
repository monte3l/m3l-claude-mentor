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

function gen(n: number, prefix = "t"): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => raw(`${prefix}${String(i)}`));
}

function bundledOf(n: number): readonly CatalogEntry[] {
  const r = parseCatalog(gen(n, "b"));
  if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
  return r.value;
}

function entry(id: string, keywords: string[]): CatalogEntry {
  const r = parseCatalog([raw(id, { keywords })]);
  if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
  const [e] = r.value;
  if (e === undefined) throw new Error("fixture empty");
  return e;
}

describe("parseUserCatalog caps", () => {
  test("accepts 500 custom entries, rejects 501", () => {
    expect(parseUserCatalog({ custom: gen(500) }).ok).toBe(true);
    expect(parseUserCatalog({ custom: gen(501) }).ok).toBe(false);
  });

  test("accepts 500 override keys, rejects 501", () => {
    const make = (n: number): Record<string, unknown> =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`t${String(i)}`, {}]),
      );
    expect(parseUserCatalog({ overrides: make(500) }).ok).toBe(true);
    expect(parseUserCatalog({ overrides: make(501) }).ok).toBe(false);
  });
});

describe("mergeCatalog caps and reasons", () => {
  test("a merged catalog of 500 passes and 501 fails", () => {
    const ok = parseUserCatalog({ custom: gen(200, "c") });
    const over = parseUserCatalog({ custom: gen(201, "c") });
    if (!ok.ok || !over.ok) throw new Error("fixture invalid");
    const bundled = bundledOf(300);
    expect(mergeCatalog(bundled, ok.value).ok).toBe(true);
    expect(mergeCatalog(bundled, over.value).ok).toBe(false);
  });

  test("a duplicate custom id reason names its index within custom", () => {
    const user = parseUserCatalog({
      custom: [raw("x"), raw("y"), raw("z"), raw("y")],
    });
    if (!user.ok) throw new Error("fixture invalid");
    // 2 bundled entries shift the merged index (5) away from the custom index (3).
    const r = mergeCatalog(bundledOf(2), user.value);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("3");
      expect(r.reason).not.toContain("5");
    }
  });
});

describe("matchTopics Unicode word boundary", () => {
  test("keyword cafe does not match when a letter follows", () => {
    expect(matchTopics([entry("c", ["cafe"])], "cafeé au lait")).toEqual([]);
  });

  test("keyword caf does not match inside café", () => {
    expect(matchTopics([entry("c", ["caf"])], "un café noir")).toEqual([]);
  });

  test("a non-ASCII letter before the keyword blocks the match", () => {
    expect(matchTopics([entry("c", ["plan"])], "éplan")).toEqual([]);
  });

  test("plan does not match planéte", () => {
    expect(matchTopics([entry("p", ["plan"])], "la planéte")).toEqual([]);
  });

  test("plan still matches a plan. and plan mode", () => {
    const cat = [entry("p", ["plan"])];
    expect(matchTopics(cat, "a plan.")).toHaveLength(1);
    expect(matchTopics(cat, "plan mode")).toHaveLength(1);
  });

  test("a non-letter non-ASCII symbol is a boundary", () => {
    expect(matchTopics([entry("p", ["plan"])], "→plan←")).toHaveLength(1);
  });

  test("a keyword with non-ASCII letters matches as a whole word", () => {
    expect(matchTopics([entry("c", ["café"])], "un café noir")).toHaveLength(1);
  });
});
