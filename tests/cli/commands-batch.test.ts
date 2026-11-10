import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.js";
import { parseEvidence } from "../../src/internal/schema.js";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.js";
import {
  appendEvidence,
  saveCatalogFile,
  saveProfile,
} from "../../src/internal/store.js";
import {
  DAY,
  NOW,
  SESSION,
  makeSandbox,
  put,
  read,
  readJson,
  run,
  runOk,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const TOPIC = "context-window";
const USAGE =
  "usage: mentor-state record-batch --topic <id> --events <channel:result,...> [--pass <pass|fail>] [--claim <level>]\n";
const CONFIRMING =
  "quiz:positive,quiz:positive,explain-back:positive,explain-back:positive,observed:positive,observed:positive";

const batch = (events: string, ...extra: string[]): string[] => [
  "record-batch",
  "--topic",
  TOPIC,
  "--events",
  events,
  ...extra,
];
const seedProfile = (
  topics: Profile["topics"],
  calibration = { confirmed: 0, refuted: 0 },
): Promise<void> =>
  saveProfile(sb.dir, { ...defaultProfile(), topics, calibration });
const introduced = {
  introduced: true,
  level: "Introduced",
  lastPassAt: null,
  passes: 0,
} as const;
const profile = (): {
  calibration: unknown;
  topics: Record<string, unknown>;
} =>
  readJson(sb.dir, "profile.json") as {
    calibration: unknown;
    topics: Record<string, unknown>;
  };

async function seedHistory(dir: string): Promise<void> {
  for (const [channel, session, at] of [
    ["quiz", "sess-b", NOW - DAY],
    ["explain-back", "sess-b", NOW - DAY],
    ["quiz", "sess-c", NOW - 2 * DAY],
    ["explain-back", "sess-c", NOW - 2 * DAY],
  ] as const) {
    const parsed = parseEvidence({
      channel,
      topic: TOPIC,
      result: "positive",
      at,
      session,
    });
    if (!parsed.ok) throw new Error("fixture invalid");
    await appendEvidence(dir, parsed.value);
  }
}

describe("record-batch happy paths", () => {
  test("appends each event in order with channel, result, topic, time and session", async () => {
    await runOk(
      sb.dir,
      batch("quiz:positive,self-report:negative,observed:positive"),
    );
    const lines = read(sb.dir, "evidence.jsonl")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => [l["channel"], l["result"]])).toEqual([
      ["quiz", "positive"],
      ["self-report", "negative"],
      ["observed", "positive"],
    ]);
    for (const line of lines) {
      expect(line).toMatchObject({ topic: TOPIC, at: NOW, session: SESSION });
    }
  });

  test("duplicates are allowed and each is appended", async () => {
    const out = (await runOk(
      sb.dir,
      batch("quiz:positive,quiz:positive,quiz:negative"),
    )) as { recorded: number };
    expect(out.recorded).toBe(3);
    expect(read(sb.dir, "evidence.jsonl").trim().split("\n")).toHaveLength(3);
  });

  test("hand-verified: confirming evidence with --claim Applied from Introduced", async () => {
    await seedProfile({ [TOPIC]: introduced });
    expect(
      await runOk(sb.dir, batch(CONFIRMING, "--claim", "Applied")),
    ).toEqual({
      topic: TOPIC,
      recorded: 6,
      passes: 0,
      level: "Applied",
      previousLevel: "Introduced",
      claim: "confirmed",
      diagnoses: [],
      evidenceSkipped: 0,
    });
    expect(profile().topics[TOPIC]).toMatchObject({
      level: "Applied",
      introduced: true,
    });
  });

  test("hand-verified: three positive quizzes derive Recalled with claim none", async () => {
    await seedProfile({ [TOPIC]: introduced });
    expect(
      await runOk(sb.dir, batch("quiz:positive,quiz:positive,quiz:positive")),
    ).toMatchObject({
      level: "Recalled",
      previousLevel: "Introduced",
      claim: "none",
    });
  });

  test("the level equals what record-evidence plus recompute give for the same events", async () => {
    const other = makeSandbox();
    try {
      await saveProfile(other.dir, {
        ...defaultProfile(),
        topics: { [TOPIC]: introduced },
      });
      const events = ["quiz:positive", "quiz:positive", "self-report:positive"];
      for (const event of events) {
        const [channel = "", result = ""] = event.split(":");
        await runOk(other.dir, [
          "record-evidence",
          "--topic",
          TOPIC,
          "--channel",
          channel,
          "--result",
          result,
        ]);
      }
      const expected = (await runOk(other.dir, [
        "recompute",
        "--topic",
        TOPIC,
        "--claim",
        "Recalled",
      ])) as Record<string, unknown>;
      await seedProfile({ [TOPIC]: introduced });
      const got = (await runOk(
        sb.dir,
        batch(events.join(","), "--claim", "Recalled"),
      )) as Record<string, unknown>;
      expect(got["level"]).toBe("Recalled");
      expect(got["claim"]).toBe("confirmed");
      expect(got).toMatchObject({
        level: expected["level"],
        previousLevel: expected["previousLevel"],
        claim: expected["claim"],
        diagnoses: expected["diagnoses"],
        evidenceSkipped: expected["evidenceSkipped"],
      });
    } finally {
      other.cleanup();
    }
  });

  test("a fast-moving topic accepts events but its level is capped at Introduced", async () => {
    const custom = parseCatalog([
      {
        id: "fast-one",
        title: "Fast",
        type: "fast-moving",
        dependencies: [],
        keywords: ["fast"],
        targetLevel: "Understood",
        enabled: true,
      },
    ]);
    if (!custom.ok) throw new Error("fixture invalid");
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: {}, custom: custom.value },
    });
    const out = await runOk(sb.dir, [
      "record-batch",
      "--topic",
      "fast-one",
      "--events",
      "quiz:positive,quiz:positive,explain-back:positive,observed:positive",
    ]);
    expect(out).toMatchObject({ recorded: 4, level: "Introduced" });
  });

  test("scoring overrides from catalog.json are honoured", async () => {
    // Three distinct sessions over three days: Fluent by default.
    await seedHistory(sb.dir);
    const events = "quiz:positive,explain-back:positive";
    const other = makeSandbox();
    try {
      await seedHistory(other.dir);
      const base = (await runOk(other.dir, batch(events))) as { level: string };
      expect(base.level).toBe("Fluent");
    } finally {
      other.cleanup();
    }
    await saveCatalogFile(sb.dir, {
      ...EMPTY_CATALOG_FILE,
      scoring: { fluencySessions: 4 },
    });
    const out = (await runOk(sb.dir, batch(events))) as { level: string };
    expect(out.level).not.toBe("Fluent");
  });
});

