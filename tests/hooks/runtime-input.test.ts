import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MAX_CONTEXT_CHARS,
  MAX_STDIN_BYTES,
  type HookHandler,
} from "../../src/hooks/runtime.js";
import { MentorStateError } from "../../src/internal/errors.js";
import {
  cleanSandboxes,
  isOneLine,
  makeSandbox,
  run,
} from "./runtime-helpers.js";

afterEach(cleanSandboxes);

function spyHandler(): ReturnType<typeof vi.fn<HookHandler>> {
  return vi.fn<HookHandler>(() => Promise.resolve(null));
}

/** Valid JSON object padded with trailing spaces to exactly `bytes` bytes. */
function paddedJson(bytes: number): string {
  const base = '{"session_id":"s1"}';
  return base + " ".repeat(bytes - Buffer.byteLength(base));
}

describe("constants", () => {
  test("pin the documented limits", () => {
    expect(MAX_STDIN_BYTES).toBe(1_048_576);
    expect(MAX_CONTEXT_CHARS).toBe(9_000);
  });
});

describe("runHookCore stdin size", () => {
  test("accepts stdin of exactly MAX_STDIN_BYTES bytes", async () => {
    const handler = spyHandler();
    const text = paddedJson(1_048_576);
    expect(Buffer.byteLength(text)).toBe(1_048_576);
    const result = await run(makeSandbox(), text, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ stdout: "", stderr: "" });
  });

  test("rejects stdin of MAX_STDIN_BYTES + 1 bytes with a stderr note", async () => {
    const handler = spyHandler();
    const text = paddedJson(1_048_577);
    const result = await run(makeSandbox(), text, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
  });

  test("counts bytes, not characters", async () => {
    const handler = spyHandler();
    // 524_289 two-byte characters: 524_289 chars but 1_048_578 bytes.
    const text = `{"a":"${"é".repeat(524_289 - 4)}"}`;
    expect(text.length).toBeLessThan(1_048_576);
    expect(Buffer.byteLength(text)).toBeGreaterThan(1_048_576);
    const result = await run(makeSandbox(), text, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
  });
});

describe("runHookCore payload parsing", () => {
  test.each([
    ["invalid JSON", "{SECRET-PAYLOAD"],
    ["empty input", ""],
    ["an array", '["SECRET-PAYLOAD"]'],
    ["null", "null"],
    ["a number", "42"],
    ["a string", '"SECRET-PAYLOAD"'],
    ["a boolean", "true"],
  ])("%s: stderr note, no stdout, handler not called", async (_n, text) => {
    const handler = spyHandler();
    const result = await run(makeSandbox(), text, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
    expect(result.stderr).not.toContain("SECRET-PAYLOAD");
    // A payload-shape rejection is a deliberate note, not a crash that is
    // later reported as a TypeError (e.g. property access on null).
    expect(result.stderr).not.toContain("TypeError");
  });

  test("passes the parsed object payload to the handler", async () => {
    const handler = spyHandler();
    await run(
      makeSandbox(),
      '{"session_id":"s1","prompt":"hi","n":[1]}',
      handler,
    );
    expect(handler.mock.calls[0]?.[0]).toEqual({
      session_id: "s1",
      prompt: "hi",
      n: [1],
    });
  });
});

describe("runHookCore data directory", () => {
  test("an unset CLAUDE_PLUGIN_DATA yields a stderr note naming the code", async () => {
    const handler = spyHandler();
    const result = await run(null, "{}", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
    expect(result.stderr).toContain("DATA_DIR_UNSET");
  });

  test("a relative CLAUDE_PLUGIN_DATA yields a stderr note, no stdout", async () => {
    const handler = spyHandler();
    const result = await run(null, "{}", handler, {
      CLAUDE_PLUGIN_DATA: "relative/dir",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DATA_DIR_INVALID");
  });
});

describe("runHookCore never throws", () => {
  test("a handler throwing MentorStateError reports code and message", async () => {
    const handler: HookHandler = () =>
      Promise.reject(
        new MentorStateError("WRITE_FAILED", "could not write state.json"),
      );
    const result = await run(
      makeSandbox(),
      '{"prompt":"SECRET-PROMPT"}',
      handler,
    );
    expect(result).toEqual({
      stdout: "",
      stderr:
        "m3l-claude-mentor: TestHook: WRITE_FAILED: could not write state.json\n",
    });
  });

  test("a handler throwing a plain Error reports only the error name", async () => {
    const handler: HookHandler = () =>
      Promise.reject(new TypeError("leaks SECRET-PROMPT"));
    const result = await run(
      makeSandbox(),
      '{"prompt":"SECRET-PROMPT"}',
      handler,
    );
    expect(result).toEqual({
      stdout: "",
      stderr: "m3l-claude-mentor: TestHook: TypeError: TypeError\n",
    });
  });

  test("a handler throwing synchronously is contained", async () => {
    const handler: HookHandler = () => {
      throw new Error("sync SECRET-PROMPT");
    };
    const result = await run(
      makeSandbox(),
      '{"prompt":"SECRET-PROMPT"}',
      handler,
    );
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
    expect(result.stderr).not.toContain("SECRET-PROMPT");
  });

  test("a handler rejecting with a non-Error value is contained", async () => {
    const handler: HookHandler = () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentional non-Error to verify the runtime still never throws
      Promise.reject("SECRET-PROMPT");
    const result = await run(
      makeSandbox(),
      '{"prompt":"SECRET-PROMPT"}',
      handler,
    );
    expect(result.stdout).toBe("");
    expect(isOneLine(result.stderr)).toBe(true);
    expect(result.stderr).not.toContain("SECRET-PROMPT");
  });

  test("never echoes payload text on a successful run", async () => {
    const result = await run(makeSandbox(), '{"prompt":"SECRET-PROMPT"}', () =>
      Promise.resolve(null),
    );
    expect(result.stderr).toBe("");
  });
});
