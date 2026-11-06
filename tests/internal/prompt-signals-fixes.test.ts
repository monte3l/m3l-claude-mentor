import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import { detectPromptSignals } from "../../src/internal/prompt-signals.js";

const parsedCatalog = parseCatalog(
  JSON.parse(readFileSync("data/topic-catalog.json", "utf8")),
);
if (!parsedCatalog.ok) throw new Error(parsedCatalog.reason);
const catalog = parsedCatalog.value;

function detect(prompt: string): readonly object[] {
  return detectPromptSignals(prompt, catalog);
}

describe("time-word tails make the stop global", () => {
  test.each([
    "stop tips for now",
    "no more tips for today",
    "mute tips for a while",
    "disable tips about tonight",
    "stop tips for a bit",
    "stop tips for the moment",
    "stop tips for this session",
    "stop tips on this conversation",
    "stop tips for now about hooks",
  ])("%s", (p) => {
    expect(detect(p)).toEqual([{ kind: "stop-tips" }]);
  });

  test("a topic phrase still resolves to the topic", () => {
    expect(detect("stop tips about hooks")).toEqual([
      { kind: "stop-tips-topic", topic: "hooks" },
    ]);
  });

  test("an unmatched non-time topic still yields nothing", () => {
    expect(detect("stop tips about gardening")).toEqual([]);
  });
});

describe("negation suppresses the phrase", () => {
  test.each([
    "please don't stop tips",
    "please dont stop tips",
    "do not resume tips",
    "never teach me plan mode",
    "not stop tips",
    "never just tell me",
    "don't stop tips about hooks",
  ])("%s", (p) => {
    expect(detect(p)).toEqual([]);
  });

  test("a negation not immediately before the phrase does not suppress", () => {
    expect(detect("don't worry. stop tips")).toEqual([{ kind: "stop-tips" }]);
  });

  test("a negation in an earlier clause does not suppress", () => {
    expect(detect("don't worry, stop tips")).toEqual([{ kind: "stop-tips" }]);
  });
});
