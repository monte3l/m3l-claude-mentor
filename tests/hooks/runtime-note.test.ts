import { afterEach, describe, expect, test } from "vitest";
import type { HookHandler, HookOutput } from "../../src/hooks/runtime.ts";
import { cleanSandboxes, makeSandbox, run } from "./runtime-helpers.ts";

afterEach(cleanSandboxes);

const SESSION_JSON = '{"session_id":"s1"}';
const emit =
  (output: HookOutput | null): HookHandler =>
  () =>
    Promise.resolve(output);

describe("HookOutput.note", () => {
  test("only a note: stdout stays empty (not {}) and stderr is one line", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ note: "degraded: LOCK_TIMEOUT" }),
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "m3l-claude-mentor: TestHook: degraded: LOCK_TIMEOUT\n",
    );
  });

  test("a note plus context: the JSON stdout is unchanged and does not carry the note", async () => {
    const output = {
      hookSpecificOutput: {
        hookEventName: "TestHook",
        additionalContext: "ctx",
      },
    } as const;
    const plain = await run(makeSandbox(), SESSION_JSON, emit(output));
    const noted = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ ...output, note: "degraded" }),
    );
    expect(noted.stdout).toBe(plain.stdout);
    expect(noted.stdout).not.toContain("degraded");
    expect(noted.stderr).toBe("m3l-claude-mentor: TestHook: degraded\n");
  });

  test("a note plus a system message keeps both stdout fields and writes one stderr line", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ systemMessage: "hello", note: "degraded" }),
    );
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: "hello" });
    expect(result.stderr).toBe("m3l-claude-mentor: TestHook: degraded\n");
  });

  test("a multi-line note is flattened to one line", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ note: "line one\nline two" }),
    );
    expect(result.stderr).toBe(
      "m3l-claude-mentor: TestHook: line one line two\n",
    );
  });

  test("no note: no stderr (existing behaviour)", async () => {
    const result = await run(
      makeSandbox(),
      SESSION_JSON,
      emit({ systemMessage: "hello" }),
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: "hello" });
  });

  test("a null output has empty stdout and stderr", async () => {
    const result = await run(makeSandbox(), SESSION_JSON, emit(null));
    expect(result).toEqual({ stdout: "", stderr: "" });
  });
});
