import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PENDING_TTL_MS } from "../../src/internal/exam-schema.ts";
import {
  NOW,
  makeSandbox,
  put,
  read,
  run,
  runOk,
  type Sandbox,
} from "./helpers.ts";
import {
  SPEC_API_KEY,
  SPEC_STREAMING,
  THREE_ITEMS,
  begin,
  beginOk,
  realCtx,
} from "./exam-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const has = (name: string): boolean => existsSync(join(sb.dir, name));
const answer = async (
  answers: string,
  overrides = {},
): ReturnType<typeof run> =>
  run(sb.dir, ["exam-answer", "--answers", answers], await realCtx(overrides));
const nothingRecorded = (): void => {
  expect(has("evidence.jsonl")).toBe(false);
  expect(has("exam-items.jsonl")).toBe(false);
};

describe("topics are validated against the MERGED catalog", () => {
  test("exam-begin: a topic the track maps but the merged catalog lacks -> VALIDATION_FAILED, nothing written, no input echoed", async () => {
    // The default test context's bundled catalog has no api-key-handling.
    const result = await run(sb.dir, [
      "exam-begin",
      "--track",
      "CCDV-F",
      "--mode",
      "drill",
      "--items",
      SPEC_API_KEY,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).toContain("catalog");
    expect(result.stderr).not.toContain("api-key-handling");
    expect(has("exam-pending.json")).toBe(false);
  });

  test("exam-answer: a pending topic missing from the merged catalog -> VALIDATION_FAILED (exit 1, not 2), nothing written, pending kept", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    const before = read(sb.dir, "exam-pending.json");
    const result = await run(sb.dir, ["exam-answer", "--answers", "B"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).not.toContain("api-key-handling");
    expect(read(sb.dir, "exam-pending.json")).toBe(before);
    nothingRecorded();
  });
});

describe("exam-answer state errors exit 1, in a fixed order", () => {
  test("expired beats a count mismatch: an expired exam answered with the wrong count reports 'expired'", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    const result = await answer("B", { now: NOW + PENDING_TTL_MS + 1 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).toContain("expired");
  });

  test("a missing pending exam beats a count mismatch: 'no pending exam'", async () => {
    const result = await answer("B;A");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).toContain("no pending exam");
  });
});

describe("a corrupt pending file", () => {
  const SECRET = "SECRETMARK";
  const corrupt: [string, string][] = [
    ["unparseable JSON", `{${SECRET}`],
    ["a JSON object of the wrong shape", `{"v":1,"note":"${SECRET}"}`],
    ["an oversize file", `${SECRET}${"x".repeat(70_000)}`],
  ];

  test.each(corrupt)(
    "exam-begin replaces %s and reports replaced:true",
    async (_n, content) => {
      put(sb.dir, "exam-pending.json", content);
      const result = await begin(sb.dir, SPEC_STREAMING);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ pending: 1, replaced: true });
      expect(read(sb.dir, "exam-pending.json")).toContain("streaming-events");
      expect(read(sb.dir, "exam-pending.json")).not.toContain(SECRET);
    },
  );

  test("exam-begin does NOT replace a pending path that cannot be read (a directory -> READ_FAILED, exit 1)", async () => {
    mkdirSync(join(sb.dir, "exam-pending.json"), { recursive: true });
    const result = await begin(sb.dir, SPEC_STREAMING);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^READ_FAILED: /);
    expect(statSync(join(sb.dir, "exam-pending.json")).isDirectory()).toBe(
      true,
    );
  });

  test("exam-answer rethrows a pending path that cannot be read (a directory -> READ_FAILED, not 'start a new exam'), nothing written", async () => {
    put(sb.dir, "profile.json", '{"marker":1}');
    mkdirSync(join(sb.dir, "exam-pending.json"), { recursive: true });
    const result = await answer("B");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^READ_FAILED: /);
    expect(result.stderr).not.toContain("VALIDATION_FAILED");
    expect(result.stderr).not.toContain("exam-begin");
    nothingRecorded();
    expect(read(sb.dir, "profile.json")).toBe('{"marker":1}');
    expect(statSync(join(sb.dir, "exam-pending.json")).isDirectory()).toBe(
      true,
    );
  });

  test.each(corrupt)(
    "exam-answer with %s -> VALIDATION_FAILED pointing at exam-begin; content never echoed; nothing written",
    async (_n, content) => {
      put(sb.dir, "exam-pending.json", content);
      const result = await answer("B");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
      expect(result.stderr).toContain("exam-begin");
      expect(result.stderr).not.toContain(SECRET);
      nothingRecorded();
    },
  );
});

