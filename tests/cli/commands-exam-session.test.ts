import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PENDING_TTL_MS } from "../../src/internal/exam-schema.ts";
import { defaultProfile } from "../../src/internal/state-schema.ts";
import { saveProfile } from "../../src/internal/store.ts";
import {
  NOW,
  SESSION,
  makeSandbox,
  read,
  readJson,
  run,
  runOk,
  type Sandbox,
} from "./helpers.ts";
import {
  SPEC_AGENT_SDK,
  SPEC_API_KEY,
  SPEC_STREAMING,
  THREE_ITEMS,
  USAGE_ANSWER,
  USAGE_BEGIN,
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
const lines = (name: string): Record<string, unknown>[] =>
  read(sb.dir, name)
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

const answer = async (
  answers: string,
  overrides = {},
): ReturnType<typeof run> =>
  run(sb.dir, ["exam-answer", "--answers", answers], await realCtx(overrides));

describe("exam-begin", () => {
  test("saves the pending exam (createdAt = now, keys sorted) and reports the count only", async () => {
    const result = await begin(sb.dir, THREE_ITEMS);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ pending: 3, replaced: false });
    expect(result.stdout).not.toMatch(/"key"|"B"|"A"/);
    expect(readJson(sb.dir, "exam-pending.json")).toMatchObject({
      v: 1,
      track: "CCDV-F",
      mode: "drill",
      createdAt: NOW,
      items: [
        {
          objective: "D7.3",
          topic: "api-key-handling",
          kind: "single",
          key: ["B"],
        },
        {
          objective: "D1.2",
          topic: "agent-sdk",
          kind: "multiple",
          key: ["A", "C"],
        },
        {
          objective: "D2.4",
          topic: "streaming-events",
          kind: "single",
          key: ["D"],
        },
      ],
    });
  });

  test("mock mode is stored", async () => {
    await runOk(
      sb.dir,
      [
        "exam-begin",
        "--track",
        "CCAR-F",
        "--mode",
        "mock",
        "--items",
        "D1.1|agentic-loop|single|A",
      ],
      await realCtx(),
    );
    expect(readJson(sb.dir, "exam-pending.json")).toMatchObject({
      track: "CCAR-F",
      mode: "mock",
    });
  });

  test("a second begin replaces the first and reports replaced:true", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    expect(await beginOk(sb.dir, SPEC_STREAMING)).toEqual({
      pending: 1,
      replaced: true,
    });
    const pending = readJson(sb.dir, "exam-pending.json") as {
      items: unknown[];
    };
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]).toMatchObject({ topic: "streaming-events" });
  });

  test("an EXPIRED pending exam is replaced too", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    const later = NOW + PENDING_TTL_MS + 5;
    const result = await begin(sb.dir, SPEC_STREAMING, { now: later });
    expect(result.exitCode).toBe(0);
    expect(readJson(sb.dir, "exam-pending.json")).toMatchObject({
      createdAt: later,
      items: [{ topic: "streaming-events" }],
    });
  });

  test("15 items are accepted", async () => {
    const items = Array.from({ length: 15 }, () => SPEC_API_KEY).join(";");
    expect(await beginOk(sb.dir, items)).toEqual({
      pending: 15,
      replaced: false,
    });
  });

  test.each([
    ["too few fields", "D7.3|api-key-handling|single"],
    ["too many fields", "D7.3|api-key-handling|single|B|x"],
    ["bad kind", "D7.3|api-key-handling|radio|B"],
    ["letter outside A-F", "D7.3|api-key-handling|single|G"],
    ["single with two letters", "D7.3|api-key-handling|single|A,B"],
    ["multiple with one letter", "D1.2|agent-sdk|multiple|A"],
    ["multiple with duplicate letters", "D1.2|agent-sdk|multiple|A,A"],
    ["multiple with six letters", "D1.2|agent-sdk|multiple|A,B,C,D,E,F"],
    ["empty letters", "D7.3|api-key-handling|single|"],
    ["empty items", ""],
    ["16 items", Array.from({ length: 16 }, () => SPEC_API_KEY).join(";")],
  ])("%s -> usage error, exit 2, nothing written", async (_n, items) => {
    const result = await begin(sb.dir, items);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(USAGE_BEGIN);
    expect(has("exam-pending.json")).toBe(false);
  });

  test("a bad mode is a usage error", async () => {
    const result = await begin(sb.dir, SPEC_API_KEY, {}, "CCDV-F", "practice");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(USAGE_BEGIN);
  });

  test("a missing flag is a usage error", async () => {
    const result = await run(
      sb.dir,
      ["exam-begin", "--track", "CCDV-F", "--items", SPEC_API_KEY],
      await realCtx(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(USAGE_BEGIN);
  });

  test.each([
    ["unknown (well-formed) track", "CCXX-F", SPEC_API_KEY],
    ["objective not in the track", "CCDV-F", "D9.9|api-key-handling|single|B"],
    ["topic not mapped by that objective", "CCDV-F", "D7.3|plan-mode|single|B"],
  ])(
    "%s -> VALIDATION_FAILED, exit 1, nothing written",
    async (_n, track, items) => {
      const result = await begin(sb.dir, items, {}, track);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
      expect(has("exam-pending.json")).toBe(false);
    },
  );

  test("a failed begin leaves an existing pending exam untouched", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    const before = read(sb.dir, "exam-pending.json");
    await begin(sb.dir, "D9.9|api-key-handling|single|B");
    expect(read(sb.dir, "exam-pending.json")).toBe(before);
  });
});

