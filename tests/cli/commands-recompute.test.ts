import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.js";
import {
  DAY,
  NOW,
  makeSandbox,
  readJson,
  run,
  runOk,
  seedEvidence,
  type Sandbox,
} from "./helpers.js";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.js";
import { saveCatalogFile, saveProfile } from "../../src/internal/store.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const TOPIC = "context-window";
const calibration = (): unknown =>
  (readJson(sb.dir, "profile.json") as { calibration: unknown }).calibration;
const topicProfile = (id: string): unknown =>
  (readJson(sb.dir, "profile.json") as { topics: Record<string, unknown> })
    .topics[id];
const seedProfile = (
  topics: Profile["topics"],
  cal = { confirmed: 0, refuted: 0 },
): Promise<void> =>
  saveProfile(sb.dir, { ...defaultProfile(), topics, calibration: cal });

async function seedConfirmingEvidence(): Promise<void> {
  for (const channel of ["quiz", "explain-back", "observed"] as const) {
    await seedEvidence(sb.dir, TOPIC, channel, "positive", 2);
  }
}

describe("recompute", () => {
  test("derives and saves the level; reports previousLevel, claim and diagnoses", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    await seedConfirmingEvidence();
    const out = await runOk(sb.dir, [
      "recompute",
      "--topic",
      TOPIC,
      "--claim",
      "Applied",
    ]);
    expect(out).toEqual({
      topic: TOPIC,
      level: "Applied",
      previousLevel: "Introduced",
      claim: "confirmed",
      diagnoses: [],
      evidenceSkipped: 0,
    });
    expect(topicProfile(TOPIC)).toMatchObject({
      level: "Applied",
      introduced: true,
    });
  });

  test("without --claim: claim is none and calibration is untouched", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    await seedConfirmingEvidence();
    const out = (await runOk(sb.dir, ["recompute", "--topic", TOPIC])) as {
      claim: string;
      level: string;
    };
    expect(out.claim).toBe("none");
    expect(out.level).toBe("Applied");
    expect(calibration()).toEqual({ confirmed: 0, refuted: 0 });
  });

  test("a confirmed claim increments calibration.confirmed", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    await seedConfirmingEvidence();
    await runOk(sb.dir, ["recompute", "--topic", TOPIC, "--claim", "Applied"]);
    expect(calibration()).toEqual({ confirmed: 1, refuted: 0 });
  });

  test("a refuted claim increments calibration.refuted and reports the diagnosis", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Claimed",
        lastPassAt: null,
        passes: 0,
      },
    });
    await seedEvidence(sb.dir, TOPIC, "quiz", "negative", 3);
    const out = (await runOk(sb.dir, [
      "recompute",
      "--topic",
      TOPIC,
      "--claim",
      "Applied",
    ])) as {
      claim: string;
      diagnoses: string[];
      level: string;
      previousLevel: string;
    };
    expect(out).toMatchObject({
      claim: "refuted",
      level: "Introduced",
      previousLevel: "Claimed",
    });
    expect(out.diagnoses).toContain("overclaim");
    expect(calibration()).toEqual({ confirmed: 0, refuted: 1 });
  });

  test("an unverified claim leaves calibration unchanged", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    await seedEvidence(sb.dir, TOPIC, "quiz", "positive", 1);
    const out = (await runOk(sb.dir, [
      "recompute",
      "--topic",
      TOPIC,
      "--claim",
      "Fluent",
    ])) as { claim: string };
    expect(out.claim).toBe("unverified");
    expect(calibration()).toEqual({ confirmed: 0, refuted: 0 });
  });

  test("an absent topic reports previousLevel Unseen", async () => {
    await seedConfirmingEvidence();
    const out = (await runOk(sb.dir, ["recompute", "--topic", TOPIC])) as {
      previousLevel: string;
    };
    expect(out.previousLevel).toBe("Unseen");
  });

  test("never lowers introduced", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    await runOk(sb.dir, ["recompute", "--topic", TOPIC]);
    expect(topicProfile(TOPIC)).toMatchObject({ introduced: true });
  });

  test("only the requested topic's events count", async () => {
    await seedProfile({
      [TOPIC]: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    });
    for (const channel of ["quiz", "explain-back", "observed"] as const) {
      await seedEvidence(sb.dir, "plan-mode", channel, "positive", 3);
    }
    const out = (await runOk(sb.dir, ["recompute", "--topic", TOPIC])) as {
      level: string;
    };
    expect(out.level).toBe("Introduced");
  });

  test("unknown topic -> exit 2", async () => {
    const result = await run(sb.dir, ["recompute", "--topic", "no-such-topic"]);
    expect(result.exitCode).toBe(2);
  });

  describe("catalog scoring overrides", () => {
    // 3 events per channel, 20 days old: default half-life (30d) stays at
    // Introduced; halfLifeDays=365 reaches Applied.
    async function seedOld(): Promise<void> {
      await seedProfile({
        [TOPIC]: {
          introduced: true,
          level: "Introduced",
          lastPassAt: null,
          passes: 0,
        },
      });
      for (const channel of ["quiz", "explain-back", "observed"] as const) {
        await seedEvidence(
          sb.dir,
          TOPIC,
          channel,
          "positive",
          3,
          NOW - 20 * DAY,
        );
      }
    }

    test("default scoring: old evidence stays at Introduced", async () => {
      await seedOld();
      const out = (await runOk(sb.dir, [
        "recompute",
        "--topic",
        TOPIC,
        "--claim",
        "Applied",
      ])) as { level: string };
      expect(out.level).toBe("Introduced");
    });

    test("catalog halfLifeDays is spread into reconcile", async () => {
      await seedOld();
      await saveCatalogFile(sb.dir, {
        ...EMPTY_CATALOG_FILE,
        scoring: { halfLifeDays: 365 },
      });
      const out = (await runOk(sb.dir, [
        "recompute",
        "--topic",
        TOPIC,
        "--claim",
        "Applied",
      ])) as {
        level: string;
        claim: string;
      };
      expect(out).toMatchObject({ level: "Applied", claim: "confirmed" });
    });
  });

  test("a user custom topic from catalog.json is recognised", async () => {
    const parsed = parseCatalog([
      {
        id: "my-topic",
        title: "Mine",
        type: "concept",
        dependencies: [],
        keywords: ["mine"],
        targetLevel: "Understood",
        enabled: true,
      },
    ]);
    if (!parsed.ok) throw new Error("custom topic fixture is invalid");
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: {}, custom: parsed.value },
    });
    const out = await runOk(sb.dir, ["introduce", "--topic", "my-topic"]);
    expect(out).toEqual({ topic: "my-topic", level: "Introduced" });
  });
});

