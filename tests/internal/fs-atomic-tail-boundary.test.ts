import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readTailLines } from "../../src/internal/fs-atomic.ts";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "fs-atomic-tail-"));
  dir = join(sandbox, "data");
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const put = (text: string): void => {
  writeFileSync(join(dir, "evidence.jsonl"), text);
};
const bytes = (text: string): number => Buffer.byteLength(text);

describe("readTailLines window boundary", () => {
  test("keeps the first line when the window starts exactly on a line boundary", async () => {
    const head = "aaaa\nbbbb\n";
    const tail = "cccc\ndddd\n";
    put(head + tail);
    // The window starts right after the "\n" ending "bbbb".
    expect(await readTailLines(dir, "evidence", bytes(tail))).toEqual([
      "cccc",
      "dddd",
    ]);
  });

  test("drops the partial first line when the window starts mid-line", async () => {
    const head = "aaaa\nbbbb\n";
    const tail = "cccc\ndddd\n";
    put(head + tail);
    // One byte more reaches the last "b": a partial line.
    expect(await readTailLines(dir, "evidence", bytes(tail) + 1)).toEqual([
      "cccc",
      "dddd",
    ]);
  });

  test("drops the empty first line when the window begins on the boundary newline itself", async () => {
    put("aaaa\nbbbb\ncccc\n");
    // Window = "\ncccc\n": the byte at the start is the boundary newline itself.
    expect(await readTailLines(dir, "evidence", bytes("\ncccc\n"))).toEqual([
      "cccc",
    ]);
  });

  test("drops nothing when tailBytes exceeds the file size", async () => {
    put("aaaa\nbbbb\n");
    expect(await readTailLines(dir, "evidence", 10_000)).toEqual([
      "aaaa",
      "bbbb",
    ]);
  });

  test("keeps a boundary-aligned first line that is multibyte", async () => {
    const tail = "éé\nok\n";
    put("zzz\n" + tail);
    expect(await readTailLines(dir, "evidence", bytes(tail))).toEqual([
      "éé",
      "ok",
    ]);
  });

  test("never yields a corrupt line when the window starts inside a multibyte character", async () => {
    const tail = "é\nok\n";
    put("zz" + tail);
    // The window begins at the continuation byte 0xA9 of "é", so the first
    // decoded line is corrupt and must be dropped.
    const lines = await readTailLines(dir, "evidence", bytes(tail) - 1);
    expect(lines).toEqual(["ok"]);
    expect(lines?.join("")).not.toContain("�");
  });

  test("keeps an unterminated last line while dropping a partial first line", async () => {
    put("aaaa\nbbbb\ncccc");
    // Window "bb\ncccc" starts mid-line.
    expect(await readTailLines(dir, "evidence", bytes("bb\ncccc"))).toEqual([
      "cccc",
    ]);
  });

  test("keeps an unterminated last line when the window starts on a boundary", async () => {
    put("aaaa\nbbbb\ncccc");
    expect(await readTailLines(dir, "evidence", bytes("cccc"))).toEqual([
      "cccc",
    ]);
  });

  test("returns an empty list for an empty file", async () => {
    put("");
    expect(await readTailLines(dir, "evidence", 10)).toEqual([]);
  });

  test("a window of start 1 over a leading newline keeps the first real line", async () => {
    put("\nabc\n");
    // The window starts at "abc"; the byte before it is "\n": a boundary.
    expect(await readTailLines(dir, "evidence", bytes("abc\n"))).toEqual([
      "abc",
    ]);
  });

  test("keeps the trailing carriage return on each CRLF line", async () => {
    const tail = "cc\r\ndd\r\n";
    put("aa\r\nbb\r\n" + tail);
    expect(await readTailLines(dir, "evidence", bytes(tail))).toEqual([
      "cc\r",
      "dd\r",
    ]);
  });
});
