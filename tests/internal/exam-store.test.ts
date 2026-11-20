import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
} from "../../src/internal/errors.ts";
import {
  MAX_EXAM_ITEMS,
  MAX_EXAM_ITEM_LINE_BYTES,
  parseExamItem,
  parsePendingExam,
  type ExamItem,
  type PendingExam,
} from "../../src/internal/exam-schema.ts";
import {
  appendExamItem,
  clearPending,
  loadPending,
  readExamItems,
  savePending,
} from "../../src/internal/exam-store.ts";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "exam-store-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function expectCode(
  promise: Promise<unknown>,
  code: MentorErrorCode,
): Promise<MentorStateError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MentorStateError);
  expect((thrown as MentorStateError).code).toBe(code);
  return thrown as MentorStateError;
}

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  track: "CCAR-F",
  domain: "D1",
  objective: "D1.2",
  topic: "plan-mode",
  kind: "single",
  mode: "drill",
  correct: true,
  at: 1000,
  session: "sess-1",
  ...over,
});

function exam(over: Record<string, unknown> = {}): ExamItem {
  const r = parseExamItem(raw(over));
  if (!r.ok) throw new Error(`fixture rejected: ${r.reason}`);
  return r.value;
}

const itemsPath = (): string => join(dir, "exam-items.jsonl");
const pendingPath = (): string => join(dir, "exam-pending.json");
const putRaw = (text: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(itemsPath(), text);
};
const line = (at: number): string => `${JSON.stringify(raw({ at }))}\n`;

function pendingExam(over: Record<string, unknown> = {}): PendingExam {
  const r = parsePendingExam({
    v: 1,
    track: "CCAR-F",
    mode: "mock",
    createdAt: 5000,
    items: [
      { objective: "D1.2", topic: "plan-mode", kind: "single", key: ["B"] },
      {
        objective: "D2.1",
        topic: "hooks",
        kind: "multiple",
        key: ["A", "C"],
      },
    ],
    ...over,
  });
  if (!r.ok) throw new Error(`fixture rejected: ${r.reason}`);
  return r.value;
}

describe("appendExamItem", () => {
  test("appends one JSON line per item to exam-items.jsonl", async () => {
    await appendExamItem(dir, exam({ at: 1 }));
    await appendExamItem(dir, exam({ at: 2, correct: false, mode: "mock" }));
    const lines = readFileSync(itemsPath(), "utf8").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0] ?? "")).toEqual(raw({ at: 1 }));
    expect(JSON.parse(lines[1] ?? "")).toEqual(
      raw({ at: 2, correct: false, mode: "mock" }),
    );
  });

  test("creates the file with mode 0o600", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    await appendExamItem(dir, exam());
    expect(statSync(itemsPath()).mode & 0o777).toBe(0o600);
  });

  test("never persists question text smuggled onto the item", async () => {
    await appendExamItem(dir, {
      ...exam(),
      question: "QUESTION-TEXT",
      options: ["OPTION-TEXT"],
      answer: "ANSWER-TEXT",
    } as ExamItem);
    const text = readFileSync(itemsPath(), "utf8");
    for (const leak of ["QUESTION-TEXT", "OPTION-TEXT", "ANSWER-TEXT"]) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(JSON.parse(text.trim()) as object).sort()).toEqual([
      "at",
      "correct",
      "domain",
      "kind",
      "mode",
      "objective",
      "session",
      "topic",
      "track",
      "v",
    ]);
  });

  test.each([
    ["negative at", { at: -1 }],
    ["float at", { at: 1.5 }],
    ["bad track", { track: "nope" }],
    ["objective/domain mismatch", { domain: "D2" }],
    ["bad kind", { kind: "essay" }],
    ["bad session", { session: "a b" }],
  ])(
    "rejects %s with VALIDATION_FAILED and writes nothing",
    async (_name, over) => {
      await expectCode(
        appendExamItem(dir, raw(over) as unknown as ExamItem),
        "VALIDATION_FAILED",
      );
      expect(existsSync(itemsPath())).toBe(false);
    },
  );

  test("the line limit is 512 bytes", () => {
    expect(MAX_EXAM_ITEM_LINE_BYTES).toBe(512);
  });

  test("appending after a torn last line starts a fresh line", async () => {
    putRaw(`${JSON.stringify(raw({ at: 1 }))}\n{"v":1,"tr`);
    await appendExamItem(dir, exam({ at: 2 }));
    const read = await readExamItems(dir);
    expect(read.items.map((i) => i.at)).toEqual([1, 2]);
    expect(read.skipped).toBe(1);
  });
});

