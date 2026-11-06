import { describe, expect, test } from "vitest";
import {
  applyProductChange,
  deriveLevel,
  reconcile,
  type Diagnosis,
  type LevelInput,
  type ReconcileInput,
} from "../../src/internal/reconcile.js";
import {
  TOPIC_TYPES,
  type Evidence,
  type Level,
  type TopicType,
} from "../../src/internal/schema.js";
import { DAY, NOW, days, ev, repeat } from "./fixtures/evidence.js";

function input(
  events: readonly Evidence[],
  type: TopicType = "concept",
  introduced = true,
): LevelInput {
  return { type, events, introduced, now: NOW };
}

describe("deriveLevel: baseline and fast-moving", () => {
  test.each(TOPIC_TYPES)(
    "%s with nothing is Unseen, introduced is Introduced",
    (type) => {
      expect(deriveLevel(input([], type, false)).level).toBe("Unseen");
      expect(deriveLevel(input([], type, true)).level).toBe("Introduced");
    },
  );

  test("fast-moving is Introduced with any event, even strong evidence", () => {
    const strong = [...repeat(5, "observed"), ...repeat(5, "quiz")];
    expect(deriveLevel(input(strong, "fast-moving", false)).level).toBe(
      "Introduced",
    );
    expect(deriveLevel(input(strong, "fast-moving", true)).level).toBe(
      "Introduced",
    );
    expect(deriveLevel(input([ev("quiz")], "fast-moving", false)).level).toBe(
      "Introduced",
    );
  });

  test("a single unsatisfying event on a non-introduced topic is Introduced", () => {
    expect(deriveLevel(input([ev("quiz")], "concept", false)).level).toBe(
      "Introduced",
    );
  });
});

describe("deriveLevel: claimed", () => {
  test("positive self-report alone is Claimed", () => {
    expect(deriveLevel(input(repeat(1, "self-report"))).level).toBe("Claimed");
  });

  test("positive self-report with an unsatisfied positive probe stays Claimed", () => {
    const events = [ev("self-report"), ev("quiz")];
    expect(deriveLevel(input(events)).level).toBe("Claimed");
  });

  test("positive self-report with a negative dimension is Introduced", () => {
    const events = [ev("self-report"), ev("quiz", "negative")];
    expect(deriveLevel(input(events)).level).toBe("Introduced");
  });

  test("negative self-report alone is Introduced", () => {
    expect(deriveLevel(input([ev("self-report", "negative")])).level).toBe(
      "Introduced",
    );
  });
});

describe("deriveLevel: rungs", () => {
  test.each([
    ["quiz", "Recalled", ["recall"]],
    ["explain-back", "Understood", ["understand"]],
    ["observed", "Applied", ["apply"]],
  ] as const)(
    "two fresh positives on %s -> %s",
    (channel, level, satisfied) => {
      const result = deriveLevel(input(repeat(2, channel)));
      expect(result.level).toBe(level);
      expect(result.satisfied).toEqual(satisfied);
    },
  );

  test("the highest satisfied rung wins and satisfied is in DIMENSIONS order", () => {
    const events = [...repeat(2, "quiz"), ...repeat(2, "explain-back")];
    const result = deriveLevel(input(events));
    expect(result.level).toBe("Understood");
    expect(result.satisfied).toEqual(["understand", "recall"]);
  });

  test("scores are reported per dimension", () => {
    const events = [...repeat(3, "quiz"), ...repeat(1, "observed", "negative")];
    const { scores } = deriveLevel(input(events));
    expect(scores.recall).toBeCloseTo(0.6, 6);
    expect(scores.apply).toBeCloseTo(-1 / 3, 6);
    expect(scores.understand).toBe(0);
  });

  test("one fresh positive does not satisfy; two do", () => {
    expect(deriveLevel(input(repeat(1, "quiz"))).satisfied).toEqual([]);
    expect(deriveLevel(input(repeat(2, "quiz"))).satisfied).toEqual(["recall"]);
  });
});

