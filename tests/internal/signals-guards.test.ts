import { describe, expect, test } from "vitest";
import {
  extractUsageSignals,
  MAX_SIGNALS_PER_EVENT,
} from "../../src/internal/signals.js";

const SECRET = "sk-ant-SECRET-1234567890";

describe("extractUsageSignals hostile input", () => {
  test.each([
    null,
    undefined,
    1,
    "str",
    true,
    [],
    [1, 2],
    {},
    { tool_name: 5, tool_input: {} },
    { tool_name: "Write", tool_input: null },
    { tool_name: "Write", tool_input: "x" },
    { tool_name: "Write", tool_input: [] },
    { tool_name: "Write", tool_input: { file_path: 5 } },
    { tool_name: "Write", tool_input: { file_path: ["/p/CLAUDE.md"] } },
    { tool_name: "Bash", tool_input: { command: { x: 1 } } },
    { tool_name: ["Skill"], tool_input: {} },
    { tool_input: {} },
  ])("%j yields []", (payload) => {
    expect(extractUsageSignals(payload)).toEqual([]);
  });

  test("inherited properties are not read", () => {
    expect(
      extractUsageSignals(
        Object.create({ tool_name: "Skill", tool_input: {} }),
      ),
    ).toEqual([]);
    expect(
      extractUsageSignals({
        tool_name: "Write",
        tool_input: Object.create({ file_path: "/p/CLAUDE.md" }) as unknown,
      }),
    ).toEqual([]);
  });

  test("tool_input inherited rather than own is not read", () => {
    const payload = Object.assign(Object.create({ tool_input: {} }) as object, {
      tool_name: "Skill",
    });
    expect(extractUsageSignals(payload)).toEqual([]);
  });

  test("SKILL.md frontmatter without a closing delimiter yields nothing", () => {
    expect(
      extractUsageSignals({
        tool_name: "Write",
        tool_input: {
          file_path: "/p/.claude/skills/a/SKILL.md",
          content: "---\ndescription: x",
        },
      }),
    ).toEqual([]);
  });

  test("tool_response is never read", () => {
    expect(
      extractUsageSignals({
        tool_name: "Glob",
        tool_input: {},
        tool_response: { tool_name: "Skill" },
      }),
    ).toEqual([]);
  });

  test("non-JSON values such as bigint never throw", () => {
    expect(() =>
      extractUsageSignals({ tool_name: "Write", tool_input: { x: 1n } }),
    ).not.toThrow();
  });
});

describe("windows and size bounds", () => {
  test("10 MB command returns promptly", () => {
    const start = performance.now();
    const out = extractUsageSignals({
      tool_name: "Bash",
      tool_input: { command: "a ".repeat(5_000_000) },
    });
    expect(out).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  test("pathological whitespace command returns promptly", () => {
    const start = performance.now();
    extractUsageSignals({
      tool_name: "Bash",
      tool_input: { command: `claude${" ".repeat(5_000_000)}x` },
    });
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  test("a match within the first 2000 chars is found", () => {
    const command = `${" ".repeat(1_900)}claude mcp add x`;
    expect(
      extractUsageSignals({ tool_name: "Bash", tool_input: { command } }),
    ).toHaveLength(1);
  });

  test("a match only after char 2000 of the command is not found", () => {
    const command = `${" ".repeat(2_000)}claude mcp add x`;
    expect(
      extractUsageSignals({ tool_name: "Bash", tool_input: { command } }),
    ).toEqual([]);
  });

  test("hooks marker within the first 100000 chars of content is found", () => {
    const content = `${" ".repeat(99_000)}"hooks"`;
    const kinds = extractUsageSignals({
      tool_name: "Write",
      tool_input: { file_path: "/p/.claude/settings.json", content },
    }).map((s) => s.kind);
    expect(kinds).toContain("configured-hook");
  });

  test("hooks marker only after char 100000 is not found", () => {
    const content = `${" ".repeat(100_000)}"hooks"`;
    const kinds = extractUsageSignals({
      tool_name: "Write",
      tool_input: { file_path: "/p/.claude/settings.json", content },
    }).map((s) => s.kind);
    expect(kinds).toEqual(["edited-settings"]);
  });
});

describe("output hygiene", () => {
  test("secrets in content, command and path never appear in output", () => {
    const outs = [
      extractUsageSignals({
        tool_name: "Write",
        tool_input: {
          file_path: `/p/${SECRET}/.claude/settings.json`,
          content: `{"hooks":{},"key":"${SECRET}"}`,
        },
      }),
      extractUsageSignals({
        tool_name: "Bash",
        tool_input: { command: `claude mcp add x --header ${SECRET}` },
      }),
      extractUsageSignals({
        tool_name: "Write",
        tool_input: {
          file_path: "/p/.claude/skills/a/SKILL.md",
          content: `---\ndescription: ${SECRET}\n---`,
        },
      }),
    ];
    for (const out of outs) {
      expect(out.length).toBeGreaterThan(0);
      expect(JSON.stringify(out)).not.toContain(SECRET);
      for (const s of out)
        expect(Object.keys(s).sort()).toEqual(["kind", "topic"]);
    }
  });
});

describe("cap and dedupe", () => {
  test("MAX_SIGNALS_PER_EVENT is 4", () => {
    expect(MAX_SIGNALS_PER_EVENT).toBe(4);
  });

  test("a Bash command matching three rows yields all three in table order", () => {
    const out = extractUsageSignals({
      tool_name: "Bash",
      tool_input: {
        command:
          "claude plugin install x; git worktree add w; claude mcp add y",
      },
    }).map((s) => s.kind);
    expect(out).toEqual([
      "added-mcp-server",
      "used-worktree",
      "used-plugin-cli",
    ]);
  });

  test("results are deduplicated by topic+kind", () => {
    const out = extractUsageSignals({
      tool_name: "Bash",
      tool_input: {
        command:
          "claude mcp add a; claude mcp add b; git worktree add w; claude -w x",
      },
    }).map((s) => s.kind);
    expect(out).toEqual(["added-mcp-server", "used-worktree"]);
  });

  test("never more than MAX_SIGNALS_PER_EVENT", () => {
    const out = extractUsageSignals({
      tool_name: "Write",
      tool_input: {
        file_path: "/p/.claude/settings.json",
        content: '"hooks"',
      },
    });
    expect(out.length).toBeLessThanOrEqual(MAX_SIGNALS_PER_EVENT);
  });
});
