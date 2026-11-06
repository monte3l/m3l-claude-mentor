import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
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
  sandbox = mkdtempSync(join(tmpdir(), "purge-edge-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("purgeData leftover-name guards", () => {
  test("a leftover name with a newline that cannot be unlinked yields a message with no raw newline", async () => {
    mkdirSync(dir);
    const name = ".state.json.a\nb.tmp";
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "inner"), "x");
    const error = await expectCode(
      purgeData(dir, { confirm: true }),
      "WRITE_FAILED",
    );
    expect(error.message).not.toContain("\n");
    expect(error.message).toContain(JSON.stringify(name));
  });

  test("'.state.json..tmp' (empty middle) is not deleted but '.state.json.x.tmp' is", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, ".state.json..tmp"), "keep");
    writeFileSync(join(dir, ".state.json.x.tmp"), "drop");
    await purgeData(dir, { confirm: true });
    expect(existsSync(join(dir, ".state.json..tmp"))).toBe(true);
    expect(existsSync(join(dir, ".state.json.x.tmp"))).toBe(false);
  });

  test("an options object inheriting confirm from its prototype is rejected and deletes nothing", async () => {
    await seed(dir);
    const inherited: unknown = Object.create({ confirm: true });
    await expectCode(
      purgeData(dir, inherited as { confirm: true }),
      "CONFIRMATION_REQUIRED",
    );
    expect(existsSync(join(dir, "state.json"))).toBe(true);
    expect(existsSync(join(dir, "evidence.jsonl"))).toBe(true);
  });

  test("a data dir that is a regular file is WRITE_FAILED mentioning leftover temp files", async () => {
    writeFileSync(dir, "i am a file");
    const error = await expectCode(
      purgeData(dir, { confirm: true }),
      "WRITE_FAILED",
    );
    expect(error.message).toMatch(/leftover temp files/i);
  });
});
