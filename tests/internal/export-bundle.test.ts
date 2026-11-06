import { describe, expect, test } from "vitest";
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  parseBundle,
  serializeBundle,
  type Bundle,
} from "../../src/internal/export.js";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.js";
import {
  defaultProfile,
  defaultState,
} from "../../src/internal/state-schema.js";
import { evidenceAt } from "./fixtures/export-data.js";

const valid = (): Record<string, unknown> => ({
  format: "m3l-claude-mentor-export",
  version: 1,
  exportedAt: 1_700_000_000_000,
  state: JSON.parse(JSON.stringify(defaultState(5))),
  profile: JSON.parse(JSON.stringify(defaultProfile())),
  catalog: { user: { overrides: {}, custom: [] }, scoring: {} },
  goals: "learn hooks",
  evidence: [evidenceAt(10), evidenceAt(20, "sess-2")],
});

const reason = (value: unknown): string => {
  const r = parseBundle(value);
  if (r.ok) throw new Error("expected failure");
  return r.reason;
};

describe("constants", () => {
  test("pin the format name and version", () => {
    expect(BUNDLE_FORMAT).toBe("m3l-claude-mentor-export");
    expect(BUNDLE_VERSION).toBe(1);
  });
});

describe("parseBundle", () => {
  test("accepts a valid bundle and returns each section", () => {
    const r = parseBundle(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe("m3l-claude-mentor-export");
    expect(r.value.version).toBe(1);
    expect(r.value.exportedAt).toBe(1_700_000_000_000);
    expect(r.value.goals).toBe("learn hooks");
    expect(r.value.evidence).toHaveLength(2);
    expect(r.value.evidence[1]?.session).toBe("sess-2");
    expect(r.value.state.segment.startedAt).toBe(5);
  });

  test("accepts an empty evidence list and empty goals", () => {
    const r = parseBundle({ ...valid(), evidence: [], goals: "" });
    expect(r.ok).toBe(true);
  });

  test("ignores extra keys and does not carry them over", () => {
    const r = parseBundle({ ...valid(), extra: "SMUGGLED" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value)).not.toContain("SMUGGLED");
  });

  test.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a number", 3],
  ])("rejects %s", (_name, value) => {
    expect(parseBundle(value).ok).toBe(false);
  });

  test("rejects a different version with 'unsupported bundle version'", () => {
    expect(reason({ ...valid(), version: 2 })).toContain(
      "unsupported bundle version",
    );
  });

  test.each([["1"], [0], [1.5], [null]])("rejects version %j", (version) => {
    expect(parseBundle({ ...valid(), version }).ok).toBe(false);
  });

  test("rejects a wrong format", () => {
    expect(parseBundle({ ...valid(), format: "other" }).ok).toBe(false);
  });

  test("a format inherited from the prototype does not count", () => {
    const { format: _format, ...rest } = valid();
    const inherited = Object.create({ format: BUNDLE_FORMAT }) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, rest);
    expect(parseBundle(inherited).ok).toBe(false);
  });

  test.each(["state", "profile", "catalog", "goals", "evidence", "exportedAt"])(
    "rejects a missing %s section",
    (key) => {
      const { [key]: _gone, ...rest } = valid();
      expect(parseBundle(rest).ok).toBe(false);
    },
  );

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "5"])(
    "rejects exportedAt %j",
    (exportedAt) => {
      expect(parseBundle({ ...valid(), exportedAt }).ok).toBe(false);
    },
  );

  test("rejects an invalid state or profile section", () => {
    expect(parseBundle({ ...valid(), state: { nope: 1 } }).ok).toBe(false);
    expect(parseBundle({ ...valid(), profile: 7 }).ok).toBe(false);
    expect(parseBundle({ ...valid(), catalog: "x" }).ok).toBe(false);
  });

  test("names the zero-based index of a corrupt evidence item", () => {
    const evidence = [evidenceAt(1), evidenceAt(2), { channel: "quiz" }];
    expect(reason({ ...valid(), evidence })).toContain("2");
    const second = [evidenceAt(1), { bogus: true }, evidenceAt(3)];
    expect(reason({ ...valid(), evidence: second })).toContain("1");
  });

  test("rejects non-array evidence", () => {
    expect(parseBundle({ ...valid(), evidence: {} }).ok).toBe(false);
  });

  test("accepts exactly 10,000 evidence items and rejects 10,001", () => {
    const make = (n: number): unknown[] =>
      Array.from({ length: n }, (_, i) => evidenceAt(i));
    expect(parseBundle({ ...valid(), evidence: make(10_000) }).ok).toBe(true);
    expect(parseBundle({ ...valid(), evidence: make(10_001) }).ok).toBe(false);
  });

  test("goals: accepts 65,536 bytes, rejects 65,537, NUL and non-strings", () => {
    expect(parseBundle({ ...valid(), goals: "a".repeat(65_536) }).ok).toBe(
      true,
    );
    expect(parseBundle({ ...valid(), goals: "a".repeat(65_537) }).ok).toBe(
      false,
    );
    // 3-byte characters: 21,846 of them is 65,538 bytes but only 21,846 chars.
    expect(parseBundle({ ...valid(), goals: "€".repeat(21_846) }).ok).toBe(
      false,
    );
    expect(parseBundle({ ...valid(), goals: "a\0b" }).ok).toBe(false);
    expect(parseBundle({ ...valid(), goals: 5 }).ok).toBe(false);
  });

  test("does not echo rejected input in the reason", () => {
    const text = reason({ ...valid(), goals: "SECRET\0VALUE" });
    expect(text).not.toContain("SECRET");
  });
});

describe("serializeBundle", () => {
  const bundle = (): Bundle => {
    const r = parseBundle(valid());
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };

  test("is pretty-printed JSON with two-space indent and a trailing newline", () => {
    const text = serializeBundle(bundle());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "format": "m3l-claude-mentor-export"');
  });

  test("round-trips through parseBundle", () => {
    const original = bundle();
    const again = parseBundle(JSON.parse(serializeBundle(original)));
    expect(again).toEqual({ ok: true, value: original });
  });

  test("serializes the catalog section", () => {
    const text = serializeBundle({ ...bundle(), catalog: EMPTY_CATALOG_FILE });
    const parsed = JSON.parse(text) as { catalog: unknown };
    expect(parseBundle({ ...valid(), catalog: parsed.catalog }).ok).toBe(true);
  });
});
