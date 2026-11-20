import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import {
  CATALOG,
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

const ORIGINAL = CATALOG.slice(0, 25);
const EXAM = CATALOG.slice(25);

describe("the bundled exam topics never surface at SessionStart", () => {
  test("the fixture splits the real catalog into 25 original and 49 ambient:false topics", () => {
    expect(ORIGINAL).toHaveLength(25);
    expect(EXAM).toHaveLength(49);
    expect(EXAM.every((e) => e.ambient === false && e.enabled)).toBe(true);
    expect(ORIGINAL.every((e) => e.ambient !== false)).toBe(true);
  });

  test("a learner with every original topic at target gets no below-target block", async () => {
    await seedProfile(
      sb.dir,
      Object.fromEntries(
        ORIGINAL.map((e) => [e.id, { introduced: true, level: e.targetLevel }]),
      ),
    );
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    const context = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(context).not.toContain("topics below target:");
    for (const e of EXAM) expect(context).not.toContain(e.id);
  });

  test("control: dropping one original topic below target does produce the block", async () => {
    const first = ORIGINAL[0];
    if (first === undefined) throw new Error("catalog empty");
    await seedProfile(
      sb.dir,
      Object.fromEntries(
        ORIGINAL.slice(1).map((e) => [
          e.id,
          { introduced: true, level: e.targetLevel },
        ]),
      ),
    );
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    const context = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("topics below target:");
    expect(context).toContain(first.id);
  });
});
