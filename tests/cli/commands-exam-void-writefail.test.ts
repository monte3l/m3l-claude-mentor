import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { examUnvoid, examVoid } from "../../src/cli/exam-void-commands.ts";
import type { ParsedArgs } from "../../src/cli/args.ts";
import type { CommandEnv } from "../../src/cli/env.ts";
import { MentorStateError } from "../../src/internal/errors.ts";
import { parseSessionId } from "../../src/internal/schema.ts";
import { NOW, makeSandbox, read, readJson, type Sandbox } from "./helpers.ts";
import { SPEC_AGENT_SDK, SPEC_API_KEY, realCtx } from "./exam-helpers.ts";
import { submit, unvoidCmd, voidCmd } from "./exam-void-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const T1 = 1_000_000;
const TWO_TOPICS = `${SPEC_API_KEY};${SPEC_AGENT_SDK}`;

async function envFor(): Promise<CommandEnv> {
  const session = parseSessionId("sess-1");
  if (!session.ok) throw new Error("fixture");
  const { bundled } = await realCtx();
  if (bundled === undefined) throw new Error("fixture");
  return { dir: sb.dir, now: NOW, session: session.value, bundled };
}

const flags = (
  ...pairs: readonly (readonly [string, string])[]
): ParsedArgs => ({
  positional: undefined,
  values: new Map(pairs),
  booleans: new Set(),
});

const voidList = (): unknown =>
  (readJson(sb.dir, "state.json") as { voidedExams?: unknown }).voidedExams;

async function caught(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("exam-void: a corrupt profile.json after the void list was saved", () => {
  test("surfaces WRITE_FAILED naming the void list, the unchanged levels, the topic ids and recompute", async () => {
    await submit(sb.dir, "s-a", T1, TWO_TOPICS, "B;A,C");
    writeFileSync(join(sb.dir, "profile.json"), "{ not json");
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toMatch(/void list/);
    expect(result.stderr).toMatch(/levels? (was|were) not updated/);
    expect(result.stderr).toMatch(/api-key-handling,\s*agent-sdk/);
    expect(result.stderr).toContain("recompute");
    expect(voidList()).toEqual([{ session: "s-a", at: T1 }]);
  });

  test("chains the underlying parse failure as the cause", async () => {
    await submit(sb.dir, "s-a", T1, SPEC_API_KEY, "B");
    writeFileSync(join(sb.dir, "profile.json"), "{ not json");
    const error = await caught(examVoid(flags(), await envFor()));
    expect(error).toBeInstanceOf(MentorStateError);
    expect((error as MentorStateError).code).toBe("WRITE_FAILED");
    expect((error as MentorStateError).cause).toBeInstanceOf(MentorStateError);
    expect(((error as MentorStateError).cause as MentorStateError).code).toBe(
      "PARSE_FAILED",
    );
  });
});

describe("exam-unvoid: a corrupt profile.json after the removal was saved", () => {
  test("surfaces WRITE_FAILED saying the removal was saved, naming topic ids and recompute", async () => {
    await submit(sb.dir, "s-a", T1, TWO_TOPICS, "B;A,C");
    const first = await voidCmd(sb.dir);
    expect(first.exitCode).toBe(0);
    writeFileSync(join(sb.dir, "profile.json"), "{ not json");
    const result = await unvoidCmd(sb.dir, [
      "--at",
      String(T1),
      "--session",
      "s-a",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toMatch(/levels? (was|were) not updated/);
    expect(result.stderr).toMatch(/api-key-handling,\s*agent-sdk/);
    expect(result.stderr).toContain("recompute");
    expect(voidList()).toBeUndefined();
  });

  test("chains the cause", async () => {
    await submit(sb.dir, "s-a", T1, SPEC_API_KEY, "B");
    await voidCmd(sb.dir);
    writeFileSync(join(sb.dir, "profile.json"), "{ not json");
    const error = await caught(
      examUnvoid(flags(["at", String(T1)], ["session", "s-a"]), await envFor()),
    );
    expect((error as MentorStateError).code).toBe("WRITE_FAILED");
    expect((error as MentorStateError).cause).toBeInstanceOf(Error);
  });
});

describe("exam-unvoid: the submission's items are gone from the exam-items window", () => {
  test("VALIDATION_FAILED, exit 1, and the pair stays voided", async () => {
    await submit(sb.dir, "s-a", T1, SPEC_API_KEY, "B");
    expect((await voidCmd(sb.dir)).exitCode).toBe(0);
    // The log no longer holds that (session, at); state.voidedExams still does.
    writeFileSync(join(sb.dir, "exam-items.jsonl"), "");
    const stateBefore = read(sb.dir, "state.json");
    const profileBefore = read(sb.dir, "profile.json");
    const result = await unvoidCmd(sb.dir, [
      "--at",
      String(T1),
      "--session",
      "s-a",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(read(sb.dir, "state.json")).toBe(stateBefore);
    expect(voidList()).toEqual([{ session: "s-a", at: T1 }]);
    expect(read(sb.dir, "profile.json")).toBe(profileBefore);
  });
});
