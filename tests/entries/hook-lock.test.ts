import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runEntryAsync, type AsyncResult } from "./spawn-async.ts";

const STOP = "hooks/entry-stop.ts";
const COMPACT = "hooks/entry-post-compact.ts";
const POST = "hooks/entry-post-tool-use.ts";
const PROMPT = "hooks/entry-user-prompt-submit.ts";
const LOCK = ".state.lock";
const FOREIGN = JSON.stringify({
  v: 1,
  pid: 424242,
  host: "foreign-host-xyz",
  token: "foreign-token",
  createdAt: 0,
});

let root: string;
let dir: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "hook-lock-")));
  dir = join(root, "data");
  mkdirSync(dir);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const json = (extra: Record<string, unknown>): string =>
  JSON.stringify({ session_id: "s1", ...extra });
const SKILL = { tool_name: "Skill", tool_input: {} };
const PLAN = { prompt: "How do I use plan mode?" };
const lockFiles = (): string[] =>
  readdirSync(dir).filter((n) => n.startsWith(LOCK));
const evidenceLines = (): string[] => {
  try {
    return readFileSync(join(dir, "evidence.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "");
  } catch {
    return [];
  }
};

function runAll(
  entry: string,
  inputs: readonly string[],
): Promise<AsyncResult[]> {
  const startAt = Date.now() + 1500;
  return Promise.all(
    inputs.map((input) =>
      runEntryAsync(entry, { input, dataDir: dir, startAt }),
    ),
  );
}

// The seeded foreign lock's mtime is "now": a child that took more than ~5 s
// to start would find it stale and break it, so keep these single-process.
describe("a held foreign lock, real process, real 2 s wait", () => {
  test.each([
    ["Stop", STOP, json({})],
    ["PostToolUse", POST, json(SKILL)],
  ] as const)(
    "%s exits 0 within ~4 s with one LOCK_TIMEOUT stderr line and empty stdout",
    async (name, entry, input) => {
      writeFileSync(join(dir, LOCK), FOREIGN);
      const r = await runEntryAsync(entry, { input, dataDir: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(
        new RegExp(`^m3l-mentor: ${name}: LOCK_TIMEOUT: .+\\n$`),
      );
      expect(r.elapsedMs).toBeGreaterThanOrEqual(1800); // it really waited
      expect(r.elapsedMs).toBeLessThan(8000);
      expect(readFileSync(join(dir, LOCK), "utf8")).toBe(FOREIGN);
    },
    15_000,
  );

  test("UserPromptSubmit fails closed: style hint only, no tip, one stderr line", async () => {
    writeFileSync(join(dir, LOCK), FOREIGN);
    const r = await runEntryAsync(PROMPT, { input: json(PLAN), dataDir: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(
      /^m3l-mentor: UserPromptSubmit: .*LOCK_TIMEOUT.*\n$/,
    );
    expect(r.elapsedMs).toBeGreaterThanOrEqual(1800); // it really waited
    expect(r.elapsedMs).toBeLessThan(8000);
    const out = JSON.parse(r.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "Mentor style hint:",
    );
    expect(out.hookSpecificOutput.additionalContext).not.toContain(
      "Mentor tip due",
    );
    expect(readdirSync(dir).filter((n) => n === "state.json")).toEqual([]);
    expect(readFileSync(join(dir, LOCK), "utf8")).toBe(FOREIGN);
  }, 15_000);
});

/**
 * Under load a hook may legitimately wait past its 2 s lock timeout; that is
 * the designed degradation (it skips its write and prints one LOCK_TIMEOUT
 * line). So each process is either "landed" (clean) or "timedOut" (exit 0 and
 * exactly one LOCK_TIMEOUT stderr line), never a crash and never both. The
 * tests assert invariants that hold either way.
 */
function outcome(r: AsyncResult): "landed" | "timedOut" {
  expect(r.status).toBe(0);
  if (r.stderr === "") return "landed";
  expect(r.stderr).toMatch(/^m3l-mentor: [A-Za-z]+: .*LOCK_TIMEOUT.*\n$/);
  return "timedOut";
}

describe("parallel PostToolUse processes (a realistic 2 to 4)", () => {
  test.each([2, 4])(
    "%s processes with the same session and topic append exactly one event",
    async (n) => {
      const results = await runAll(
        POST,
        Array.from({ length: n }, () => json(SKILL)),
      );
      const outcomes = results.map(outcome);
      // The first process to take the lock always lands; all others see its event.
      expect(outcomes).toContain("landed");
      expect(evidenceLines()).toHaveLength(1);
      expect(lockFiles()).toEqual([]);
    },
    60_000,
  );

  test("distinct topics: each landed process's topics are recorded exactly once, timed-out ones record nothing", async () => {
    const specs: readonly (readonly [string, readonly string[]])[] = [
      [json(SKILL), ["skills"]],
      [json({ tool_name: "Agent", tool_input: {} }), ["subagents"]],
      [json({ tool_name: "EnterPlanMode", tool_input: {} }), ["plan-mode"]],
      [
        json({
          tool_name: "Write",
          tool_input: {
            file_path: "/p/.claude/settings.json",
            content: '{"hooks": {}}',
          },
        }),
        ["hooks", "settings-scopes"],
      ],
    ];
    const results = await runAll(
      POST,
      specs.map(([input]) => input),
    );
    const outcomes = results.map(outcome);
    const expected = specs
      .flatMap(([, topics], i) => (outcomes[i] === "landed" ? topics : []))
      .sort();
    const topics = evidenceLines()
      .map((l) => (JSON.parse(l) as { topic: string }).topic)
      .sort();
    expect(topics).toEqual(expected); // none lost, none duplicated
    expect(outcomes).toContain("landed");
    expect(lockFiles()).toEqual([]);
  }, 60_000);
});

describe("parallel state-touching hooks", () => {
  test("2 Stop and 2 PostCompact processes never corrupt state.json and leave no lock", async () => {
    const inputs = Array.from({ length: 2 }, () => json({}));
    const [stops, compacts] = await Promise.all([
      runAll(STOP, inputs),
      runAll(COMPACT, inputs),
    ]);
    const outcomes = [...stops, ...compacts].map(outcome);
    expect(outcomes).toContain("landed");
    const state: unknown = JSON.parse(
      readFileSync(join(dir, "state.json"), "utf8"),
    );
    expect(state).toMatchObject({ segment: expect.any(Object) as unknown });
    expect(lockFiles()).toEqual([]);
  }, 60_000);
});

describe("parallel UserPromptSubmit processes", () => {
  test.each([2, 4])(
    "%s processes in one segment emit at most one tip between them",
    async (n) => {
      const results = await runAll(
        PROMPT,
        Array.from({ length: n }, () => json(PLAN)),
      );
      const outcomes = results.map(outcome);
      const tips = results.filter((r) => r.stdout.includes("Mentor tip due"));
      expect(tips.length).toBeLessThanOrEqual(1);
      // The first process through the lock tips; a timed-out one never does.
      if (outcomes.includes("landed")) expect(tips).toHaveLength(1);
      const state = JSON.parse(
        readFileSync(join(dir, "state.json"), "utf8"),
      ) as { segment: { tipsEmitted: number } };
      expect(state.segment.tipsEmitted).toBe(tips.length);
      expect(lockFiles()).toEqual([]);
    },
    60_000,
  );
});
