import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userPromptSubmitHandler } from "../../../src/hooks/handlers/user-prompt-submit.ts";
import {
  NOW,
  loadStateAt,
  makeDeps,
  makeSandbox,
  payload,
  seedState,
  snapshot,
  type Sandbox,
} from "./helpers.ts";
import {
  fakeLock,
  lockFiles,
  releasingLock,
  runWithLock,
  seedForeignLock,
} from "./lock-helpers.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = makeSandbox();
  await seedState(sb.dir);
});
afterEach(() => {
  sb.cleanup();
});

const PLAN = "How do I use plan mode?";
const TIP_MARK = "Mentor tip due";

describe("UserPromptSubmit when the lock times out (fails closed)", () => {
  test("a prompt that would tip gets the style hint but no tip; one note; state untouched", async () => {
    seedForeignLock(sb.dir);
    const before = snapshot(sb.dir);
    const { lock, sleeps } = fakeLock();
    const out = await userPromptSubmitHandler(
      payload({ prompt: PLAN }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(out?.systemMessage).toBeUndefined();
    expect(out?.hookSpecificOutput?.additionalContext).toBe(
      "Mentor style hint: explain-demo.",
    );
    expect(out?.note).toMatch(/LOCK_TIMEOUT/);
    expect(snapshot(sb.dir)).toEqual(before);
  });

  test("through runHookCore: JSON context on stdout and exactly one stderr line", async () => {
    seedForeignLock(sb.dir);
    const { lock } = fakeLock();
    const result = await runWithLock(
      "UserPromptSubmit",
      userPromptSubmitHandler,
      payload({ prompt: PLAN }),
      sb.dir,
      lock,
    );
    expect(result.stderr).toMatch(
      /^m3l-claude-mentor: UserPromptSubmit: .*LOCK_TIMEOUT.*\n$/,
    );
    expect(result.stdout).not.toContain(TIP_MARK);
    expect(result.stdout).toContain("Mentor style hint:");
  });

  test("the teach offer survives, the tip does not", async () => {
    seedForeignLock(sb.dir);
    const { lock } = fakeLock();
    const out = await userPromptSubmitHandler(
      payload({ prompt: "teach me about plan mode" }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    const text = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(text).toContain("Mentor style hint:");
    expect(text).toContain("/m3l-claude-mentor:teach plan-mode");
    expect(text).not.toContain(TIP_MARK);
  });

  test.each([
    ["stop tips", "please stop tips"],
    ["stop tips about a topic", "stop tips about plan mode"],
  ])(
    "a '%s' intent is not persisted and its notice is suppressed",
    async (_n, prompt) => {
      seedForeignLock(sb.dir);
      const before = snapshot(sb.dir);
      const { lock } = fakeLock();
      const out = await userPromptSubmitHandler(
        payload({ prompt }),
        makeDeps(sb.dir, { lockOptions: lock }),
      );
      expect(out?.systemMessage).toBeUndefined();
      expect(out?.note).toMatch(/LOCK_TIMEOUT/);
      expect(out?.hookSpecificOutput?.additionalContext ?? "").not.toContain(
        TIP_MARK,
      );
      expect(snapshot(sb.dir)).toEqual(before);
    },
  );

  test("a resume intent while muted is not persisted and its notice is suppressed", async () => {
    await seedState(sb.dir, { muted: true });
    seedForeignLock(sb.dir);
    const before = snapshot(sb.dir);
    const { lock } = fakeLock();
    const out = await userPromptSubmitHandler(
      payload({ prompt: "resume tips" }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.systemMessage).toBeUndefined();
    expect(out?.note).toMatch(/LOCK_TIMEOUT/);
    expect(snapshot(sb.dir)).toEqual(before);
    expect((await loadStateAt(sb.dir)).muted).toBe(true);
  });
});

describe("UserPromptSubmit with no lock held", () => {
  test("behaves as before: tip, persisted segment, no note, no lock file", async () => {
    const { lock } = fakeLock();
    const out = await userPromptSubmitHandler(
      payload({ prompt: PLAN }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.hookSpecificOutput?.additionalContext).toContain(TIP_MARK);
    expect(out?.note).toBeUndefined();
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.tipsEmitted).toBe(1);
    expect(seg.lastTipAt).toBe(NOW);
    expect(lockFiles(sb.dir)).toEqual([]);
  });

  test("stop tips still mutes, persists and notifies, with no lock file left", async () => {
    const { lock } = fakeLock();
    const out = await userPromptSubmitHandler(
      payload({ prompt: "please stop tips" }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.systemMessage).toContain("Mentor tips muted");
    expect((await loadStateAt(sb.dir)).muted).toBe(true);
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});

describe("UserPromptSubmit and a muted learner under lock contention", () => {
  test.each([
    ["a topic prompt", PLAN],
    ["a teach prompt", "teach me about plan mode"],
  ])(
    "%s: output is null-equivalent, only the LOCK_TIMEOUT note on stderr",
    async (_n, prompt) => {
      await seedState(sb.dir, { muted: true });
      seedForeignLock(sb.dir);
      const before = snapshot(sb.dir);
      const { lock } = fakeLock();
      const result = await runWithLock(
        "UserPromptSubmit",
        userPromptSubmitHandler,
        payload({ prompt }),
        sb.dir,
        lock,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /^m3l-claude-mentor: UserPromptSubmit: .*LOCK_TIMEOUT.*\n$/,
      );
      expect(snapshot(sb.dir)).toEqual(before);
    },
  );

  test("not muted keeps the style hint plus the note, and no tip", async () => {
    seedForeignLock(sb.dir);
    const { lock } = fakeLock();
    const result = await runWithLock(
      "UserPromptSubmit",
      userPromptSubmitHandler,
      payload({ prompt: PLAN }),
      sb.dir,
      lock,
    );
    expect(result.stdout).toContain("Mentor style hint:");
    expect(result.stdout).not.toContain(TIP_MARK);
    expect(result.stderr).toMatch(/LOCK_TIMEOUT/);
  });

  test("a corrupt state.json on the timeout branch is not swallowed into a note", async () => {
    writeFileSync(join(sb.dir, "state.json"), "{not json");
    seedForeignLock(sb.dir);
    const { lock } = fakeLock();
    const result = await runWithLock(
      "UserPromptSubmit",
      userPromptSubmitHandler,
      payload({ prompt: PLAN }),
      sb.dir,
      lock,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^m3l-claude-mentor: UserPromptSubmit: [A-Z_]+: [^\n]+\n$/,
    );
    expect(result.stderr).not.toContain("LOCK_TIMEOUT");
    expect(readFileSync(join(sb.dir, "state.json"), "utf8")).toBe("{not json");
  });
});

describe("UserPromptSubmit non-timeout errors in the lock path are not turned into notes", () => {
  test("a corrupt state.json (no lock held) gives one stderr line, empty stdout, no tip", async () => {
    writeFileSync(join(sb.dir, "state.json"), "{not json");
    const { lock } = fakeLock();
    const result = await runWithLock(
      "UserPromptSubmit",
      userPromptSubmitHandler,
      payload({ prompt: PLAN }),
      sb.dir,
      lock,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^m3l-claude-mentor: UserPromptSubmit: [A-Z_]+: [^\n]+\n$/,
    );
    expect(result.stderr).not.toContain("LOCK_TIMEOUT");
    expect(result.stderr).not.toContain(TIP_MARK);
    expect(readFileSync(join(sb.dir, "state.json"), "utf8")).toBe("{not json");
    expect(lockFiles(sb.dir)).toEqual([]);
  });

  test("an unwritable data dir is a WRITE_FAILED line, not a LOCK_TIMEOUT note", async (ctx) => {
    if (process.platform === "win32" || process.getuid?.() === 0) ctx.skip();
    const before = snapshot(sb.dir);
    chmodSync(sb.dir, 0o500);
    try {
      const { lock, sleeps } = fakeLock();
      const result = await runWithLock(
        "UserPromptSubmit",
        userPromptSubmitHandler,
        payload({ prompt: PLAN }),
        sb.dir,
        lock,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /^m3l-claude-mentor: UserPromptSubmit: WRITE_FAILED: [^\n]+\n$/,
      );
      expect(result.stderr).not.toContain("LOCK_TIMEOUT");
      expect(sleeps).toEqual([]);
    } finally {
      chmodSync(sb.dir, 0o700);
    }
    expect(snapshot(sb.dir)).toEqual(before);
  });
});

describe("UserPromptSubmit decides from state read INSIDE the lock", () => {
  test("a tip recorded by a competitor while we waited is honoured: no second tip", async () => {
    // A competitor in another data dir tips first; its resulting state.json is
    // what lands in ours while our hook waits for the foreign lock.
    const rival = join(sb.root, "rival");
    mkdirSync(rival);
    await seedState(rival);
    await userPromptSubmitHandler(payload({ prompt: PLAN }), makeDeps(rival));
    const competing = join(rival, "state.json");
    expect(
      (
        JSON.parse(readFileSync(competing, "utf8")) as {
          segment: { tipsEmitted: number };
        }
      ).segment.tipsEmitted,
    ).toBe(1);

    seedForeignLock(sb.dir);
    const { lock } = releasingLock(sb.dir, () => {
      copyFileSync(competing, join(sb.dir, "state.json"));
    });
    const out = await userPromptSubmitHandler(
      payload({ prompt: PLAN }),
      makeDeps(sb.dir, { lockOptions: lock }),
    );
    expect(out?.hookSpecificOutput?.additionalContext ?? "").not.toContain(
      TIP_MARK,
    );
    expect((await loadStateAt(sb.dir)).segment.tipsEmitted).toBe(1);
    expect(lockFiles(sb.dir)).toEqual([]);
  });
});
