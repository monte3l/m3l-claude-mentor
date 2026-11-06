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
import {
  describeData,
  exportBundle,
  exportBundleToFile,
  importBundle,
  importBundleFromFile,
} from "../../src/internal/export.js";
import {
  NOW,
  evidenceAt,
  expectCode,
  seed,
  snapshot,
} from "./fixtures/export-data.js";

let sandbox = "";
let src = "";
let dst = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "export-edge-"));
  src = join(sandbox, "src");
  dst = join(sandbox, "dst");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const REPLACE = { replace: true } as const;
const putRaw = (name: string, text: string): void => {
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, name), text);
};

describe("exportBundle evidenceSkipped", () => {
  test("a clean log reports 0", async () => {
    await seed(src);
    const result = await exportBundle(src, NOW);
    expect(result.evidenceSkipped).toBe(0);
    expect(result.bundle.evidence).toHaveLength(2);
  });

  test("a malformed line is counted as 1 and the other events are still exported", async () => {
    await seed(src);
    const path = join(src, "evidence.jsonl");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}{"channel":"qui\n${JSON.stringify(evidenceAt(NOW - 1000, "sess-3"))}\n`,
    );
    const result = await exportBundle(src, NOW);
    expect(result.evidenceSkipped).toBe(1);
    expect(result.bundle.evidence.map((e) => e.session)).toEqual([
      "sess-1",
      "sess-2",
      "sess-3",
    ]);
  });

  test("exportBundleToFile returns the same skipped count and still writes the file", async () => {
    await seed(src);
    putRaw("evidence.jsonl", `${JSON.stringify(evidenceAt(5))}\ngarbage\n`);
    const target = join(sandbox, "out.json");
    const result = await exportBundleToFile(src, NOW, target);
    expect(result).toEqual({ evidenceSkipped: 1 });
    expect(existsSync(target)).toBe(true);
  });

  test("a clean exportBundleToFile returns 0", async () => {
    await seed(src);
    expect(await exportBundleToFile(src, NOW, join(sandbox, "o.json"))).toEqual(
      { evidenceSkipped: 0 },
    );
  });
});

describe("exportBundle / exportBundleToFile guards", () => {
  test("goals.md containing NUL is VALIDATION_FAILED", async () => {
    await seed(src);
    putRaw("goals.md", "bad\0goal");
    await expectCode(exportBundle(src, NOW), "VALIDATION_FAILED");
  });

  test("refuses a managed path written in a different letter case", async () => {
    await seed(src);
    const before = snapshot(src);
    await expectCode(
      exportBundleToFile(src, NOW, join(src, "STATE.JSON")),
      "VALIDATION_FAILED",
    );
    expect(snapshot(src)).toEqual(before);
  });

  test("replaces an existing unrelated target file", async () => {
    await seed(src);
    const target = join(sandbox, "existing.txt");
    writeFileSync(target, "OLD CONTENT");
    await exportBundleToFile(src, NOW, target);
    const text = readFileSync(target, "utf8");
    expect(text).not.toContain("OLD CONTENT");
    expect(text).toContain("m3l-claude-mentor-export");
  });
});

describe("describeData loads every section", () => {
  test("a corrupt catalog.json is PARSE_FAILED", async () => {
    await seed(src);
    putRaw("catalog.json", "{nope");
    await expectCode(describeData(src, NOW), "PARSE_FAILED");
  });

  test("a catalog failing its parser is VALIDATION_FAILED", async () => {
    await seed(src);
    putRaw("catalog.json", "[]");
    await expectCode(describeData(src, NOW), "VALIDATION_FAILED");
  });

  test("goals.md containing NUL is VALIDATION_FAILED", async () => {
    await seed(src);
    putRaw("goals.md", "a\0b");
    await expectCode(describeData(src, NOW), "VALIDATION_FAILED");
  });

  test("goals.md over 64 KiB is TOO_LARGE", async () => {
    await seed(src);
    putRaw("goals.md", "a".repeat(65_537));
    await expectCode(describeData(src, NOW), "TOO_LARGE");
  });

  test.skipIf(process.platform === "win32")(
    "a symlinked managed file is READ_FAILED",
    async () => {
      await seed(src);
      const outside = join(sandbox, "outside.txt");
      writeFileSync(outside, "x");
      rmSync(join(src, "goals.md"));
      symlinkSync(outside, join(src, "goals.md"));
      await expectCode(describeData(src, NOW), "READ_FAILED");
    },
  );

  test.skipIf(process.platform === "win32")(
    "a dangling symlinked managed file is READ_FAILED",
    async () => {
      await seed(src);
      rmSync(join(src, "goals.md"));
      symlinkSync(join(sandbox, "missing-target"), join(src, "goals.md"));
      await expectCode(describeData(src, NOW), "READ_FAILED");
    },
  );
});

describe("import edge cases", () => {
  test("a bundle file starting with a UTF-8 BOM imports successfully", async () => {
    await seed(src);
    const file = join(sandbox, "bom.json");
    await exportBundleToFile(src, NOW, file);
    writeFileSync(file, `\uFEFF${readFileSync(file, "utf8")}`);
    const summary = await importBundleFromFile(dst, file, REPLACE);
    expect(summary.evidenceEvents).toBe(2);
    expect(readFileSync(join(dst, "goals.md"), "utf8")).toBe(
      "Learn hooks\nand plan mode\n",
    );
  });

  test("a first-write failure says sections already replaced: none", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    mkdirSync(join(dst, "evidence.jsonl"), { recursive: true });
    const error = await expectCode(
      importBundle(dst, bundle, REPLACE),
      "WRITE_FAILED",
    );
    expect(error.message).toContain("sections already replaced: none");
  });

  test("evidence.jsonl being a directory leaves the other managed files unchanged", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    mkdirSync(join(dst, "evidence.jsonl"), { recursive: true });
    writeFileSync(join(dst, "goals.md"), "keep me");
    writeFileSync(join(dst, "state.json"), "keep state");
    const before = snapshot(dst);
    await expectCode(importBundle(dst, bundle, REPLACE), "WRITE_FAILED");
    const after = snapshot(dst);
    expect(after["goals.md"]).toBe(before["goals.md"]);
    expect(after["state.json"]).toBe(before["state.json"]);
    expect(after["evidence.jsonl"]).toBe("<dir>");
    expect(Object.keys(after).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
