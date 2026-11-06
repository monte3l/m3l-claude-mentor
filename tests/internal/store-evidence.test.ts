import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MentorStateError,
  type MentorErrorCode,
} from "../../src/internal/errors.js";
import type { Evidence } from "../../src/internal/schema.js";
import { appendEvidence, readEvidence } from "../../src/internal/store.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "store-evidence-"));
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

const ev = (at: number, session = "sess_1"): Evidence =>
  ({
    channel: "quiz",
    topic: "plan-mode",
    result: "positive",
    at,
    session,
  }) as Evidence;

const line = (at: number, session = "sess_1"): string =>
  JSON.stringify({
    channel: "quiz",
    topic: "plan-mode",
    result: "positive",
    at,
    session,
  });

const putRaw = (raw: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "evidence.jsonl"), raw);
};
const raw = (): string => readFileSync(join(dir, "evidence.jsonl"), "utf8");

describe("appendEvidence", () => {
  test("appends one JSON line per event with exactly the five typed fields", async () => {
    await appendEvidence(dir, ev(1));
    await appendEvidence(dir, {
      channel: "self-report",
      topic: "hooks",
      result: "negative",
      at: 2,
      session: "s-2",
    } as Evidence);
    const lines = raw().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      channel: "quiz",
      topic: "plan-mode",
      result: "positive",
      at: 1,
      session: "sess_1",
    });
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      channel: "self-report",
      topic: "hooks",
      result: "negative",
      at: 2,
      session: "s-2",
    });
  });

  test("does not persist extra keys smuggled onto the value", async () => {
    await appendEvidence(dir, { ...ev(1), junk: "SMUGGLED" } as Evidence);
    expect(raw()).not.toContain("SMUGGLED");
    const parsed: unknown = JSON.parse(raw().trim());
    expect(Object.keys(parsed as Record<string, unknown>).sort()).toEqual([
      "at",
      "channel",
      "result",
      "session",
      "topic",
    ]);
  });

  test.each([
    ["negative at", { ...ev(1), at: -1 }],
    ["non-finite at", { ...ev(1), at: Number.NaN }],
    ["bad channel", { ...ev(1), channel: "telepathy" }],
    ["bad topic", { ...ev(1), topic: "Bad Topic" }],
    ["bad session", { ...ev(1), session: "a b" }],
    ["bad result", { ...ev(1), result: "maybe" }],
  ])(
    "rejects %s with VALIDATION_FAILED and writes nothing",
    async (_n, bad) => {
      await expectCode(
        appendEvidence(dir, bad as unknown as Evidence),
        "VALIDATION_FAILED",
      );
      expect(existsSync(join(dir, "evidence.jsonl"))).toBe(false);
    },
  );

  test("fails with WRITE_FAILED when the file path is a directory", async () => {
    mkdirSync(join(dir, "evidence.jsonl"), { recursive: true });
    const error = await expectCode(appendEvidence(dir, ev(1)), "WRITE_FAILED");
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("fails with WRITE_FAILED when a file sits where the data dir should be", async () => {
    writeFileSync(dir, "file");
    await expectCode(appendEvidence(dir, ev(1)), "WRITE_FAILED");
  });

  test("concurrent appends yield exactly that many intact lines", async () => {
    const count = 40;
    await Promise.all(
      Array.from({ length: count }, (_, i) => appendEvidence(dir, ev(i))),
    );
    const lines = raw().split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(count);
    const ats = lines.map((l) => (JSON.parse(l) as { at: number }).at);
    expect(ats.sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, i) => i),
    );
    expect(readdirSync(dir)).toEqual(["evidence.jsonl"]);
    const read = await readEvidence(dir, { maxEvents: 100 });
    expect(read.events).toHaveLength(count);
    expect(read.skipped).toBe(0);
  });

  test("a torn tail (no trailing newline) stays its own line: the next append is not glued onto it", async () => {
    await appendEvidence(dir, ev(1));
    await appendEvidence(dir, ev(2));
    appendFileSync(join(dir, "evidence.jsonl"), '{"channel":"qu');
    await appendEvidence(dir, ev(3));
    const read = await readEvidence(dir);
    expect(read.events.map((e) => e.at)).toEqual([1, 2, 3]);
    expect(read.skipped).toBe(1);
  });

  test("normal appends write exactly one newline-terminated line each, no blank lines", async () => {
    await appendEvidence(dir, ev(1));
    await appendEvidence(dir, ev(2));
    await appendEvidence(dir, ev(3));
    const one = (at: number): string =>
      `{"channel":"quiz","topic":"plan-mode","result":"positive","at":${String(at)},"session":"sess_1"}\n`;
    expect(raw()).toBe(one(1) + one(2) + one(3));
  });

  test("appending to a missing or an empty file adds no leading newline", async () => {
    await appendEvidence(dir, ev(1));
    expect(raw().startsWith("{")).toBe(true);
    putRaw("");
    await appendEvidence(dir, ev(2));
    expect(raw().startsWith("{")).toBe(true);
    expect(raw().split("\n")).toHaveLength(2);
  });

  test("appending after a file ending in a newline adds no blank line", async () => {
    putRaw(`${line(1)}\n`);
    await appendEvidence(dir, ev(2));
    expect(raw()).toBe(`${line(1)}\n${line(2)}\n`);
  });
});