describe("record-batch --pass", () => {
  test("pass on an absent topic creates the entry with passes 1 and lastPassAt now, in one saved profile with the new level", async () => {
    const out = await runOk(
      sb.dir,
      batch("quiz:positive,quiz:positive,quiz:positive", "--pass", "pass"),
    );
    expect(out).toMatchObject({
      passes: 1,
      level: "Recalled",
      previousLevel: "Unseen",
    });
    expect(profile().topics[TOPIC]).toEqual({
      introduced: false,
      level: "Recalled",
      lastPassAt: NOW,
      passes: 1,
    });
  });

  test("pass increments existing passes and stamps lastPassAt", async () => {
    await seedProfile({
      [TOPIC]: { ...introduced, passes: 2, lastPassAt: NOW - DAY },
    });
    const out = await runOk(sb.dir, batch("quiz:positive", "--pass", "pass"));
    expect(out).toMatchObject({ passes: 3 });
    expect(profile().topics[TOPIC]).toMatchObject({
      passes: 3,
      lastPassAt: NOW,
    });
  });

  test("fail resets passes to 0 and leaves lastPassAt alone", async () => {
    await seedProfile({
      [TOPIC]: { ...introduced, passes: 2, lastPassAt: NOW - DAY },
    });
    const out = await runOk(sb.dir, batch("quiz:negative", "--pass", "fail"));
    expect(out).toMatchObject({ passes: 0 });
    expect(profile().topics[TOPIC]).toMatchObject({
      passes: 0,
      lastPassAt: NOW - DAY,
    });
  });

  test("without --pass the stored passes and lastPassAt are kept and reported", async () => {
    await seedProfile({
      [TOPIC]: { ...introduced, passes: 2, lastPassAt: NOW - DAY },
    });
    const out = await runOk(sb.dir, batch("quiz:positive"));
    expect(out).toMatchObject({ passes: 2 });
    expect(profile().topics[TOPIC]).toMatchObject({
      passes: 2,
      lastPassAt: NOW - DAY,
    });
  });
});

describe("record-batch calibration", () => {
  // Hand-verified against `recompute` on the same events.
  test.each([
    ["confirmed", CONFIRMING, "Applied", { confirmed: 1, refuted: 0 }],
    [
      "refuted",
      "quiz:negative,quiz:negative,explain-back:negative",
      "Fluent",
      { confirmed: 0, refuted: 1 },
    ],
    ["unverified", "quiz:positive", "Understood", { confirmed: 0, refuted: 0 }],
  ] as const)("--claim: %s", async (outcome, events, claim, cal) => {
    await seedProfile({ [TOPIC]: introduced });
    const out = await runOk(sb.dir, batch(events, "--claim", claim));
    expect(out).toMatchObject({ claim: outcome });
    expect(profile().calibration).toEqual(cal);
  });

  test("without --claim the calibration is untouched and claim is none", async () => {
    await seedProfile({ [TOPIC]: introduced }, { confirmed: 2, refuted: 1 });
    const out = await runOk(sb.dir, batch(CONFIRMING));
    expect(out).toMatchObject({ claim: "none" });
    expect(profile().calibration).toEqual({ confirmed: 2, refuted: 1 });
  });
});

