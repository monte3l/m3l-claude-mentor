import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import {
  parseEvidence,
  parseSessionId,
  type Channel,
  type Level,
} from "../../../src/internal/schema.ts";
import { appendEvidence, loadProfile } from "../../../src/internal/store.ts";
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

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function add(
  channel: Channel,
  count: number,
  at: number,
  session = SESSION,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const e = parseEvidence({
      channel,
      topic: "context-window",
      result: "positive",
      at,
      session,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
  }
}

const voidOf = (
  session: string,
  at: number,
): { session: ReturnType<typeof sidOf>; at: number } => ({
  session: sidOf(session),
  at,
});
function sidOf(
  value: string,
): NonNullable<
  ReturnType<typeof parseSessionId> extends infer R
    ? R extends { ok: true; value: infer V }
      ? V
      : never
    : never
> {
  const r = parseSessionId(value);
  if (!r.ok) throw new Error("fixture");
  return r.value;
}

async function levelOnDisk(): Promise<Level | undefined> {
  return (await loadProfile(sb.dir, NOW)).topics["context-window"]?.level;
}

describe("sessionStartHandler ignores voided quiz evidence", () => {
  test("control: without a void the quiz events lift the level", async () => {
    await seedProfile(sb.dir, { "context-window": { level: "Unseen" } });
    await seedState(sb.dir);
    await add("quiz", 2, NOW);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk()).toBe("Recalled");
  });

  test("a voided submission's quiz events no longer lift the level", async () => {
    await seedProfile(sb.dir, { "context-window": { level: "Unseen" } });
    await seedState(sb.dir, { voidedExams: [voidOf(SESSION, NOW)] });
    await add("quiz", 2, NOW);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk()).toBe("Unseen");
  });

  test("only the matching (session, at) is dropped; other quiz events still count", async () => {
    await seedProfile(sb.dir, { "context-window": { level: "Unseen" } });
    await seedState(sb.dir, { voidedExams: [voidOf(SESSION, NOW)] });
    await add("quiz", 2, NOW);
    await add("quiz", 2, NOW, "other-session");
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk()).toBe("Recalled");
  });
});