describe("readExamItems", () => {
  test("a missing file gives no items and nothing skipped, and creates nothing", async () => {
    expect(await readExamItems(dir)).toEqual({ items: [], skipped: 0 });
    expect(existsSync(dir)).toBe(false);
  });

  test("returns items in chronological (file) order", async () => {
    putRaw(line(1) + line(2) + line(3));
    const { items, skipped } = await readExamItems(dir);
    expect(items).toEqual([exam({ at: 1 }), exam({ at: 2 }), exam({ at: 3 })]);
    expect(skipped).toBe(0);
  });

  test("counts malformed, invalid and blank-free lines as skipped and keeps the rest", async () => {
    putRaw(
      `${line(1)}not json\n[1,2]\n${JSON.stringify(raw({ at: -5 }))}\n${line(2)}\n`,
    );
    const { items, skipped } = await readExamItems(dir);
    expect(items.map((i) => i.at)).toEqual([1, 2]);
    expect(skipped).toBe(3);
  });

  test("skipped text is never surfaced", async () => {
    putRaw(`SECRET-GARBAGE\n${line(1)}`);
    const result = await readExamItems(dir);
    expect(JSON.stringify(result)).not.toContain("SECRET-GARBAGE");
  });

  test("keeps only the newest maxItems, still oldest-first", async () => {
    putRaw(Array.from({ length: 10 }, (_v, i) => line(i + 1)).join(""));
    const { items } = await readExamItems(dir, { maxItems: 3 });
    expect(items.map((i) => i.at)).toEqual([8, 9, 10]);
  });

  test("maxItems equal to the line count returns everything", async () => {
    putRaw(Array.from({ length: 4 }, (_v, i) => line(i + 1)).join(""));
    const { items } = await readExamItems(dir, { maxItems: 4 });
    expect(items.map((i) => i.at)).toEqual([1, 2, 3, 4]);
  });

  test("defaults maxItems to MAX_EXAM_ITEMS", async () => {
    expect(MAX_EXAM_ITEMS).toBe(5000);
    const total = MAX_EXAM_ITEMS + 5;
    putRaw(Array.from({ length: total }, (_v, i) => line(i + 1)).join(""));
    const { items } = await readExamItems(dir);
    expect(items).toHaveLength(MAX_EXAM_ITEMS);
    expect(items[0]?.at).toBe(6);
    expect(items.at(-1)?.at).toBe(total);
  });

  test("reads only the last 1 MiB window", async () => {
    // Sentinel first line (at = 1) then ~1.5 MiB of filler lines.
    const filler = line(7);
    const count = Math.ceil((1.5 * 1024 * 1024) / filler.length);
    putRaw(line(1) + filler.repeat(count));
    const { items } = await readExamItems(dir);
    expect(items.some((i) => i.at === 1)).toBe(false);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.at === 7)).toBe(true);
  });

  // Assumption (mirrors readEvidence): the 512-byte limit counts the line
  // plus its newline, and an over-long line is skipped even when it parses.
  test.each([
    [512, true],
    [513, false],
  ])("a %i-byte line (with newline) is %s", async (bytes, accepted) => {
    const base = JSON.stringify(raw({ at: 1 }));
    const padKey = ',"pad":"';
    const padLen = bytes - base.length - padKey.length - 2;
    const padded = `${base.slice(0, -1)}${padKey}${"x".repeat(padLen)}"}`;
    expect(Buffer.byteLength(`${padded}\n`)).toBe(bytes);
    putRaw(`${padded}\n`);
    const { items, skipped } = await readExamItems(dir);
    expect(items).toHaveLength(accepted ? 1 : 0);
    expect(skipped).toBe(accepted ? 0 : 1);
  });

  test("511-byte line is accepted", async () => {
    const base = JSON.stringify(raw({ at: 1 }));
    const padKey = ',"pad":"';
    const padLen = 511 - base.length - padKey.length - 2;
    putRaw(`${base.slice(0, -1)}${padKey}${"x".repeat(padLen)}"}\n`);
    expect((await readExamItems(dir)).items).toHaveLength(1);
  });
});

