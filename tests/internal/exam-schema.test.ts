import { describe, expect, expectTypeOf, test } from "vitest";
import {
  EXAM_ITEM_MODES,
  MAX_EXAM_ITEMS,
  MAX_EXAM_ITEM_LINE_BYTES,
  PENDING_TTL_MS,
  isPendingExpired,
  parseExamItem,
  MAX_PENDING_ITEMS,
  parsePendingExam,
  type ExamItem,
  type PendingExam,
  type PendingItem,
} from "../../src/internal/exam-schema.ts";
import type { Parsed, SessionId, TopicId } from "../../src/internal/schema.ts";
import type { ItemKind } from "../../src/internal/tracks.ts";

const RAW = "RAW-SECRET-VALUE";
/** Unmistakable and invalid as a session id (space and slash). */
const RAW_SESSION = "RAW SECRET/VALUE";

function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
  };
}

function reasonOf(r: Parsed<unknown>): string {
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reason;
}

describe("constants", () => {
  test("pins the limits and modes", () => {
    expect(MAX_EXAM_ITEMS).toBe(5000);
    expect(MAX_EXAM_ITEM_LINE_BYTES).toBe(512);
    expect(PENDING_TTL_MS).toBe(86_400_000);
    expect([...EXAM_ITEM_MODES]).toEqual(["drill", "mock"]);
  });
});

