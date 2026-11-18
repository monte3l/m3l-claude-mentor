import { readFileSync } from "node:fs";
import type * as FsPromises0 from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { MentorStateError } from "../../../src/internal/errors.ts";
import { parseEvidence } from "../../../src/internal/schema.ts";
import { appendEvidence } from "../../../src/internal/store.ts";
import {
  NOW,
  SESSION,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  type Sandbox,
} from "./helpers.ts";
import { fakeLock, lockFiles } from "./lock-helpers.ts";

type FsPromises = typeof FsPromises0;

// `rename` is the commit step of every atomic save; refusing the profile's
// makes the locked section of SessionStart fail with a non-timeout error.
const fsMocks = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<FsPromises>()),
  ...fsMocks,
}));

let sb: Sandbox;
let real: FsPromises;

beforeEach(async () => {
  real = await vi.importActual<FsPromises>("node:fs/promises");
  fsMocks.rename.mockImplementation(real.rename);
  sb = makeSandbox();
  await seedState(sb.dir);
  await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
  for (let i = 0; i < 2; i += 1) {
    const e = parseEvidence({
      channel: "observed",
      topic: "claude-md",
      result: "positive",
      at: NOW,
      session: SESSION,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
  }
});
afterEach(() => {
  fsMocks.rename.mockReset();
  sb.cleanup();
});

describe("SessionStart does not swallow a non-timeout failure of the locked section", () => {
  test("a failing profile save propagates as WRITE_FAILED, not as a note", async () => {
    const cause = Object.assign(new Error("EIO: injected"), { code: "EIO" });
    let refused = 0;
    fsMocks.rename.mockImplementation((...args: unknown[]) => {
      if (String(args[1]).endsWith("profile.json")) {
        refused += 1;
        return Promise.reject(cause);
      }
      return (real.rename as (...a: unknown[]) => Promise<unknown>)(...args);
    });
    const before = readFileSync(join(sb.dir, "profile.json"), "utf8");
    const { lock } = fakeLock();
    let thrown: unknown;
    try {
      await sessionStartHandler(
        payload(),
        makeDeps(sb.dir, { lockOptions: lock }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(refused).toBeGreaterThan(0); // the injection really fired
    expect(thrown).toBeInstanceOf(MentorStateError);
    expect((thrown as MentorStateError).code).toBe("WRITE_FAILED");
    expect(readFileSync(join(sb.dir, "profile.json"), "utf8")).toBe(before);
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});
