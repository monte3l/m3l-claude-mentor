import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runHookCore } from "../../../src/hooks/runtime.ts";
import {
  saveProfile,
  appendEvidence,
  loadProfile,
} from "../../../src/internal/store.ts";
import { defaultProfile } from "../../../src/internal/state-schema.ts";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { parseEvidence, type Channel } from "../../../src/internal/schema.ts";
import {
  NOW,
  SESSION,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  settingsWith,
  type Sandbox,
} from "./helpers.ts";
import {
  fakeLock,
  lockFiles,
  noWaitLock,
  releasingLock,
  runWithLock,
  seedForeignLock,
} from "./lock-helpers.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = makeSandbox();
  await seedState(sb.dir);
});
afterEach(() => {
  sb.cleanup();
});

async function add(
  topic: string,
  channel: Channel,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const e = parseEvidence({
      channel,
      topic,
      result: "positive",
      at: NOW,
      session: SESSION,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
  }
}

const profileBytes = (): string =>
  readFileSync(join(sb.dir, "profile.json"), "utf8");
const rows = (text: string | undefined): string[] => (text ?? "").split("\n");

describe("SessionStart is optimistic: it locks only when the profile would change", () => {
  test("(a) nothing to change: a held foreign lock is never waited on, no note", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    // Settle the profile once, without any lock, so the next run changes nothing.
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    seedForeignLock(sb.dir);
    const result = await runWithLock(
      "SessionStart",
      sessionStartHandler,
      payload(),
      sb.dir,
      noWaitLock(),
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("m3l-claude-mentor learner state");
  });

  test("(a2) no evidence at all: same, no wait and no note", async () => {
    seedForeignLock(sb.dir);
    const result = await runWithLock(
      "SessionStart",
      sessionStartHandler,
      payload(),
      sb.dir,
      noWaitLock(),
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("m3l-claude-mentor learner state");
  });

  test("(b) levels would change but the lock times out: context from the stored profile, one note, profile untouched", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    seedForeignLock(sb.dir);
    const before = profileBytes();
    const { lock, sleeps } = fakeLock();
    const result = await runWithLock(
      "SessionStart",
      sessionStartHandler,
      payload(),
      sb.dir,
      lock,
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /^m3l-claude-mentor: SessionStart: .*LOCK_TIMEOUT.*\n$/,
    );
    const context = (
      JSON.parse(result.stdout) as {
        hookSpecificOutput: { additionalContext: string };
      }
    ).hookSpecificOutput.additionalContext;
    // The unrefreshed profile still has claude-md below target.
    expect(rows(context).some((l) => l.startsWith("claude-md:"))).toBe(true);
    expect(profileBytes()).toBe(before);
  });

  test("(b2) the handler itself returns the context plus a note", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    seedForeignLock(sb.dir);
    const { lock } = fakeLock();
    const out = await sessionStartHandler(
      payload(),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.hookSpecificOutput?.additionalContext).toContain(
      "m3l-claude-mentor learner state",
    );
    expect(out?.note).toMatch(/LOCK_TIMEOUT/);
  });

  test("(c) changes and no lock: the profile is saved and no lock file remains", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    const { lock } = fakeLock();
    const out = await sessionStartHandler(
      payload(),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.note).toBeUndefined();
    expect((await loadProfile(sb.dir, NOW)).topics["claude-md"]?.level).toBe(
      "Applied",
    );
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});

describe("SessionStart silent paths still report the lock timeout", () => {
  test.each([
    ["dial 0", settingsWith({ dial: 0 }), false],
    ["muted", settingsWith({}), true],
  ])(
    "%s: stdout empty and exactly one LOCK_TIMEOUT stderr line",
    async (_n, settings, muted) => {
      await seedState(sb.dir, { muted });
      await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
      await add("claude-md", "observed", 2);
      seedForeignLock(sb.dir);
      const { lock } = fakeLock();
      const result = await runHookCore(
        "SessionStart",
        {
          stdinText: JSON.stringify(payload()),
          env: { CLAUDE_PLUGIN_DATA: sb.dir },
          now: NOW,
        },
        (p, d) => sessionStartHandler(p, { ...d, settings, lockOptions: lock }),
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /^m3l-claude-mentor: SessionStart: .*LOCK_TIMEOUT.*\n$/,
      );
    },
  );
});

describe("SessionStart recomputes from the profile read INSIDE the lock", () => {
  test("a competitor's raise of another topic survives our save", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    seedForeignLock(sb.dir);
    const { lock } = releasingLock(sb.dir, async () => {
      // The competitor raised a topic we have no evidence for.
      await saveProfile(sb.dir, {
        ...defaultProfile(),
        topics: {
          "claude-md": {
            introduced: false,
            level: "Unseen",
            lastPassAt: null,
            passes: 0,
          },
          "plan-mode": {
            introduced: true,
            level: "Applied",
            lastPassAt: null,
            passes: 0,
          },
        },
      });
    });
    await sessionStartHandler(
      payload(),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    const saved = await loadProfile(sb.dir, NOW);
    expect(saved.topics["plan-mode"]?.level).toBe("Applied");
    expect(saved.topics["claude-md"]?.level).toBe("Applied");
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});