describe("exam-answer", () => {
  test("scores by exact set equality, case-insensitively and order-free, revealing keys only now", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    const out = await runOk(
      sb.dir,
      ["exam-answer", "--answers", "b;c,a;D"],
      await realCtx(),
    );
    expect(out).toMatchObject({
      results: [
        { index: 0, correct: true, key: ["B"] },
        { index: 1, correct: true, key: ["A", "C"] },
        { index: 2, correct: true, key: ["D"] },
      ],
      correctCount: 3,
      total: 3,
    });
  });

  test("multiple-response is all-or-nothing; wrong answers are scored false", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    const out = (await runOk(
      sb.dir,
      ["exam-answer", "--answers", "A;A,C,D;D"],
      await realCtx(),
    )) as { results: { correct: boolean }[]; correctCount: number };
    expect(out.results.map((r) => r.correct)).toEqual([false, false, true]);
    expect(out.correctCount).toBe(1);
  });

  test("a subset of a multiple key is wrong", async () => {
    await beginOk(sb.dir, SPEC_AGENT_SDK);
    const out = (await runOk(
      sb.dir,
      ["exam-answer", "--answers", "A"],
      await realCtx(),
    )) as { correctCount: number };
    expect(out.correctCount).toBe(0);
  });

  test("appends one quiz evidence event per item", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    await answer("B;A;D");
    expect(lines("evidence.jsonl")).toEqual([
      {
        channel: "quiz",
        topic: "api-key-handling",
        result: "positive",
        at: NOW,
        session: SESSION,
      },
      {
        channel: "quiz",
        topic: "agent-sdk",
        result: "negative",
        at: NOW,
        session: SESSION,
      },
      {
        channel: "quiz",
        topic: "streaming-events",
        result: "positive",
        at: NOW,
        session: SESSION,
      },
    ]);
  });

  test("appends one exam item per item with exactly the typed fields (no key or question text)", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    await answer("B;A,C;A");
    expect(lines("exam-items.jsonl")).toEqual([
      {
        v: 1,
        track: "CCDV-F",
        domain: "D7",
        objective: "D7.3",
        topic: "api-key-handling",
        kind: "single",
        mode: "drill",
        correct: true,
        at: NOW,
        session: SESSION,
      },
      {
        v: 1,
        track: "CCDV-F",
        domain: "D1",
        objective: "D1.2",
        topic: "agent-sdk",
        kind: "multiple",
        mode: "drill",
        correct: true,
        at: NOW,
        session: SESSION,
      },
      {
        v: 1,
        track: "CCDV-F",
        domain: "D2",
        objective: "D2.4",
        topic: "streaming-events",
        kind: "single",
        mode: "drill",
        correct: false,
        at: NOW,
        session: SESSION,
      },
    ]);
  });

  test("levels: one entry per distinct topic, equal to the stored profile and to record-batch", async () => {
    await beginOk(sb.dir, `${SPEC_API_KEY};${SPEC_API_KEY}`);
    const out = (await runOk(
      sb.dir,
      ["exam-answer", "--answers", "B;B"],
      await realCtx(),
    )) as { levels: Record<string, string> };
    expect(Object.keys(out.levels)).toEqual(["api-key-handling"]);
    const stored = readJson(sb.dir, "profile.json") as {
      topics: Record<string, { level: string }>;
    };
    expect(stored.topics["api-key-handling"]?.level).toBe(
      out.levels["api-key-handling"],
    );

    // Same two positive quiz events through record-batch must yield the same level.
    const other = makeSandbox();
    try {
      const batch = (await runOk(
        other.dir,
        [
          "record-batch",
          "--topic",
          "api-key-handling",
          "--events",
          "quiz:positive,quiz:positive",
        ],
        await realCtx(),
      )) as { level: string };
      expect(out.levels["api-key-handling"]).toBe(batch.level);
    } finally {
      other.cleanup();
    }
  });

  test("passes and lastPassAt are left untouched", async () => {
    await saveProfile(sb.dir, {
      ...defaultProfile(),
      topics: {
        "api-key-handling": {
          introduced: true,
          level: "Introduced",
          lastPassAt: NOW - 5,
          passes: 2,
        },
      },
    });
    await beginOk(sb.dir, SPEC_API_KEY);
    await answer("B");
    const stored = readJson(sb.dir, "profile.json") as {
      topics: Record<string, { passes: number; lastPassAt: number | null }>;
    };
    expect(stored.topics["api-key-handling"]).toMatchObject({
      passes: 2,
      lastPassAt: NOW - 5,
    });
  });

  test("deletes the pending exam, so answering again is VALIDATION_FAILED", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    await answer("B;A,C;D");
    expect(has("exam-pending.json")).toBe(false);
    const again = await answer("B;A,C;D");
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(lines("exam-items.jsonl")).toHaveLength(3);
  });

  test("no pending exam -> VALIDATION_FAILED, exit 1, nothing written", async () => {
    const result = await answer("B");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(has("exam-items.jsonl")).toBe(false);
    expect(has("evidence.jsonl")).toBe(false);
  });

  test("an expired pending exam -> VALIDATION_FAILED, file left in place, nothing recorded", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    const result = await answer("B", { now: NOW + PENDING_TTL_MS + 1 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(has("exam-pending.json")).toBe(true);
    expect(has("exam-items.jsonl")).toBe(false);
    expect(has("evidence.jsonl")).toBe(false);
  });

  test("a pending exam exactly at the TTL is still answerable", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    const result = await answer("B", { now: NOW + PENDING_TTL_MS });
    expect(result.exitCode).toBe(0);
  });

  test.each([
    ["duplicate letters in a multiple group", "B;A,A;D"],
    ["duplicate letters in a single group", "B;A,C;D,D"],
    ["letter outside A-F", "B;A,C;G"],
    ["empty group", "B;;D"],
    ["junk", "B;A C;D"],
  ])(
    "%s -> usage error, exit 2, pending kept, nothing recorded",
    async (_n, answers) => {
      await beginOk(sb.dir, THREE_ITEMS);
      const result = await answer(answers);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(USAGE_ANSWER);
      expect(has("exam-pending.json")).toBe(true);
      expect(has("exam-items.jsonl")).toBe(false);
      expect(has("evidence.jsonl")).toBe(false);
    },
  );
});

