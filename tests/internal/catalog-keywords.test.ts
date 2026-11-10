import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { matchTopics, parseCatalog } from "../../src/internal/catalog.js";
import type { CatalogEntry } from "../../src/internal/schema.js";

function loadBundled(): readonly CatalogEntry[] {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL("../../data/topic-catalog.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCatalog(raw);
  if (!parsed.ok) throw new Error(`bundled catalog invalid: ${parsed.reason}`);
  return parsed.value;
}

const catalog = loadBundled();

/** Single words too generic to be a whole keyword on any bundled topic. */
const GENERIC = [
  "context",
  "clear",
  "compact",
  "settings",
  "scope",
  "memory",
  "plan",
  "design",
  "explore",
  "tests",
  "verify",
  "lint",
  "prompt",
  "prompts",
  "review",
  "diff",
  "model",
];

describe("bundled catalog keywords", () => {
  test.each(GENERIC)("no topic uses the generic keyword %j", (word) => {
    const offenders = catalog
      .filter((e) => e.keywords.includes(word))
      .map((e) => e.id);
    expect(offenders).toEqual([]);
  });

  test("`token`/`tokens` appear only on term-token", () => {
    const offenders = catalog
      .filter(
        (e) => e.keywords.includes("token") || e.keywords.includes("tokens"),
      )
      .map((e) => e.id);
    expect(offenders).toEqual(["term-token"]);
  });
});

const EXAMPLES: readonly (readonly [string, string])[] = [
  ["context-window", "my context window is full"],
  ["context-window", "what is the context limit here"],
  ["compaction", "how does compaction work"],
  ["compaction", "what does auto-compact do"],
  ["agentic-loop", "explain the agentic loop"],
  ["permissions-model", "how do I add a deny rule"],
  ["settings-scopes", "where does settings.json live"],
  ["settings-scopes", "what are managed settings"],
  ["mcp", "how do I add an mcp server"],
  ["claude-md", "edit my claude.md file"],
  ["claude-md", "where do project instructions go"],
  ["slash-commands", "how do I add a slash command"],
  ["plan-mode", "how do I use plan mode"],
  ["skills", "how do I create a skill"],
  ["subagents", "how do subagents work"],
  ["hooks", "write a hook for PostToolUse"],
  ["plugins", "how do I install a plugin from a marketplace"],
  ["output-styles", "how do I change the output style"],
  ["worktrees", "how do I use a worktree"],
  ["verify-your-work", "please run the tests and typecheck"],
  ["explore-plan-code", "should I explore first before coding"],
  ["context-hygiene", "my long session is getting slow"],
  ["context-hygiene", "should I start a new session"],
  ["specific-prompts", "how do I write a specific prompt"],
  ["review-ai-changes", "how do I review the diff"],
  ["term-token", "explain what a token is"],
  ["term-system-prompt", "what is the system prompt"],
  ["term-harness", "what is a harness"],
  ["model-names-and-limits", "what claude models exist"],
  ["model-names-and-limits", "claude pricing for the api"],
  ["model-names-and-limits", "what is the model alias for claude opus"],
  ["new-features", "show me the changelog"],
  ["explore-plan-code", "should I plan before coding"],
  ["explore-plan-code", "Explore, plan, then code"],
  ["review-ai-changes", "how do I review the changes Claude made"],
  ["review-ai-changes", "review a pull request"],
  ["context-hygiene", "when should I use /clear"],
  ["context-hygiene", "my context is full"],
  ["claude-md", "what does /memory do"],
  ["claude-md", "what is CLAUDE.local.md"],
  ["verify-your-work", "how can Claude verify its work"],
  ["verify-your-work", "type check my code"],
  ["settings-scopes", "what is settings.local.json"],
  ["settings-scopes", "where do project settings live"],
  ["specific-prompts", "how do I write a better prompt"],
  ["compaction", "compact the conversation"],
  ["compaction", "what is autocompact"],
  ["model-names-and-limits", "which claude model should I use"],
  ["new-features", "what do the release notes say"],
  ["context-hygiene", "use /clear here"],
  ["compaction", "(/compact)"],
  ["plan-mode", "`/plan`"],
  ["claude-md", "/memory"],
  ["claude-md", "use /init here"],
];

describe("example prompts match their topic first", () => {
  test("the table covers every bundled topic", () => {
    const covered = new Set(EXAMPLES.map(([id]) => id));
    expect(catalog.map((e) => e.id).filter((id) => !covered.has(id))).toEqual(
      [],
    );
  });

  test.each(EXAMPLES)("%s <- %j", (id, prompt) => {
    expect(matchTopics(catalog, prompt, 1).map((e) => e.id)).toEqual([id]);
  });
});

describe("negative prompts match nothing", () => {
  test.each([
    "What does your start-of-session context say about my learning state?",
    "please plan my day",
    "review this sentence",
    "clear my doubts",
    "check the scope of this project",
    "design a logo",
    "explore the city this weekend",
    "what is the plan for today",
    "release my software",
    "which model should own this foreign key",
    "rename the model name column",
    "pass the model id to the serializer",
    "write a haiku for the README",
    "a magnum opus",
    "rate limit my API endpoint",
    "run ./init.sh",
    "look in ~/memory",
    "delete ./clear-cache",
    "cd src/compact",
  ])("%j", (prompt) => {
    expect(matchTopics(catalog, prompt).map((e) => e.id)).toEqual([]);
  });
});
