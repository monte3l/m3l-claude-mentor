import { describe, expect, test } from "vitest";
import { extractUsageSignals } from "../../src/internal/signals.js";

function bash(command: string): readonly { topic: string; kind: string }[] {
  return extractUsageSignals({
    tool_name: "Bash",
    tool_input: { command },
  }).map((s) => ({ topic: s.topic, kind: s.kind }));
}

describe("Bash command start accepts a path slash", () => {
  test("absolute path to claude", () => {
    expect(bash("/usr/local/bin/claude mcp add x")).toEqual([
      { topic: "mcp", kind: "added-mcp-server" },
    ]);
  });

  test.each(["claude mcpadd x", "claude mcp list", "/usr/bin/claude mcp list"])(
    "near miss %s",
    (c) => {
      expect(bash(c)).toEqual([]);
    },
  );
});
