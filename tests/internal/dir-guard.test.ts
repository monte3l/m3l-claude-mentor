import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { afterAll, describe, expect, test } from "vitest";
import {
  appendLineAtomic,
  readTailLines,
  readTextBounded,
  writeTextAtomic,
} from "../../src/internal/fs-atomic.js";
import {
  describeData,
  exportBundle,
  exportBundleToFile,
  importBundle,
  importBundleFromFile,
  purgeData,
  type Bundle,
} from "../../src/internal/export.js";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.js";
import {
  appendEvidence,
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  readEvidence,
  saveCatalogFile,
  saveGoals,
  saveProfile,
  saveState,
} from "../../src/internal/store.js";
import {
  defaultProfile,
  defaultState,
} from "../../src/internal/state-schema.js";
import { NOW, evidenceAt, expectCode } from "./fixtures/export-data.js";

const UNIQUE = `dir-guard-unique-${String(process.pid)}`;
const DIRS = [`${UNIQUE}/relative`, "", ".", "/"] as const;
const bundle = {} as unknown as Bundle;

type Call = (dir: string) => Promise<unknown>;

const CALLS: readonly (readonly [string, Call])[] = [
  ["readTextBounded", (d) => readTextBounded(d, "goals", 100)],
  ["writeTextAtomic", (d) => writeTextAtomic(d, "goals", "x")],
  ["appendLineAtomic", (d) => appendLineAtomic(d, "evidence", "x")],
  ["readTailLines", (d) => readTailLines(d, "evidence", 100)],
  ["loadState", (d) => loadState(d, NOW)],
  ["saveState", (d) => saveState(d, defaultState(NOW))],
  ["loadProfile", (d) => loadProfile(d, NOW)],
  ["saveProfile", (d) => saveProfile(d, defaultProfile())],
  ["loadCatalogFile", (d) => loadCatalogFile(d)],
  ["saveCatalogFile", (d) => saveCatalogFile(d, EMPTY_CATALOG_FILE)],
  ["loadGoals", (d) => loadGoals(d)],
  ["saveGoals", (d) => saveGoals(d, "x")],
  ["appendEvidence", (d) => appendEvidence(d, evidenceAt(1))],
  ["readEvidence", (d) => readEvidence(d)],
  ["exportBundle", (d) => exportBundle(d, NOW)],
  [
    "exportBundleToFile",
    (d) => exportBundleToFile(d, NOW, join(cwd(), "never-written.json")),
  ],
  ["importBundle", (d) => importBundle(d, bundle, { replace: true })],
  [
    "importBundleFromFile",
    (d) =>
      importBundleFromFile(d, join(cwd(), "never-read.json"), {
        replace: true,
      }),
  ],
  ["describeData", (d) => describeData(d, NOW)],
  ["purgeData", (d) => purgeData(d, { confirm: true })],
];

describe("every public function taking a dir rejects an unsafe dir before any I/O", () => {
  test.each(
    CALLS.flatMap(([name, call]) =>
      DIRS.map((dir) => [name, dir, call] as const),
    ),
  )("%s with %j throws DATA_DIR_INVALID", async (_name, dir, call) => {
    await expectCode(call(dir), "DATA_DIR_INVALID");
  });

  test("no relative directory was created under the working directory", () => {
    expect(existsSync(join(cwd(), UNIQUE))).toBe(false);
    expect(existsSync(join(cwd(), "never-written.json"))).toBe(false);
  });
});

// Runs after the "nothing created" assertion above; removes only the exact
// names this file generated, so a regression cannot leave junk in the repo.
afterAll(() => {
  rmSync(join(cwd(), UNIQUE), { recursive: true, force: true });
  rmSync(join(cwd(), "never-written.json"), { force: true });
  rmSync(join(cwd(), "never-read.json"), { force: true });
});
