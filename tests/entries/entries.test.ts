import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { readEvidence } from "../../src/internal/store.js";
import {
  distPath,
  makeSandbox,
  parseSingleJson,
  requireBuilt,
  runDist,
  type Sandbox,
} from "./spawn-helpers.js";

const ENTRIES = [
  ["SessionStart", "hooks/entry-session-start.js"],
  ["UserPromptSubmit", "hooks/entry-user-prompt-submit.js"],
  ["PostToolUse", "hooks/entry-post-tool-use.js"],
  ["Stop", "hooks/entry-stop.js"],
  ["PostCompact", "hooks/entry-post-compact.js"],
] as const;

const STOP = "hooks/entry-stop.js";
const PROMPT = "hooks/entry-user-prompt-submit.js";
const POST = "hooks/entry-post-tool-use.js";
const START = "hooks/entry-session-start.js";

let sb: Sandbox;
beforeAll(() => {
  // `pnpm build` must run first: these tests spawn the compiled entries.
  for (const [, file] of ENTRIES) requireBuilt(file);
});
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const payload = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: "s1", ...extra });

describe.each(ENTRIES)("%s entry", (event, file) => {
  test("exits 0 with empty or single-JSON stdout for a plain payload", () => {
    const r = runDist(file, {
      input: payload({ hook_event_name: event, source: "startup" }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 on invalid JSON", () => {
    const r = runDist(file, { input: "{nope", dataDir: sb.dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("exits 0 on a 2 MB stdin", () => {
    const r = runDist(file, {
      input: payload({ junk: "x".repeat(2 * 1024 * 1024) }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 when CLAUDE_PLUGIN_DATA is unset", () => {
    const r = runDist(file, { input: payload(), dataDir: null });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 with a corrupt state.json", () => {
    mkdirSync(sb.dir, { recursive: true });
    writeFileSync(join(sb.dir, "state.json"), "{corrupt");
    const r = runDist(file, {
      input: payload({
        prompt: "plan mode",
        tool_name: "Skill",
        tool_input: {},
      }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("importing the module in-process runs nothing", async () => {
    const before = process.exitCode;
    const mod: unknown = await import(
      /* @vite-ignore */ distPath(file).replaceAll("\\", "/")
    );
    expect(mod).toBeTypeOf("object");
    expect(process.exitCode).toBe(before);
    expect(import.meta.main).not.toBe(true);
  });
});

describe("Stop entry", () => {
  test("prints nothing even when a tip is already due", () => {
    const dial = { CLAUDE_PLUGIN_OPTION_DIAL: "2" };
    const first = runDist(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
      env: dial,
    });
    expect(first.stdout).toContain("Mentor tip due");
    const stop = runDist(STOP, {
      input: payload({ hook_event_name: "Stop" }),
      dataDir: sb.dir,
      env: dial,
    });
    expect(stop.status).toBe(0);
    expect(stop.stdout).toBe("");
  });
});

describe("UserPromptSubmit entry end-to-end", () => {
  const env = { CLAUDE_PLUGIN_OPTION_DIAL: "2" };

  test("emits a tip directive once; a second prompt in the segment does not", () => {
    const first = runDist(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
      env,
    });
    expect(first.status).toBe(0);
    const out = parseSingleJson(first.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain(
      'Mentor tip due on "Plan mode" (plan-mode)',
    );

    const second = runDist(PROMPT, {
      input: payload({ prompt: "and what about plan mode again" }),
      dataDir: sb.dir,
      env,
    });
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("Mentor tip due");
  });

  test("dial 0 never emits a tip directive", () => {
    const r = runDist(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
      env: { CLAUDE_PLUGIN_OPTION_DIAL: "0" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("Mentor tip due");
  });
});

describe("PostToolUse entry", () => {
  const write = {
    tool_name: "Write",
    tool_input: {
      file_path: "/proj/.claude/skills/demo/SKILL.md",
      content: "---\nname: demo\ndescription: a demo\n---\nBody\n",
    },
  };

  test("appends observed evidence for a SKILL.md write and prints nothing", async () => {
    const r = runDist(POST, { input: payload(write), dataDir: sb.dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const { events } = await readEvidence(sb.dir, { maxEvents: 500 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      topic: "skills",
      channel: "observed",
      result: "positive",
      session: "s1",
    });
  });

  test("records nothing when CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS is false", async () => {
    const r = runDist(POST, {
      input: payload(write),
      dataDir: sb.dir,
      env: { CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS: "false" },
    });
    expect(r.status).toBe(0);
    const { events } = await readEvidence(sb.dir, { maxEvents: 500 });
    expect(events).toHaveLength(0);
  });
});

describe("SessionStart entry", () => {
  test("prints a learner-state summary as additional context", () => {
    const r = runDist(START, {
      input: payload({ source: "startup" }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    const out = parseSingleJson(r.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "m3l-claude-mentor learner state",
    );
  });
});

describe("corrupt user catalog.json", () => {
  const POST_COMPACT = "hooks/entry-post-compact.js";

  function segmentId(): number {
    const state = JSON.parse(
      readFileSync(join(sb.dir, "state.json"), "utf8"),
    ) as { segment: { segmentId: number } };
    return state.segment.segmentId;
  }

  function lastActivityAt(): number {
    const state = JSON.parse(
      readFileSync(join(sb.dir, "state.json"), "utf8"),
    ) as { segment: { lastActivityAt: number } };
    return state.segment.lastActivityAt;
  }

  function seedAndCorrupt(): number {
    const seed = runDist(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
    });
    expect(seed.status).toBe(0);
    writeFileSync(join(sb.dir, "catalog.json"), "{corrupt");
    return segmentId();
  }

  test("Stop still advances the segment", () => {
    const before = seedAndCorrupt();
    const r = runDist(STOP, {
      input: payload({ cwd: sb.root }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(segmentId()).toBe(before + 1);
  });

  test("PostCompact runs silently and records activity", () => {
    seedAndCorrupt();
    const before = lastActivityAt();
    // Keep the two runs a few milliseconds apart (synchronous sleep).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    const r = runDist(POST_COMPACT, {
      input: payload({ cwd: sb.root }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(lastActivityAt()).toBeGreaterThan(before);
  });

  test("UserPromptSubmit exits 0 silently with a stderr note", () => {
    seedAndCorrupt();
    const r = runDist(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
