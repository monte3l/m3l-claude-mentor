import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import {
  extractUsageSignals,
  signalToEvidence,
  USAGE_KINDS,
  type UsageSignal,
} from "../../src/internal/signals.js";
import { parseSessionId } from "../../src/internal/schema.js";

const FM = "---\nname: x\ndescription: does x\n---\nbody";

function sig(payload: unknown): readonly { topic: string; kind: string }[] {
  return extractUsageSignals(payload).map((s) => ({
    topic: s.topic,
    kind: s.kind,
  }));
}

function call(
  tool_name: string,
  tool_input: Record<string, unknown>,
): { tool_name: string; tool_input: Record<string, unknown> } {
  return { tool_name, tool_input };
}

describe("extractUsageSignals positive rows", () => {
  test.each([
    [
      "Write",
      { file_path: "/p/.claude/skills/foo/SKILL.md", content: FM },
      "skills",
      "created-skill",
    ],
    [
      "Write",
      { file_path: "/p/.claude/agents/a.md", content: "x" },
      "subagents",
      "wrote-agent",
    ],
    [
      "Edit",
      { file_path: "/p/.claude/agents/a.md", new_string: "x" },
      "subagents",
      "wrote-agent",
    ],
    [
      "Write",
      { file_path: "/p/.claude/commands/c.md" },
      "slash-commands",
      "wrote-command",
    ],
    [
      "Edit",
      { file_path: "/p/.claude/commands/c.md" },
      "slash-commands",
      "wrote-command",
    ],
    [
      "Write",
      { file_path: "/p/.claude/output-styles/o.md" },
      "output-styles",
      "wrote-output-style",
    ],
    [
      "Edit",
      { file_path: "/p/.claude/output-styles/o.md" },
      "output-styles",
      "wrote-output-style",
    ],
    ["Write", { file_path: "/p/CLAUDE.md" }, "claude-md", "edited-claude-md"],
    ["Edit", { file_path: "CLAUDE.md" }, "claude-md", "edited-claude-md"],
    [
      "Write",
      { file_path: "/p/.claude/settings.json", content: "{}" },
      "settings-scopes",
      "edited-settings",
    ],
    [
      "Edit",
      { file_path: "/p/.claude/settings.local.json", new_string: "{}" },
      "settings-scopes",
      "edited-settings",
    ],
    ["Write", { file_path: "/p/.mcp.json" }, "mcp", "edited-mcp-config"],
    ["Edit", { file_path: ".mcp.json" }, "mcp", "edited-mcp-config"],
    [
      "Write",
      { file_path: "/p/.claude-plugin/plugin.json" },
      "plugins",
      "edited-plugin-manifest",
    ],
    [
      "Edit",
      { file_path: "/p/.claude-plugin/plugin.json" },
      "plugins",
      "edited-plugin-manifest",
    ],
    ["Bash", { command: "claude mcp add foo" }, "mcp", "added-mcp-server"],
    [
      "Bash",
      { command: "cd x && claude mcp add foo" },
      "mcp",
      "added-mcp-server",
    ],
    [
      "Bash",
      { command: "git worktree add ../w" },
      "worktrees",
      "used-worktree",
    ],
    ["Bash", { command: "claude -w feat" }, "worktrees", "used-worktree"],
    [
      "Bash",
      { command: "claude --worktree feat" },
      "worktrees",
      "used-worktree",
    ],
    [
      "Bash",
      { command: "claude plugin install x" },
      "plugins",
      "used-plugin-cli",
    ],
    ["Bash", { command: "claude plugin add x" }, "plugins", "used-plugin-cli"],
    [
      "Bash",
      { command: "(claude plugin validate .)" },
      "plugins",
      "used-plugin-cli",
    ],
    ["Skill", {}, "skills", "invoked-skill"],
    ["Agent", {}, "subagents", "dispatched-subagent"],
    ["Task", {}, "subagents", "dispatched-subagent"],
    ["EnterPlanMode", {}, "plan-mode", "used-plan-mode"],
    ["ExitPlanMode", {}, "plan-mode", "used-plan-mode"],
  ])("%s %j -> %s/%s", (tool, input, topic, kind) => {
    expect(sig(call(tool, input))).toEqual([{ topic, kind }]);
  });

  test("hooks in settings content adds configured-hook after edited-settings", () => {
    expect(
      sig(
        call("Write", {
          file_path: "/p/.claude/settings.json",
          content: '{"hooks":{}}',
        }),
      ),
    ).toEqual([
      { topic: "settings-scopes", kind: "edited-settings" },
      { topic: "hooks", kind: "configured-hook" },
    ]);
  });

  test("hooks in new_string of settings.local.json adds configured-hook", () => {
    expect(
      sig(
        call("Edit", {
          file_path: "/p/.claude/settings.local.json",
          new_string: '"hooks": 1',
        }),
      ).map((s) => s.kind),
    ).toContain("configured-hook");
  });

  test("hooks/hooks.json yields configured-hook only", () => {
    expect(sig(call("Write", { file_path: "/p/hooks/hooks.json" }))).toEqual([
      { topic: "hooks", kind: "configured-hook" },
    ]);
  });

  test("windows paths are normalised", () => {
    expect(
      sig(call("Write", { file_path: "C:\\p\\.claude\\agents\\a.md" })),
    ).toEqual([{ topic: "subagents", kind: "wrote-agent" }]);
    expect(
      sig(call("Write", { file_path: "C:\\p\\hooks\\hooks.json" })),
    ).toEqual([{ topic: "hooks", kind: "configured-hook" }]);
  });
});

