import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { userPromptSubmitHandler } from "../../../src/hooks/handlers/user-prompt-submit.ts";
import { isReviewDue } from "../../../src/internal/mastery.ts";
import type { Level } from "../../../src/internal/schema.ts";
import {
  CATALOG,
  NOW,
  loadStateAt,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const PLAN = "How do I use plan mode?";
// lastPassAt 0 and one pass: a 3-day interval, long elapsed at NOW (day 100).
const DUE = { introduced: true, lastPassAt: 0, passes: 1 } as const;

async function promptContext(): Promise<string> {
  const out = await userPromptSubmitHandler(
    payload({ prompt: PLAN }),
    makeDeps(sb.dir),
  );
  return out?.hookSpecificOutput?.additionalContext ?? "";
}

describe("UserPromptSubmit: mastered is silent even when a review is due", () => {
  test("the fixture really has a due review", () => {
    expect(isReviewDue(DUE.lastPassAt, DUE.passes, NOW)).toBe(true);
  });

  test.each(["Applied", "Fluent"] as const satisfies readonly Level[])(
    "a %s topic with a due review gets no tip directive",
    async (level) => {
      await seedProfile(sb.dir, { "plan-mode": { ...DUE, level } });
      const text = await promptContext();
      expect(text).not.toContain("Mentor tip due");
      expect(text).toBe("Mentor style hint: socratic.");
      const seg = (await loadStateAt(sb.dir)).segment;
      expect(seg.tipsEmitted).toBe(0);
      expect(seg.lastTipAt).toBeNull();
    },
  );

  test("control: a below-target topic in the same state still tips", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": { ...DUE, level: "Recalled" },
    });
    const text = await promptContext();
    expect(text).toContain('Mentor tip due on "Plan mode" (plan-mode)');
    expect((await loadStateAt(sb.dir)).segment.tipsEmitted).toBe(1);
  });
});

describe("SessionStart: a due review is surfaced as a review line", () => {
  async function summaryLines(): Promise<string[]> {
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    return (out?.hookSpecificOutput?.additionalContext ?? "").split("\n");
  }

  test("a due mastered topic yields exactly one review line and no below-target row", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": { ...DUE, level: "Applied" },
    });
    const rows = await summaryLines();
    expect(rows.filter((l) => l === "review due: plan-mode")).toHaveLength(1);
    expect(rows.filter((l) => l.includes("plan-mode"))).toEqual([
      "review due: plan-mode",
    ]);
    expect(rows.some((l) => l.includes("Mentor tip"))).toBe(false);
  });

  test("a mastered topic whose review is not due is not mentioned", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": {
        introduced: true,
        level: "Applied",
        lastPassAt: NOW,
        passes: 1,
      },
    });
    expect(
      (await summaryLines()).filter((l) => l.includes("plan-mode")),
    ).toEqual([]);
  });

  test("a mastered topic never passed (lastPassAt null) is not mentioned", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": { introduced: true, level: "Applied" },
    });
    expect(
      (await summaryLines()).filter((l) => l.includes("plan-mode")),
    ).toEqual([]);
  });

  test("review lines are capped at 5 and follow catalog order", async () => {
    const entries = CATALOG.filter((e) => e.enabled).slice(0, 8);
    const [notDue, ...due] = entries;
    if (notDue === undefined) throw new Error("fixture");
    const topics: Record<
      string,
      {
        introduced: true;
        level: Level;
        lastPassAt: number;
        passes: number;
      }
    > = {};
    // Seeded in reverse so catalog order cannot come from insertion order.
    for (const e of [...due].reverse()) {
      topics[e.id] = { ...DUE, level: e.targetLevel };
    }
    topics[notDue.id] = {
      introduced: true,
      level: notDue.targetLevel,
      lastPassAt: NOW,
      passes: 1,
    };
    await seedProfile(sb.dir, topics);
    const reviews = (await summaryLines()).filter((l) =>
      l.startsWith("review due: "),
    );
    expect(reviews).toEqual(due.slice(0, 5).map((e) => `review due: ${e.id}`));
    expect(reviews).not.toContain(`review due: ${notDue.id}`);
  });

  test("at-target topics are omitted from the below-target list", async () => {
    const [first, second] = CATALOG.filter((e) => e.enabled);
    if (first === undefined || second === undefined) throw new Error("fixture");
    await seedProfile(sb.dir, {
      [first.id]: { ...DUE, level: first.targetLevel },
      [second.id]: { ...DUE, level: "Introduced" },
    });
    const rows = await summaryLines();
    expect(rows.some((l) => l.startsWith(`${first.id}: `))).toBe(false);
    expect(rows.some((l) => l.startsWith(`${second.id}: Introduced`))).toBe(
      true,
    );
  });
});
