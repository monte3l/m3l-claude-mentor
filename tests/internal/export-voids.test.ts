import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  exportBundle,
  importBundleFromFile,
  purgeData,
} from "../../src/internal/export.ts";
import { loadState } from "../../src/internal/store.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "bundle-v1-voids.json",
);
let root: string;
let dst: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "voids-"));
  dst = join(root, "data");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const EXPECTED = [
  { session: "sess-1", at: 1_699_990_000_000 },
  { session: "sess-2", at: 1_699_995_000_000 },
];

test("import then export round-trips the void list and keeps raw evidence", async () => {
  await importBundleFromFile(dst, FIXTURE, { replace: true });
  expect((await loadState(dst, 1)).voidedExams).toEqual(EXPECTED);
  const { bundle } = await exportBundle(dst, 1_700_000_000_000);
  expect(bundle.state.voidedExams).toEqual(EXPECTED);
  const original = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    evidence: unknown[];
  };
  expect(bundle.evidence).toHaveLength(original.evidence.length);
});

test("an old bundle (no voids) imports with no voidedExams key", async () => {
  const old = join(dirname(FIXTURE), "bundle-v1.json");
  await importBundleFromFile(dst, old, { replace: true });
  const state = await loadState(dst, 1);
  expect(Object.hasOwn(state, "voidedExams")).toBe(false);
});

test("purge still removes the data (void list is part of state)", async () => {
  await importBundleFromFile(dst, FIXTURE, { replace: true });
  await purgeData(dst, { confirm: true });
  const state = await loadState(dst, 1);
  expect(Object.hasOwn(state, "voidedExams")).toBe(false);
});
