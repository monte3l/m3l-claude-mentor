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
import { readEvidence } from "../../src/internal/store.ts";
import {
  scriptPath,
  makeSandbox,
  parseSingleJson,
  requireScript,
  runScript,
  type Sandbox,
} from "./spawn-helpers.ts";

const ENTRIES = [
  ["SessionStart", "hooks/entry-session-start.ts"],
  ["UserPromptSubmit", "hooks/entry-user-prompt-submit.ts"],
  ["PostToolUse", "hooks/entry-post-tool-use.ts"],
  ["Stop", "hooks/entry-stop.ts"],
  ["PostCompact", "hooks/entry-post-compact.ts"],
] as const;

const STOP = "hooks/entry-stop.ts";
const PROMPT = "hooks/entry-user-prompt-submit.ts";
const POST = "hooks/entry-post-tool-use.ts";
const START = "hooks/entry-session-start.ts";

let sb: Sandbox;
beforeAll(() => {
  // These tests spawn each hook entry as a child process, running src/*.ts directly.
  for (const [, file] of ENTRIES) requireScript(file);
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
    const r = runScript(file, {
      input: payload({ hook_event_name: event, source: "startup" }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 on invalid JSON", () => {
    const r = runScript(file, { input: "{nope", dataDir: sb.dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("exits 0 on a 2 MB stdin", () => {
    const r = runScript(file, {
      input: payload({ junk: "x".repeat(2 * 1024 * 1024) }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 when CLAUDE_PLUGIN_DATA is unset", () => {
    const r = runScript(file, { input: payload(), dataDir: null });
    expect(r.status).toBe(0);
    expect(() => parseSingleJson(r.stdout)).not.toThrow();
  });

  test("exits 0 with a corrupt state.json", () => {
    mkdirSync(sb.dir, { recursive: true });
    writeFileSync(join(sb.dir, "state.json"), "{corrupt");
    const r = runScript(file, {
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
      /* @vite-ignore */ scriptPath(file).replaceAll("\\", "/")
    );
    expect(mod).toBeTypeOf("object");
    expect(process.exitCode).toBe(before);
    expect(import.meta.main).not.toBe(true);
  });
});

describe("Stop entry", () => {
  test("prints nothing even when a tip is already due", () => {
    const dial = { CLAUDE_PLUGIN_OPTION_DIAL: "2" };
    const first = runScript(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
      env: dial,
    });
    expect(first.stdout).toContain("Mentor tip due");
    const stop = runScript(STOP, {
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
    const first = runScript(PROMPT, {
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

    const second = runScript(PROMPT, {
      input: payload({ prompt: "and what about plan mode again" }),
      dataDir: sb.dir,
      env,
    });
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("Mentor tip due");
  });

  test("dial 0 never emits a tip directive", () => {
    const r = runScript(PROMPT, {
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
    const r = runScript(POST, { input: payload(write), dataDir: sb.dir });
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
    const r = runScript(POST, {
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
    const r = runScript(START, {
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
  const POST_COMPACT = "hooks/entry-post-compact.ts";

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
    const seed = runScript(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
    });
    expect(seed.status).toBe(0);
    writeFileSync(join(sb.dir, "catalog.json"), "{corrupt");
    return segmentId();
  }

  test("Stop runs silently and keeps the segment and its emitted tip", () => {
    const dial = { CLAUDE_PLUGIN_OPTION_DIAL: "2" };
    const seed = runScript(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
      env: dial,
    });
    expect(seed.stdout).toContain("Mentor tip due");
    writeFileSync(join(sb.dir, "catalog.json"), "{corrupt");
    const seg = () => {
      const { segmentId, tipsEmitted } = (
        JSON.parse(readFileSync(join(sb.dir, "state.json"), "utf8")) as {
          segment: { segmentId: number; tipsEmitted: number };
        }
      ).segment;
      return { segmentId, tipsEmitted };
    };
    const before = seg();
    expect(before.tipsEmitted).toBe(1);
    const activity = lastActivityAt();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    const r = runScript(STOP, {
      input: payload({ cwd: sb.root }),
      dataDir: sb.dir,
      env: dial,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(lastActivityAt()).toBeGreaterThan(activity);
    expect(seg()).toEqual(before);
  });

  test("PostCompact runs silently and records activity", () => {
    seedAndCorrupt();
    const before = lastActivityAt();
    // Keep the two runs a few milliseconds apart (synchronous sleep).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    const r = runScript(POST_COMPACT, {
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
    const r = runScript(PROMPT, {
      input: payload({ prompt: "how do I use plan mode" }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
