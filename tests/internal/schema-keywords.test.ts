import { afterEach, describe, expect, test } from "vitest";
import { parseCatalogEntry, parseKeywords } from "../../src/internal/schema.js";

const validEntry: Record<string, unknown> = {
  id: "context-window",
  title: "The context window",
  type: "concept",
  dependencies: [],
  keywords: ["context"],
  targetLevel: "Understood",
  style: "socratic",
  enabled: true,
};

function sparse(length: number, index: number, value: unknown): unknown[] {
  const arr: unknown[] = new Array<unknown>(length);
  arr[index] = value;
  return arr;
}

describe("parseKeywords", () => {
  test("trims and lowercases", () => {
    expect(parseKeywords(["  Plan Mode ", "CLAUDE.md"], "keywords")).toEqual({
      ok: true,
      value: ["plan mode", "claude.md"],
    });
  });

  test("failure reason names the field", () => {
    const r = parseKeywords("nope", "overrides.a.keywords");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("overrides.a.keywords");
  });

  test("bad item reason names the field and zero-based index", () => {
    const r = parseKeywords(["ok", "fine", "  "], "keywords");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("keywords");
      expect(r.reason).toContain("2");
    }
  });

  test("accepts 20 items and rejects 21", () => {
    const make = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `k${String(i)}`);
    expect(parseKeywords(make(20), "keywords").ok).toBe(true);
    expect(parseKeywords(make(21), "keywords").ok).toBe(false);
  });

  test("accepts 40 chars and rejects 41", () => {
    expect(parseKeywords(["k".repeat(40)], "keywords").ok).toBe(true);
    expect(parseKeywords(["k".repeat(41)], "keywords").ok).toBe(false);
  });

  test("measures length after trimming", () => {
    expect(parseKeywords([`  ${"k".repeat(40)}  `], "keywords").ok).toBe(true);
  });

  test("rejects a sparse array, naming the field and hole index", () => {
    const r = parseKeywords(sparse(2, 1, "a"), "keywords");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("keywords");
      expect(r.reason).toContain("0");
    }
  });

  test.each([
    ["string", "a"],
    ["object", {}],
    ["null", null],
    ["undefined", undefined],
  ])("rejects non-array %s", (_n, v) => {
    expect(parseKeywords(v, "keywords").ok).toBe(false);
  });

  test("rejects a non-string item", () => {
    expect(parseKeywords(["a", 5], "keywords").ok).toBe(false);
  });

  test("reason does not echo the raw bad value", () => {
    const r = parseKeywords(["ok", "SECRET".repeat(10)], "keywords");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("SECRET");
  });
});

describe("parseCatalogEntry (fix round)", () => {
  test("reads each of the seven fields exactly once", () => {
    const counts: Record<string, number> = {};
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(validEntry)) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        get() {
          counts[key] = (counts[key] ?? 0) + 1;
          return val;
        },
      });
    }
    // style is supplied here, so all of id/title/type/dependencies/keywords/
    // targetLevel/style/enabled are exercised.
    expect(parseCatalogEntry(obj).ok).toBe(true);
    for (const key of Object.keys(validEntry)) {
      expect(counts[key]).toBe(1);
    }
  });

  test("a style only on the prototype is treated as absent", () => {
    const base: Record<string, unknown> = { ...validEntry };
    delete base["style"];
    const obj = Object.assign(
      Object.create({ style: "socratic" }) as Record<string, unknown>,
      base,
    );
    const r = parseCatalogEntry(obj);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, "style")).toBe(false);
  });

  test("stores the title trimmed", () => {
    const r = parseCatalogEntry({ ...validEntry, title: "  T  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toBe("T");
  });

  test("does not copy extra keys", () => {
    const r = parseCatalogEntry({ ...validEntry, extra: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, "extra")).toBe(false);
  });

  test.each([
    "id",
    "title",
    "type",
    "dependencies",
    "keywords",
    "targetLevel",
    "enabled",
  ])("rejects a missing %s", (key) => {
    const copy: Record<string, unknown> = { ...validEntry };
    delete copy[key];
    expect(parseCatalogEntry(copy).ok).toBe(false);
  });

  test("rejects sparse dependencies, naming the field", () => {
    const r = parseCatalogEntry({
      ...validEntry,
      dependencies: sparse(2, 1, "a"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("dependencies");
  });

  test("rejects sparse keywords", () => {
    expect(
      parseCatalogEntry({ ...validEntry, keywords: sparse(2, 1, "a") }).ok,
    ).toBe(false);
  });
});

describe("plain JSON-parsed bad data never throws", () => {
  test.each([
    '{"id":"a","title":"t","type":"concept","dependencies":null,"keywords":[],"targetLevel":"Fluent","enabled":true}',
    '{"id":"a","title":"t","type":"concept","dependencies":[null],"keywords":[],"targetLevel":"Fluent","enabled":true}',
    '{"id":"a","title":"t","type":"concept","dependencies":[],"keywords":[[]],"targetLevel":"Fluent","enabled":true}',
    '{"id":"a","title":{"x":1},"type":"concept","dependencies":[],"keywords":[],"targetLevel":"Fluent","enabled":true}',
    '{"__proto__":{"id":"a"}}',
    '{"constructor":{"prototype":{}}}',
    "[[[[[]]]]]",
    '"just a string"',
    "null",
    "12",
  ])("%s", (json) => {
    const value = JSON.parse(json) as unknown;
    let result: ReturnType<typeof parseCatalogEntry> | undefined;
    expect(() => {
      result = parseCatalogEntry(value);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });
});

describe("a hole never falls through to Array.prototype", () => {
  afterEach(() => {
    Reflect.deleteProperty(Array.prototype, "0");
  });

  function pollute(value: string): void {
    Object.defineProperty(Array.prototype, "0", {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }

  test("keywords hole is rejected even when the prototype supplies a valid string", () => {
    pollute("polluted");
    const arr: unknown[] = new Array<unknown>(2);
    arr[1] = "b";
    const r = parseKeywords(arr, "keywords");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("0");
  });

  test("dependencies hole is rejected even when the prototype supplies a valid id", () => {
    pollute("polluted-id");
    const arr: unknown[] = new Array<unknown>(2);
    arr[1] = "b";
    const r = parseCatalogEntry({ ...validEntry, dependencies: arr });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("dependencies");
  });
});
