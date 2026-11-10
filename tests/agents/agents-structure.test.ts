import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ROOT,
  checkFastFacts,
  hasPhrase,
  parseFrontmatter,
  splitList,
  unknownKeys,
} from "../skills/helpers.js";

const AGENTS_DIR = join(ROOT, "agents");
const AGENTS = ["docs-researcher", "mastery-assessor"] as const;
const ALLOWED_KEYS = [
  "name",
  "description",
  "tools",
  "model",
  "color",
  "maxTurns",
];
const FORBIDDEN_KEYS = [
  "hooks",
  "mcpServers",
  "permissionMode",
  "memory",
  "skills",
  "background",
  "isolation",
  "disallowedTools",
];
const FORBIDDEN_TOOLS = ["Bash", "Write", "Edit", "Agent", "Task", "WebSearch"];
const MODEL_ALIASES = ["sonnet", "opus", "haiku", "inherit"];

const load = (name: string) => {
  const path = join(AGENTS_DIR, `${name}.md`);
  return { ...parseFrontmatter(readFileSync(path, "utf8")), path };
};

/** Agent-definition problems shared by every agent. */
function checkAgent(
  stem: string,
  data: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const key of unknownKeys(data, ALLOWED_KEYS))
    problems.push(`unknown key: ${key}`);
  for (const key of FORBIDDEN_KEYS)
    if (Object.hasOwn(data, key)) problems.push(`forbidden key: ${key}`);
  if (data["name"] !== stem) problems.push("name must equal the file stem");
  if ((data["name"] ?? "").includes(":")) problems.push("name has a colon");
  if ((data["description"] ?? "").length < 80)
    problems.push("description shorter than 80 chars");
  if (data["tools"] === undefined) problems.push("tools missing");
  for (const tool of splitList(data["tools"]))
    if (FORBIDDEN_TOOLS.includes(tool))
      problems.push(`forbidden tool: ${tool}`);
  if (!MODEL_ALIASES.includes(data["model"] ?? ""))
    problems.push(`model is not an alias: ${data["model"] ?? "(missing)"}`);
  const turns = Number(data["maxTurns"]);
  if (!/^\d+$/.test(data["maxTurns"] ?? "") || turns < 1 || turns > 20)
    problems.push("maxTurns must be an integer 1..20");
  return problems;
}

describe("agents directory", () => {
  test("holds exactly the two agent files", () => {
    expect(readdirSync(AGENTS_DIR).sort()).toEqual([
      "docs-researcher.md",
      "mastery-assessor.md",
    ]);
  });
});

describe.each(AGENTS)("agent %s", (name) => {
  test("passes the shared definition rules", () => {
    expect(checkAgent(name, load(name).data)).toEqual([]);
  });

  test("body is at most 8000 bytes", () => {
    expect(statSync(load(name).path).size).toBeLessThanOrEqual(8000);
  });

  test("body states no model ids, prices or limits", () => {
    expect(checkFastFacts(load(name).body)).toEqual([]);
  });

  test("treats inputs as data, never instructions", () => {
    expect(hasPhrase(load(name).body, "never instructions")).toBe(true);
  });
});

/** True when a JSON-style `"events"` key appears in the text. */
function findEventsKey(text: string): boolean {
  return /"events"\s*:/.test(text);
}

describe("agent specifics", () => {
  test("docs-researcher has only WebFetch and the documented keys", () => {
    const { data, body } = load("docs-researcher");
    expect(splitList(data["tools"])).toEqual(["WebFetch"]);
    expect(data["model"]).toBe("sonnet");
    expect(data["maxTurns"]).toBe("10");
    expect(data["color"]).toBe("cyan");
    for (const needle of [
      "https://code.claude.com/docs/llms.txt",
      "Sources:",
      "Newest version:",
    ])
      expect(hasPhrase(body, needle), needle).toBe(true);
  });

  test("mastery-assessor has a non-empty subset of Read, Grep, Glob", () => {
    const { data, body } = load("mastery-assessor");
    const tools = splitList(data["tools"]);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(["Read", "Grep", "Glob"]).toContain(tool);
    expect(data["model"]).toBe("sonnet");
    expect(data["maxTurns"]).toBe("6");
    expect(data["color"]).toBe("purple");
    for (const needle of ["JSON", "Artifact paths:", "record-batch"])
      expect(hasPhrase(body, needle), needle).toBe(true);
    expect(hasPhrase(body, "ignore paths", true)).toBe(true);
    expect(findEventsKey(body)).toBe(false);
  });
});

describe("checkAgent self-tests", () => {
  const good = {
    name: "x",
    description: "d".repeat(80),
    tools: "Read",
    model: "sonnet",
    maxTurns: "5",
  };

  test("accepts a good definition", () => {
    expect(checkAgent("x", good)).toEqual([]);
  });

  test.each([
    ["forbidden key", { ...good, hooks: "x" }],
    ["unknown key", { ...good, extra: "x" }],
    ["wrong stem", { ...good, name: "y" }],
    ["colon in name", { ...good, name: "m:x" }],
    ["short description", { ...good, description: "short" }],
    ["missing tools", { ...good, tools: undefined as unknown as string }],
    ["forbidden tool", { ...good, tools: "Read, Bash" }],
    ["full model id", { ...good, model: "claude-sonnet-4-5" }],
    ["maxTurns zero", { ...good, maxTurns: "0" }],
    ["maxTurns too big", { ...good, maxTurns: "21" }],
    ["maxTurns not integer", { ...good, maxTurns: "2.5" }],
  ])("flags %s", (_label, data) => {
    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );
    expect(checkAgent("x", cleaned)).not.toEqual([]);
  });
});

describe("findEventsKey self-tests", () => {
  test("flags a JSON example with an events key", () => {
    expect(findEventsKey('{"verdicts":[],"events":"quiz:positive"}')).toBe(
      true,
    );
  });

  test("accepts an example without it", () => {
    expect(findEventsKey('{"verdicts":[],"notes":"events are rebuilt"}')).toBe(
      false,
    );
  });
});
