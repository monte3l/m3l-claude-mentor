import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userPromptSubmitHandler } from "../../../src/hooks/handlers/user-prompt-submit.js";
import { newSegment } from "../../../src/internal/segment.js";
import {
  BAD_SESSIONS,
  DAY,
  NOW,
  loadStateAt,
  makeDeps,
  makeSandbox,
  payload,
  seedState,
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

const MUTED_NOTICE =
  'Mentor tips muted. Say "resume tips" to turn them back on.';

describe("userPromptSubmitHandler persistent signals", () => {
  test("stop tips mutes globally, persists, and notifies the user", async () => {
    const out = await userPromptSubmitHandler(
      payload({ prompt: "please stop tips" }),
      makeDeps(sb.dir),
    );
    expect(out?.systemMessage).toBe(MUTED_NOTICE);
    expect(out?.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(out?.hookSpecificOutput?.additionalContext ?? "").not.toContain(
      "Mentor tip due",
    );
    expect((await loadStateAt(sb.dir)).muted).toBe(true);
  });

  test("resume tips unmutes, persists, and notifies the user", async () => {
    await seedState(sb.dir, { muted: true });
    const out = await userPromptSubmitHandler(
      payload({ prompt: "resume tips" }),
      makeDeps(sb.dir),
    );
    expect(out?.systemMessage).toBe("Mentor tips resumed.");
    expect((await loadStateAt(sb.dir)).muted).toBe(false);
  });

  test("stop tips about a topic mutes that topic with a titled notice", async () => {
    const out = await userPromptSubmitHandler(
      payload({ prompt: "stop tips about plan mode" }),
      makeDeps(sb.dir),
    );
    expect(out?.systemMessage).toBe("Mentor tips muted for Plan mode.");
    const state = await loadStateAt(sb.dir);
    expect(state.mutedTopics).toEqual(["plan-mode"]);
    expect(state.muted).toBe(false);
    expect(out?.hookSpecificOutput?.additionalContext ?? "").not.toContain(
      "Mentor tip due",
    );
  });

  test("muting an already muted topic does not duplicate it", async () => {
    await seedState(sb.dir, { mutedTopics: [topicId("plan-mode")] });
    await userPromptSubmitHandler(
      payload({ prompt: "stop tips about plan mode" }),
      makeDeps(sb.dir),
    );
    expect((await loadStateAt(sb.dir)).mutedTopics).toEqual(["plan-mode"]);
  });

  test("the topic mute list stops growing at 500 entries", async () => {
    const full = Array.from({ length: 500 }, (_, i) =>
      topicId(`t-${String(i)}`),
    );
    await seedState(sb.dir, { mutedTopics: full });
    await userPromptSubmitHandler(
      payload({ prompt: "stop tips about plan mode" }),
      makeDeps(sb.dir),
    );
    const state = await loadStateAt(sb.dir);
    expect(state.mutedTopics).toHaveLength(500);
    expect(state.mutedTopics).not.toContain("plan-mode");
  });
});

describe("userPromptSubmitHandler silence and no-ops", () => {
  test("is silent when muted and no notice applies", async () => {
    await seedState(sb.dir, { muted: true });
    const out = await userPromptSubmitHandler(
      payload({ prompt: "How do I use plan mode?" }),
      makeDeps(sb.dir),
    );
    expect(out).toBeNull();
  });

  test("returns null when there is no topic, signal or notice", async () => {
    const out = await userPromptSubmitHandler(
      payload({ prompt: "hello there" }),
      makeDeps(sb.dir),
    );
    expect(out).toBeNull();
  });

  test.each([
    ["a number", 123],
    ["null", null],
    ["an object", { text: "plan mode" }],
    ["missing", undefined],
  ])(
    "returns null and writes nothing when prompt is %s",
    async (_n, prompt) => {
      const extra = prompt === undefined ? {} : { prompt };
      expect(
        await userPromptSubmitHandler(payload(extra), makeDeps(sb.dir)),
      ).toBeNull();
      expect(existsSync(sb.dir)).toBe(false);
    },
  );

  test.each(BAD_SESSIONS)(
    "returns null for a %s session id",
    async (_n, value) => {
      const out = await userPromptSubmitHandler(
        withSession(value, { prompt: "How do I use plan mode?" }),
        makeDeps(sb.dir),
      );
      expect(out).toBeNull();
      expect(existsSync(sb.dir)).toBe(false);
    },
  );

  test("leaves state.json untouched on disk when nothing changed", async () => {
    const segment = {
      ...newSegment(NOW),
      lastTopic: topicId("plan-mode"),
    };
    await seedState(sb.dir, { muted: true, segment });
    const file = join(sb.dir, "state.json");
    const old = new Date(1_000_000_000_000);
    utimesSync(file, old, old);
    const bytes = readFileSync(file, "utf8");

    const out = await userPromptSubmitHandler(
      payload({ prompt: "How do I use plan mode?" }),
      makeDeps(sb.dir),
    );
    expect(out).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(statSync(file).mtimeMs).toBe(old.getTime());
  });
});

describe("userPromptSubmitHandler segments", () => {
  test("an idle gap starts a new segment persisted with the activity time", async () => {
    const before = { ...newSegment(NOW - 2 * 3_600_000), segmentId: 4 };
    await seedState(sb.dir, { muted: true, segment: before });
    await userPromptSubmitHandler(
      payload({ prompt: "hello there" }),
      makeDeps(sb.dir),
    );
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.segmentId).toBe(5);
    expect(seg.startedAt).toBe(NOW);
    expect(seg.lastActivityAt).toBe(NOW);
  });

  test("a topic change starts a new segment and records the topic", async () => {
    const before = {
      ...newSegment(NOW - 1_000),
      segmentId: 2,
      lastTopic: topicId("skills"),
    };
    await seedState(sb.dir, { muted: true, segment: before });
    await userPromptSubmitHandler(
      payload({ prompt: "How do I use plan mode?" }),
      makeDeps(sb.dir),
    );
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.segmentId).toBe(3);
    expect(seg.lastTopic).toBe("plan-mode");
  });

  test("activity in the same topic keeps the segment and bumps activity", async () => {
    const before = {
      ...newSegment(NOW - 1_000),
      segmentId: 2,
      lastTopic: topicId("plan-mode"),
    };
    await seedState(sb.dir, { muted: true, segment: before });
    await userPromptSubmitHandler(
      payload({ prompt: "How do I use plan mode?" }),
      makeDeps(sb.dir),
    );
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.segmentId).toBe(2);
    expect(seg.lastActivityAt).toBe(NOW);
  });

  test("a new segment resets the one-tip quota", async () => {
    const before = {
      ...newSegment(NOW - 10 * DAY),
      tipsEmitted: 1,
      lastTipAt: NOW - 10 * DAY,
    };
    await seedState(sb.dir, { segment: before });
    const out = await userPromptSubmitHandler(
      payload({ prompt: "How do I use plan mode?" }),
      makeDeps(sb.dir),
    );
    expect(out?.hookSpecificOutput?.additionalContext).toContain(
      'Mentor tip due on "Plan mode" (plan-mode).',
    );
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.tipsEmitted).toBe(1);
    expect(seg.lastTipAt).toBe(NOW);
  });
});
