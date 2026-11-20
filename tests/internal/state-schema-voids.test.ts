import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseBundle, serializeBundle } from "../../src/internal/export.ts";
import { defaultState, parseState } from "../../src/internal/state-schema.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "bundle-v1-voids.json",
);

function state(voidedExams?: unknown): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(defaultState(500))) as Record<
    string,
    unknown
  >;
  return voidedExams === undefined ? base : { ...base, voidedExams };
}
const entry = (i: number): { session: string; at: number } => ({
  session: `s${String(i)}`,
  at: i,
});
const fails = (value: unknown): boolean => !parseState(value).ok;

describe("parseState voidedExams", () => {
  test("an old state without the key stays valid and gains no own key", () => {
    const r = parseState(state());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, "voidedExams")).toBe(false);
  });

  test("defaultState has no voidedExams key", () => {
    expect(Object.hasOwn(defaultState(1), "voidedExams")).toBe(false);
  });

  test("a valid list round-trips", () => {
    const list = [entry(1), { session: "s1", at: 2 }];
    const r = parseState(state(list));
    expect(r).toMatchObject({ ok: true, value: { voidedExams: list } });
  });

  test("accepts exactly 100 distinct entries, rejects 101", () => {
    const hundred = Array.from({ length: 100 }, (_v, i) => entry(i));
    expect(parseState(state(hundred)).ok).toBe(true);
    expect(fails(state([...hundred, entry(100)]))).toBe(true);
  });

  test("a sparse-array hole is rejected, not skipped", () => {
    // eslint-disable-next-line no-sparse-arrays -- intentional hole to prove it is rejected
    const holey = [entry(1), , entry(3)];
    expect(fails(state(holey))).toBe(true);
  });

  test("an empty list is not an error", () => {
    expect(parseState(state([])).ok).toBe(true);
  });

  test.each([
    ["not an array", { session: "s1", at: 1 }],
    ["duplicate pair", [entry(1), entry(1)]],
    ["negative at", [{ session: "s1", at: -1 }]],
    ["fractional at", [{ session: "s1", at: 1.5 }]],
    ["unsafe at", [{ session: "s1", at: 2 ** 53 }]],
    ["string at", [{ session: "s1", at: "1" }]],
    ["bad session", [{ session: "", at: 1 }]],
    ["missing session", [{ at: 1 }]],
    ["null entry", [null]],
  ])("rejects %s", (_name, value) => {
    expect(fails(state(value))).toBe(true);
  });
});

describe("bundle-v1-voids fixture", () => {
  const raw = (): unknown => JSON.parse(readFileSync(FIXTURE, "utf8"));

  test("parses and carries the voided list in its state", () => {
    const r = parseBundle(raw());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.voidedExams).toEqual([
      { session: "sess-1", at: 1_699_990_000_000 },
      { session: "sess-2", at: 1_699_995_000_000 },
    ]);
  });

  test("survives serialize then parse", () => {
    const first = parseBundle(raw());
    if (!first.ok) throw new Error("fixture rejected");
    const again = parseBundle(JSON.parse(serializeBundle(first.value)));
    expect(again).toEqual(first);
  });
});
