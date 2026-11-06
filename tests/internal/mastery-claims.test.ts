import { describe, expect, test } from "vitest";
import {
  deriveLevel,
  reconcile,
  type LevelInput,
} from "../../src/internal/reconcile.js";
import type { Evidence, Level, TopicType } from "../../src/internal/schema.js";
import { NOW, days, ev, repeat } from "./fixtures/evidence.js";

function input(
  events: readonly Evidence[],
  type: TopicType = "concept",
): LevelInput {
  return { type, events, introduced: true, now: NOW };
}

describe("reconcile: claim rules (rungs within the claim)", () => {
  test("claimedLevel Claimed with Understood evidence and a failed quiz: confirmed, no overclaim", () => {
    const result = reconcile({
      ...input([...repeat(2, "explain-back"), ev("quiz", "negative")]),
      claimedLevel: "Claimed",
    });
    expect(result.claim).toBe("confirmed");
    expect(result.diagnoses).toEqual(["weak-recall", "underclaim"]);
  });

  test("self-report events only (no claimedLevel) and a negative recall: refuted", () => {
    const result = reconcile(
      input([ev("self-report"), ev("quiz", "negative")]),
    );
    expect(result.claim).toBe("refuted");
    expect(result.diagnoses).toEqual(["overclaim"]);
  });

  test("claimedLevel Applied with only Recalled evidence and nothing negative: unverified", () => {
    const result = reconcile({
      ...input(repeat(2, "quiz")),
      claimedLevel: "Applied",
    });
    expect(result.level).toBe("Recalled");
    expect(result.claim).toBe("unverified");
  });

  test("claimedLevel Understood and a negative on apply only: apply is above the claim", () => {
    const withUnderstood = reconcile({
      ...input([...repeat(2, "explain-back"), ev("observed", "negative")]),
      claimedLevel: "Understood",
    });
    expect(withUnderstood.claim).toBe("confirmed");
    expect(withUnderstood.diagnoses).toEqual([]);

    const alone = reconcile({
      ...input([ev("observed", "negative")]),
      claimedLevel: "Understood",
    });
    expect(alone.claim).toBe("unverified");
    expect(alone.diagnoses).toEqual([]);
  });

  test.each([
    ["Recalled", "quiz", "refuted"],
    ["Understood", "explain-back", "refuted"],
    ["Applied", "observed", "refuted"],
    ["Recalled", "explain-back", "unverified"],
    ["Recalled", "observed", "unverified"],
    ["Understood", "observed", "unverified"],
  ] as const)(
    "claimedLevel %s with a lone negative %s -> %s",
    (claimedLevel, channel, claim) => {
      const result = reconcile({
        ...input([ev(channel, "negative")]),
        claimedLevel,
      });
      expect(result.claim).toBe(claim);
      expect(result.diagnoses.includes("overclaim")).toBe(claim === "refuted");
    },
  );

  test.each([
    ["Recalled", "confirmed"],
    ["Understood", "confirmed"],
    ["Applied", "unverified"],
    ["Fluent", "unverified"],
  ] as const)(
    "with Understood-level evidence, claimedLevel %s -> %s",
    (claimedLevel: Level, claim) => {
      const result = reconcile({
        ...input(repeat(2, "explain-back")),
        claimedLevel,
      });
      expect(result.level).toBe("Understood");
      expect(result.claim).toBe(claim);
    },
  );
});

describe("reconcile: fast-moving topics", () => {
  test.each([
    ["no claim", [ev("quiz")], undefined, "none"],
    ["positive self-report", [ev("self-report")], undefined, "unverified"],
    [
      "strong evidence with a claimedLevel",
      [...repeat(4, "observed"), ...repeat(4, "quiz")],
      "Applied",
      "unverified",
    ],
    [
      "a negative with a claimedLevel",
      [ev("quiz", "negative")],
      "Recalled",
      "unverified",
    ],
    [
      "self-report plus a negative",
      [ev("self-report"), ev("quiz", "negative")],
      undefined,
      "unverified",
    ],
  ] as const)("%s", (_name, events, claimedLevel, claim) => {
    const base = input(events, "fast-moving");
    const result = reconcile(
      claimedLevel === undefined ? base : { ...base, claimedLevel },
    );
    expect(result.level).toBe("Introduced");
    expect(result.claim).toBe(claim);
    expect(result.diagnoses.includes("overclaim")).toBe(false);
  });
});

describe("reconcile: diagnosis guards", () => {
  test("a lone observed negative does not produce knows-not-applies", () => {
    const result = reconcile(input([ev("observed", "negative")]));
    expect(result.diagnoses).toEqual([]);
  });

  test("a lone explain-back negative does not produce works-by-rote", () => {
    const result = reconcile(input([ev("explain-back", "negative")]));
    expect(result.diagnoses).toEqual([]);
  });
});

describe("deriveLevel: fluent ignores negative events", () => {
  test("two positive quiz sessions plus a negative in a third session stay Recalled", () => {
    const events = [
      ...repeat(5, "quiz", "positive", days(3), "s1"),
      ...repeat(5, "quiz", "positive", days(2), "s2"),
      ev("quiz", "negative", days(1), "s3"),
    ];
    const result = deriveLevel(input(events, "terminology"));
    expect(result.satisfied).toEqual(["recall"]);
    expect(result.level).toBe("Recalled");
  });
});

describe("deriveLevel: fluencySessions validation", () => {
  test.each([-1, 1.5, NaN])("fluencySessions %d throws RangeError", (n) => {
    expect(() =>
      deriveLevel({ ...input([ev("quiz")]), fluencySessions: n }),
    ).toThrowError(RangeError);
  });
});
