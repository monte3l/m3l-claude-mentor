import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CatalogFile } from "../../src/internal/catalog-file.js";
import { MentorStateError } from "../../src/internal/errors.js";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  saveCatalogFile,
} from "../../src/internal/store.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "store-guards-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MentorStateError);
    return (error as MentorStateError).code;
  }
  return "none";
}

test.each([
  ["loadState", (): Promise<unknown> => loadState(dir, 0)],
  ["loadProfile", (): Promise<unknown> => loadProfile(dir, 0)],
  ["loadCatalogFile", (): Promise<unknown> => loadCatalogFile(dir)],
  ["loadGoals", (): Promise<unknown> => loadGoals(dir)],
])(
  "%s: a regular file where the data dir should be gives READ_FAILED",
  async (_n, load) => {
    writeFileSync(dir, "i am a file");
    expect(await codeOf(load())).toBe("READ_FAILED");
  },
);

test.each([
  ["null", null],
  ["a string", "nope"],
  ["an array", []],
  ["a non-object user", { user: 5, scoring: {} }],
  ["a null user", { user: null, scoring: {} }],
])(
  "saveCatalogFile rejects %s with VALIDATION_FAILED and leaves the file untouched",
  async (_n, bad) => {
    await saveCatalogFile(dir, {
      user: { overrides: {}, custom: [] },
      scoring: {},
    });
    const before = readFileSync(join(dir, "catalog.json"), "utf8");
    expect(
      await codeOf(saveCatalogFile(dir, bad as unknown as CatalogFile)),
    ).toBe("VALIDATION_FAILED");
    expect(readFileSync(join(dir, "catalog.json"), "utf8")).toBe(before);
  },
);

test("saveCatalogFile rejects a non-object without creating the file", async () => {
  expect(
    await codeOf(saveCatalogFile(dir, null as unknown as CatalogFile)),
  ).toBe("VALIDATION_FAILED");
  expect(existsSync(join(dir, "catalog.json"))).toBe(false);
});
