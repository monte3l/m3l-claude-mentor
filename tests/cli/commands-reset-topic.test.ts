import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.ts";
import { saveProfile } from "../../src/internal/store.ts";
import {
  DAY,
  NOW,
  makeSandbox,
  put,
  readJson,
  run,
  runOk,
  seedEvidence,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const TOPIC = "plan-mode";
const OTHER = "context-window";

const seedProfile = (topics: Profile["topics"]): Promise<void> =>
  saveProfile(sb.dir, { ...defaultProfile(), topics });

const stored = (id: string): unknown =>
  (readJson(sb.dir, "profile.json") as { topics: Record<string, unknown> })
    .topics[id];

const evidenceText = (): string => {
  try {
    return readFileSync(join(sb.dir, "evidence.jsonl"), "utf8");
  } catch {
    return "";
  }
};

const APPLIED = {
  introduced: true,
  level: "Applied",
  lastPassAt: NOW - 3 * DAY,
  passes: 4,
} as const;

describe("reset-topic", () => {
  test("resets an Applied topic to Introduced and snapshots the old values", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    const out = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(out).toEqual({
      topic: TOPIC,
      level: "Introduced",
      previousLevel: "Applied",
      reset: true,
    });
    expect(stored(TOPIC)).toEqual({
      introduced: true,
      level: "Introduced",
      lastPassAt: null,
      passes: 0,
      resetAt: NOW,
      resetFrom: {
        level: "Applied",
        passes: 4,
        lastPassAt: NOW - 3 * DAY,
        introduced: true,
      },
    });
  });

  test("snapshots introduced:false, sets introduced:true, and undo restores false", async () => {
    const seed = {
      introduced: false,
      level: "Applied",
      lastPassAt: NOW - 3 * DAY,
      passes: 4,
    } as const;
    await seedProfile({ [TOPIC]: seed });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(stored(TOPIC)).toMatchObject({
      introduced: true,
      level: "Introduced",
      resetFrom: { introduced: false },
    });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC, "--undo"]);
    expect(stored(TOPIC)).toEqual(seed);
  });

  test("leaves other topics alone", async () => {
    await seedProfile({
      [TOPIC]: APPLIED,
      [OTHER]: { ...APPLIED, level: "Recalled" },
    });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(stored(OTHER)).toEqual({ ...APPLIED, level: "Recalled" });
  });

  test("writes no evidence and does not touch existing evidence", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await seedEvidence(sb.dir, TOPIC, "quiz", "positive", 2, NOW - 5 * DAY);
    const before = evidenceText();
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(evidenceText()).toBe(before);
  });

  test("an absent topic is a no-op and creates no profile entry", async () => {
    const out = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(out).toEqual({ topic: TOPIC, level: "Unseen", reset: false });
    expect(existsSync(join(sb.dir, "profile.json"))).toBe(false);
  });

  test.each(["Unseen", "Introduced"] as const)(
    "a topic at %s (not above Introduced) is a no-op",
    async (level) => {
      const entry = { introduced: false, level, lastPassAt: null, passes: 0 };
      await seedProfile({ [TOPIC]: entry });
      const out = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
      expect(out).toEqual({ topic: TOPIC, level, reset: false });
      expect(stored(TOPIC)).toEqual(entry);
    },
  );

  test("a topic at Claimed ranks above Introduced, so it is reset and undo restores it", async () => {
    const entry = {
      introduced: true,
      level: "Claimed",
      lastPassAt: null,
      passes: 0,
    } as const;
    await seedProfile({ [TOPIC]: entry });
    const out = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    expect(out).toMatchObject({
      topic: TOPIC,
      level: "Introduced",
      previousLevel: "Claimed",
      reset: true,
    });
    const undone = await runOk(sb.dir, [
      "reset-topic",
      "--topic",
      TOPIC,
      "--undo",
    ]);
    expect(undone).toEqual({ topic: TOPIC, level: "Claimed", restored: true });
    expect(stored(TOPIC)).toEqual(entry);
  });

  test("reset, raise above Introduced from new evidence, reset again keeps the ORIGINAL resetFrom", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 3, NOW + DAY);
    await runOk(sb.dir, ["recompute", "--topic", TOPIC], { now: NOW + DAY });
    expect((stored(TOPIC) as { level: string }).level).not.toBe("Introduced");
    const again = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC], {
      now: NOW + 2 * DAY,
    });
    expect(again).toMatchObject({ topic: TOPIC, reset: true });
    expect(stored(TOPIC)).toMatchObject({
      level: "Introduced",
      resetAt: NOW + 2 * DAY,
      resetFrom: {
        level: "Applied",
        passes: 4,
        lastPassAt: NOW - 3 * DAY,
        introduced: true,
      },
    });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC, "--undo"]);
    expect(stored(TOPIC)).toEqual(APPLIED);
  });

  test("a repeat reset keeps the ORIGINAL resetFrom and reports reset:false", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    const first = stored(TOPIC);
    const again = await runOk(sb.dir, ["reset-topic", "--topic", TOPIC], {
      now: NOW + DAY,
    });
    expect(again).toEqual({
      topic: TOPIC,
      level: "Introduced",
      reset: false,
    });
    expect(stored(TOPIC)).toEqual(first);
  });

  test("an unknown topic is a usage error (exit 2) and writes nothing", async () => {
    const result = await run(sb.dir, ["reset-topic", "--topic", "no-such"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^usage: /);
  });

  test("a missing --topic is a usage error", async () => {
    const result = await run(sb.dir, ["reset-topic"]);
    expect(result.exitCode).toBe(2);
  });

  test("a malformed topic id is a usage error", async () => {
    const result = await run(sb.dir, ["reset-topic", "--topic", "Bad Id"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("reset-topic with recompute", () => {
  test("recompute keeps Introduced from old evidence", async () => {
    await seedProfile({ [TOPIC]: { ...APPLIED, level: "Recalled" } });
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 3, NOW - 5 * DAY);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(sb.dir, ["recompute", "--topic", TOPIC]);
    expect((stored(TOPIC) as { level: string }).level).toBe("Introduced");
  });

  test("recompute raises again from evidence recorded after the reset", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 3, NOW - 5 * DAY);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 2, NOW + DAY);
    await runOk(sb.dir, ["recompute", "--topic", TOPIC], { now: NOW + DAY });
    const t = stored(TOPIC) as { level: string; resetAt: number };
    expect(t.level).toBe("Applied");
    expect(t.resetAt).toBe(NOW);
  });

  test("record-batch after a reset counts only post-reset evidence", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 3, NOW - 5 * DAY);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(
      sb.dir,
      ["record-batch", "--topic", TOPIC, "--events", "quiz:positive"],
      { now: NOW + DAY },
    );
    expect((stored(TOPIC) as { level: string }).level).toBe("Introduced");
  });
});

