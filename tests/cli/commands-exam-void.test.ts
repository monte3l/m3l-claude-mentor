import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  NOW,
  makeSandbox,
  put,
  read,
  readJson,
  run,
  type Sandbox,
} from "./helpers.ts";
import { SPEC_AGENT_SDK, SPEC_API_KEY, realCtx } from "./exam-helpers.ts";
import {
  USAGE_UNVOID,
  USAGE_VOID,
  rank,
  submit,
  unvoidCmd,
  voidCmd,
} from "./exam-void-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const voidedList = (): unknown => {
  let state: { voidedExams?: unknown };
  try {
    state = readJson(sb.dir, "state.json") as { voidedExams?: unknown };
  } catch {
    return undefined; // no state.json yet: nothing was ever voided
  }
  return state.voidedExams;
};
const level = (topic: string): string =>
  (
    readJson(sb.dir, "profile.json") as {
      topics: Record<string, { level: string }>;
    }
  ).topics[topic]?.level ?? "none";
const parse = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout) as Record<string, unknown>;

const T1 = 1_000_000;
const T2 = 2_000_000;

/** Two submissions: s-a at T1 (api-key x2 positive), s-b at T2 (agent-sdk). */
async function seedTwo(): Promise<void> {
  await submit(sb.dir, "s-a", T1, `${SPEC_API_KEY};${SPEC_API_KEY}`, "B;B");
  await submit(sb.dir, "s-b", T2, SPEC_AGENT_SDK, "A,C");
}