describe("readEvidence", () => {
  test("returns an empty result for a missing file", async () => {
    expect(await readEvidence(dir)).toEqual({ events: [], skipped: 0 });
    expect(existsSync(dir)).toBe(false);
  });

  test("returns an empty result for an empty file", async () => {
    putRaw("");
    expect(await readEvidence(dir)).toEqual({ events: [], skipped: 0 });
  });

  test("reads back appended events in file order", async () => {
    await appendEvidence(dir, ev(3));
    await appendEvidence(dir, ev(1));
    await appendEvidence(dir, ev(2));
    const read = await readEvidence(dir);
    expect(read.skipped).toBe(0);
    expect(read.events.map((e) => e.at)).toEqual([3, 1, 2]);
    expect(read.events[0]).toEqual(ev(3));
  });

  test("counts malformed lines in skipped and keeps the valid ones", async () => {
    putRaw(
      [
        line(1),
        "this is not json",
        '{"channel":"quiz"}',
        "[]",
        "null",
        line(2),
        "",
      ].join("\n") + "\n",
    );
    const read = await readEvidence(dir);
    expect(read.events.map((e) => e.at)).toEqual([1, 2]);
    expect(read.skipped).toBe(4);
  });

  test("a partial last line (crash mid-append) is skipped, not an error", async () => {
    putRaw(`${line(1)}\n${line(2)}\n{"channel":"qu`);
    const read = await readEvidence(dir);
    expect(read.events.map((e) => e.at)).toEqual([1, 2]);
    expect(read.skipped).toBe(1);
  });

  test("tolerates a line that fails validation without leaking its text", async () => {
    putRaw(`${line(1)}\n{"channel":"quiz","topic":"SECRETTOPIC","at":1}\n`);
    const read = await readEvidence(dir);
    expect(read.events).toHaveLength(1);
    expect(read.skipped).toBe(1);
    expect(JSON.stringify(read)).not.toContain("SECRETTOPIC");
  });

  test("maxEvents trims to the last N valid events in file order", async () => {
    putRaw(`${[1, 2, 3, 4, 5].map((n) => line(n)).join("\n")}\n`);
    const read = await readEvidence(dir, { maxEvents: 2 });
    expect(read.events.map((e) => e.at)).toEqual([4, 5]);
  });

  test("maxEvents counts valid events only and does not hide malformed lines", async () => {
    putRaw(`${line(1)}\n${line(2)}\njunk\n${line(3)}\n`);
    const read = await readEvidence(dir, { maxEvents: 2 });
    expect(read.events.map((e) => e.at)).toEqual([2, 3]);
    expect(read.skipped).toBe(1);
  });

  test("maxEvents of 1 and of 10_000 are accepted", async () => {
    putRaw(`${line(1)}\n${line(2)}\n`);
    expect(
      (await readEvidence(dir, { maxEvents: 1 })).events.map((e) => e.at),
    ).toEqual([2]);
    expect(
      (await readEvidence(dir, { maxEvents: 10_000 })).events,
    ).toHaveLength(2);
  });

  test.each([
    [0],
    [-1],
    [1.5],
    [10_001],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])("rejects maxEvents %s with RangeError", async (maxEvents) => {
    putRaw(`${line(1)}\n`);
    await expect(readEvidence(dir, { maxEvents })).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  test("a multibyte character cut at the tail start drops the partial first line, keeping the rest intact", async () => {
    // Byte sizes, hand-computed:
    //  - junk line: 650_000 "é" x 2 bytes = 1_300_000 bytes + "\n" = 1_300_001
    //  - 10_000 valid lines, `at` 10000..19999 (5 digits): 88 bytes + "\n" = 89 each = 890_000
    //  - total 2_190_001 > EVIDENCE_TAIL_BYTES (2_097_152)
    //  - tail start offset = 2_190_001 - 2_097_152 = 92_849, inside the junk
    //    line and odd, so it lands on the continuation byte of an "é".
    const junk = "é".repeat(650_000);
    const valid = Array.from({ length: 10_000 }, (_, i) => line(10_000 + i));
    putRaw(`${junk}\n${valid.join("\n")}\n`);
    const read = await readEvidence(dir);
    expect(read.skipped).toBe(0);
    expect(read.events).toHaveLength(10_000);
    expect(read.events[0]?.at).toBe(10_000);
    expect(read.events.at(-1)?.at).toBe(19_999);
  });

  describe("oversized lines", () => {
    const padded = (bytes: number): string => {
      const base = JSON.stringify({
        channel: "quiz",
        topic: "plan-mode",
        result: "positive",
        at: 7,
        session: "sess_1",
        pad: "",
      });
      return base.replace(
        '"pad":""',
        `"pad":"${"x".repeat(bytes - Buffer.byteLength(base))}"`,
      );
    };

    test("a line whose bytes + 1 equals the limit is kept; one byte more is skipped and never echoed", async () => {
      const kept = padded(4095);
      const dropped = padded(4096).replace('"at":7', '"at":8');
      expect(Buffer.byteLength(kept)).toBe(4095);
      expect(Buffer.byteLength(dropped)).toBe(4096);
      putRaw(`${line(1)}\n${kept}\n${dropped}\n${line(2)}\n`);
      const read = await readEvidence(dir);
      expect(read.events.map((e) => e.at)).toEqual([1, 7, 2]);
      expect(read.skipped).toBe(1);
      expect(JSON.stringify(read)).not.toContain("xxxxxxxx");
    });
  });

  test("reads only the tail of a large file and drops the partial first line", async () => {
    const session = "s".repeat(128);
    const total = 12_000; // about 2.9 MB, well over the 2 MiB tail
    putRaw(
      Array.from({ length: total }, (_, i) => line(i, session)).join("\n") +
        "\n",
    );
    const read = await readEvidence(dir);
    expect(read.skipped).toBe(0);
    expect(read.events.length).toBeLessThan(total);
    expect(read.events.length).toBeGreaterThan(8000);
    expect(read.events.at(-1)?.at).toBe(total - 1);
    const first = read.events[0]?.at ?? -1;
    expect(read.events.map((e) => e.at)).toEqual(
      Array.from({ length: total - first }, (_, i) => first + i),
    );
  });

  test("reports READ_FAILED when the file path is a directory", async () => {
    mkdirSync(join(dir, "evidence.jsonl"), { recursive: true });
    const error = await expectCode(readEvidence(dir), "READ_FAILED");
    expect(error.cause).toBeInstanceOf(Error);
  });
});