describe("loadPending / savePending / clearPending", () => {
  test("loadPending is null when the file is missing and creates nothing", async () => {
    expect(await loadPending(dir)).toBeNull();
    expect(existsSync(dir)).toBe(false);
  });

  test("savePending then loadPending round-trips", async () => {
    const pending = pendingExam();
    await savePending(dir, pending);
    expect(await loadPending(dir)).toEqual(pending);
  });

  test("savePending writes the file with mode 0o600", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    await savePending(dir, pendingExam());
    expect(statSync(pendingPath()).mode & 0o777).toBe(0o600);
  });

  test("savePending replaces a previous pending exam", async () => {
    await savePending(dir, pendingExam({ createdAt: 1 }));
    await savePending(dir, pendingExam({ createdAt: 2, mode: "drill" }));
    const loaded = await loadPending(dir);
    expect(loaded?.createdAt).toBe(2);
    expect(loaded?.mode).toBe("drill");
  });

  test("savePending leaves no temp file behind", async () => {
    await savePending(dir, pendingExam());
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir)).toEqual(["exam-pending.json"]);
  });

  test("savePending refuses an invalid pending exam and writes nothing", async () => {
    await expectCode(
      savePending(dir, { ...pendingExam(), items: [] }),
      "VALIDATION_FAILED",
    );
    expect(existsSync(pendingPath())).toBe(false);
  });

  test("malformed JSON is PARSE_FAILED and the message never contains the content", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(pendingPath(), "{SECRET-CONTENT");
    const error = await expectCode(loadPending(dir), "PARSE_FAILED");
    expect(error.message).not.toContain("SECRET-CONTENT");
  });

  test("schema-invalid JSON is VALIDATION_FAILED", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(pendingPath(), JSON.stringify({ v: 1, items: [] }));
    await expectCode(loadPending(dir), "VALIDATION_FAILED");
  });

  test("clearPending removes the file", async () => {
    await savePending(dir, pendingExam());
    await clearPending(dir);
    expect(existsSync(pendingPath())).toBe(false);
    expect(await loadPending(dir)).toBeNull();
  });

  test("clearPending is idempotent: no error when the file or directory is absent", async () => {
    await expect(clearPending(dir)).resolves.toBeUndefined();
    mkdirSync(dir, { recursive: true });
    await expect(clearPending(dir)).resolves.toBeUndefined();
    await savePending(dir, pendingExam());
    await clearPending(dir);
    await expect(clearPending(dir)).resolves.toBeUndefined();
  });

  test("clearPending leaves the exam log alone", async () => {
    await appendExamItem(dir, exam());
    await savePending(dir, pendingExam());
    await clearPending(dir);
    expect((await readExamItems(dir)).items).toHaveLength(1);
  });
});

describe("data directory guard", () => {
  test.each([
    ["appendExamItem", (d: string) => appendExamItem(d, exam())],
    ["readExamItems", (d: string) => readExamItems(d)],
    ["loadPending", (d: string) => loadPending(d)],
    ["savePending", (d: string) => savePending(d, pendingExam())],
    ["clearPending", (d: string) => clearPending(d)],
  ])("%s rejects a relative data dir with DATA_DIR_INVALID", async (_n, fn) => {
    await expectCode(fn("relative/dir"), "DATA_DIR_INVALID");
  });
});
