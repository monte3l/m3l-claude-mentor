import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const HOOK = fileURLToPath(
  new URL("../../.claude/hooks/guard-hub-src-writes.mjs", import.meta.url),
);

interface HookResult {
  readonly status: number | null;
  readonly stderr: string;
}

let project: string;

beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "guard-hub-")));
  mkdirSync(join(project, "src"));
  mkdirSync(join(project, "tests"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

/** Run the hook with a raw stdin string against the temp project. */
function runRaw(stdin: string): HookResult {
  const result = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
    timeout: 20_000,
    env: { PATH: process.env["PATH"] ?? "", CLAUDE_PROJECT_DIR: project },
  });
  return { status: result.status, stderr: result.stderr };
}

/** Run the hook with a payload object, defaulting cwd to the temp project. */
function runHook(payload: Record<string, unknown>): HookResult {
  return runRaw(JSON.stringify({ cwd: project, ...payload }));
}

const spoke = (agentType: string): Record<string, unknown> => ({
  agent_type: agentType,
  agent_id: "agent-123",
});

describe("guard-hub-src-writes: Write/Edit", () => {
  test.each([
    ["Write", "src/a.ts"],
    ["Edit", "src/nested/b.ts"],
    ["Write", "tests/a.test.ts"],
    ["Edit", "tests/deep/b.test.ts"],
  ])("blocks a hub %s into %s", (tool, rel) => {
    const filePath = join(project, rel);
    const result = runHook({
      tool_name: tool,
      tool_input: { file_path: filePath },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored write to a guarded path");
    expect(result.stderr).toContain(filePath);
  });

  test("allows a hub write outside src/ and tests/", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: join(project, "docs", "notes.md") },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test.each(["test-author", "code-implementer"])(
    "allows %s (agent_type and agent_id) to write into src/",
    (agentType) => {
      const result = runHook({
        tool_name: "Write",
        tool_input: { file_path: join(project, "src", "a.ts") },
        ...spoke(agentType),
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    },
  );

  test("treats agent_type without agent_id as the hub and blocks", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: join(project, "src", "a.ts") },
      agent_type: "code-implementer",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored write");
  });

  test("treats a blank agent_id as the hub and blocks", () => {
    const result = runHook({
      tool_name: "Edit",
      tool_input: { file_path: join(project, "tests", "a.test.ts") },
      agent_type: "test-author",
      agent_id: "   ",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored write to a guarded path");
  });

  test("blocks a non-writer agent_type even with an agent_id", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: join(project, "src", "a.ts") },
      ...spoke("code-reviewer"),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored write to a guarded path");
  });

  test("blocks a relative path resolved against the payload cwd", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: "src/a.ts" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored write to a guarded path");
  });
});

describe("guard-hub-src-writes: Bash and Monitor", () => {
  test("blocks a hub Bash redirect into src/", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "echo x > src/a.ts" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored Bash command");
    expect(result.stderr).toContain("writes to a guarded path");
  });

  test("allows the same Bash redirect for a writer spoke", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "echo x > src/a.ts" },
      ...spoke("code-implementer"),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("blocks the same Bash redirect when agent_id is missing", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "echo x > src/a.ts" },
      agent_type: "code-implementer",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored Bash command");
  });

  test("allows a benign Bash command", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("allows a Bash redirect to a path outside src/ and tests/", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "echo x > docs/a.md" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("blocks a hub Monitor command that writes into src/", () => {
    const result = runHook({
      tool_name: "Monitor",
      tool_input: { command: "echo x > src/a.ts" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored Bash command");
  });

  test("allows a benign Monitor command", () => {
    const result = runHook({
      tool_name: "Monitor",
      tool_input: { command: "tail -f /dev/null" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("allows a Monitor WebSocket input with no command", () => {
    const result = runHook({
      tool_name: "Monitor",
      tool_input: { ws: "wss://example.invalid/stream" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("no string tool_input.command");
  });

  test("routes a payload with no tool_name but a command to the Bash guard", () => {
    const result = runHook({ tool_input: { command: "echo x > src/a.ts" } });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Hub-authored Bash command");
  });

  test("blocks a hub removing the project root as an ancestor of src/", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "rm -rf ." },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ancestor of a guarded path");
  });
});

describe("guard-hub-src-writes: fail-open input handling", () => {
  test("fails open on malformed JSON, noting it on stderr", () => {
    const result = runRaw("{not json");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("unparseable hook payload");
  });

  test("fails open on a non-object JSON payload", () => {
    const result = runRaw("42");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("not a JSON object");
  });

  test("fails open on a Write payload with no string file_path", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: 7 },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("no string tool_input.file_path");
  });
});
