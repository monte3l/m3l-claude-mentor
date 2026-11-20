import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { matchTopics, parseCatalog } from "../../src/internal/catalog.ts";
import type { CatalogEntry } from "../../src/internal/schema.ts";

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

/**
 * Exam topics are `ambient: false`, so they only match when opted in. Each
 * phrase contains one of that topic's own keywords.
 */
const EXAM_EXAMPLES: readonly (readonly [string, string])[] = [
  ["messages-api", "what does the messages api return"],
  ["streaming-events", "which streaming events does it emit"],
  ["prompt-caching", "how does prompt caching save cost"],
  ["batch-processing", "when should I use the batch api"],
  ["extended-thinking", "turn on extended thinking for this call"],
  ["workflow-vs-agent-patterns", "is prompt chaining better here"],
  ["multi-agent-orchestration", "design a multi-agent system"],
  ["session-management", "how does session resume behave"],
  ["model-selection", "how should I choose a model for this"],
  ["generation-mechanics", "what does sampling temperature change"],
  ["tool-use-api", "what is a tool_result block"],
  ["structured-output", "how do I get structured output"],
  ["vision-and-files", "how does the files api work"],
  ["agent-sdk", "how do I start with the agent sdk"],
  [
    "mcp-server-development",
    "which stdio transport and streamable http should I pick",
  ],
  ["claude-code-headless-ci", "run in headless mode on a schedule"],
  ["built-in-tools", "which built-in tools exist"],
  ["tool-design", "how do I improve my tool design"],
  ["api-error-handling", "handle a 429 error from the api"],
  ["prompt-design", "tips for prompt design with xml tags"],
  ["few-shot-examples", "when to use few-shot examples"],
  ["grounding-and-citations", "how do citations work"],
  ["eval-design", "build a golden set for my eval"],
  ["failure-diagnosis", "why does a hallucination happen"],
  ["prompt-injection-defense", "defend against prompt injection"],
  ["api-key-handling", "where should the api key live"],
  ["human-in-the-loop", "add an approval gate before payment"],
  ["deployment-surfaces", "should we use google vertex ai for claude"],
  ["agent-runtimes", "which agent runtime fits our team"],
  ["retrieval-architecture", "design the rag pipeline for our docs"],
  ["rate-limits-throughput", "plan for burst traffic next week"],
  ["durable-agent-state", "make it resume after interruption"],
  ["context-editing-and-memory", "when do I use context editing"],
  ["progressive-discovery", "we hit the too many tools problem"],
  ["governance-compliance", "do we need zero data retention"],
  ["production-reliability", "add a circuit breaker for the provider"],
  ["observability-telemetry", "set up agent tracing for the fleet"],
  ["incident-response", "we need a kill switch for the bot"],
  ["online-evaluation", "run an a/b test prompts experiment"],
  ["llm-as-judge", "my judge rubric shows position bias"],
  ["cost-latency-optimization", "stay inside the latency budget"],
  [
    "model-migration-and-change-management",
    "plan the model migration to a new version",
  ],
  ["agent-threat-defense", "guard against tool poisoning"],
  ["enterprise-identity-and-audit", "wire up single sign-on for the agents"],
  ["ai-risk-and-bias", "run a bias testing pass before launch"],
  ["stakeholder-communication", "write an architecture decision record"],
  ["org-agent-governance", "draft an agent usage policy"],
  ["agent-fleet-operations", "how do we run an agent fleet overnight"],
  ["guardrail-design", "add runtime guardrails around the agent"],
];

const EXAM_IDS: ReadonlySet<string> = new Set(
  catalog.filter((e) => e.ambient === false).map((e) => e.id as string),
);

describe("example prompts match their topic first", () => {
  test("the table covers every bundled topic", () => {
    const covered = new Set([...EXAMPLES, ...EXAM_EXAMPLES].map(([id]) => id));
    expect(catalog.map((e) => e.id).filter((id) => !covered.has(id))).toEqual(
      [],
    );
  });

  test.each(EXAMPLES)("%s <- %j", (id, prompt) => {
    expect(matchTopics(catalog, prompt, 1).map((e) => e.id)).toEqual([id]);
  });
});

describe("exam topic example prompts", () => {
  test("the table covers every ambient:false bundled topic exactly once", () => {
    expect(EXAM_EXAMPLES.map(([id]) => id).sort()).toEqual(
      [...EXAM_IDS].sort(),
    );
    expect(EXAM_EXAMPLES).toHaveLength(49);
  });

  test.each(EXAM_EXAMPLES)("%s <- %j when opted in", (id, prompt) => {
    const hits = matchTopics(catalog, prompt, 1, {
      includeAmbientOff: EXAM_IDS,
    });
    expect(hits.map((e) => e.id)).toEqual([id]);
  });

  test("the grep tool phrase matches built-in-tools when opted in", () => {
    const hits = matchTopics(
      catalog,
      "how does the grep tool differ from a custom tool",
      1,
      { includeAmbientOff: EXAM_IDS },
    );
    expect(hits.map((e) => e.id)).toEqual(["built-in-tools"]);
  });

  test.each(EXAM_EXAMPLES)("%s stays silent unprompted: %j", (id, prompt) => {
    expect(matchTopics(catalog, prompt, 50).map((e) => e.id)).not.toContain(id);
  });

  test("without opt-in no exam topic matches any example phrase", () => {
    const phrases = [...EXAMPLES, ...EXAM_EXAMPLES].map(([, text]) => text);
    for (const phrase of phrases) {
      const ids = matchTopics(catalog, phrase, 100).map((e) => e.id as string);
      expect(
        ids.filter((id) => EXAM_IDS.has(id)),
        phrase,
      ).toEqual([]);
    }
  });
});

describe("everyday phrases are not hijacked by exam topics", () => {
  test.each([
    "teach me progressive disclosure",
    "explain the feedback loop",
    "what is access control",
    "how does agent memory work",
    "do a risk assessment",
    "what is a budget cap",
  ])("%j does not resolve to an exam topic first", (prompt) => {
    const [first] = matchTopics(catalog, prompt, 1, {
      includeAmbientOff: EXAM_IDS,
    });
    expect(first === undefined ? false : EXAM_IDS.has(first.id)).toBe(false);
  });

  test.each([
    ["progressive-discovery", "teach me tool progressive disclosure"],
    ["online-evaluation", "teach me production feedback loop"],
  ])("%s <- %j still wins when opted in", (id, prompt) => {
    const hits = matchTopics(catalog, prompt, 1, {
      includeAmbientOff: EXAM_IDS,
    });
    expect(hits.map((e) => e.id)).toEqual([id]);
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