describe("partial failures of exam-answer", () => {
  const seed = async (): Promise<void> => {
    await beginOk(sb.dir, THREE_ITEMS);
  };

  test("an evidence append that fails: 'recorded 0 of 3 events; no exam item was recorded', pending kept, no exam items", async () => {
    await seed();
    mkdirSync(join(sb.dir, "evidence.jsonl"));
    const result = await answer("B;A,C;D");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toContain(
      "recorded 0 of 3 events; no exam item was recorded",
    );
    expect(has("exam-pending.json")).toBe(true);
    expect(has("exam-items.jsonl")).toBe(false);
    expect(has("profile.json")).toBe(false);
  });

  test("an exam-item append that fails: all events recorded, 0 of 3 items, profile not updated, pending kept", async () => {
    await runOk(sb.dir, ["set-mute", "off"]);
    await seed();
    mkdirSync(join(sb.dir, "exam-items.jsonl"));
    const result = await answer("B;A,C;D");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toContain("recorded 3 events and 0 of 3 exam items");
    expect(result.stderr).toContain("profile was not updated");
    expect(read(sb.dir, "evidence.jsonl").trimEnd().split("\n")).toHaveLength(
      3,
    );
    expect(has("exam-pending.json")).toBe(true);
    expect(has("profile.json")).toBe(false);
  });
});

describe("syntax stays a usage error", () => {
  test("a duplicate letter leaves pending, items and evidence untouched", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    const before = read(sb.dir, "exam-pending.json");
    const result = await answer("B;A,A;D");
    expect(result.exitCode).toBe(2);
    expect(read(sb.dir, "exam-pending.json")).toBe(before);
    nothingRecorded();
  });
});

describe("a stored activeTrack that is no longer bundled", () => {
  const STALE = "CCXX-F";
  beforeEach(async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    const path = join(sb.dir, "state.json");
    const state = JSON.parse(read(sb.dir, "state.json")) as Record<
      string,
      unknown
    >;
    writeFileSync(path, JSON.stringify({ ...state, activeTrack: STALE }));
  });

  test.each([["readiness"], ["exam-items"]])(
    "%s without --track -> VALIDATION_FAILED mentioning set-track --clear",
    async (command) => {
      const result = await run(sb.dir, [command], await realCtx());
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
      expect(result.stderr).toContain("set-track --clear");
    },
  );

  test("an explicit --track still works", async () => {
    const out = (await runOk(
      sb.dir,
      ["readiness", "--track", "CCDV-F"],
      await realCtx(),
    )) as { track: string };
    expect(out.track).toBe("CCDV-F");
  });

  test("get-profile reports the stale code and no topic weights", async () => {
    const out = (await runOk(sb.dir, ["get-profile"], await realCtx())) as {
      activeTrack: string | null;
      activeTrackTopics: Record<string, number>;
    };
    expect(out.activeTrack).toBe(STALE);
    expect(out.activeTrackTopics).toEqual({});
  });

  test("tracks reports active as the stale code", async () => {
    const out = (await runOk(sb.dir, ["tracks"], await realCtx())) as {
      active: string | null;
    };
    expect(out.active).toBe(STALE);
  });
});
