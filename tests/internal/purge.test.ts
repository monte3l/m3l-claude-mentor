import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { purgeData } from "../../src/internal/export.js";
import { expectCode, seed } from "./fixtures/export-data.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "purge-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const MANAGED = [
  "profile.json",
  "state.json",
  "catalog.json",
  "goals.md",
  "evidence.jsonl",
];

describe("purgeData", () => {
  test("deletes the managed files and reports deleted vs alreadyMissing", async () => {
    await seed(dir);
    const result = await purgeData(dir, { confirm: true });
    expect([...result.deleted].sort()).toEqual([
      "evidence",
      "goals",
      "profile",
      "state",
    ]);
    expect(result.alreadyMissing).toEqual(["catalog"]);
    for (const name of MANAGED) expect(existsSync(join(dir, name))).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });

  test("keeps unrelated files, a subdirectory and its contents", async () => {
    await seed(dir);
    writeFileSync(join(dir, "notes.txt"), "mine");
    writeFileSync(join(dir, "state.json.bak"), "backup");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "state.json"), "nested");
    await purgeData(dir, { confirm: true });
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("mine");
    expect(readFileSync(join(dir, "state.json.bak"), "utf8")).toBe("backup");
    expect(readFileSync(join(dir, "sub", "state.json"), "utf8")).toBe("nested");
  });

  test("removes leftover .<name>.*.tmp files but not look-alikes", async () => {
    await seed(dir);
    writeFileSync(join(dir, ".state.json.1.abc.tmp"), "x");
    writeFileSync(join(dir, ".evidence.jsonl.99.zz.tmp"), "x");
    writeFileSync(join(dir, ".state.json.bak"), "keep");
    writeFileSync(join(dir, ".other.json.1.abc.tmp"), "keep");
    writeFileSync(join(dir, "state.json.1.abc.tmp"), "keep");
    await purgeData(dir, { confirm: true });
    expect(existsSync(join(dir, ".state.json.1.abc.tmp"))).toBe(false);
    expect(existsSync(join(dir, ".evidence.jsonl.99.zz.tmp"))).toBe(false);
    expect(existsSync(join(dir, ".state.json.bak"))).toBe(true);
    expect(existsSync(join(dir, ".other.json.1.abc.tmp"))).toBe(true);
    expect(existsSync(join(dir, "state.json.1.abc.tmp"))).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "unlinks a symlink pointing outside the directory and leaves its target",
    async () => {
      mkdirSync(dir);
      const outside = join(sandbox, "outside.txt");
      writeFileSync(outside, "precious");
      symlinkSync(outside, join(dir, "goals.md"));
      const result = await purgeData(dir, { confirm: true });
      expect(result.deleted).toEqual(["goals"]);
      expect(readFileSync(outside, "utf8")).toBe("precious");
      expect(existsSync(join(dir, "goals.md"))).toBe(false);
    },
  );

  test.each([
    ["missing", {}],
    ["false", { confirm: false }],
    ["the string yes", { confirm: "yes" }],
    ["1", { confirm: 1 }],
    ["undefined", { confirm: undefined }],
  ])(
    "confirm %s -> CONFIRMATION_REQUIRED and nothing is deleted",
    async (_n, options) => {
      await seed(dir);
      await expectCode(
        purgeData(dir, options as unknown as { confirm: true }),
        "CONFIRMATION_REQUIRED",
      );
      for (const name of MANAGED.filter((n) => n !== "catalog.json")) {
        expect(existsSync(join(dir, name))).toBe(true);
      }
    },
  );

  test("a non-empty directory named profile.json yields one collected WRITE_FAILED while the others are still deleted", async () => {
    await seed(dir);
    rmSync(join(dir, "profile.json"));
    mkdirSync(join(dir, "profile.json"));
    writeFileSync(join(dir, "profile.json", "inner.txt"), "inside");
    const error = await expectCode(
      purgeData(dir, { confirm: true }),
      "WRITE_FAILED",
    );
    expect(error.message).toContain("profile.json");
    expect(error.message).not.toContain(sandbox);
    for (const name of ["state.json", "goals.md", "evidence.jsonl"]) {
      expect(existsSync(join(dir, name))).toBe(false);
    }
    expect(readFileSync(join(dir, "profile.json", "inner.txt"), "utf8")).toBe(
      "inside",
    );
  });

  test("purging an empty directory is fine", async () => {
    mkdirSync(dir);
    const result = await purgeData(dir, { confirm: true });
    expect(result.deleted).toEqual([]);
    expect([...result.alreadyMissing].sort()).toEqual([
      "catalog",
      "evidence",
      "goals",
      "profile",
      "state",
    ]);
    expect(existsSync(dir)).toBe(true);
  });

  test("purging a missing directory is fine and does not create it", async () => {
    const result = await purgeData(dir, { confirm: true });
    expect(result.deleted).toEqual([]);
    expect(result.alreadyMissing).toHaveLength(5);
    expect(existsSync(dir)).toBe(false);
  });
});
