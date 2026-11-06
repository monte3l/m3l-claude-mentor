import { describe, expect, test } from "vitest";
import type { TopicId } from "../../src/internal/schema.js";
import {
  clampProfileToNow,
  clampStateToNow,
  defaultProfile,
  defaultState,
  parseProfile,
  parseState,
  type MentorState,
  type Profile,
} from "../../src/internal/state-schema.js";

function mustState(v: unknown): MentorState {
  const r = parseState(v);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}
function mustProfile(v: unknown): Profile {
  const r = parseProfile(v);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}
function frozenState(seg: Record<string, unknown>): MentorState {
  const s = mustState({
    schemaVersion: 1,
    muted: true,
    mutedTopics: ["a"],
    excludedProjects: ["/p"],
    lastChangelogVersion: "1.0.0",
    segment: {
      segmentId: 4,
      startedAt: 10,
      lastActivityAt: 20,
      tipsEmitted: 2,
      lastTipAt: 15,
      lastTopic: "a",
      ...seg,
    },
  });
  Object.freeze(s.segment);
  Object.freeze(s.mutedTopics);
  Object.freeze(s.excludedProjects);
  return Object.freeze(s);
}

describe("clampStateToNow", () => {
  test("future activity and start are clamped to now", () => {
    const r = clampStateToNow(
      frozenState({ startedAt: 5e15, lastActivityAt: 9e15, lastTipAt: 1e15 }),
      1000,
    );
    expect(r.segment).toEqual({
      segmentId: 4,
      startedAt: 1000,
      lastActivityAt: 1000,
      tipsEmitted: 2,
      lastTipAt: 1000,
      lastTopic: "a" as TopicId,
    });
  });

  test("only lastActivityAt in the future: start untouched", () => {
    const r = clampStateToNow(frozenState({ lastActivityAt: 9e15 }), 1000);
    expect(r.segment.startedAt).toBe(10);
    expect(r.segment.lastActivityAt).toBe(1000);
    expect(r.segment.lastTipAt).toBe(15);
  });

  test("a timestamp exactly equal to now stays", () => {
    const r = clampStateToNow(
      frozenState({ startedAt: 1000, lastActivityAt: 1000, lastTipAt: 1000 }),
      1000,
    );
    expect(r.segment.startedAt).toBe(1000);
    expect(r.segment.lastActivityAt).toBe(1000);
    expect(r.segment.lastTipAt).toBe(1000);
  });

  test("one above now is clamped, one below stays", () => {
    const r = clampStateToNow(
      frozenState({ startedAt: 999, lastActivityAt: 1001, lastTipAt: 999 }),
      1000,
    );
    expect(r.segment.startedAt).toBe(999);
    expect(r.segment.lastActivityAt).toBe(1000);
    expect(r.segment.lastTipAt).toBe(999);
  });

  test("null lastTipAt stays null", () => {
    const r = clampStateToNow(frozenState({ lastTipAt: null }), 1000);
    expect(r.segment.lastTipAt).toBeNull();
  });

  test("a state entirely in the past is returned equal", () => {
    const s = frozenState({});
    expect(clampStateToNow(s, 1_000_000)).toEqual(s);
    const d = defaultState(5);
    expect(clampStateToNow(d, 5)).toEqual(d);
  });

  test("carries every other field over", () => {
    const r = clampStateToNow(frozenState({ lastActivityAt: 9e15 }), 1000);
    expect(r.muted).toBe(true);
    expect(r.mutedTopics).toEqual(["a"]);
    expect(r.excludedProjects).toEqual(["/p"]);
    expect(r.lastChangelogVersion).toBe("1.0.0");
    expect(r.schemaVersion).toBe(1);
  });

  test("does not mutate a frozen input", () => {
    const s = frozenState({ startedAt: 5e15, lastActivityAt: 9e15 });
    const r = clampStateToNow(s, 1000);
    expect(r).not.toBe(s);
    expect(s.segment.startedAt).toBe(5e15);
    expect(s.segment.lastActivityAt).toBe(9e15);
  });

  test("result still parses", () => {
    const r = clampStateToNow(frozenState({ lastActivityAt: 9e15 }), 1000);
    expect(parseState(r).ok).toBe(true);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("now %s -> RangeError naming now", (_l, now) => {
    expect(() => clampStateToNow(defaultState(0), now)).toThrowError(
      RangeError,
    );
    expect(() => clampStateToNow(defaultState(0), now)).toThrowError(/now/);
  });
});

function frozenProfile(): Profile {
  const p = mustProfile({
    schemaVersion: 1,
    topics: {
      future: {
        introduced: true,
        level: "Applied",
        lastPassAt: 9e15,
        passes: 3,
      },
      exact: {
        introduced: true,
        level: "Recalled",
        lastPassAt: 1000,
        passes: 1,
      },
      past: {
        introduced: false,
        level: "Claimed",
        lastPassAt: 5,
        passes: 0,
      },
      never: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    },
    calibration: { confirmed: 7, refuted: 2 },
  });
  for (const t of Object.values(p.topics)) Object.freeze(t);
  Object.freeze(p.topics);
  Object.freeze(p.calibration);
  return Object.freeze(p);
}

describe("clampProfileToNow", () => {
  test("clamps only future lastPassAt and carries the rest", () => {
    const r = clampProfileToNow(frozenProfile(), 1000);
    expect(r.topics).toEqual({
      future: {
        introduced: true,
        level: "Applied",
        lastPassAt: 1000,
        passes: 3,
      },
      exact: {
        introduced: true,
        level: "Recalled",
        lastPassAt: 1000,
        passes: 1,
      },
      past: {
        introduced: false,
        level: "Claimed",
        lastPassAt: 5,
        passes: 0,
      },
      never: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    expect(r.calibration).toEqual({ confirmed: 7, refuted: 2 });
    expect(r.schemaVersion).toBe(1);
  });

  test("one above now clamped, one below stays", () => {
    const p = mustProfile({
      ...defaultProfile(),
      topics: {
        a: { introduced: true, level: "Fluent", lastPassAt: 1001, passes: 1 },
        b: { introduced: true, level: "Fluent", lastPassAt: 999, passes: 1 },
      },
    });
    const r = clampProfileToNow(p, 1000);
    expect(r.topics["a"]?.lastPassAt).toBe(1000);
    expect(r.topics["b"]?.lastPassAt).toBe(999);
  });

  test("an all-past profile is returned equal; default too", () => {
    const p = frozenProfile();
    expect(clampProfileToNow(p, 9e15)).toEqual(p);
    expect(clampProfileToNow(defaultProfile(), 0)).toEqual(defaultProfile());
  });

  test("does not mutate a frozen input", () => {
    const p = frozenProfile();
    clampProfileToNow(p, 1000);
    expect(p.topics["future"]?.lastPassAt).toBe(9e15);
  });

  test("result still parses", () => {
    expect(parseProfile(clampProfileToNow(frozenProfile(), 1000)).ok).toBe(
      true,
    );
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("now %s -> RangeError naming now", (_l, now) => {
    expect(() => clampProfileToNow(defaultProfile(), now)).toThrowError(
      RangeError,
    );
    expect(() => clampProfileToNow(defaultProfile(), now)).toThrowError(/now/);
  });
});