describe("extractUsageSignals near misses", () => {
  test.each([
    ["Write", { file_path: "/p/.claude/skills/SKILL.md", content: FM }],
    ["Write", { file_path: "/p/skills/foo/SKILL.md", content: FM }],
    ["Write", { file_path: "/p/.claude/skills/foo/SKILL.md", content: "hi" }],
    [
      "Write",
      {
        file_path: "/p/.claude/skills/foo/SKILL.md",
        content: "---\nname: x\n---\nbody",
      },
    ],
    [
      "Write",
      {
        file_path: "/p/.claude/skills/foo/SKILL.md",
        content: " ---\ndescription: x\n---",
      },
    ],
    [
      "Write",
      {
        file_path: "/p/.claude/skills/foo/SKILL.md",
        content: "---\nname: x\n---\ndescription: later",
      },
    ],
    ["Edit", { file_path: "/p/.claude/skills/foo/SKILL.md", content: FM }],
    ["Write", { file_path: "/p/other/agents/a.md" }],
    ["Write", { file_path: "/p/.claude/agents/a.txt" }],
    ["Write", { file_path: "/p/.claude/commands/c.txt" }],
    ["Write", { file_path: "/p/.claude/output-styles/o.txt" }],
    ["Write", { file_path: "/p/CLAUDE.md.bak" }],
    ["Write", { file_path: "/p/notCLAUDE.md" }],
    ["Write", { file_path: "/p/claude.md" }],
    ["Write", { file_path: "/p/.claude/settings.yaml" }],
    ["Write", { file_path: "/p/settings.json" }],
    ["Write", { file_path: "/p/other/hooks.json" }],
    ["Write", { file_path: "/p/hooks/other.json" }],
    ["Write", { file_path: "/p/x.mcp.json" }],
    ["Write", { file_path: "/p/plugin.json" }],
    ["Bash", { command: "claude mcp list" }],
    ["Bash", { command: "claude mcpadd foo" }],
    ["Bash", { command: "xclaude mcp add foo" }],
    ["Bash", { command: "claude mcp addition" }],
    ["Bash", { command: "git worktree list" }],
    ["Bash", { command: "git worktree addx" }],
    ["Bash", { command: "claude -wx" }],
    ["Bash", { command: "claude plugin list" }],
    ["Bash", { command: "claude plugin installer" }],
    ["Read", { file_path: "/p/CLAUDE.md" }],
    ["Glob", {}],
  ])("%s %j yields nothing", (tool, input) => {
    expect(sig(call(tool, input))).toEqual([]);
  });

  test("hooks text in a non-settings file does not add configured-hook", () => {
    expect(
      sig(call("Write", { file_path: "/p/CLAUDE.md", content: '"hooks"' })),
    ).toEqual([{ topic: "claude-md", kind: "edited-claude-md" }]);
  });
});

describe("signal vocabulary", () => {
  test("every table topic is a catalog id", () => {
    const parsed = parseCatalog(
      JSON.parse(readFileSync("data/topic-catalog.json", "utf8")),
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const ids = new Set(parsed.value.map((e) => e.id as string));
    for (const t of [
      "skills",
      "subagents",
      "slash-commands",
      "output-styles",
      "claude-md",
      "settings-scopes",
      "hooks",
      "mcp",
      "plugins",
      "worktrees",
      "plan-mode",
    ]) {
      expect(ids.has(t)).toBe(true);
    }
  });

  test("USAGE_KINDS lists every kind in the table", () => {
    expect([...USAGE_KINDS].sort()).toEqual(
      [
        "created-skill",
        "wrote-agent",
        "wrote-command",
        "wrote-output-style",
        "edited-claude-md",
        "edited-settings",
        "configured-hook",
        "edited-mcp-config",
        "edited-plugin-manifest",
        "added-mcp-server",
        "used-worktree",
        "used-plugin-cli",
        "invoked-skill",
        "dispatched-subagent",
        "used-plan-mode",
      ].sort(),
    );
  });

  test("USAGE_KINDS is frozen", () => {
    expect(Object.isFrozen(USAGE_KINDS)).toBe(true);
  });

  test("every emitted signal topic and kind belong to the vocabulary", () => {
    const out = extractUsageSignals(call("Skill", {}));
    for (const s of out) expect(USAGE_KINDS).toContain(s.kind);
  });
});

describe("signalToEvidence", () => {
  const session = (() => {
    const r = parseSessionId("sess-1");
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  })();
  const [first] = extractUsageSignals(call("Skill", {}));
  const signal = first as UsageSignal;

  test("builds observed positive evidence", () => {
    expect(signalToEvidence(signal, session, 1234)).toEqual({
      channel: "observed",
      topic: "skills",
      result: "positive",
      at: 1234,
      session,
    });
  });

  test("at = 0 is accepted", () => {
    expect(signalToEvidence(signal, session, 0).at).toBe(0);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, -Infinity])(
    "at = %s throws RangeError",
    (at) => {
      expect(() => signalToEvidence(signal, session, at)).toThrowError(
        RangeError,
      );
    },
  );
});
