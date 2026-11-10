import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { postCompactHandler } from "../../../src/hooks/handlers/post-compact.js";
import { userPromptSubmitHandler } from "../../../src/hooks/handlers/user-prompt-submit.js";
import { stopHandler } from "../../../src/hooks/handlers/stop.js";
import { loadState } from "../../../src/internal/store.js";
import { newSegment } from "../../../src/internal/segment.js";
import {
  BAD_SESSIONS,
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

const IDLE = 40 * 60_000;

describe.each([
  ["stopHandler", stopHandler],
  ["postCompactHandler", postCompactHandler],
])("%s touches activity only", (_name, handler) => {
  const idleSeed = () => ({
    ...newSegment(NOW - IDLE),
    segmentId: 3,
    tipsEmitted: 1,
    lastTipAt: NOW - IDLE + 1_000,
    lastTopic: topicId("plan-mode"),
  });

  test("after a 40-minute idle gap keeps the segment and only moves lastActivityAt", async () => {
    const before = idleSeed();
    await seedState(sb.dir, { segment: before });
    expect(await handler(payload(), makeDeps(sb.dir))).toBeNull();
    expect((await loadStateAt(sb.dir)).segment).toEqual({
      ...before,
      lastActivityAt: NOW,
    });
  });

  test("a second call at the same instant changes nothing", async () => {
    await seedState(sb.dir, { segment: idleSeed() });
    await handler(payload(), makeDeps(sb.dir));
    const once = (await loadStateAt(sb.dir)).segment;
    await handler(payload(), makeDeps(sb.dir));
    expect((await loadStateAt(sb.dir)).segment).toEqual(once);
  });

  test("the next prompt shortly after still has no fresh tip quota", async () => {
    await seedState(sb.dir, { segment: idleSeed() });
    await handler(payload(), makeDeps(sb.dir));
    const out = await userPromptSubmitHandler(
      payload({ prompt: "how do I use plan mode" }),
      makeDeps(sb.dir, { now: NOW + 1_000 }),
    );
    expect(out?.hookSpecificOutput?.additionalContext ?? "").not.toContain(
      "Mentor tip due",
    );
    const seg = (await loadState(sb.dir, NOW + 1_000)).segment;
    expect(seg.segmentId).toBe(3);
    expect(seg.tipsEmitted).toBe(1);
  });
});

describe("stopHandler", () => {
  test("counts as activity: same segment, quota and topic kept", async () => {
    const before = {
      ...newSegment(NOW - 5_000),
      segmentId: 3,
      tipsEmitted: 1,
      lastTipAt: NOW - 4_000,
      lastTopic: topicId("plan-mode"),
    };
    await seedState(sb.dir, { segment: before });
    const out = await stopHandler(payload(), makeDeps(sb.dir));
    expect(out).toBeNull();
    expect((await loadStateAt(sb.dir)).segment).toEqual({
      ...before,
      lastActivityAt: NOW,
    });
  });

  test("two consecutive Stops 1s apart keep segmentId and tipsEmitted", async () => {
    const before = {
      ...newSegment(NOW - 5_000),
      segmentId: 3,
      tipsEmitted: 1,
      lastTipAt: NOW - 4_000,
    };
    await seedState(sb.dir, { segment: before });
    await stopHandler(payload(), makeDeps(sb.dir));
    await stopHandler(payload(), makeDeps(sb.dir, { now: NOW + 1_000 }));
    const seg = (await loadState(sb.dir, NOW + 1_000)).segment;
    expect(seg.segmentId).toBe(3);
    expect(seg.tipsEmitted).toBe(1);
    expect(seg.lastActivityAt).toBe(NOW + 1_000);
  });

  test("never returns context, even when a tip is due", async () => {
    const due = { ...newSegment(NOW - 1_000), lastTopic: topicId("plan-mode") };
    await seedState(sb.dir, { segment: due });
    const out = await stopHandler(
      payload({ last_assistant_message: "Here is how plan mode works." }),
      makeDeps(sb.dir),
    );
    expect(out).toBeNull();
  });

  test("works with no prior state", async () => {
    expect(await stopHandler(payload(), makeDeps(sb.dir))).toBeNull();
    expect((await loadStateAt(sb.dir)).segment.segmentId).toBe(0);
  });

  test.each(BAD_SESSIONS)(
    "returns null and writes nothing for a %s session id",
    async (_n, value) => {
      expect(
        await stopHandler(withSession(value), makeDeps(sb.dir)),
      ).toBeNull();
      expect(existsSync(sb.dir)).toBe(false);
    },
  );
});

describe("postCompactHandler", () => {
  test("counts as activity within the current segment", async () => {
    const before = {
      ...newSegment(NOW - 1_000),
      segmentId: 2,
      tipsEmitted: 1,
      lastTopic: topicId("plan-mode"),
    };
    await seedState(sb.dir, { segment: before });
    expect(await postCompactHandler(payload(), makeDeps(sb.dir))).toBeNull();
    expect((await loadStateAt(sb.dir)).segment).toEqual({
      ...before,
      lastActivityAt: NOW,
    });
  });

  test.each(BAD_SESSIONS)(
    "returns null and writes nothing for a %s session id",
    async (_n, value) => {
      expect(
        await postCompactHandler(withSession(value), makeDeps(sb.dir)),
      ).toBeNull();
      expect(existsSync(sb.dir)).toBe(false);
    },
  );
});
