import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { parseEvidence } from "../../../src/internal/schema.ts";
import { appendEvidence } from "../../../src/internal/store.ts";
import { run } from "../runtime-helpers.ts";
import {
  SESSION,
  makeSandbox,
  seedProfile,
  snapshot,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function seedEvidence(): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    const e = parseEvidence({
      channel: "quiz",
      topic: "context-window",
      result: "positive",
      at: 1_700_000_000_000,
      session: SESSION,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
  }
}

describe("SessionStart with an invalid state.json and evidence present", () => {
  test.each([
    ["not JSON", "{ nope"],
    ["wrong shape", '{"voidedExams":"x"}'],
  ])(
    "%s: fails open, raises nothing, leaves the profile alone",
    async (_name, text) => {
      await seedProfile(sb.dir, { "context-window": { level: "Unseen" } });
      await seedEvidence();
      writeFileSync(join(sb.dir, "state.json"), text);
      const before = snapshot(sb.dir);
      const result = await run(
        sb.dir,
        JSON.stringify({ session_id: SESSION }),
        sessionStartHandler,
      );
      // No crash: a stderr note only, no context, no raised levels.
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^m3l-claude-mentor: TestHook: /);
      expect(snapshot(sb.dir)).toEqual(before);
    },
  );
});
