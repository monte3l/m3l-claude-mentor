import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { parseExamItem } from "../../src/internal/exam-schema.ts";
import { computeReadiness } from "../../src/internal/readiness.ts";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.ts";
import { saveProfile } from "../../src/internal/store.ts";
import {
  DAY,
  NOW,
  SESSION,
  makeSandbox,
  put,
  run,
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

const READINESS_USAGE = "usage: mentor-state readiness [--track <code>]\n";
const ITEMS_USAGE =
  "usage: mentor-state exam-items [--track <code>] [--limit <n>]\n";

interface ItemSpec {
  track: string;
  objective: string;
  topic: string;
  correct: boolean;
  at: number;
}

function itemLine(s: ItemSpec): string {
  const parsed = parseExamItem({
    v: 1,
    track: s.track,
    domain: s.objective.split(".")[0],
    objective: s.objective,
    topic: s.topic,
    kind: "single",
    mode: "drill",
    correct: s.correct,
    at: s.at,
    session: SESSION,
  });
  if (!parsed.ok) throw new Error("exam item fixture invalid");
  return JSON.stringify(parsed.value);
}

const seed = (specs: readonly ItemSpec[]): void => {
  put(sb.dir, "exam-items.jsonl", `${specs.map(itemLine).join("\n")}\n`);
};

function ccarF(): ReturnType<typeof loadBundledTracks>[number] {
  const track = loadBundledTracks().find((t) => t.code === "CCAR-F");
  if (track === undefined) throw new Error("CCAR-F missing");
  return track;
}

/** 6 items per domain: 3 on each of its first two objectives, all one day old. */
function evidenceSpecs(): ItemSpec[] {
  const specs: ItemSpec[] = [];
  for (const [di, domain] of ccarF().domains.entries()) {
    for (const objective of domain.objectives.slice(0, 2)) {
      const topic = objective.topics[0];
      if (topic === undefined) throw new Error("objective without topic");
      for (let i = 0; i < 3; i += 1) {
        specs.push({
          track: "CCAR-F",
          objective: objective.id,
          topic,
          correct: (i + di) % 3 !== 0,
          at: NOW - DAY,
        });
      }
    }
  }
  return specs;
}

describe("readiness", () => {
  test("insufficient evidence on a fresh dir: no index key, notAScorePrediction true", async () => {
    const out = (await runOk(
      sb.dir,
      ["readiness", "--track", "CCAR-F"],
      await realCtx(),
    )) as Record<string, unknown>;
    expect(out).toMatchObject({
      track: "CCAR-F",
      status: "insufficient-evidence",
      notAScorePrediction: true,
      totalEffectiveItems: 0,
    });
    expect(Object.hasOwn(out, "index")).toBe(false);
    expect(out["guide"]).toEqual({
      version: ccarF().guide.version,
      effective: ccarF().guide.effective,
    });
    const domains = out["domains"] as { id: string; weight: number }[];
    expect(domains.map((d) => [d.id, d.weight])).toEqual([
      ["D1", 27],
      ["D2", 18],
      ["D3", 20],
      ["D4", 20],
      ["D5", 15],
    ]);
  });

  test("ok path: equals computeReadiness over the stored profile, merged catalog and this track's items", async () => {
    const specs = evidenceSpecs();
    // Items of another track must not influence CCAR-F readiness.
    seed([
      ...specs,
      {
        track: "CCDV-F",
        objective: "D7.3",
        topic: "api-key-handling",
        correct: false,
        at: NOW - DAY,
      },
    ]);
    const topics: Profile["topics"] = Object.fromEntries(
      ccarF()
        .domains.flatMap((d) => d.objectives.slice(0, 2))
        .flatMap((o) => o.topics.slice(0, 1))
        .map((t) => [
          t,
          { introduced: true, level: "Applied", lastPassAt: null, passes: 0 },
        ]),
    );
    const profile: Profile = { ...defaultProfile(), topics };
    await saveProfile(sb.dir, profile);

    const out = (await runOk(
      sb.dir,
      ["readiness", "--track", "CCAR-F"],
      await realCtx(),
    )) as { status: string; index?: number; domains: unknown[] };

    const expected = computeReadiness({
      track: ccarF(),
      catalog: await loadBundledCatalog(),
      profile,
      items: specs.map((s) => {
        const parsed = parseExamItem(JSON.parse(itemLine(s)));
        if (!parsed.ok) throw new Error("invalid");
        return parsed.value;
      }),
      now: NOW,
    });
    expect(expected.status).toBe("ok");
    expect(out).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(out.status).toBe("ok");
    expect(Number.isInteger(out.index)).toBe(true);
    expect(out.domains).toHaveLength(5);
  });

  test("defaults to the active track; an explicit --track overrides it", async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    const byDefault = (await runOk(sb.dir, ["readiness"], await realCtx())) as {
      track: string;
    };
    expect(byDefault.track).toBe("CCDV-F");
    const explicit = (await runOk(
      sb.dir,
      ["readiness", "--track", "CCAR-F"],
      await realCtx(),
    )) as { track: string };
    expect(explicit.track).toBe("CCAR-F");
  });

  test("no --track and no active track -> VALIDATION_FAILED, exit 1, telling the learner what to do", async () => {
    const result = await run(sb.dir, ["readiness"], await realCtx());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).toContain("--track");
    expect(result.stderr).toContain("set-track");
  });

  test("a malformed --track is still a usage error, exit 2", async () => {
    const result = await run(
      sb.dir,
      ["readiness", "--track", "lowercase"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(READINESS_USAGE);
  });

  test("an unknown (well-formed) track -> VALIDATION_FAILED, exit 1", async () => {
    const result = await run(
      sb.dir,
      ["readiness", "--track", "CCXX-F"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
  });
});

describe("exam-items", () => {
  const items = async (
    ...argv: string[]
  ): Promise<{
    track: string;
    total: number;
    domains: {
      id: string;
      name: string;
      weight: number;
      items: number;
      correct: number;
      lastAt: number | null;
      objectives: { id: string; items: number; correct: number }[];
    }[];
  }> =>
    (await runOk(sb.dir, ["exam-items", ...argv], await realCtx())) as never;

  const spec = (
    objective: string,
    correct: boolean,
    at: number,
    track = "CCAR-F",
  ): ItemSpec => ({ track, objective, topic: "agentic-loop", correct, at });

  test("raw per-domain and per-objective counts, this track only, in track order", async () => {
    seed([
      // Four on one objective and day: no per-day cap applies to raw counts.
      spec("D1.1", true, NOW - 3 * DAY),
      spec("D1.1", true, NOW - 3 * DAY),
      spec("D1.1", true, NOW - 3 * DAY),
      spec("D1.1", false, NOW - 3 * DAY),
      spec("D1.2", true, NOW - 90 * DAY),
      spec("D3.1", false, NOW - 2 * DAY),
      spec("D7.3", true, NOW - DAY, "CCDV-F"),
    ]);
    const out = await items("--track", "CCAR-F");
    expect(out.track).toBe("CCAR-F");
    expect(out.total).toBe(6);
    expect(out.domains.map((d) => [d.id, d.weight])).toEqual([
      ["D1", 27],
      ["D2", 18],
      ["D3", 20],
      ["D4", 20],
      ["D5", 15],
    ]);
    const [d1, d2, d3] = out.domains;
    expect(d1).toMatchObject({ items: 5, correct: 4, lastAt: NOW - 3 * DAY });
    expect(d1?.objectives.slice(0, 3)).toEqual([
      { id: "D1.1", items: 4, correct: 3 },
      { id: "D1.2", items: 1, correct: 1 },
      { id: "D1.3", items: 0, correct: 0 },
    ]);
    expect(d1?.objectives).toHaveLength(7);
    expect(d2).toMatchObject({ items: 0, correct: 0, lastAt: null });
    expect(d3).toMatchObject({ items: 1, correct: 0, lastAt: NOW - 2 * DAY });
    expect(d1?.name).toBe(ccarF().domains[0]?.name);
  });

  test("an empty log gives zero totals and null lastAt", async () => {
    const out = await items("--track", "CCAR-F");
    expect(out.total).toBe(0);
    expect(out.domains.every((d) => d.lastAt === null && d.items === 0)).toBe(
      true,
    );
  });

  test("defaults to the active track; neither -> VALIDATION_FAILED, exit 1", async () => {
    const none = await run(sb.dir, ["exam-items"], await realCtx());
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(none.stderr).toContain("--track");
    expect(none.stderr).toContain("set-track");
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    expect((await items()).track).toBe("CCDV-F");
  });

  test("an unknown (well-formed) track -> VALIDATION_FAILED, exit 1", async () => {
    const result = await run(
      sb.dir,
      ["exam-items", "--track", "CCXX-F"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
  });

  test("--limit reads only the newest n log lines", async () => {
    seed([
      spec("D1.1", false, NOW - 4 * DAY),
      spec("D1.1", false, NOW - 3 * DAY),
      spec("D1.2", true, NOW - 2 * DAY),
      spec("D2.1", true, NOW - DAY),
    ]);
    const out = await items("--track", "CCAR-F", "--limit", "2");
    expect(out.total).toBe(2);
    expect(out.domains[0]).toMatchObject({ items: 1, correct: 1 });
    expect(out.domains[1]).toMatchObject({ items: 1, correct: 1 });
    expect((await items("--track", "CCAR-F", "--limit", "4")).total).toBe(4);
  });

  test.each([["0"], ["5001"], ["abc"], ["1.5"], ["-1"], [""]])(
    "--limit %j -> usage error, exit 2",
    async (limit) => {
      const result = await run(
        sb.dir,
        ["exam-items", "--track", "CCAR-F", "--limit", limit],
        await realCtx(),
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe(ITEMS_USAGE);
    },
  );

  test("--limit 5000 is accepted", async () => {
    const result = await run(
      sb.dir,
      ["exam-items", "--track", "CCAR-F", "--limit", "5000"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(0);
  });
});
