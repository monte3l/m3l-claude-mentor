import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import {
  detectPromptSignals,
  MAX_PROMPT_CHARS,
  MAX_PROMPT_SIGNALS,
} from "../../src/internal/prompt-signals.js";

const parsedCatalog = parseCatalog(
  JSON.parse(readFileSync("data/topic-catalog.json", "utf8")),
);
if (!parsedCatalog.ok) throw new Error(parsedCatalog.reason);
const catalog = parsedCatalog.value;

function detect(prompt: unknown): readonly object[] {
  return detectPromptSignals(prompt, catalog);
}

describe("constants", () => {
  test("limits", () => {
    expect(MAX_PROMPT_CHARS).toBe(4_000);
    expect(MAX_PROMPT_SIGNALS).toBe(3);
  });
});

describe("just-tell-me", () => {
  test.each([
    "just tell me",
    "Just tell me how",
    "JUST GIVE ME THE ANSWER",
    "skip the explanation",
    "skip the explanations please",
    "no explanation needed",
    "no explanations needed.",
    "ok, just tell me!",
  ])("%s", (p) => {
    expect(detect(p)).toEqual([{ kind: "just-tell-me" }]);
  });

  test.each(["justify me", "just telling me", "unjust tell me", "skip it"])(
    "near miss %s",
    (p) => {
      expect(detect(p)).toEqual([]);
    },
  );
});

describe("global stop and resume", () => {
  test.each([
    "stop tips",
    "stop the tips",
    "no more tips",
    "mute tips",
    "mute the tips",
    "disable tips",
    "turn off tips",
    "STOP THE TIPS!",
    "please, stop tips.",
  ])("stop: %s", (p) => {
    expect(detect(p)).toEqual([{ kind: "stop-tips" }]);
  });

  test.each([
    "resume tips",
    "unmute tips",
    "turn tips on",
    "turn tips back on",
    "enable tips",
    "Resume Tips!",
  ])("resume: %s", (p) => {
    expect(detect(p)).toEqual([{ kind: "resume-tips" }]);
  });

  test("later instruction wins: stop then resume", () => {
    expect(detect("stop tips. actually, resume tips")).toEqual([
      { kind: "resume-tips" },
    ]);
  });

  test("later instruction wins: resume then stop", () => {
    expect(detect("resume tips. no wait, stop tips")).toEqual([
      { kind: "stop-tips" },
    ]);
  });

  test("duplicate stop yields one signal", () => {
    expect(detect("stop tips, stop tips, no more tips")).toEqual([
      { kind: "stop-tips" },
    ]);
  });
});

describe("topic stop", () => {
  test.each([
    ["stop tips about hooks", "hooks"],
    ["no more tips on plan mode", "plan-mode"],
    ["mute tips for worktrees.", "worktrees"],
    ["Disable tips about the MCP server!", "mcp"],
  ])("%s", (p, topic) => {
    expect(detect(p)).toEqual([{ kind: "stop-tips-topic", topic }]);
  });

  test("no catalog match yields nothing and no global fallback", () => {
    expect(detect("stop tips about gardening")).toEqual([]);
    expect(detect("no more tips on zzzz")).toEqual([]);
  });

  test("topic words end at sentence end", () => {
    expect(detect("stop tips about gardening. hooks are fun")).toEqual([]);
  });

  test("words beyond 80 chars are not considered", () => {
    expect(detect(`stop tips about ${"x".repeat(80)} hooks`)).toEqual([]);
  });
});

describe("teach-next", () => {
  test.each([
    ["teach me about hooks", "hooks"],
    ["teach me skills", "skills"],
    ["teach me worktrees next", "worktrees"],
    ["let's learn plan mode", "plan-mode"],
    ["Let's learn about subagents", "subagents"],
  ])("%s", (p, topic) => {
    expect(detect(p)).toEqual([{ kind: "teach-next", topic }]);
  });

  test("no catalog match yields nothing", () => {
    expect(detect("teach me about gardening")).toEqual([]);
    expect(detect("let's learn cooking")).toEqual([]);
  });
});

describe("ordering and cap", () => {
  test("ordered by first match position", () => {
    expect(detect("teach me about hooks. just tell me. stop tips")).toEqual([
      { kind: "teach-next", topic: "hooks" },
      { kind: "just-tell-me" },
      { kind: "stop-tips" },
    ]);
    expect(detect("stop tips. just tell me")).toEqual([
      { kind: "stop-tips" },
      { kind: "just-tell-me" },
    ]);
  });

  test("caps at 3 signals", () => {
    const out = detect(
      "just tell me. stop tips. teach me about hooks. stop tips about worktrees",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: "just-tell-me" });
  });

  test("one signal per topic for topic kinds, distinct topics kept", () => {
    expect(detect("teach me hooks. teach me hooks")).toHaveLength(1);
    expect(detect("teach me hooks. teach me skills")).toEqual([
      { kind: "teach-next", topic: "hooks" },
      { kind: "teach-next", topic: "skills" },
    ]);
  });
});
