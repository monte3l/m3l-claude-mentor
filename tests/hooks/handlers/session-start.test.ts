import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.js";
import { appendEvidence, saveGoals } from "../../../src/internal/store.js";
import { parseEvidence } from "../../../src/internal/schema.js";
import {
  BAD_SESSIONS,
  NOW,
  SESSION,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  settingsWith,
  snapshot,
  topicId,
  withSession,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function summary(
  extra: Record<string, unknown> = {},
  deps = makeDeps(sb.dir),
): Promise<string> {
  const out = await sessionStartHandler(payload(extra), deps);
  expect(out).not.toBeNull();
  expect(out?.hookSpecificOutput?.hookEventName).toBe("SessionStart");
  const text = out?.hookSpecificOutput?.additionalContext;
  expect(typeof text).toBe("string");
  return text ?? "";
}

function lines(text: string): string[] {
  return text.split("\n");
}

describe("sessionStartHandler summary", () => {
  test("header says session start for startup, resume, clear and unknown sources", async () => {
    for (const source of [
      "startup",
      "resume",
      "clear",
      "fork",
      "weird",
      7,
      undefined,
    ]) {
      const text = await summary(source === undefined ? {} : { source });
      expect(lines(text)[0]).toBe(
        "m3l-claude-mentor learner state (session start)",
      );
    }
  });

  test("header says restored after compaction for source compact", async () => {
    const text = await summary({ source: "compact" });
    expect(lines(text)[0]).toBe(
      "m3l-claude-mentor learner state (restored after compaction)",
    );
  });

  test("mentions the dial and ends with the profile pointer", async () => {
    const text = await summary(
      {},
      makeDeps(sb.dir, { settings: settingsWith({ dial: 4 }) }),
    );
    expect(lines(text).some((l) => /dial/i.test(l) && l.includes("4"))).toBe(
      true,
    );
    expect(lines(text).at(-1)).toBe(
      "Use /m3l-claude-mentor:profile to see or change settings.",
    );
    expect(text.length).toBeLessThanOrEqual(2_000);
  });

  test("lists at most 8 below-target topics with level and target", async () => {
    const text = await summary();
    const rows = lines(text).filter((l) => l.includes(" (target "));
    expect(rows).toHaveLength(8);
    expect(rows).toContain("context-window: Unseen (target Understood)");
  });

  test("touched topics come before Unseen ones", async () => {
    await seedProfile(sb.dir, {
      skills: { introduced: true, level: "Introduced" },
      hooks: { level: "Recalled" },
    });
    const rows = lines(await summary()).filter((l) => l.includes(" (target "));
    expect(rows).toContain("skills: Introduced (target Applied)");
    expect(rows).toContain("hooks: Recalled (target Applied)");
    const firstUnseen = rows.findIndex((l) => l.includes(": Unseen "));
    expect(rows.indexOf("skills: Introduced (target Applied)")).toBeLessThan(
      firstUnseen,
    );
    expect(rows.indexOf("hooks: Recalled (target Applied)")).toBeLessThan(
      firstUnseen,
    );
  });

  test("an introduced topic with level Unseen counts as touched", async () => {
    await seedProfile(sb.dir, {
      plugins: { introduced: true, level: "Unseen" },
    });
    const rows = lines(await summary()).filter((l) => l.includes(" (target "));
    expect(rows).toContain("plugins: Unseen (target Applied)");
  });

  test("omits topics at or above target and individually muted topics", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": { introduced: true, level: "Applied" },
      skills: { introduced: true, level: "Introduced" },
    });
    await seedState(sb.dir, { mutedTopics: [topicId("skills")] });
    const rows = lines(await summary());
    expect(rows.some((l) => l.startsWith("plan-mode:"))).toBe(false);
    expect(rows.some((l) => l.startsWith("skills:"))).toBe(false);
  });

  test("lists at most 5 due reviews and omits muted or not-due ones", async () => {
    const ids = [
      "skills",
      "hooks",
      "plugins",
      "mcp",
      "claude-md",
      "slash-commands",
      "subagents",
    ];
    const topics: Record<
      string,
      {
        introduced: boolean;
        level: "Applied";
        lastPassAt: number;
        passes: number;
      }
    > = {};
    for (const id of ids) {
      topics[id] = {
        introduced: true,
        level: "Applied",
        lastPassAt: 0,
        passes: 1,
      };
    }
    topics["worktrees"] = {
      introduced: true,
      level: "Applied",
      lastPassAt: NOW,
      passes: 0,
    };
    await seedProfile(sb.dir, topics);
    const rows = lines(await summary()).filter((l) =>
      l.startsWith("review due: "),
    );
    expect(rows).toHaveLength(5);
    expect(
      rows.every((l) => ids.includes(l.slice("review due: ".length))),
    ).toBe(true);
  });

  test("a due topic is listed and a muted due topic is not", async () => {
    await seedProfile(sb.dir, {
      skills: {
        introduced: true,
        level: "Applied",
        lastPassAt: 0,
        passes: 1,
      },
      hooks: {
        introduced: true,
        level: "Applied",
        lastPassAt: 0,
        passes: 1,
      },
      mcp: { introduced: true, level: "Applied", lastPassAt: NOW, passes: 0 },
    });
    await seedState(sb.dir, { mutedTopics: [topicId("hooks")] });
    const rows = lines(await summary());
    expect(rows).toContain("review due: skills");
    expect(rows).not.toContain("review due: hooks");
    expect(rows).not.toContain("review due: mcp");
  });

  test("includes goals after a goals: line, cut to 400 chars", async () => {
    await saveGoals(sb.dir, `${"g".repeat(1_000)}`);
    const text = await summary();
    const rows = lines(text);
    const at = rows.indexOf("goals:");
    expect(at).toBeGreaterThanOrEqual(0);
    const goalText = rows.slice(at + 1).join("\n");
    expect(goalText).toContain("g".repeat(400));
    expect(goalText).not.toContain("g".repeat(401));
    expect(text.length).toBeLessThanOrEqual(2_000);
  });

  test("omits the goals section when goals are empty or absent", async () => {
    expect(lines(await summary())).not.toContain("goals:");
    await saveGoals(sb.dir, "");
    expect(lines(await summary())).not.toContain("goals:");
  });

  test("never includes evidence content", async () => {
    const e = parseEvidence({
      channel: "observed",
      topic: "skills",
      result: "positive",
      at: NOW,
      session: "secret-session-xyz",
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
    const text = await summary();
    expect(text).not.toContain("secret-session-xyz");
    expect(text).not.toContain("observed");
  });

  test("writes nothing, not even the data directory", async () => {
    await summary();
    expect(existsSync(sb.dir)).toBe(false);
    await seedState(sb.dir);
    await seedProfile(sb.dir, { skills: { level: "Recalled" } });
    const before = snapshot(sb.dir);
    await summary({ source: "compact" });
    expect(snapshot(sb.dir)).toEqual(before);
  });
});

describe("sessionStartHandler silence", () => {
  test("returns null when globally muted", async () => {
    await seedState(sb.dir, { muted: true });
    expect(await sessionStartHandler(payload(), makeDeps(sb.dir))).toBeNull();
  });

  test("returns null when the dial is 0", async () => {
    const deps = makeDeps(sb.dir, { settings: settingsWith({ dial: 0 }) });
    expect(await sessionStartHandler(payload(), deps)).toBeNull();
  });

  test.each(BAD_SESSIONS)(
    "returns null for a %s session id",
    async (_n, value) => {
      expect(
        await sessionStartHandler(withSession(value), makeDeps(sb.dir)),
      ).toBeNull();
    },
  );

  test("a valid session id is accepted", async () => {
    const out = await sessionStartHandler(
      { session_id: SESSION },
      makeDeps(sb.dir),
    );
    expect(out).not.toBeNull();
  });
});