describe("deriveLevel: fluent", () => {
  const trio = (
    channel: "quiz" | "explain-back" | "observed",
    span = days(1),
  ): Evidence[] => [
    ev(channel, "positive", 0, "s1"),
    ev(channel, "positive", span / 2, "s2"),
    ev(channel, "positive", span, "s3"),
  ];

  test.each([
    ["terminology", trio("quiz")],
    ["concept", [...trio("quiz"), ...trio("explain-back")]],
    ["feature", [...trio("observed"), ...trio("explain-back")]],
    ["practice", [...trio("observed"), ...trio("explain-back")]],
  ] as const)(
    "%s is Fluent with all required dimensions over 3 sessions and a day",
    (type, events) => {
      expect(deriveLevel(input(events, type)).level).toBe("Fluent");
    },
  );

  test("a missing required dimension blocks Fluent", () => {
    const events = [...trio("observed"), ...trio("quiz")];
    // feature needs apply + understand; there is no understand evidence
    expect(deriveLevel(input(events, "feature")).level).toBe("Applied");
  });

  test.each([
    [
      "2 distinct sessions",
      [
        ev("quiz", "positive", 0, "s1"),
        ev("quiz", "positive", days(1), "s2"),
        ev("quiz", "positive", days(2), "s2"),
      ],
      "Recalled",
    ],
    [
      "3 distinct sessions",
      [
        ev("quiz", "positive", 0, "s1"),
        ev("quiz", "positive", days(1), "s2"),
        ev("quiz", "positive", days(2), "s3"),
      ],
      "Fluent",
    ],
  ] as const)("session boundary: %s", (_name, events, expected) => {
    expect(deriveLevel(input(events, "terminology")).level).toBe(expected);
  });

  test.each([
    ["just under one day", DAY - 1, "Recalled"],
    ["exactly one day", DAY, "Fluent"],
    ["well over a day", days(5), "Fluent"],
  ] as const)("span boundary: %s", (_name, span, expected) => {
    expect(deriveLevel(input(trio("quiz", span), "terminology")).level).toBe(
      expected,
    );
  });

  test("fluencySessions overrides the default of 3", () => {
    // Two distinct sessions. Quiz ages 0, 1, 2 days: neff = 1 + 0.97716 +
    // 0.95499 = 2.93215, score = 2.93215 / 4.93215 = 0.5945 (>= 0.5).
    const two = [
      ev("quiz", "positive", 0, "s1"),
      ev("quiz", "positive", days(1), "s1"),
      ev("quiz", "positive", days(2), "s2"),
    ];
    expect(deriveLevel(input(two, "terminology")).level).toBe("Recalled");
    expect(
      deriveLevel({ ...input(two, "terminology"), fluencySessions: 2 }).level,
    ).toBe("Fluent");
  });

  test("only sessions of required-dimension channels count", () => {
    // concept requires understand + recall; sessions s2/s3 come from observed only
    // Hand scores (raw 1, score = neff / (neff + 2)):
    // quiz and explain-back at 0, 1.5, 3 days: neff = 1 + 0.96594 + 0.93303
    //   = 2.89897, score = 0.5917; observed at 0, 0.5, 1 day: neff = 1 +
    //   0.98851 + 0.97716 = 2.96567, score = 0.5972. All >= 0.5.
    const events = [
      ev("quiz", "positive", days(3), "s1"),
      ev("quiz", "positive", days(1.5), "s1"),
      ev("quiz", "positive", 0, "s1"),
      ev("explain-back", "positive", days(3), "s1"),
      ev("explain-back", "positive", days(1.5), "s1"),
      ev("explain-back", "positive", 0, "s1"),
      ev("observed", "positive", days(1), "s2"),
      ev("observed", "positive", days(0.5), "s3"),
      ev("observed", "positive", 0, "s3"),
    ];
    expect(deriveLevel(input(events, "concept")).level).toBe("Applied");
  });
});

describe("deriveLevel: caller errors", () => {
  test("non-finite now and mixed topics throw RangeError", () => {
    expect(() => deriveLevel({ ...input([]), now: NaN })).toThrowError(
      RangeError,
    );
    const mixed = [ev("quiz"), ev("quiz", "positive", 0, "s1", "other-topic")];
    expect(() => deriveLevel(input(mixed))).toThrowError(RangeError);
  });
});

