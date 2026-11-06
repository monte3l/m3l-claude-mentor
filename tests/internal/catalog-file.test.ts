import { describe, expect, expectTypeOf, test } from "vitest";
import {
  EMPTY_CATALOG_FILE,
  parseCatalogFile,
  serializeCatalogFile,
  type CatalogFile,
} from "../../src/internal/catalog-file.js";
import type { Parsed } from "../../src/internal/schema.js";

const entry = {
  id: "my-topic",
  title: "My topic",
  type: "feature",
  dependencies: [],
  keywords: ["my topic"],
  targetLevel: "Applied",
  enabled: true,
};

const weights = {
  observed: 1,
  "explain-back": 1,
  quiz: 1,
  "self-report": 0.5,
};

function value(result: Parsed<CatalogFile>): CatalogFile {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.value;
}

describe("EMPTY_CATALOG_FILE", () => {
  test("has an empty user catalog and an empty scoring config", () => {
    expect(EMPTY_CATALOG_FILE).toEqual({
      user: { overrides: {}, custom: [] },
      scoring: {},
    });
  });
});

describe("parseCatalogFile", () => {
  test("parses an empty object to the empty catalog file", () => {
    expect(value(parseCatalogFile({}))).toEqual({
      user: { overrides: {}, custom: [] },
      scoring: {},
    });
  });

  test("parses overrides, custom topics and scoring together", () => {
    const parsed = value(
      parseCatalogFile({
        overrides: { "plan-mode": { enabled: false } },
        custom: [entry],
        scoring: { weights, halfLifeDays: 30, fluencySessions: 3 },
      }),
    );
    expect(parsed.user.overrides).toEqual({ "plan-mode": { enabled: false } });
    expect(parsed.user.custom).toEqual([entry]);
    expect(parsed.scoring).toEqual({
      weights,
      halfLifeDays: 30,
      fluencySessions: 3,
    });
  });

  test("does not leak the scoring key into the user catalog", () => {
    const parsed = value(parseCatalogFile({ scoring: { halfLifeDays: 7 } }));
    expect(Object.keys(parsed.user).sort()).toEqual(["custom", "overrides"]);
    expect(parsed.scoring).toEqual({ halfLifeDays: 7 });
  });

  test.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a number", 3],
  ])("rejects %s with a reason", (_name, input) => {
    const result = parseCatalogFile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  test("rejects an invalid scoring config", () => {
    expect(parseCatalogFile({ scoring: { halfLifeDays: -1 } }).ok).toBe(false);
    expect(parseCatalogFile({ scoring: "nope" }).ok).toBe(false);
  });

  test("rejects an invalid user catalog", () => {
    expect(parseCatalogFile({ overrides: "nope" }).ok).toBe(false);
    expect(parseCatalogFile({ custom: [{ id: "Bad Id" }] }).ok).toBe(false);
  });
});

describe("serializeCatalogFile", () => {
  test("omits scoring when it has no keys", () => {
    const out = serializeCatalogFile(EMPTY_CATALOG_FILE);
    expect(out).toEqual({ overrides: {}, custom: [] });
    expect(Object.hasOwn(out, "scoring")).toBe(false);
  });

  test("includes scoring when it has at least one key", () => {
    const file = value(parseCatalogFile({ scoring: { fluencySessions: 5 } }));
    const out = serializeCatalogFile(file);
    expect(out.scoring).toEqual({ fluencySessions: 5 });
    expect(out.overrides).toEqual({});
    expect(out.custom).toEqual([]);
  });

  test("produces JSON-ready output", () => {
    const file = value(
      parseCatalogFile({
        overrides: { "plan-mode": { enabled: false } },
        custom: [entry],
        scoring: { weights, halfLifeDays: 14 },
      }),
    );
    const out = serializeCatalogFile(file);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  test("round-trips through parseCatalogFile", () => {
    const file = value(
      parseCatalogFile({
        overrides: { "plan-mode": { enabled: false, targetLevel: "Recalled" } },
        custom: [entry],
        scoring: { weights, halfLifeDays: 14, fluencySessions: 2 },
      }),
    );
    expect(value(parseCatalogFile(serializeCatalogFile(file)))).toEqual(file);
    expect(
      value(parseCatalogFile(serializeCatalogFile(EMPTY_CATALOG_FILE))),
    ).toEqual(EMPTY_CATALOG_FILE);
  });
});

describe("types", () => {
  test("CatalogFile exposes readonly user and scoring", () => {
    expectTypeOf<CatalogFile>().toHaveProperty("user");
    expectTypeOf<CatalogFile>().toHaveProperty("scoring");
    expectTypeOf(parseCatalogFile).returns.toEqualTypeOf<Parsed<CatalogFile>>();
  });
});
