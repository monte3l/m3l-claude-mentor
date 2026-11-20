import { describe, expect, expectTypeOf, test } from "vitest";
import {
  parseExamItem,
  type ExamItem,
} from "../../src/internal/exam-schema.ts";
import {
  parseEvidence,
  parseSessionId,
  type Channel,
  type Evidence,
} from "../../src/internal/schema.ts";
import {
  excludeVoidedEvidence,
  excludeVoidedItems,
  type VoidedExam,
} from "../../src/internal/voids.ts";

function sid(value: string): VoidedExam["session"] {
  const r = parseSessionId(value);
  if (!r.ok) throw new Error("bad session fixture");
  return r.value;
}
const voided = (session: string, at: number): VoidedExam => ({
  session: sid(session),
  at,
});

function ev(channel: Channel, session: string, at: number): Evidence {
  const r = parseEvidence({
    channel,
    topic: "plan-mode",
    result: "positive",
    at,
    session,
  });
  if (!r.ok) throw new Error("bad evidence fixture");
  return r.value;
}

function item(session: string, at: number): ExamItem {
  const r = parseExamItem({
    v: 1,
    track: "CCAR-F",
    domain: "D1",
    objective: "D1.2",
    topic: "plan-mode",
    kind: "single",
    mode: "drill",
    correct: true,
    at,
    session,
  });
  if (!r.ok) throw new Error("bad item fixture");
  return r.value;
}

describe("VoidedExam", () => {
  test("is a session and an epoch-ms at", () => {
    expectTypeOf<VoidedExam["at"]>().toEqualTypeOf<number>();
    expectTypeOf<VoidedExam["session"]>().toEqualTypeOf<Evidence["session"]>();
  });
});

describe("excludeVoidedEvidence", () => {
  test("drops only quiz events whose (session, at) match a void, keeping order", () => {
    const events = [
      ev("quiz", "s1", 10),
      ev("quiz", "s1", 20),
      ev("quiz", "s2", 10),
      ev("quiz", "s1", 10),
      ev("quiz", "s3", 5),
    ];
    expect(
      excludeVoidedEvidence(events, [voided("s1", 10), voided("s3", 5)]),
    ).toEqual([events[1], events[2]]);
  });

  test("never drops events of another channel, even on a matching pair", () => {
    const events = [
      ev("observed", "s1", 10),
      ev("explain-back", "s1", 10),
      ev("quiz", "s1", 10),
    ];
    expect(excludeVoidedEvidence(events, [voided("s1", 10)])).toEqual([
      events[0],
      events[1],
    ]);
  });

  test("session and at must both match", () => {
    const events = [ev("quiz", "s1", 10), ev("quiz", "s2", 20)];
    expect(
      excludeVoidedEvidence(events, [voided("s1", 20), voided("s2", 10)]),
    ).toEqual(events);
  });

  test("no voids or no events: an equal copy, input not mutated", () => {
    const events = [ev("quiz", "s1", 10)];
    const out = excludeVoidedEvidence(events, []);
    expect(out).toEqual(events);
    expect(out).not.toBe(events);
    expect(excludeVoidedEvidence([], [voided("s1", 10)])).toEqual([]);
    expect(events).toHaveLength(1);
  });
});

describe("excludeVoidedItems", () => {
  test("drops items whose (session, at) match, keeping order", () => {
    const items = [
      item("s1", 10),
      item("s1", 20),
      item("s2", 10),
      item("s1", 10),
    ];
    expect(excludeVoidedItems(items, [voided("s1", 10)])).toEqual([
      items[1],
      items[2],
    ]);
  });

  test("non-matching items and empty voids are untouched", () => {
    const items = [item("s1", 10), item("s2", 20)];
    expect(excludeVoidedItems(items, [voided("s1", 20)])).toEqual(items);
    const out = excludeVoidedItems(items, []);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});