describe("reconcile: design table 4.5", () => {
  interface Row {
    readonly name: string;
    readonly events: readonly Evidence[];
    readonly claim: "none" | "unverified" | "confirmed" | "refuted";
    readonly diagnoses: readonly Diagnosis[];
    readonly level: Level;
  }

  const rows: readonly Row[] = [
    {
      name: "self-report high + probe fails",
      events: [...repeat(3, "self-report"), ev("quiz", "negative")],
      claim: "refuted",
      diagnoses: ["overclaim"],
      level: "Introduced",
    },
    {
      name: "self-report high + observed confirms",
      events: [...repeat(3, "self-report"), ...repeat(2, "observed")],
      claim: "confirmed",
      diagnoses: [],
      level: "Applied",
    },
    {
      name: "quiz pass + observed misuse",
      events: [...repeat(2, "quiz"), ev("observed", "negative")],
      claim: "none",
      diagnoses: ["knows-not-applies"],
      level: "Recalled",
    },
    {
      name: "observed correct + explain-back fails",
      events: [...repeat(2, "observed"), ev("explain-back", "negative")],
      claim: "none",
      diagnoses: ["works-by-rote"],
      level: "Applied",
    },
    {
      name: "explain-back strong + quiz fails",
      events: [...repeat(2, "explain-back"), ev("quiz", "negative")],
      claim: "none",
      diagnoses: ["weak-recall"],
      level: "Understood",
    },
    {
      name: "claim with no probe evidence",
      events: repeat(1, "self-report"),
      claim: "unverified",
      diagnoses: [],
      level: "Claimed",
    },
  ];

  test.each(rows)("$name", ({ events, claim, diagnoses, level }) => {
    const result = reconcile(input(events));
    expect(result.claim).toBe(claim);
    expect(result.diagnoses).toEqual(diagnoses);
    expect(result.level).toBe(level);
  });

  test("old vs newer evidence: a recent negative triggers weak-recall, an old one does not", () => {
    const understood = repeat(2, "explain-back");
    const recentNegative = [
      ...understood,
      ...repeat(5, "quiz", "positive", days(60)),
      ev("quiz", "negative", 0),
    ];
    const oldNegative = [
      ...understood,
      ...repeat(5, "quiz", "positive", 0),
      ev("quiz", "negative", days(60)),
    ];
    const recent = reconcile(input(recentNegative));
    const old = reconcile(input(oldNegative));
    expect(recent.scores.recall).toBeCloseTo(-0.0481283, 6);
    expect(recent.diagnoses).toEqual(["weak-recall"]);
    expect(old.scores.recall).toBeCloseTo(0.6230954, 6);
    expect(old.diagnoses).toEqual([]);
    expect(old.satisfied).toEqual(["understand", "recall"]);
  });

  test("product change: stale evidence is dropped and the topic falls back to Introduced", () => {
    const old = [
      ...repeat(3, "self-report", "positive", days(40)),
      ...repeat(3, "quiz", "positive", days(40)),
    ];
    const changedAt = NOW - days(10);
    const kept = applyProductChange(old, changedAt);
    expect(kept).toEqual([]);
    const result = reconcile(input(kept));
    expect(result.level).toBe("Introduced");
    expect(result.claim).toBe("none");
  });

  test("diagnoses combine in the documented order", () => {
    const rote = reconcile(
      input([
        ...repeat(1, "self-report"),
        ...repeat(2, "quiz"),
        ev("observed", "negative"),
      ]),
    );
    expect(rote.diagnoses).toEqual(["overclaim", "knows-not-applies"]);
    const weak = reconcile({
      ...input([
        ev("self-report"),
        ...repeat(2, "explain-back"),
        ev("quiz", "negative"),
      ]),
      claimedLevel: "Claimed",
    });
    // Claimed is below every rung, so no dimension is within the claim.
    expect(weak.claim).toBe("confirmed");
    expect(weak.diagnoses).toEqual(["weak-recall", "underclaim"]);
    const both = reconcile({
      ...input([
        ev("self-report"),
        ...repeat(2, "quiz"),
        ev("observed", "negative"),
        ev("explain-back", "negative"),
      ]),
      claimedLevel: "Applied",
    });
    expect(both.diagnoses).toEqual(["overclaim", "knows-not-applies"]);
  });
});

