import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { postCompactHandler } from "../../../src/hooks/handlers/post-compact.ts";
import { postToolUseHandler } from "../../../src/hooks/handlers/post-tool-use.ts";
import { stopHandler } from "../../../src/hooks/handlers/stop.ts";
import type { HookHandler } from "../../../src/hooks/runtime.ts";
import {
  NOW,
  SESSION,
  makeSandbox,
  seedProfile,
  seedState,
  snapshot,
  type Sandbox,
} from "./helpers.ts";
import {
  FOREIGN,
  LOCK,
  fakeLock,
  lockFiles,
  noWaitLock,
  runWithLock,
  seedForeignLock,
} from "./lock-helpers.ts";
import { appendEvidence } from "../../../src/internal/store.ts";
import { parseEvidence } from "../../../src/internal/schema.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = makeSandbox();
  await seedState(sb.dir, { muted: true });
  await seedProfile(sb.dir, { "plan-mode": { level: "Recalled" } });
  const e = parseEvidence({
    channel: "quiz",
    topic: "plan-mode",
    result: "positive",
    at: 1,
    session: "other",
  });
  if (!e.ok) throw new Error("fixture");
  await appendEvidence(sb.dir, e.value);
});
afterEach(() => {
  sb.cleanup();
});

const HANDLERS: readonly (readonly [
  string,
  HookHandler,
  Record<string, unknown>,
])[] = [
  ["Stop", stopHandler, { session_id: SESSION }],
  ["PostCompact", postCompactHandler, { session_id: SESSION }],
  [
    "PostToolUse",
    postToolUseHandler,
    { session_id: SESSION, tool_name: "Skill", tool_input: {} },
  ],
];

describe.each(HANDLERS)("%s", (name, handler, payload) => {
  test("a fresh foreign lock gives one LOCK_TIMEOUT stderr line, empty stdout, nothing written", async () => {
    seedForeignLock(sb.dir);
    const before = snapshot(sb.dir);
    const { lock, sleeps } = fakeLock();
    const result = await runWithLock(name, handler, payload, sb.dir, lock);
    expect(result.stderr).toMatch(
      new RegExp(`^m3l-claude-mentor: ${name}: LOCK_TIMEOUT: .+\\n$`),
    );
    expect(result.stderr).not.toContain("424242");
    expect(result.stdout).toBe("");
    expect(sleeps.length).toBeGreaterThan(0);
    expect(snapshot(sb.dir)).toEqual(before);
    expect(readFileSync(join(sb.dir, LOCK), "utf8")).toBe(FOREIGN);
  });

  test("without a lock it runs as before and leaves no lock file", async () => {
    const { lock } = fakeLock();
    const result = await runWithLock(name, handler, payload, sb.dir, lock);
    expect(result).toEqual({ stdout: "", stderr: "" });
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});

describe("what each handler writes when it does get the lock", () => {
  const LATER = NOW + 60_000;

  test.each([
    ["Stop", stopHandler],
    ["PostCompact", postCompactHandler],
  ] as const)(
    "%s touches the segment, so state.json changes",
    async (name, handler) => {
      const { lock } = fakeLock();
      const before = snapshot(sb.dir)?.["state.json"];
      const result = await runWithLock(
        name,
        handler,
        { session_id: SESSION },
        sb.dir,
        lock,
        { now: LATER },
      );
      expect(result).toEqual({ stdout: "", stderr: "" });
      expect(snapshot(sb.dir)?.["state.json"]).not.toBe(before);
      expect(lockFiles(sb.dir)).toEqual([]);
    },
  );

  test("PostToolUse appends one event", async () => {
    const { lock } = fakeLock();
    const before = snapshot(sb.dir)?.["evidence.jsonl"];
    await runWithLock(
      "PostToolUse",
      postToolUseHandler,
      { session_id: SESSION, tool_name: "Skill", tool_input: {} },
      sb.dir,
      lock,
    );
    expect(snapshot(sb.dir)?.["evidence.jsonl"]).not.toBe(before);
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});

describe("PostToolUse returns before the lock for an excluded or unknown project", () => {
  test.each([
    ["inside an excluded project", { cwd: "/a/b/c" }],
    ["a null cwd while projects are excluded", {}],
  ])("%s: no wait, no note, no evidence", async (_n, extra) => {
    await seedState(sb.dir, { excludedProjects: ["/a/b"] });
    seedForeignLock(sb.dir);
    const before = snapshot(sb.dir);
    const result = await runWithLock(
      "PostToolUse",
      postToolUseHandler,
      { session_id: SESSION, tool_name: "Skill", tool_input: {}, ...extra },
      sb.dir,
      noWaitLock(),
    );
    expect(result).toEqual({ stdout: "", stderr: "" });
    expect(snapshot(sb.dir)).toEqual(before);
  });
});
