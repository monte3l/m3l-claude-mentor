import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MentorStateError,
  type MentorErrorCode,
} from "../../src/internal/errors.js";
import {
  EVIDENCE_TAIL_BYTES,
  MAX_EVIDENCE_LINE_BYTES,
  MAX_GOALS_BYTES,
  MAX_JSON_BYTES,
  appendLineAtomic,
  readTailLines,
  readTextBounded,
  writeTextAtomic,
} from "../../src/internal/fs-atomic.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "fs-atomic-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function failure(promise: Promise<unknown>): Promise<MentorStateError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MentorStateError);
  return thrown as MentorStateError;
}

async function expectCode(
  promise: Promise<unknown>,
  code: MentorErrorCode,
): Promise<MentorStateError> {
  const error = await failure(promise);
  expect(error.code).toBe(code);
  return error;
}

const tmpFiles = (where: string): string[] =>
  readdirSync(where).filter((name) => name.endsWith(".tmp"));

describe("limits", () => {
  test("pins the documented byte limits", () => {
    expect(MAX_JSON_BYTES).toBe(1_048_576);
    expect(MAX_GOALS_BYTES).toBe(65_536);
    expect(EVIDENCE_TAIL_BYTES).toBe(2_097_152);
    expect(MAX_EVIDENCE_LINE_BYTES).toBe(4096);
  });
});

describe("readTextBounded", () => {
  test("returns null for a missing file and for a missing directory", async () => {
    expect(await readTextBounded(dir, "state", 100)).toBeNull();
    mkdirSync(dir);
    expect(await readTextBounded(dir, "state", 100)).toBeNull();
  });

  test("reads the file text as UTF-8", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "goals.md"), "héllo wörld\n");
    expect(await readTextBounded(dir, "goals", 100)).toBe("héllo wörld\n");
  });

  test("returns an empty string for an empty file", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "goals.md"), "");
    expect(await readTextBounded(dir, "goals", 16)).toBe("");
  });

  test("accepts a file of exactly maxBytes", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "goals.md"), "a".repeat(16));
    expect(await readTextBounded(dir, "goals", 16)).toBe("a".repeat(16));
  });

  test("rejects a file of maxBytes + 1 with TOO_LARGE", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "goals.md"), "a".repeat(17));
    await expectCode(readTextBounded(dir, "goals", 16), "TOO_LARGE");
  });

  test("counts bytes, not characters, against the limit", async () => {
    mkdirSync(dir);
    // 8 two-byte characters = 16 bytes (ok); 9 = 18 bytes (too large).
    writeFileSync(join(dir, "goals.md"), "é".repeat(8));
    expect(await readTextBounded(dir, "goals", 16)).toBe("é".repeat(8));
    writeFileSync(join(dir, "goals.md"), "é".repeat(9));
    await expectCode(readTextBounded(dir, "goals", 16), "TOO_LARGE");
  });

  test("reports READ_FAILED with the fs error as cause when the path is a directory", async () => {
    mkdirSync(join(dir, "state.json"), { recursive: true });
    const error = await expectCode(
      readTextBounded(dir, "state", 100),
      "READ_FAILED",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });
});

describe("writeTextAtomic", () => {
  test("creates the data directory with mode 0o700 and the file with 0o600", async () => {
    await writeTextAtomic(dir, "state", "{}\n");
    expect(readFileSync(join(dir, "state.json"), "utf8")).toBe("{}\n");
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
    }
  });

  test("replaces existing content and leaves exactly one file behind", async () => {
    await writeTextAtomic(dir, "goals", "first");
    await writeTextAtomic(dir, "goals", "second é");
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe("second é");
    expect(readdirSync(dir)).toEqual(["goals.md"]);
  });

  test("writes only the named file, leaving siblings untouched", async () => {
    await writeTextAtomic(dir, "goals", "g");
    await writeTextAtomic(dir, "state", "s");
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe("g");
    expect(readdirSync(dir).sort()).toEqual(["goals.md", "state.json"]);
  });

  test("fails with WRITE_FAILED and leaves no .tmp when the target is a directory", async () => {
    const target = join(dir, "state.json");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "keep.txt"), "keep");
    const error = await expectCode(
      writeTextAtomic(dir, "state", "new"),
      "WRITE_FAILED",
    );
    expect(error.cause).toBeInstanceOf(Error);
    expect(tmpFiles(dir)).toEqual([]);
    expect(readdirSync(dir)).toEqual(["state.json"]);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep");
  });

  test("fails with WRITE_FAILED when a regular file sits where the data dir should be", async () => {
    writeFileSync(dir, "i am a file");
    const error = await expectCode(
      writeTextAtomic(dir, "state", "new"),
      "WRITE_FAILED",
    );
    expect(error.cause).toBeInstanceOf(Error);
    expect(readFileSync(dir, "utf8")).toBe("i am a file");
  });

  test("leaves no .tmp after many concurrent writers of one file", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        writeTextAtomic(dir, "goals", `writer-${String(i)}`),
      ),
    );
    expect(tmpFiles(dir)).toEqual([]);
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toMatch(/^writer-\d+$/);
  });
});

