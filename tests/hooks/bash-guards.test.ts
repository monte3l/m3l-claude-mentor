import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
/**
 * Mirrors `MAX_COMMAND_LENGTH` in .claude/hooks/guard-readonly-bash.mjs (not
 * exported there). If the hook's value changes, the boundary tests below fail.
 */
const MAX_COMMAND_LENGTH = 65_536;
const doubleBg = fileURLToPath(
  new URL("../../.claude/hooks/guard-double-background.mjs", import.meta.url),
);
const readonlyBash = fileURLToPath(
  new URL("../../.claude/hooks/guard-readonly-bash.mjs", import.meta.url),
);

interface HookResult {
  status: number | null;
  stderr: string;
}

/** Run a hook as a CLI with `input` as the raw stdin payload. */
function runRaw(hook: string, input: string): HookResult {
  const result = spawnSync(process.execPath, [hook], {
    input,
    encoding: "utf8",
    timeout: 20_000,
    env: { PATH: process.env["PATH"] ?? "", CLAUDE_PROJECT_DIR: repoRoot },
  });
  return { status: result.status, stderr: result.stderr };
}

/** Allowed means exit 0 with nothing on stderr (hooks write only when blocking). */
function expectAllowed(result: HookResult): void {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
}

function runBg(command: string, runInBackground?: unknown): HookResult {
  return runRaw(
    doubleBg,
    JSON.stringify({
      tool_name: "Bash",
      tool_input: { command, run_in_background: runInBackground },
    }),
  );
}

function runRo(command: string, agentType?: string): HookResult {
  return runRaw(
    readonlyBash,
    JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      agent_type: agentType,
      agent_id: "x",
    }),
  );
}

describe("guard-double-background", () => {
  test.each([
    ["nohup with trailing &", "nohup sleep 5 > log 2>&1 &"],
    ["nohup without a trailing &", "nohup sleep 5 > log 2>&1"],
    ["disown without a trailing &", "disown %1"],
    ["trailing &", "sleep 5 &"],
    ["disown after a separator", "sleep 5 & disown"],
  ])("blocks run_in_background with %s", (_name, command) => {
    const result = runBg(command, true);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("[guard-double-background] Blocked");
  });

  test("allows run_in_background alone", () => {
    expectAllowed(runBg("sleep 5", true));
  });

  test.each([false, undefined, "true", 1])(
    "allows a detach construct when run_in_background is %j",
    (flag) => {
      expectAllowed(runBg("nohup sleep 5 &", flag));
    },
  );

  test("allows the word nohup as argument text", () => {
    expectAllowed(runBg("grep -n nohup file.txt", true));
  });

  test.each(["a && b", "make 2>&1", "curl 'x?a=1&page=2'"])(
    "allows non-detach ampersand usage: %s",
    (command) => {
      expectAllowed(runBg(command, true));
    },
  );

  test("fails open on malformed JSON", () => {
    expect(runRaw(doubleBg, "{not json").status).toBe(0);
  });
});

describe("guard-readonly-bash as a read-only spoke", () => {
  test.each([
    "git diff main...HEAD",
    "git log --oneline -5",
    "git status --short",
    "grep -rn foo src",
    "pnpm lint",
    "pnpm test 2>&1 | tail",
    "cat package.json | head -5",
  ])("allows %s", (command) => {
    expectAllowed(runRo(command, "code-reviewer"));
  });

  test.each([
    "echo x > f.txt",
    "pnpm format",
    "git commit -m x",
    "sed -i s/a/b/ f",
    "rm -rf dist",
    "npx prettier --write .",
    "pnpm add foo",
    "cat a | tee b",
    "eslint --fix .",
  ])("blocks %s", (command) => {
    const result = runRo(command, "code-reviewer");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("[guard-readonly-bash] Blocked");
    expect(result.stderr).toContain("code-reviewer");
  });

  test("blocks a command one character over the length limit", () => {
    const command = `echo ${" ".repeat(MAX_COMMAND_LENGTH - 5 + 1)}`;
    expect(command.length).toBe(MAX_COMMAND_LENGTH + 1);
    const result = runRo(command, "code-reviewer");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("[guard-readonly-bash] Blocked");
    expect(result.stderr).toContain("too long to classify");
  });

  test("allows a command of exactly the length limit", () => {
    const command = `echo ${" ".repeat(MAX_COMMAND_LENGTH - 5)}`;
    expect(command.length).toBe(MAX_COMMAND_LENGTH);
    expectAllowed(runRo(command, "code-reviewer"));
  });

  test("allows a short command well under the length limit", () => {
    const result = runRo(`echo ${"a".repeat(1000)}`, "code-reviewer");
    expectAllowed(result);
  });

  test("malformed JSON fails open because the caller cannot be identified", () => {
    expect(runRaw(readonlyBash, "{not json").status).toBe(0);
  });
});

describe("guard-readonly-bash scope", () => {
  test("does not restrict a call with no agent_type (the hub)", () => {
    expectAllowed(runRo("git commit -m x"));
    expectAllowed(runRo("rm -rf dist"));
  });

  test("does not restrict an empty agent_type", () => {
    expectAllowed(runRo("git commit -m x", ""));
  });

  test.each(["test-author", "code-implementer"])(
    "does not restrict the writer spoke %s",
    (agent) => {
      expectAllowed(runRo("git commit -m x", agent));
    },
  );

  test("does not restrict an unknown agent_type", () => {
    expectAllowed(runRo("git commit -m x", "no-such-agent"));
  });
});
