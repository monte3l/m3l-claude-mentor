import { describe, expect, test } from "vitest";
import { matchTopics, parseCatalog } from "../../src/internal/catalog.ts";
import { detectPromptSignals } from "../../src/internal/prompt-signals.ts";

function entry(
  id: string,
  keywords: readonly string[],
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    title: id,
    type: "feature",
    dependencies: [],
    keywords,
    targetLevel: "Applied",
    enabled: true,
    ...extra,
  };
}

function build(entries: readonly Record<string, unknown>[]) {
  const parsed = parseCatalog(entries);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

// exam-weak is ambient, listed first, and shares the keyword "exam": it wins
// a tie unless the ambient: false topic is considered at all.
const catalog = build([
  entry("exam-weak", ["exam"]),
  entry("exam-x", ["exam"], { ambient: false }),
  entry("exam-off", ["offword"], { ambient: false, enabled: false }),
  entry("plain", ["plainword"]),
]);

describe("explicit requests resolve ambient: false topics", () => {
  test.each([
    ["teach me exam next", { kind: "teach-next", topic: "exam-x" }],
    ["stop tips about exam", { kind: "stop-tips-topic", topic: "exam-x" }],
  ])("%s", (prompt, signal) => {
    // Sole topic is ambient: false, so it resolves only if such topics count.
    const sole = build([entry("exam-x", ["exam"], { ambient: false })]);
    expect(detectPromptSignals(prompt, sole)).toEqual([signal]);
  });

  test.each([
    ["teach me exam next", "teach-next"],
    ["stop tips about exam", "stop-tips-topic"],
  ])("%s does not fall through to a weaker ambient topic", (prompt, kind) => {
    const signals = detectPromptSignals(prompt, [
      ...catalog.filter((e) => e.id !== "exam-weak"),
      ...catalog.filter((e) => e.id === "exam-weak"),
    ]);
    expect(signals).toEqual([{ kind, topic: "exam-x" }]);
  });

  test.each([
    ["teach me plainword", { kind: "teach-next", topic: "plain" }],
    ["stop tips about plainword", { kind: "stop-tips-topic", topic: "plain" }],
  ])("ambient topics still resolve: %s", (prompt, signal) => {
    expect(detectPromptSignals(prompt, catalog)).toEqual([signal]);
  });

  test.each(["teach me offword", "stop tips about offword"])(
    "a disabled ambient: false topic stays excluded: %s",
    (prompt) => {
      expect(detectPromptSignals(prompt, catalog)).toEqual([]);
    },
  );
});

describe("ambient: false pair", () => {
  test("the same topic is explicitly teachable but yields no ambient match", () => {
    const only = build([entry("exam-x", ["exam"], { ambient: false })]);
    expect(matchTopics(only, "I have an exam")).toEqual([]);
    expect(detectPromptSignals("teach me exam", only)).toEqual([
      { kind: "teach-next", topic: "exam-x" },
    ]);
  });
});
