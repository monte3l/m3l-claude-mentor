import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendLineAtomic } from "../../src/internal/fs-atomic.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "fs-torn-"));
  dir = join(sandbox, "data");
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("appendLineAtomic torn-tail endings", () => {
  test.each([
    ["a single byte without a newline", Buffer.from("a"), "a\nnext\n"],
    ["a trailing carriage return", Buffer.from("ab\r"), "ab\r\nnext\n"],
    [
      "a lone first byte of a 2-byte UTF-8 character",
      Buffer.from([0x61, 0xc3]),
      "a\xc3\nnext\n",
    ],
  ])("separates %s from the new line", async (_name, existing, expected) => {
    const path = join(dir, "evidence.jsonl");
    writeFileSync(path, existing);
    await appendLineAtomic(dir, "evidence", "next");
    const bytes = readFileSync(path);
    expect([...bytes]).toEqual([...Buffer.from(expected, "latin1")]);
  });

  test("a file already ending in a newline gets no extra separator", async () => {
    const path = join(dir, "evidence.jsonl");
    writeFileSync(path, "a\n");
    await appendLineAtomic(dir, "evidence", "next");
    expect(readFileSync(path, "utf8")).toBe("a\nnext\n");
  });
});