describe("exam-answer count mismatch", () => {
  test.each([
    ["too few groups", "B;A"],
    ["too many groups", "B;A,C;D;A"],
  ])(
    "%s -> VALIDATION_FAILED, exit 1, pending kept, nothing recorded",
    async (_n, answers) => {
      await beginOk(sb.dir, THREE_ITEMS);
      const result = await answer(answers);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
      expect(has("exam-pending.json")).toBe(true);
      expect(has("exam-items.jsonl")).toBe(false);
      expect(has("evidence.jsonl")).toBe(false);
    },
  );
});

describe("exam flow, other commands and purge", () => {
  test("an exam flow changes only the level of the answered topics in the topics view", async () => {
    type Row = { id: string; level: string } & Record<string, unknown>;
    type View = { topics: Row[]; shadowedCustom: unknown };
    const ctx = await realCtx();
    const before = (await runOk(sb.dir, ["topics"], ctx)) as View;
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], ctx);
    await beginOk(sb.dir, SPEC_API_KEY);
    await answer("B");
    const after = (await runOk(sb.dir, ["topics"], ctx)) as View;

    expect(after.shadowedCustom).toEqual(before.shadowedCustom);
    expect(after.topics.map((row) => row.id)).toEqual(
      before.topics.map((row) => row.id),
    );
    const withoutLevel = (row: Row): Record<string, unknown> => {
      const { level: _level, ...rest } = row;
      return rest;
    };
    expect(after.topics.map(withoutLevel)).toEqual(
      before.topics.map(withoutLevel),
    );

    const changed = after.topics
      .filter((row, i) => row.level !== before.topics[i]?.level)
      .map((row) => row.id);
    expect(changed).toEqual(["api-key-handling"]);
    const stored = readJson(sb.dir, "profile.json") as {
      topics: Record<string, { level: string }>;
    };
    expect(
      after.topics.find((row) => row.id === "api-key-handling")?.level,
    ).toBe(stored.topics["api-key-handling"]?.level);
    expect((await run(sb.dir, ["show"], ctx)).exitCode).toBe(0);
  });

  test("purge deletes exam-items.jsonl and exam-pending.json", async () => {
    await beginOk(sb.dir, SPEC_API_KEY);
    await answer("B");
    await beginOk(sb.dir, SPEC_STREAMING);
    expect(has("exam-items.jsonl")).toBe(true);
    expect(has("exam-pending.json")).toBe(true);
    await runOk(sb.dir, ["purge", "--confirm"], await realCtx());
    expect(has("exam-items.jsonl")).toBe(false);
    expect(has("exam-pending.json")).toBe(false);
  });

  test("the general usage line lists every exam command", async () => {
    const result = await run(sb.dir, [], await realCtx());
    const listed = /commands: ([^\n]+)/.exec(result.stderr)?.[1] ?? "";
    for (const name of [
      "tracks",
      "set-track",
      "exam-begin",
      "exam-answer",
      "readiness",
      "exam-items",
    ]) {
      expect(listed.split(", "), name).toContain(name);
    }
  });
});