describe("exam-void", () => {
  test("with no flags voids the most recent submission and reports items and levels", async () => {
    await seedTwo();
    const before = level("agent-sdk");
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(0);
    const out = parse(result.stdout);
    expect(out).toMatchObject({ voided: { session: "s-b", at: T2 }, items: 1 });
    expect(Object.keys(out["levels"] as object)).toEqual(["agent-sdk"]);
    expect(voidedList()).toEqual([{ session: "s-b", at: T2 }]);
    expect(level("agent-sdk")).toBe(
      (out["levels"] as Record<string, string>)["agent-sdk"],
    );
    expect(rank(level("agent-sdk"))).toBeLessThan(rank(before));
  });

  test("with no flags picks the newest submission by at when the log lists them out of time order", async () => {
    await seedTwo();
    const lines = read(sb.dir, "exam-items.jsonl")
      .split("\n")
      .filter((l) => l !== "");
    const byAt = (l: string): number => (JSON.parse(l) as { at: number }).at;
    const older = lines.filter((l) => byAt(l) === T1);
    const newer = lines.filter((l) => byAt(l) === T2);
    expect(older.length).toBeGreaterThan(0);
    expect(newer.length).toBeGreaterThan(0);
    put(sb.dir, "exam-items.jsonl", [...newer, ...older].join("\n") + "\n");
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(0);
    expect(parse(result.stdout)).toMatchObject({
      voided: { session: "s-b", at: T2 },
    });
    expect(voidedList()).toEqual([{ session: "s-b", at: T2 }]);
  });

  test("with both flags voids that submission and recomputes all its topics", async () => {
    await seedTwo();
    const before = level("api-key-handling");
    const result = await voidCmd(sb.dir, [
      "--at",
      String(T1),
      "--session",
      "s-a",
    ]);
    expect(result.exitCode).toBe(0);
    expect(parse(result.stdout)).toMatchObject({
      voided: { session: "s-a", at: T1 },
      items: 2,
      levels: { "api-key-handling": level("api-key-handling") },
    });
    expect(rank(level("api-key-handling"))).toBeLessThan(rank(before));
  });

  test("logs are never rewritten", async () => {
    await seedTwo();
    const items = read(sb.dir, "exam-items.jsonl");
    const evidence = read(sb.dir, "evidence.jsonl");
    await voidCmd(sb.dir);
    expect(read(sb.dir, "exam-items.jsonl")).toBe(items);
    expect(read(sb.dir, "evidence.jsonl")).toBe(evidence);
  });

  test("a second void with no flags targets the next most recent, not the voided one", async () => {
    await seedTwo();
    await voidCmd(sb.dir);
    const again = await voidCmd(sb.dir);
    expect(again.exitCode).toBe(1);
    // The latest is already voided: contract says already-voided is an error.
    expect(again.stderr).toMatch(/^VALIDATION_FAILED: /);
  });

  test.each([
    ["only --at", ["--at", "5"]],
    ["only --session", ["--session", "s-a"]],
  ])("%s is a syntax error, exit 2", async (_n, args) => {
    const result = await voidCmd(sb.dir, args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(USAGE_VOID);
    expect(result.stdout).toBe("");
  });

  test.each([
    ["non-numeric at", ["--at", "x", "--session", "s-a"]],
    ["negative at", ["--at", "-1", "--session", "s-a"]],
    ["fractional at", ["--at", "1.5", "--session", "s-a"]],
    ["bad session", ["--at", "1", "--session", ""]],
    ["extra argument", ["extra"]],
  ])("%s is a usage error, exit 2", async (_n, args) => {
    const result = await voidCmd(sb.dir, args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^usage: /);
  });

  test("no exam items at all: VALIDATION_FAILED exit 1, nothing written", async () => {
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(() => read(sb.dir, "state.json")).toThrow();
  });

  test("no matching submission: VALIDATION_FAILED exit 1, state unchanged", async () => {
    await seedTwo();
    const result = await voidCmd(sb.dir, ["--at", "7", "--session", "s-a"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(voidedList()).toBeUndefined();
  });

  test("a voided item's topic missing from the merged catalog: VALIDATION_FAILED, nothing written", async () => {
    await seedTwo();
    const profile = read(sb.dir, "profile.json");
    // The default test catalog lacks the exam topics the items name.
    const result = await run(sb.dir, ["exam-void"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(voidedList()).toBeUndefined();
    expect(read(sb.dir, "profile.json")).toBe(profile);
  });

  test("already voided: VALIDATION_FAILED exit 1, list unchanged", async () => {
    await seedTwo();
    const args = ["--at", String(T1), "--session", "s-a"];
    await voidCmd(sb.dir, args);
    const result = await voidCmd(sb.dir, args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(voidedList()).toEqual([{ session: "s-a", at: T1 }]);
  });

  test("cap of 100 voids reached: VALIDATION_FAILED exit 1", async () => {
    await seedTwo();
    await run(sb.dir, ["set-mute", "off"]);
    const state = readJson(sb.dir, "state.json") as Record<string, unknown>;
    const hundred = Array.from({ length: 100 }, (_v, i) => ({
      session: `old-${String(i)}`,
      at: i,
    }));
    put(
      sb.dir,
      "state.json",
      JSON.stringify({ ...state, voidedExams: hundred }),
    );
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(voidedList()).toEqual(hundred);
  });

  test("get-profile is unaffected by the void list", async () => {
    await seedTwo();
    await voidCmd(sb.dir);
    const result = await run(sb.dir, ["get-profile"], await realCtx());
    expect(result.exitCode).toBe(0);
    expect(Object.keys(parse(result.stdout)).length).toBeGreaterThan(0);
  });
});

describe("exam-unvoid", () => {
  test("removes the entry, recomputes the same topics and restores the level", async () => {
    // Seeded at the commands' own clock so no decay separates the levels.
    await submit(sb.dir, "s-a", NOW, `${SPEC_API_KEY};${SPEC_API_KEY}`, "B;B");
    await submit(sb.dir, "s-b", NOW, SPEC_AGENT_SDK, "A,C");
    const original = level("api-key-handling");
    const args = ["--at", String(NOW), "--session", "s-a"];
    await voidCmd(sb.dir, args);
    const result = await unvoidCmd(sb.dir, args);
    expect(result.exitCode).toBe(0);
    expect(parse(result.stdout)).toEqual({
      unvoided: { session: "s-a", at: NOW },
      items: 2,
      levels: { "api-key-handling": original },
    });
    expect(level("api-key-handling")).toBe(original);
    expect(voidedList() ?? []).toEqual([]);
  });

  test("an entry that is not voided: VALIDATION_FAILED exit 1", async () => {
    await seedTwo();
    const result = await unvoidCmd(sb.dir, [
      "--at",
      String(T1),
      "--session",
      "s-a",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
  });

  test.each([
    ["no flags", []],
    ["only --at", ["--at", "5"]],
    ["only --session", ["--session", "s-a"]],
  ])("%s is a syntax error, exit 2", async (_n, args) => {
    const result = await unvoidCmd(sb.dir, args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(USAGE_UNVOID);
  });
});

describe("usage listing", () => {
  test("the general usage line lists both commands", async () => {
    const result = await run(sb.dir, [], await realCtx());
    const listed = /commands: ([^\n]+)/.exec(result.stderr)?.[1] ?? "";
    expect(listed.split(", ")).toEqual(
      expect.arrayContaining(["exam-void", "exam-unvoid"]),
    );
  });
});
