import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { makeSandbox, put, runOk, type Sandbox } from "./helpers.ts";
import { SPEC_API_KEY, THREE_ITEMS, realCtx } from "./exam-helpers.ts";
import { submit, unvoidCmd, voidCmd } from "./exam-void-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

interface Sub {
  session: string;
  at: number;
  items: number;
  voided: boolean;
}
const itemsOut = async (
  args: readonly string[] = [],
): Promise<{ submissions: Sub[]; [k: string]: unknown }> =>
  (await runOk(
    sb.dir,
    ["exam-items", "--track", "CCDV-F", ...args],
    await realCtx(),
  )) as never;

describe("exam-items submissions", () => {
  test("lists submissions most recent first with item counts and voided flag", async () => {
    await submit(sb.dir, "s-a", 1000, THREE_ITEMS, "B;A,C;D");
    await submit(sb.dir, "s-b", 2000, SPEC_API_KEY, "B");
    expect((await itemsOut()).submissions).toEqual([
      { session: "s-b", at: 2000, items: 1, voided: false },
      { session: "s-a", at: 1000, items: 3, voided: false },
    ]);
  });

  test("includes voided submissions flagged voided: true, still listed", async () => {
    await submit(sb.dir, "s-a", 1000, SPEC_API_KEY, "B");
    await submit(sb.dir, "s-b", 2000, SPEC_API_KEY, "B");
    await voidCmd(sb.dir);
    expect((await itemsOut()).submissions).toEqual([
      { session: "s-b", at: 2000, items: 1, voided: true },
      { session: "s-a", at: 1000, items: 1, voided: false },
    ]);
    await unvoidCmd(sb.dir, ["--at", "2000", "--session", "s-b"]);
    expect((await itemsOut()).submissions[0]?.voided).toBe(false);
  });

  test("an empty log yields an empty submissions list", async () => {
    expect((await itemsOut()).submissions).toEqual([]);
  });

  test("is capped at 20, most recent first", async () => {
    const lines = Array.from({ length: 25 }, (_v, i) =>
      JSON.stringify({
        v: 1,
        track: "CCDV-F",
        domain: "D7",
        objective: "D7.3",
        topic: "api-key-handling",
        kind: "single",
        mode: "drill",
        correct: true,
        at: 1000 + i,
        session: `s-${String(i)}`,
      }),
    );
    put(sb.dir, "exam-items.jsonl", `${lines.join("\n")}\n`);
    const subs = (await itemsOut()).submissions;
    expect(subs).toHaveLength(20);
    expect(subs[0]?.at).toBe(1024);
    expect(subs[19]?.at).toBe(1005);
  });

  test("per-objective counts exclude voided items", async () => {
    await submit(sb.dir, "s-a", 1000, SPEC_API_KEY, "B");
    await submit(sb.dir, "s-b", 2000, SPEC_API_KEY, "B");
    const before = JSON.stringify(await itemsOut());
    await voidCmd(sb.dir);
    const afterVoid = JSON.stringify(await itemsOut());
    expect(afterVoid).not.toBe(before);
    expect(afterVoid).toContain('"voided":true');
    await unvoidCmd(sb.dir, ["--at", "2000", "--session", "s-b"]);
    expect(JSON.stringify(await itemsOut())).toBe(before);
  });
});

describe("readiness after a void", () => {
  test("voided items stop counting toward totalEffectiveItems", async () => {
    const track = loadBundledTracks().find((t) => t.code === "CCDV-F");
    expect(track).toBeDefined();
    await submit(sb.dir, "s-a", 1000, THREE_ITEMS, "B;A,C;D");
    const total = async (): Promise<number> =>
      (
        (await runOk(
          sb.dir,
          ["readiness", "--track", "CCDV-F"],
          await realCtx({ now: 3000 }),
        )) as { totalEffectiveItems: number }
      ).totalEffectiveItems;
    const counted = await total();
    expect(counted).toBeGreaterThan(0);
    await voidCmd(sb.dir);
    expect(await total()).toBe(0);
    await unvoidCmd(sb.dir, ["--at", "1000", "--session", "s-a"]);
    expect(await total()).toBe(counted);
  });

  test("a void drops an ok readiness back to insufficient-evidence", async () => {
    const track = loadBundledTracks().find((t) => t.code === "CCAR-F");
    if (track === undefined) throw new Error("CCAR-F missing");
    const lines: string[] = [];
    for (const [di, domain] of track.domains.entries()) {
      for (const objective of domain.objectives.slice(0, 2)) {
        const topic = objective.topics[0];
        if (topic === undefined) throw new Error("objective without topic");
        for (let i = 0; i < 3; i += 1) {
          lines.push(
            JSON.stringify({
              v: 1,
              track: "CCAR-F",
              domain: domain.id,
              objective: objective.id,
              topic,
              kind: "single",
              mode: "drill",
              correct: (i + di) % 3 !== 0,
              at: 5000,
              session: "one-big-session",
            }),
          );
        }
      }
    }
    put(sb.dir, "exam-items.jsonl", `${lines.join("\n")}\n`);
    const status = async (): Promise<string> =>
      (
        (await runOk(
          sb.dir,
          ["readiness", "--track", "CCAR-F"],
          await realCtx({ now: 6000 }),
        )) as { status: string }
      ).status;
    expect(await status()).toBe("ok");
    const voided = await voidCmd(sb.dir);
    expect(voided.exitCode).toBe(0);
    expect(await status()).toBe("insufficient-evidence");
  });
});

describe("exam-begin and exam-answer are unchanged", () => {
  test("exam-answer output keeps its shape after a prior void", async () => {
    await submit(sb.dir, "s-a", 1000, SPEC_API_KEY, "B");
    await voidCmd(sb.dir);
    const result = await submit(sb.dir, "s-b", 2000, SPEC_API_KEY, "B");
    expect(result).toMatchObject({ correctCount: 1 });
  });
});