describe("reset-topic --undo", () => {
  test("restores the exact prior level, passes and lastPassAt", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    const out = await runOk(sb.dir, [
      "reset-topic",
      "--topic",
      TOPIC,
      "--undo",
    ]);
    expect(out).toEqual({ topic: TOPIC, level: "Applied", restored: true });
    expect(stored(TOPIC)).toEqual(APPLIED);
    expect(Object.hasOwn(stored(TOPIC) as object, "resetAt")).toBe(false);
    expect(Object.hasOwn(stored(TOPIC) as object, "resetFrom")).toBe(false);
  });

  test("restores a null lastPassAt", async () => {
    const entry = { ...APPLIED, lastPassAt: null, passes: 0 };
    await seedProfile({ [TOPIC]: entry });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC, "--undo"]);
    expect(stored(TOPIC)).toEqual(entry);
  });

  test("without a prior reset it is a no-op with restored:false", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    const out = await runOk(sb.dir, [
      "reset-topic",
      "--topic",
      TOPIC,
      "--undo",
    ]);
    expect(out).toMatchObject({ topic: TOPIC, restored: false });
    expect(stored(TOPIC)).toEqual(APPLIED);
  });

  test("an absent topic is a no-op with restored:false", async () => {
    const out = await runOk(sb.dir, [
      "reset-topic",
      "--topic",
      TOPIC,
      "--undo",
    ]);
    expect(out).toMatchObject({ topic: TOPIC, restored: false });
    expect(existsSync(join(sb.dir, "profile.json"))).toBe(false);
  });

  test("an entry with resetAt but no resetFrom fails validation and is left untouched", async () => {
    // saveProfile refuses this shape, so write the file directly.
    const text = JSON.stringify({
      ...defaultProfile(),
      topics: {
        [TOPIC]: {
          introduced: true,
          level: "Introduced",
          lastPassAt: null,
          passes: 0,
          resetAt: NOW,
        },
      },
    });
    put(sb.dir, "profile.json", text);
    const result = await run(sb.dir, [
      "reset-topic",
      "--topic",
      TOPIC,
      "--undo",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(readFileSync(join(sb.dir, "profile.json"), "utf8")).toBe(text);
  });

  test("after a repeat reset, undo restores the original snapshot", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC, "--undo"]);
    expect(stored(TOPIC)).toEqual(APPLIED);
  });

  test("after post-reset progress above Introduced, undo restores the pre-reset snapshot and leaves evidence bytes unchanged", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await seedEvidence(sb.dir, TOPIC, "quiz", "positive", 2, NOW - 5 * DAY);
    const before = evidenceText();
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await seedEvidence(sb.dir, TOPIC, "observed", "positive", 3, NOW + DAY);
    await runOk(sb.dir, ["recompute", "--topic", TOPIC], { now: NOW + DAY });
    expect((stored(TOPIC) as { level: string }).level).not.toBe("Introduced");
    const afterProgress = evidenceText();
    const out = await runOk(
      sb.dir,
      ["reset-topic", "--topic", TOPIC, "--undo"],
      { now: NOW + 2 * DAY },
    );
    expect(out).toEqual({ topic: TOPIC, level: "Applied", restored: true });
    expect(stored(TOPIC)).toEqual(APPLIED);
    expect(Object.hasOwn(stored(TOPIC) as object, "resetAt")).toBe(false);
    expect(Object.hasOwn(stored(TOPIC) as object, "resetFrom")).toBe(false);
    expect(evidenceText()).toBe(afterProgress);
    expect(afterProgress.startsWith(before)).toBe(true);
  });

  test("never modifies the evidence log", async () => {
    await seedProfile({ [TOPIC]: APPLIED });
    await seedEvidence(sb.dir, TOPIC, "quiz", "positive", 2, NOW - 5 * DAY);
    const before = evidenceText();
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC]);
    await runOk(sb.dir, ["reset-topic", "--topic", TOPIC, "--undo"]);
    expect(evidenceText()).toBe(before);
  });

  test("an unknown topic is a usage error", async () => {
    const result = await run(sb.dir, [
      "reset-topic",
      "--topic",
      "no-such",
      "--undo",
    ]);
    expect(result.exitCode).toBe(2);
  });
});
