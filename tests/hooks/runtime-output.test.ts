import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type HookDeps,
  type HookHandler,
  type HookOutput,
} from "../../src/hooks/runtime.js";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.js";
import {
  cleanSandboxes,
  isOneLine,
  makeSandbox,
  NOW,
  run,
} from "./runtime-helpers.js";

afterEach(cleanSandboxes);

const SESSION_JSON = '{"session_id":"s1"}';

function emit(output: HookOutput | null): HookHandler {
  return () => Promise.resolve(output);
}

async function depsFor(
  stdin: string,
  env: Readonly<Record<string, string | undefined>> = {},
  prepare?: (dir: string) => void,
): Promise<{ deps: HookDeps; dir: string }> {
  const dir = makeSandbox();
  prepare?.(dir);
  const handler = vi.fn<HookHandler>(() => Promise.resolve(null));
  await run(dir, stdin, handler, env);
  const deps = handler.mock.calls[0]?.[1];
  if (deps === undefined) throw new Error("handler was not called");
  return { deps, dir };
}

describe("runHookCore output", () => {
  test("a null handler result yields empty stdout and stderr", async () => {
    expect(await run(makeSandbox(), SESSION_JSON, emit(null))).toEqual({
      stdout: "",
      stderr: "",
    });
  });

  test("an output is one JSON document plus a newline", async () => {
    const output: HookOutput = {
      systemMessage: "hello",
      hookSpecificOutput: {
        hookEventName: "TestHook",
        additionalContext: "ctx",
      },
    };
    const result = await run(makeSandbox(), SESSION_JSON, emit(output));
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
  });

  test("an output with an empty object is still serialized", async () => {
    const result = await run(makeSandbox(), SESSION_JSON, emit({}));
    expect(result.stdout).toBe("{}\n");
  });
});

describe("runHookCore context cap", () => {
  test("additionalContext of exactly 9,000 chars is untouched", async () => {
    const context = "a".repeat(9_000);
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({
        hookSpecificOutput: {
          hookEventName: "TestHook",
          additionalContext: context,
        },
      }),
    );
    const parsed = JSON.parse(result.stdout) as HookOutput;
    expect(parsed.hookSpecificOutput?.additionalContext).toBe(context);
  });

  test("additionalContext of 9,001 chars is cut to 9,000 ending with an ellipsis", async () => {
    const context = "a".repeat(9_001);
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({
        hookSpecificOutput: {
          hookEventName: "TestHook",
          additionalContext: context,
        },
      }),
    );
    const out = JSON.parse(result.stdout) as HookOutput;
    const text = out.hookSpecificOutput?.additionalContext ?? "";
    expect(text).toHaveLength(9_000);
    expect(text).toBe(`${"a".repeat(8_999)}…`);
    expect(out.hookSpecificOutput?.hookEventName).toBe("TestHook");
  });

  test("systemMessage of exactly 9,000 chars is untouched", async () => {
    const message = "b".repeat(9_000);
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ systemMessage: message }),
    );
    expect((JSON.parse(result.stdout) as HookOutput).systemMessage).toBe(
      message,
    );
  });

  test("systemMessage of 9,001 chars is cut to 9,000 ending with an ellipsis", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ systemMessage: "b".repeat(9_001) }),
    );
    const text = (JSON.parse(result.stdout) as HookOutput).systemMessage ?? "";
    expect(text).toBe(`${"b".repeat(8_999)}…`);
  });

  test("both fields are capped independently in one output", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({
        systemMessage: "s".repeat(20_000),
        hookSpecificOutput: {
          hookEventName: "TestHook",
          additionalContext: "c".repeat(20_000),
        },
      }),
    );
    const out = JSON.parse(result.stdout) as HookOutput;
    expect(out.systemMessage).toHaveLength(9_000);
    expect(out.hookSpecificOutput?.additionalContext).toHaveLength(9_000);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd().includes("\n")).toBe(false);
  });
});

describe("runHookCore deps", () => {
  test("passes dir, now, default settings and the bundled catalog", async () => {
    const { deps, dir } = await depsFor(SESSION_JSON);
    expect(deps.dir).toBe(dir);
    expect(deps.now).toBe(NOW);
    expect(deps.settings).toEqual({ dial: 2, transcriptAnalysis: true });
    expect(deps.catalog).toEqual(await loadBundledCatalog());
  });

  test("derives settings from the plugin option environment", async () => {
    const { deps } = await depsFor(SESSION_JSON, {
      CLAUDE_PLUGIN_OPTION_DIAL: "4",
      CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS: "false",
    });
    expect(deps.settings).toEqual({ dial: 4, transcriptAnalysis: false });
  });

  test("merges the user catalog.json over the bundled catalog", async () => {
    const custom = {
      id: "my-topic",
      title: "My topic",
      type: "feature",
      dependencies: [],
      keywords: ["my topic"],
      targetLevel: "Applied",
      enabled: true,
    };
    const { deps } = await depsFor(SESSION_JSON, {}, (dir) => {
      writeFileSync(
        join(dir, "catalog.json"),
        JSON.stringify({
          overrides: { "context-window": { enabled: false } },
          custom: [custom],
        }),
      );
    });
    expect(deps.catalog.find((e) => e.id === "my-topic")).toEqual(custom);
    expect(deps.catalog.find((e) => e.id === "context-window")?.enabled).toBe(
      false,
    );
  });

  test("a corrupt user catalog.json yields a stderr note, no stdout, no handler call", async () => {
    const dir = makeSandbox();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "catalog.json"), "{not json SECRET-CATALOG");
    const handler = vi.fn<HookHandler>(() =>
      Promise.resolve({ systemMessage: "x" }),
    );
    const result = await run(dir, SESSION_JSON, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
    expect(result.stderr).not.toContain("SECRET-CATALOG");
  });

  test("a user catalog that fails to merge yields a stderr note, no stdout", async () => {
    const dir = makeSandbox();
    writeFileSync(
      join(dir, "catalog.json"),
      JSON.stringify({
        overrides: { "no-such-topic": { enabled: false } },
        custom: [],
      }),
    );
    const handler = vi.fn<HookHandler>(() => Promise.resolve(null));
    const result = await run(dir, SESSION_JSON, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
  });
});

describe("runHookCore cwd", () => {
  test.each([
    ["an absolute path", '{"cwd":"/a/b/c"}', "/a/b/c"],
    ["a relative path", '{"cwd":"rel/dir"}', null],
    ["a dot-relative path", '{"cwd":"./x"}', null],
    ["an empty string", '{"cwd":""}', null],
    ["a non-string", '{"cwd":5}', null],
    ["null", '{"cwd":null}', null],
    ["missing", "{}", null],
  ])("%s -> %j", async (_name, stdin, expected) => {
    const { deps } = await depsFor(stdin);
    expect(deps.cwd).toBe(expected);
  });
});
