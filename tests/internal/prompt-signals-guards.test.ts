import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import {
  detectPromptSignals,
  MAX_PROMPT_CHARS,
} from "../../src/internal/prompt-signals.js";

const parsedCatalog = parseCatalog(
  JSON.parse(readFileSync("data/topic-catalog.json", "utf8")),
);
if (!parsedCatalog.ok) throw new Error(parsedCatalog.reason);
const catalog = parsedCatalog.value;

function detect(prompt: unknown): readonly object[] {
  return detectPromptSignals(prompt, catalog);
}

describe("non-string input", () => {
  test.each([
    null,
    undefined,
    1,
    true,
    [],
    ["stop tips"],
    {},
    { a: "stop tips" },
  ])("%j yields []", (p) => {
    expect(detect(p)).toEqual([]);
  });

  test("empty catalog still detects non-topic kinds and no topic kinds", () => {
    expect(detectPromptSignals("just tell me", [])).toEqual([
      { kind: "just-tell-me" },
    ]);
    expect(detectPromptSignals("teach me about hooks", [])).toEqual([]);
  });
});

describe("pasted_content blocks are ignored", () => {
  test("phrase inside a block is ignored", () => {
    expect(
      detect("<pasted_content id=1>stop tips</pasted_content id=1>"),
    ).toEqual([]);
  });

  test("phrase outside a block is kept, inside is dropped", () => {
    expect(
      detect(
        "just tell me <pasted_content a>stop tips</pasted_content a> resume tips",
      ),
    ).toEqual([{ kind: "just-tell-me" }, { kind: "resume-tips" }]);
  });

  test("inside phrase cannot win later-wins against outside phrase", () => {
    expect(
      detect("stop tips <pasted_content x>resume tips</pasted_content x>"),
    ).toEqual([{ kind: "stop-tips" }]);
  });

  test("unterminated opening tag ignores to the end", () => {
    expect(detect("just tell me <pasted_content x> stop tips")).toEqual([
      { kind: "just-tell-me" },
    ]);
  });

  test("tags are matched case-insensitively", () => {
    expect(detect("<PASTED_CONTENT a>stop tips</PASTED_CONTENT a>")).toEqual(
      [],
    );
  });

  test("two blocks are both ignored", () => {
    expect(
      detect(
        "<pasted_content a>stop tips</pasted_content a> teach me hooks <pasted_content b>just tell me</pasted_content b>",
      ),
    ).toEqual([{ kind: "teach-next", topic: "hooks" }]);
  });
});

describe("scan window", () => {
  test("phrase fully inside the window is found", () => {
    const p = `${" ".repeat(MAX_PROMPT_CHARS - 20)}just tell me`;
    expect(detect(p)).toEqual([{ kind: "just-tell-me" }]);
  });

  test("phrase starting at char 4001 is ignored", () => {
    const p = `${"x".repeat(MAX_PROMPT_CHARS)} just tell me`;
    expect(detect(p)).toEqual([]);
  });

  test("phrase straddling the window edge is not matched", () => {
    const p = `${" ".repeat(MAX_PROMPT_CHARS - 5)}just tell me`;
    expect(detect(p)).toEqual([]);
  });

  test("huge input returns promptly", () => {
    const start = performance.now();
    detect("stop ".repeat(2_000_000));
    detect(`stop tips about ${"a ".repeat(2_000_000)}`);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe("output hygiene", () => {
  test("never echoes prompt text", () => {
    const secret = "sk-ant-SECRET-999";
    const out = detect(
      `my key ${secret}. stop tips about hooks ${secret}. just tell me. teach me skills`,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toContain(secret);
    for (const s of out) {
      expect(Object.keys(s).every((k) => k === "kind" || k === "topic")).toBe(
        true,
      );
    }
  });
});
