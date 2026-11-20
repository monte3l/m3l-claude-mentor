import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DAY,
  NOW,
  SESSION,
  makeSandbox,
  put,
  runOk,
  type Sandbox,
} from "./helpers.ts";
import { realCtx } from "./exam-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

/** A valid-shaped line written directly: the parser does not check membership. */
function line(
  domain: string,
  objective: string,
  correct: boolean,
  at: number,
): string {
  return JSON.stringify({
    v: 1,
    track: "CCAR-F",
    domain,
    objective,
    topic: "agentic-loop",
    kind: "single",
    mode: "drill",
    correct,
    at,
    session: SESSION,
  });
}

const seedLines = (lines: readonly string[]): void => {
  put(sb.dir, "exam-items.jsonl", `${lines.join("\n")}\n`);
};

const GOOD = [
  line("D1", "D1.1", true, NOW - 3 * DAY),
  line("D1", "D1.2", false, NOW - 5 * DAY),
  line("D2", "D2.1", true, NOW - 4 * DAY),
];
// Newer than every valid item, so a leak would show in lastAt.
const BAD = [
  line("D1", "D1.9", false, NOW - DAY),
  line("D9", "D9.1", false, NOW - DAY),
];

interface View {
  total: number;
  domains: {
    id: string;
    items: number;
    correct: number;
    lastAt: number | null;
    objectives: { id: string; items: number; correct: number }[];
  }[];
}

const items = async (): Promise<View> =>
  (await runOk(
    sb.dir,
    ["exam-items", "--track", "CCAR-F"],
    await realCtx(),
  )) as never;

describe("exam-items skips items the track cannot place", () => {
  test("an unknown objective of a known domain and an unknown domain are not counted", async () => {
    seedLines([...GOOD, ...BAD]);
    const out = await items();
    expect(out.total).toBe(3);
    expect(out.domains.map((d) => d.id)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
    ]);
    expect(out.domains[0]).toMatchObject({
      items: 2,
      correct: 1,
      lastAt: NOW - 3 * DAY,
    });
    expect(out.domains[1]).toMatchObject({
      items: 1,
      correct: 1,
      lastAt: NOW - 4 * DAY,
    });
    expect(out.domains.reduce((n, d) => n + d.items, 0)).toBe(3);
    const objectives = out.domains.flatMap((d) => d.objectives);
    expect(objectives.reduce((n, o) => n + o.items, 0)).toBe(3);
    expect(objectives.some((o) => o.id === "D1.9" || o.id === "D9.1")).toBe(
      false,
    );
  });

  test("only bad items leaves every count zero and lastAt null", async () => {
    seedLines(BAD);
    const out = await items();
    expect(out.total).toBe(0);
    expect(
      out.domains.every(
        (d) => d.items === 0 && d.correct === 0 && d.lastAt === null,
      ),
    ).toBe(true);
  });

  test("readiness ignores them: same output with and without the bad items", async () => {
    const readiness = async (): Promise<unknown> =>
      runOk(sb.dir, ["readiness", "--track", "CCAR-F"], await realCtx());
    seedLines(GOOD);
    const without = await readiness();
    seedLines([...GOOD, ...BAD]);
    const withBad = await readiness();
    expect(withBad).toEqual(without);
  });
});
