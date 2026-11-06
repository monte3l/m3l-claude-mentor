import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { postCompactHandler } from "../../../src/hooks/handlers/post-compact.js";
import { stopHandler } from "../../../src/hooks/handlers/stop.js";
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

describe("stopHandler", () => {
  test("ends the segment: new id, quota reset, lastTipAt kept, topic cleared", async () => {
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
      segmentId: 4,
      startedAt: NOW,
      lastActivityAt: NOW,
      tipsEmitted: 0,
      lastTipAt: NOW - 4_000,
      lastTopic: null,
    });
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
    expect((await loadStateAt(sb.dir)).segment.segmentId).toBe(1);
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

  test("starts a new segment after an idle gap", async () => {
    const before = {
      ...newSegment(NOW - 2 * 3_600_000),
      segmentId: 2,
      tipsEmitted: 1,
    };
    await seedState(sb.dir, { segment: before });
    expect(await postCompactHandler(payload(), makeDeps(sb.dir))).toBeNull();
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.segmentId).toBe(3);
    expect(seg.tipsEmitted).toBe(0);
    expect(seg.startedAt).toBe(NOW);
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