describe("parseExamItem", () => {
  test("accepts a valid item and returns a fresh equal object", () => {
    const input = item();
    const r = parseExamItem(input);
    expect(r).toEqual({ ok: true, value: input });
    if (r.ok) expect(r.value).not.toBe(input);
  });

  test.each([
    ["two-letter track code", { track: "CC-F" }],
    ["four-letter track code", { track: "CCDV-P" }],
    ["two-letter suffix", { track: "CCAR-FP" }],
    ["two-digit domain and objective", { domain: "D12", objective: "D12.34" }],
    ["multiple kind", { kind: "multiple" }],
    ["mock mode", { mode: "mock" }],
    ["incorrect", { correct: false }],
    ["at zero", { at: 0 }],
  ])("accepts %s", (_name, over) => {
    expect(parseExamItem(item(over)).ok).toBe(true);
  });

  test.each([
    ["non-object", "x"],
    ["null", null],
    ["array", []],
    ["v 2", item({ v: 2 })],
    [
      "v missing",
      (() => {
        const i = item();
        delete i["v"];
        return i;
      })(),
    ],
    ["track lowercase", item({ track: "ccar-f" })],
    ["track one-letter prefix", item({ track: "C-F" })],
    ["track five-letter prefix", item({ track: "CCCCC-F" })],
    ["track three-letter suffix", item({ track: "CCAR-FPX" })],
    ["track no dash", item({ track: "CCARF" })],
    ["track non-string", item({ track: 5 })],
    ["domain lowercase", item({ domain: "d1" })],
    ["domain three digits", item({ domain: "D123", objective: "D123.1" })],
    ["domain without digits", item({ domain: "D" })],
    ["objective without dot", item({ objective: "D1" })],
    ["objective three-digit minor", item({ objective: "D1.123" })],
    ["objective empty minor", item({ objective: "D1." })],
    ["objective/domain mismatch", item({ domain: "D2", objective: "D1.2" })],
    [
      "domain D1 vs objective D11.1",
      item({ domain: "D1", objective: "D11.1" }),
    ],
    ["bad topic", item({ topic: "Bad Topic" })],
    ["bad kind", item({ kind: "essay" })],
    ["bad mode", item({ mode: "practice" })],
    ["correct as string", item({ correct: "true" })],
    ["correct as number", item({ correct: 1 })],
    ["at negative", item({ at: -1 })],
    ["at float", item({ at: 1.5 })],
    ["at NaN", item({ at: Number.NaN })],
    ["at Infinity", item({ at: Number.POSITIVE_INFINITY })],
    ["at string", item({ at: "1" })],
    ["bad session", item({ session: "a b" })],
  ])("rejects %s", (_name, input) => {
    expect(parseExamItem(input).ok).toBe(false);
  });

  test.each([
    ["track", { track: RAW }],
    ["domain", { domain: RAW, objective: "D1.2" }],
    ["objective", { objective: RAW }],
    ["kind", { kind: RAW }],
    ["mode", { mode: RAW }],
    ["correct", { correct: RAW }],
    ["session", { session: RAW_SESSION }],
    ["topic", { topic: RAW }],
  ])("reason names %s and never echoes the raw value", (field, over) => {
    const reason = reasonOf(parseExamItem(item(over)));
    expect(reason).toContain(field);
    expect(reason).not.toContain(RAW);
    expect(reason).not.toContain(RAW_SESSION);
  });

  test("reason for at names the field", () => {
    expect(reasonOf(parseExamItem(item({ at: -1 })))).toMatch(/\bat\b/u);
  });

  test("unknown keys, including question text, are ignored and not copied", () => {
    const r = parseExamItem(
      item({ question: "Q?", options: ["a"], answer: "B", extra: 1 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual([
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
    }
  });

  test("ignores inherited fields", () => {
    const proto = item();
    const r = parseExamItem(Object.create(proto) as unknown);
    expect(r.ok).toBe(false);
  });

  test("exported types", () => {
    expectTypeOf<ExamItem["v"]>().toEqualTypeOf<1>();
    expectTypeOf<ExamItem["topic"]>().toEqualTypeOf<TopicId>();
    expectTypeOf<ExamItem["session"]>().toEqualTypeOf<SessionId>();
    expectTypeOf<ExamItem["kind"]>().toEqualTypeOf<ItemKind>();
    expectTypeOf<ExamItem["mode"]>().toEqualTypeOf<"drill" | "mock">();
    expectTypeOf<ExamItem["correct"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ExamItem["at"]>().toEqualTypeOf<number>();
    expectTypeOf(parseExamItem).returns.toEqualTypeOf<Parsed<ExamItem>>();
  });
});

function pi(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objective: "D1.2",
    topic: "plan-mode",
    kind: "single",
    key: ["B"],
    ...over,
  };
}

function pending(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    track: "CCAR-F",
    mode: "drill",
    createdAt: 5000,
    items: [pi()],
    ...over,
  };
}

const many = (n: number): Record<string, unknown>[] =>
  Array.from({ length: n }, () => pi());

describe("parsePendingExam", () => {
  test("accepts a valid pending exam as a fresh equal object", () => {
    const input = pending({
      items: [pi(), pi({ kind: "multiple", key: ["A", "C"] })],
    });
    const r = parsePendingExam(input);
    expect(r).toEqual({ ok: true, value: input });
    if (r.ok) expect(r.value).not.toBe(input);
  });

  test("MAX_PENDING_ITEMS is 15", () => {
    expect(MAX_PENDING_ITEMS).toBe(15);
  });

  test("accepts exactly MAX_PENDING_ITEMS items and rejects one more", () => {
    expect(
      parsePendingExam(pending({ items: many(MAX_PENDING_ITEMS) })).ok,
    ).toBe(true);
    const reason = reasonOf(
      parsePendingExam(pending({ items: many(MAX_PENDING_ITEMS + 1) })),
    );
    expect(reason).toContain("items");
  });

  test("accepts 1 item and rejects 0", () => {
    expect(parsePendingExam(pending({ items: many(1) })).ok).toBe(true);
    expect(reasonOf(parsePendingExam(pending({ items: many(0) })))).toContain(
      "items",
    );
  });

  test("rejects non-array items", () => {
    expect(parsePendingExam(pending({ items: "x" })).ok).toBe(false);
  });

  test.each([
    ["non-object", 3],
    ["v 2", pending({ v: 2 })],
    ["bad track", pending({ track: "nope" })],
    ["bad mode", pending({ mode: "exam" })],
    ["createdAt negative", pending({ createdAt: -1 })],
    ["createdAt NaN", pending({ createdAt: Number.NaN })],
    ["createdAt string", pending({ createdAt: "1" })],
    ["item bad objective", pending({ items: [pi({ objective: "X" })] })],
    ["item bad topic", pending({ items: [pi({ topic: "A B" })] })],
    ["item bad kind", pending({ items: [pi({ kind: "x" })] })],
    ["item non-object", pending({ items: ["x"] })],
  ])("rejects %s", (_n, input) => {
    expect(parsePendingExam(input).ok).toBe(false);
  });

  test.each([
    ["single, one letter", "single", ["A"], true],
    ["single, last letter F", "single", ["F"], true],
    ["single, two letters", "single", ["A", "B"], false],
    ["single, empty key", "single", [], false],
    ["multiple, one letter", "multiple", ["A"], false],
    ["multiple, two letters", "multiple", ["A", "B"], true],
    ["multiple, five letters", "multiple", ["A", "B", "C", "D", "E"], true],
    [
      "multiple, six letters",
      "multiple",
      ["A", "B", "C", "D", "E", "F"],
      false,
    ],
    ["letter G", "single", ["G"], false],
    ["lowercase letter", "single", ["a"], false],
    ["multi-character entry", "single", ["AB"], false],
    ["non-string entry", "single", [1], false],
    ["duplicate letters", "multiple", ["A", "A"], false],
    ["duplicate among three", "multiple", ["A", "B", "A"], false],
  ] as const)("key: %s", (_n, kind, key, ok) => {
    const r = parsePendingExam(pending({ items: [pi({ kind, key })] }));
    expect(r.ok).toBe(ok);
    if (!ok) expect(reasonOf(r)).toContain("key");
  });

  test("key must be an array", () => {
    expect(parsePendingExam(pending({ items: [pi({ key: "A" })] })).ok).toBe(
      false,
    );
  });

  test("unsorted keys are stored sorted", () => {
    const r = parsePendingExam(
      pending({ items: [pi({ kind: "multiple", key: ["D", "A", "C"] })] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items[0]?.key).toEqual(["A", "C", "D"]);
  });

  test("a bad item reason does not echo raw input", () => {
    const reason = reasonOf(
      parsePendingExam(pending({ items: [pi({ objective: RAW })] })),
    );
    expect(reason).not.toContain(RAW);
    expect(reason).not.toContain(RAW_SESSION);
  });

  test("unknown keys, such as question text, are not copied", () => {
    const r = parsePendingExam(
      pending({
        question: "Q?",
        items: [pi({ question: "Q?", options: ["x"], answer: "B" })],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual([
        "createdAt",
        "items",
        "mode",
        "track",
        "v",
      ]);
      expect(Object.keys(r.value.items[0] ?? {}).sort()).toEqual([
        "key",
        "kind",
        "objective",
        "topic",
      ]);
    }
  });

  test("exported types", () => {
    expectTypeOf<PendingItem["key"]>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<PendingItem["topic"]>().toEqualTypeOf<TopicId>();
    expectTypeOf<PendingExam["items"]>().toEqualTypeOf<
      readonly PendingItem[]
    >();
    expectTypeOf<PendingExam["v"]>().toEqualTypeOf<1>();
    expectTypeOf(parsePendingExam).returns.toEqualTypeOf<Parsed<PendingExam>>();
  });
});

describe("isPendingExpired", () => {
  const p = (createdAt: number): PendingExam => {
    const r = parsePendingExam(pending({ createdAt }));
    if (!r.ok) throw new Error("fixture rejected");
    return r.value;
  };

  test.each([
    ["just created", 10_000, 10_000, false],
    ["exactly at the TTL", 0, PENDING_TTL_MS, false],
    ["one ms past the TTL", 0, PENDING_TTL_MS + 1, true],
    ["long past the TTL", 1000, 1000 + 10 * PENDING_TTL_MS, true],
    ["created in the future", 5000, 1000, false],
  ])("%s", (_n, createdAt, now, expected) => {
    expect(isPendingExpired(p(createdAt), now)).toBe(expected);
  });
});
