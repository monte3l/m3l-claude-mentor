import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { describeError } from "../../../src/hooks/runtime.ts";
import { loadBundledTracks } from "../../../src/internal/bundled-tracks.ts";
import { MentorStateError } from "../../../src/internal/errors.ts";
import { saveGoals } from "../../../src/internal/store.ts";
import {
  CATALOG,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  type Sandbox,
} from "./helpers.ts";

vi.mock("../../../src/internal/bundled-tracks.ts", () => ({
  loadBundledTracks: vi.fn(),
}));

const STORED_SECRET = "stored-secret-value";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
  vi.mocked(loadBundledTracks).mockImplementation(() => {
    throw new MentorStateError("READ_FAILED", "could not read track CCAR-F", {
      cause: new Error(STORED_SECRET),
    });
  });
});
afterEach(() => {
  vi.mocked(loadBundledTracks).mockReset();
  sb.cleanup();
});

describe("SessionStart when the bundled tracks cannot be loaded", () => {
  test("an active track still yields the normal summary, without any track focus", async () => {
    await seedState(sb.dir, { activeTrack: "CCAR-F" });
    await saveGoals(sb.dir, "ship the plugin");
    await seedProfile(
      sb.dir,
      Object.fromEntries(
        CATALOG.map((e) => [e.id, { lastPassAt: 0, passes: 1 }]),
      ),
    );
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    const text = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(text).toContain("tip dial: 2");
    expect(text).toContain("topics below target:");
    expect(text).toContain("review due: ");
    expect(text).toContain("goals:\nship the plugin");
    expect(text).not.toContain("Exam track");
    const ids = text
      .split("\n")
      .filter((l) => l.includes(" (target "))
      .map((l) => l.split(":")[0]);
    for (const id of ids) {
      expect(CATALOG.find((e) => e.id === id)?.ambient).not.toBe(false);
    }
  });

  test("the result carries a fixed note from describeError, never stored data", async () => {
    await seedState(sb.dir, { activeTrack: "CCAR-F" });
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(out?.note).toBe(
      describeError(
        new MentorStateError("READ_FAILED", "could not read track CCAR-F"),
      ),
    );
    expect(out?.note).toMatch(/READ_FAILED/);
    expect(out?.note).not.toContain(STORED_SECRET);
  });

  test("with no active track the loader is never needed and there is no note", async () => {
    await seedState(sb.dir, {});
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(out?.note).toBeUndefined();
    expect(out?.hookSpecificOutput?.additionalContext).toContain("tip dial");
  });
});
