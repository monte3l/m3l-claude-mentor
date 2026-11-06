import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.js";
import { parseEvidence } from "../../src/internal/schema.js";
import {
  appendEvidence,
  saveCatalogFile,
  saveProfile,
} from "../../src/internal/store.js";
import { defaultProfile } from "../../src/internal/state-schema.js";
import { runCommand } from "../../src/cli/commands.js";
import {
  DAY,
  NOW,
  SESSION,
  makeSandbox,
  readJson,
  run,
  runOk,
  seedEvidence,
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
const profileJson = (): {
  calibration: unknown;
  topics: Record<string, unknown>;
} =>
  readJson(sb.dir, "profile.json") as {
    calibration: unknown;
    topics: Record<string, unknown>;
  };

describe("recompute calibration gating", () => {
  test("without --claim, confirming evidence plus a positive self-report leaves calibration untouched even though reconcile reports confirmed", async () => {
    await saveProfile(sb.dir, {
      ...defaultProfile(),
      topics: {
        [TOPIC]: {
          introduced: true,
          level: "Introduced",
          lastPassAt: null,
          passes: 0,
        },
      },
    });
    for (const channel of ["quiz", "explain-back", "observed"] as const) {
      await seedEvidence(sb.dir, TOPIC, channel, "positive", 2);
    }
    await seedEvidence(sb.dir, TOPIC, "self-report", "positive", 1);

    // reconcile itself reports the self-report as a confirmed claim ...
    const out = (await runOk(sb.dir, ["recompute", "--topic", TOPIC])) as {
      claim: string;
    };
    expect(out.claim).toBe("confirmed");
    // ... but without --claim the calibration must not move.
    expect(profileJson().calibration).toEqual({ confirmed: 0, refuted: 0 });
  });
});

describe("absent ctx.bundled", () => {
  test("falls back to an empty catalog: get-profile succeeds", async () => {
    const result = await runCommand(["get-profile"], {
      dir: sb.dir,
      now: NOW,
      session: SESSION,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ topics: [] });
  });

  test("falls back to an empty catalog: a bundled topic is unknown (usage, exit 2)", async () => {
    const result = await runCommand(["introduce", "--topic", TOPIC], {
      dir: sb.dir,
      now: NOW,
      session: SESSION,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^usage: /);
  });
});

describe("a user catalog that does not merge", () => {
  test("exits 1 with VALIDATION_FAILED and does not echo catalog content", async () => {
    const parsed = parseCatalog([
      {
        id: "plan-mode",
        title: "SECRET-TITLE-xyzzy",
        type: "concept",
        dependencies: [],
        keywords: ["xyzzy-keyword"],
        targetLevel: "Understood",
        enabled: true,
      },
    ]);
    if (!parsed.ok) throw new Error("custom topic fixture is invalid");
    // The custom id duplicates a bundled id, so it cannot merge.
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: {}, custom: parsed.value },
    });
    const result = await run(sb.dir, ["get-profile"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr.trimEnd()).not.toContain("\n");
    expect(result.stderr).not.toContain("SECRET-TITLE-xyzzy");
    expect(result.stderr).not.toContain("xyzzy-keyword");
    expect(result.stderr).not.toContain("plan-mode");
  });
});

describe("catalog scoring.fluencySessions", () => {
  // Concept topic: Fluent needs understand + recall satisfied, positive events
  // on the quiz and explain-back channels from at least `fluencySessions`
  // distinct sessions spanning at least one day. Evidence below: three
  // sessions over two days, so the default (3) yields Fluent.
  async function seedThreeSessions(): Promise<void> {
    const plan = [
      ["quiz", "sess-a", NOW],
      ["quiz", "sess-b", NOW - DAY],
      ["explain-back", "sess-b", NOW - DAY],
      ["explain-back", "sess-c", NOW - 2 * DAY],
      ["quiz", "sess-c", NOW - 2 * DAY],
      ["explain-back", "sess-a", NOW],
    ] as const;
    for (const [channel, session, at] of plan) {
      const parsed = parseEvidence({
        channel,
        topic: TOPIC,
        result: "positive",
        at,
        session,
      });
      if (!parsed.ok) throw new Error("evidence fixture is invalid");
      await appendEvidence(sb.dir, parsed.value);
    }
  }

  const levelOf = async (): Promise<string> =>
    (
      (await runOk(sb.dir, ["recompute", "--topic", TOPIC])) as {
        level: string;
      }
    ).level;

  test("the default (3 sessions) yields Fluent for three distinct sessions", async () => {
    await seedThreeSessions();
    expect(await levelOf()).toBe("Fluent");
  });

  test("an override of 4 stops the same evidence being Fluent", async () => {
    await seedThreeSessions();
    await saveCatalogFile(sb.dir, {
      ...EMPTY_CATALOG_FILE,
      scoring: { fluencySessions: 4 },
    });
    expect(await levelOf()).not.toBe("Fluent");
  });

  test("an override of 2 makes two sessions Fluent where the default does not", async () => {
    // Two sessions only: sess-a and sess-b.
    for (const [channel, session, at] of [
      ["quiz", "sess-a", NOW],
      ["explain-back", "sess-a", NOW],
      ["quiz", "sess-a", NOW],
      ["explain-back", "sess-a", NOW],
      ["quiz", "sess-b", NOW - 2 * DAY],
      ["explain-back", "sess-b", NOW - 2 * DAY],
      ["quiz", "sess-b", NOW - 2 * DAY],
      ["explain-back", "sess-b", NOW - 2 * DAY],
    ] as const) {
      const parsed = parseEvidence({
        channel,
        topic: TOPIC,
        result: "positive",
        at,
        session,
      });
      if (!parsed.ok) throw new Error("evidence fixture is invalid");
      await appendEvidence(sb.dir, parsed.value);
    }
    expect(await levelOf()).not.toBe("Fluent");
    await saveCatalogFile(sb.dir, {
      ...EMPTY_CATALOG_FILE,
      scoring: { fluencySessions: 2 },
    });
    expect(await levelOf()).toBe("Fluent");
  });
});

describe("record-pass on an absent topic", () => {
  test("creates an Unseen, not-introduced entry with passes 1 and lastPassAt now", async () => {
    const out = await runOk(sb.dir, [
      "record-pass",
      "--topic",
      TOPIC,
      "--result",
      "pass",
    ]);
    expect(out).toEqual({ topic: TOPIC, passes: 1 });
    expect(profileJson().topics[TOPIC]).toEqual({
      introduced: false,
      level: "Unseen",
      lastPassAt: NOW,
      passes: 1,
    });
  });
});
