import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import {
  DATA_DIR_PREFIX,
  LEGACY_DATA_DIR_PREFIX,
  MIGRATION_MARKER,
} from "../../../src/internal/legacy-data.ts";
import {
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  topicId,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
let legacy = "";
let current = "";
beforeEach(() => {
  sb = makeSandbox();
  legacy = join(sb.root, `${LEGACY_DATA_DIR_PREFIX}monte3l`);
  current = join(sb.root, `${DATA_DIR_PREFIX}monte3l`);
});
afterEach(() => {
  sb.cleanup();
});

describe("SessionStart carries the learner's data over from the former name", () => {
  test("the first session after the rename sees the old learner state", async () => {
    mkdirSync(legacy, { recursive: true });
    await seedProfile(legacy, {
      hooks: { introduced: true, level: "Applied" },
    });
    await seedState(legacy, { mutedTopics: [topicId("plan-mode")] });

    const out = await sessionStartHandler(payload(), makeDeps(current));

    expect(out?.note).toBeUndefined();
    expect(existsSync(join(current, "profile.json"))).toBe(true);
    expect(existsSync(join(current, "state.json"))).toBe(true);
    expect(existsSync(join(current, MIGRATION_MARKER))).toBe(true);
    const profile = JSON.parse(
      readFileSync(join(current, "profile.json"), "utf8"),
    ) as { topics: Record<string, { level: string }> };
    expect(profile.topics["hooks"]?.level).toBe("Applied");
    // The summary is built from the carried state: hooks is Applied, so it is
    // no longer listed as Unseen.
    expect(out?.hookSpecificOutput?.additionalContext).toContain(
      "m3l-mentor learner state",
    );
    expect(out?.hookSpecificOutput?.additionalContext).not.toContain(
      "hooks: Unseen",
    );
  });

  test("a directory that is not named after the plugin is left alone", async () => {
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(out?.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(existsSync(join(sb.dir, MIGRATION_MARKER))).toBe(false);
  });

  test("with no old directory nothing is created for the carry-over", async () => {
    await sessionStartHandler(payload(), makeDeps(current));
    expect(existsSync(join(current, MIGRATION_MARKER))).toBe(false);
  });

  test("a failed carry-over never stops the session: it adds a fixed-text note", async () => {
    mkdirSync(legacy, { recursive: true });
    await seedProfile(legacy, {
      hooks: { introduced: true, level: "Applied" },
    });
    const blocked = join(legacy, "profile.json");
    chmodSync(blocked, 0o000);
    try {
      const out = await sessionStartHandler(payload(), makeDeps(current));
      expect(out?.hookSpecificOutput?.additionalContext).toContain(
        "m3l-mentor learner state",
      );
      expect(out?.note).toMatch(/^WRITE_FAILED: /);
      expect(out?.note).not.toContain(sb.root);
      expect(existsSync(join(current, MIGRATION_MARKER))).toBe(false);
    } finally {
      chmodSync(blocked, 0o600);
    }
    const again = await sessionStartHandler(payload(), makeDeps(current));
    expect(again?.note).toBeUndefined();
    expect(existsSync(join(current, MIGRATION_MARKER))).toBe(true);
  });

  test("a muted or dial-0 learner still gets the carry-over, and the note when it fails", async () => {
    mkdirSync(legacy, { recursive: true });
    await seedProfile(legacy, {
      hooks: { introduced: true, level: "Applied" },
    });
    const blocked = join(legacy, "profile.json");
    chmodSync(blocked, 0o000);
    try {
      const out = await sessionStartHandler(
        payload(),
        makeDeps(current, { settings: { dial: 0, transcriptAnalysis: true } }),
      );
      expect(out?.hookSpecificOutput).toBeUndefined();
      expect(out?.note).toMatch(/^WRITE_FAILED: /);
    } finally {
      chmodSync(blocked, 0o600);
    }
  });
});
