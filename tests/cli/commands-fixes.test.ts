import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { makeSandbox, runOk, seedEvidence, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

describe("recompute evidenceSkipped", () => {
  test("counts a malformed evidence line and still computes the level", async () => {
    await seedEvidence(sb.dir, "context-window", "quiz", "positive", 2);
    appendFileSync(join(sb.dir, "evidence.jsonl"), "{not json\n");
    await seedEvidence(sb.dir, "context-window", "observed", "positive", 2);
    const out = (await runOk(sb.dir, [
      "recompute",
      "--topic",
      "context-window",
    ])) as { evidenceSkipped: number; level: string };
    expect(out.evidenceSkipped).toBe(1);
    expect(typeof out.level).toBe("string");
  });

  test("is 0 when no line is skipped", async () => {
    await seedEvidence(sb.dir, "context-window", "quiz", "positive", 1);
    const out = (await runOk(sb.dir, [
      "recompute",
      "--topic",
      "context-window",
    ])) as { evidenceSkipped: number };
    expect(out.evidenceSkipped).toBe(0);
  });
});