describe("reconcile: claims", () => {
  const events = repeat(2, "observed");

  test("no claim without claimedLevel or positive self-report", () => {
    expect(reconcile(input(events)).claim).toBe("none");
  });

  test("claimedLevel alone counts as a claim: confirmed when evidence satisfies", () => {
    const result = reconcile({ ...input(events), claimedLevel: "Applied" });
    expect(result.claim).toBe("confirmed");
    expect(result.diagnoses).toEqual([]);
  });

  test("claimedLevel alone: refuted by a negative dimension", () => {
    const result = reconcile({
      ...input([ev("quiz", "negative")]),
      claimedLevel: "Applied",
    });
    expect(result.claim).toBe("refuted");
    expect(result.diagnoses).toEqual(["overclaim"]);
  });

  test("claimedLevel with no evidence is unverified", () => {
    const result = reconcile({ ...input([]), claimedLevel: "Applied" });
    expect(result.claim).toBe("unverified");
    expect(result.diagnoses).toEqual([]);
  });

  test("a negative self-report is not a claim", () => {
    expect(reconcile(input([ev("self-report", "negative")])).claim).toBe(
      "none",
    );
  });

  test.each([
    ["Recalled", true],
    ["Applied", false],
    ["Fluent", false],
  ] as const)(
    "claimedLevel %s vs derived Applied: underclaim=%s",
    (claimedLevel, under) => {
      const result = reconcile({ ...input(events), claimedLevel });
      expect(result.diagnoses.includes("underclaim")).toBe(under);
    },
  );

  test("no underclaim without claimedLevel", () => {
    expect(reconcile(input(events)).diagnoses).not.toContain("underclaim");
  });

  test.each(["Fluent", "Applied", "Understood"] as const)(
    "claimedLevel %s never raises the level",
    (claimedLevel) => {
      const base: LevelInput = input([ev("quiz")]);
      const input2: ReconcileInput = { ...base, claimedLevel };
      const result = reconcile(input2);
      expect(result.level).toBe("Introduced");
      expect({
        level: result.level,
        scores: result.scores,
        satisfied: result.satisfied,
      }).toEqual(deriveLevel(base));
    },
  );

  test("level, scores and satisfied equal deriveLevel for evidence-rich input", () => {
    const base = input([
      ...repeat(2, "quiz"),
      ...repeat(2, "explain-back"),
      ev("self-report"),
    ]);
    const result = reconcile({ ...base, claimedLevel: "Fluent" });
    const derived = deriveLevel(base);
    expect(result.level).toBe(derived.level);
    expect(result.scores).toEqual(derived.scores);
    expect(result.satisfied).toEqual(derived.satisfied);
  });
});

describe("applyProductChange", () => {
  test("keeps events at or after changedAt and drops older ones", () => {
    const changedAt = NOW - days(5);
    const older = ev("quiz", "positive", days(5) + 1);
    const boundary = ev("quiz", "positive", days(5));
    const newer = ev("quiz", "positive", days(1));
    expect(applyProductChange([older, boundary, newer], changedAt)).toEqual([
      boundary,
      newer,
    ]);
  });

  test("returns a new array and does not mutate the input", () => {
    const events = [ev("quiz"), ev("quiz", "positive", days(9))];
    const snapshot = [...events];
    const out = applyProductChange(events, NOW - days(1));
    expect(out).not.toBe(events);
    expect(events).toEqual(snapshot);
  });

  test("a fully-stale history with introduced:true derives Introduced", () => {
    const stale = repeat(3, "observed", "positive", days(40));
    const kept = applyProductChange(stale, NOW - days(1));
    expect(deriveLevel(input(kept, "feature", true)).level).toBe("Introduced");
  });

  test.each([NaN, Infinity, -Infinity])(
    "non-finite changedAt %d throws RangeError",
    (changedAt) => {
      expect(() => applyProductChange([], changedAt)).toThrowError(RangeError);
    },
  );
});