describe("get-profile", () => {
  test("empty data dir yields the defaults", async () => {
    expect(await runOk(sb.dir, ["get-profile"])).toEqual({
      topics: [],
      calibration: { confirmed: 0, refuted: 0 },
      calibrationScore: 0.5,
      muted: false,
      mutedTopics: [],
      excludedProjects: [],
    });
  });

  test("merges profile and state; topics sorted by id; calibrationScore computed", async () => {
    await seedProfile(
      {
        "plan-mode": {
          introduced: true,
          level: "Applied",
          lastPassAt: null,
          passes: 0,
        },
        [TOPIC]: {
          introduced: true,
          level: "Recalled",
          lastPassAt: NOW - DAY,
          passes: 1,
        },
      },
      { confirmed: 3, refuted: 0 },
    );
    await runOk(sb.dir, ["set-mute", "on"]);
    await runOk(sb.dir, ["set-topic-mute", "on", "--topic", "plan-mode"]);
    await runOk(sb.dir, ["exclude-project", "add", "--path", "/work/a"]);
    const out = (await runOk(sb.dir, ["get-profile"])) as Record<
      string,
      unknown
    >;
    expect(out["topics"]).toEqual([
      {
        id: TOPIC,
        level: "Recalled",
        introduced: true,
        passes: 1,
        lastPassAt: NOW - DAY,
        reviewDue: false,
      },
      {
        id: "plan-mode",
        level: "Applied",
        introduced: true,
        passes: 0,
        lastPassAt: null,
        reviewDue: false,
      },
    ]);
    expect(out["calibration"]).toEqual({ confirmed: 3, refuted: 0 });
    expect(out["calibrationScore"]).toBeCloseTo(0.8, 10);
    expect(out["muted"]).toBe(true);
    expect(out["mutedTopics"]).toEqual(["plan-mode"]);
    expect(out["excludedProjects"]).toEqual(["/work/a"]);
  });

  // passes=1 -> review interval 3 days.
  test.each([
    ["exactly at the interval", NOW - 3 * DAY, true],
    ["one millisecond short", NOW - 3 * DAY + 1, false],
  ] as const)("reviewDue boundary: %s", async (_name, lastPassAt, due) => {
    await seedProfile({
      [TOPIC]: { introduced: true, level: "Recalled", lastPassAt, passes: 1 },
    });
    const out = (await runOk(sb.dir, ["get-profile"])) as {
      topics: { reviewDue: boolean }[];
    };
    expect(out.topics[0]?.reviewDue).toBe(due);
  });
});