describe("appendLineAtomic", () => {
  test("appends newline-terminated lines in order, creating the dir 0o700 and file 0o600", async () => {
    await appendLineAtomic(dir, "evidence", "one");
    await appendLineAtomic(dir, "evidence", "two é");
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe(
      "one\ntwo é\n",
    );
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "evidence.jsonl")).mode & 0o777).toBe(0o600);
    }
  });

  test.each([["a\nb"], ["a\rb"], ["trailing\n"], ["\r\n"]])(
    "rejects a line with a line break (%j) with VALIDATION_FAILED and writes nothing",
    async (line) => {
      await expectCode(
        appendLineAtomic(dir, "evidence", line),
        "VALIDATION_FAILED",
      );
      expect(existsSync(join(dir, "evidence.jsonl"))).toBe(false);
    },
  );

  test("accepts a line whose bytes plus newline total exactly 4096", async () => {
    const line = "x".repeat(4095);
    await appendLineAtomic(dir, "evidence", line);
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe(`${line}\n`);
  });

  test("rejects a line one byte over the limit and leaves existing content", async () => {
    await appendLineAtomic(dir, "evidence", "keep");
    await expectCode(
      appendLineAtomic(dir, "evidence", "x".repeat(4096)),
      "VALIDATION_FAILED",
    );
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe("keep\n");
  });

  test("measures the limit in bytes, not characters", async () => {
    await appendLineAtomic(dir, "evidence", "é".repeat(2047)); // 4094 + 1
    await expectCode(
      appendLineAtomic(dir, "evidence", "é".repeat(2048)), // 4096 + 1
      "VALIDATION_FAILED",
    );
  });

  test("fails with WRITE_FAILED when the target is a directory", async () => {
    mkdirSync(join(dir, "evidence.jsonl"), { recursive: true });
    const error = await expectCode(
      appendLineAtomic(dir, "evidence", "x"),
      "WRITE_FAILED",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("fails with WRITE_FAILED when a regular file sits where the data dir should be", async () => {
    writeFileSync(dir, "file");
    await expectCode(appendLineAtomic(dir, "evidence", "x"), "WRITE_FAILED");
  });
});

describe("appendLineAtomic after a torn record", () => {
  test("writes a separating newline when the file does not end in one", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "good\n");
    appendFileSync(join(dir, "evidence.jsonl"), "frag");
    await appendLineAtomic(dir, "evidence", "next");
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe(
      "good\nfrag\nnext\n",
    );
  });

  test("writes no leading newline for a missing, empty, or newline-terminated file", async () => {
    await appendLineAtomic(dir, "evidence", "a");
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe("a\n");
    writeFileSync(join(dir, "evidence.jsonl"), "");
    await appendLineAtomic(dir, "evidence", "b");
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe("b\n");
    await appendLineAtomic(dir, "evidence", "c");
    expect(readFileSync(join(dir, "evidence.jsonl"), "utf8")).toBe("b\nc\n");
  });
});

describe("readTailLines", () => {
  test("returns null when the file is missing", async () => {
    expect(await readTailLines(dir, "evidence", 100)).toBeNull();
  });

  test("returns every non-empty line when the file fits in the tail", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "a\n\nb\nc\n");
    expect(await readTailLines(dir, "evidence", 1000)).toEqual(["a", "b", "c"]);
  });

  test("keeps the first line when the tail covers the whole file exactly", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "line1\nline2\nline3\n"); // 18 bytes
    expect(await readTailLines(dir, "evidence", 18)).toEqual([
      "line1",
      "line2",
      "line3",
    ]);
  });

  test("drops the possibly partial first line when the read starts mid-file", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "line1\nline2\nline3\n");
    // Last 9 bytes are "e2\nline3\n"; "e2" is a partial line.
    expect(await readTailLines(dir, "evidence", 9)).toEqual(["line3"]);
  });

  test("drops a multibyte character cut at the tail start", async () => {
    mkdirSync(dir);
    // "é" is two bytes; the last 5 bytes start on its continuation byte.
    writeFileSync(join(dir, "evidence.jsonl"), "é\nok\n");
    expect(await readTailLines(dir, "evidence", 5)).toEqual(["ok"]);
  });

  test("keeps an unterminated last line", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "a\nb");
    expect(await readTailLines(dir, "evidence", 100)).toEqual(["a", "b"]);
  });

  test("returns an empty list for an empty file", async () => {
    mkdirSync(dir);
    writeFileSync(join(dir, "evidence.jsonl"), "");
    expect(await readTailLines(dir, "evidence", 100)).toEqual([]);
  });

  test("reports READ_FAILED when the path is a directory", async () => {
    mkdirSync(join(dir, "evidence.jsonl"), { recursive: true });
    await expectCode(readTailLines(dir, "evidence", 100), "READ_FAILED");
  });
});

describe("read-side failures on a non-directory data dir and bad limits", () => {
  test("a regular file where the data dir should be gives READ_FAILED on both readers", async () => {
    writeFileSync(dir, "i am a file");
    const a = await expectCode(
      readTextBounded(dir, "state", 100),
      "READ_FAILED",
    );
    expect(a.cause).toBeInstanceOf(Error);
    await expectCode(readTailLines(dir, "evidence", 100), "READ_FAILED");
  });

  test.each([[-1], [Number.NaN], [1.5], [Number.POSITIVE_INFINITY]])(
    "readTextBounded rejects maxBytes %s with RangeError",
    async (maxBytes) => {
      await expect(
        readTextBounded(dir, "state", maxBytes),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  test.each([[0], [-1], [Number.NaN], [1.5], [Number.POSITIVE_INFINITY]])(
    "readTailLines rejects tailBytes %s with RangeError",
    async (tailBytes) => {
      await expect(
        readTailLines(dir, "evidence", tailBytes),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );
});