describe("record-batch validation writes nothing", () => {
  const ok = "quiz:positive";
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["no arguments", ["record-batch"]],
    ["no --events", ["record-batch", "--topic", TOPIC]],
    ["no --topic", ["record-batch", "--events", ok]],
    ["an empty --events", batch("")],
    [
      "a missing --events value",
      ["record-batch", "--topic", TOPIC, "--events"],
    ],
    ["a repeated --events", [...batch(ok), "--events", ok]],
    ["a repeated --topic", [...batch(ok), "--topic", TOPIC]],
    ["a repeated --pass", batch(ok, "--pass", "pass", "--pass", "fail")],
    [
      "a repeated --claim",
      batch(ok, "--claim", "Applied", "--claim", "Applied"),
    ],
    ["an unknown flag", batch(ok, "--nope", "x")],
    ["a stray positional", [...batch(ok), "extra"]],
    [
      "an unknown topic",
      ["record-batch", "--topic", "no-such-topic", "--events", ok],
    ],
    [
      "a malformed topic",
      ["record-batch", "--topic", "Bad Id!", "--events", ok],
    ],
    ["a bad pass value", batch(ok, "--pass", "maybe")],
    ["a bad claim level", batch(ok, "--claim", "Master")],
    ["a lowercase claim", batch(ok, "--claim", "applied")],
    ["a token without a colon", batch("quiz")],
    ["a token without a result", batch("quiz:")],
    ["a token without a channel", batch(":positive")],
    ["an unknown channel", batch("bogus:positive")],
    ["an unknown result", batch("quiz:maybe")],
    ["an uppercase channel", batch("QUIZ:positive")],
    ["an extra colon", batch("quiz:positive:positive")],
    ["a trailing comma", batch("quiz:positive,")],
    ["an empty token", batch("quiz:positive,,quiz:positive")],
    ["whitespace after the colon", batch("quiz: positive")],
    ["whitespace around a comma", batch("quiz:positive, quiz:positive")],
    ["a space separator", batch("quiz:positive quiz:positive")],
    [
      "a bad second event after a good one",
      batch("quiz:positive,bogus:positive"),
    ],
    [
      "a good events list with a bad --claim",
      batch(ok, "--pass", "pass", "--claim", "Master"),
    ],
    ["11 events", batch(Array(11).fill(ok).join(","))],
  ];

  test.each(cases)(
    "%s -> exit 2, fixed usage line, no files written",
    async (_name, argv) => {
      const result = await run(sb.dir, argv);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(USAGE);
      expect(() => read(sb.dir, "evidence.jsonl")).toThrow();
      expect(() => read(sb.dir, "profile.json")).toThrow();
    },
  );

  test("a rejected call leaves existing evidence and profile byte-identical", async () => {
    await seedProfile({ [TOPIC]: introduced });
    await runOk(sb.dir, batch(ok));
    const evidence = read(sb.dir, "evidence.jsonl");
    const stored = read(sb.dir, "profile.json");
    await run(sb.dir, batch("quiz:positive,bogus:positive", "--pass", "pass"));
    await run(sb.dir, batch(ok, "--pass", "pass", "--claim", "Master"));
    expect(read(sb.dir, "evidence.jsonl")).toBe(evidence);
    expect(read(sb.dir, "profile.json")).toBe(stored);
  });

  test("does not echo any rejected argument value", async () => {
    for (const argv of [
      ["record-batch", "--topic", "secret-topic-xyzzy", "--events", ok],
      batch("SECRET-xyzzy:positive"),
      batch(ok, "--pass", "SECRET-xyzzy"),
      batch(ok, "--claim", "SECRET-xyzzy"),
    ]) {
      const result = await run(sb.dir, argv);
      expect(result.stderr).not.toMatch(/secret|xyzzy/i);
    }
  });

  test("the 10-event cap: 10 events succeed", async () => {
    const out = await runOk(sb.dir, batch(Array(10).fill(ok).join(",")));
    expect(out).toMatchObject({ recorded: 10 });
    expect(read(sb.dir, "evidence.jsonl").trim().split("\n")).toHaveLength(10);
  });

  test("a catalog.json that does not merge exits 1 and nothing is written", async () => {
    put(
      sb.dir,
      "catalog.json",
      '{"overrides":{"no-such-topic":{}},"custom":[]}',
    );
    const result = await run(sb.dir, batch(ok));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(() => read(sb.dir, "evidence.jsonl")).toThrow();
  });
});

describe("record-batch partial failure", () => {
  test("an append that fails reports WRITE_FAILED recorded 0 of n and applies no pass or recompute", async () => {
    // evidence.jsonl is a directory, so the first append cannot succeed.
    mkdirSync(join(sb.dir, "evidence.jsonl"), { recursive: true });
    const result = await run(
      sb.dir,
      batch("quiz:positive,quiz:positive,quiz:positive", "--pass", "pass"),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toContain("recorded 0 of 3 events");
    expect(result.stderr.trimEnd()).not.toContain("\n");
    expect(() => read(sb.dir, "profile.json")).toThrow();
  });
});
