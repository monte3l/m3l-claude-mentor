import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HookHandler, HookOutput } from "../../src/hooks/runtime.js";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.js";
import { cleanSandboxes, makeSandbox, run } from "./runtime-helpers.js";

afterEach(cleanSandboxes);

const STDIN = '{"session_id":"s1"}';

describe("runHookCore options.catalog", () => {
  test("catalog:false passes an empty catalog and still runs the handler", async () => {
    const handler = vi.fn<HookHandler>(() => Promise.resolve(null));
    const result = await run(
      makeSandbox(),
      STDIN,
      handler,
      {},
      { catalog: false },
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1].catalog).toEqual([]);
    expect(result).toEqual({ stdout: "", stderr: "" });
  });

  test("catalog:false ignores a corrupt user catalog.json", async () => {
    const dir = makeSandbox();
    writeFileSync(join(dir, "catalog.json"), "{not json");
    const handler = vi.fn<HookHandler>(() =>
      Promise.resolve({ systemMessage: "ran" }),
    );
    const result = await run(dir, STDIN, handler, {}, { catalog: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: "ran" });
  });

  test("catalog:false ignores an unmergeable user catalog.json", async () => {
    const dir = makeSandbox();
    writeFileSync(
      join(dir, "catalog.json"),
      JSON.stringify({
        overrides: { "no-such-topic": { enabled: false } },
        custom: [],
      }),
    );
    const handler = vi.fn<HookHandler>(() => Promise.resolve(null));
    const result = await run(dir, STDIN, handler, {}, { catalog: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.stderr).toBe("");
  });

  test.each([
    ["omitted", undefined],
    ["an empty options object", {}],
    ["catalog:true", { catalog: true }],
  ] as const)(
    "%s keeps the default: catalog loaded, failure is a note",
    async (_n, options) => {
      const okDir = makeSandbox();
      const ok = vi.fn<HookHandler>(() => Promise.resolve(null));
      await run(okDir, STDIN, ok, {}, options);
      expect(ok.mock.calls[0]?.[1].catalog).toEqual(await loadBundledCatalog());

      const badDir = makeSandbox();
      writeFileSync(join(badDir, "catalog.json"), "{not json");
      const bad = vi.fn<HookHandler>(() => Promise.resolve(null));
      const result = await run(badDir, STDIN, bad, {}, options);
      expect(bad).not.toHaveBeenCalled();
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    },
  );
});

describe("runHookCore hookEventName", () => {
  test("is forced to the hook name when the handler returns another", async () => {
    const handler: HookHandler = () =>
      Promise.resolve({
        hookSpecificOutput: {
          hookEventName: "SomethingElse",
          additionalContext: "ctx",
        },
      });
    const result = await run(makeSandbox(), STDIN, handler);
    const out = JSON.parse(result.stdout) as HookOutput;
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "TestHook",
      additionalContext: "ctx",
    });
  });

  test("is forced even when additionalContext is absent", async () => {
    const handler: HookHandler = () =>
      Promise.resolve({ hookSpecificOutput: { hookEventName: "Wrong" } });
    const result = await run(makeSandbox(), STDIN, handler);
    expect(
      (JSON.parse(result.stdout) as HookOutput).hookSpecificOutput
        ?.hookEventName,
    ).toBe("TestHook");
  });

  test("an output without hookSpecificOutput gains none", async () => {
    const handler: HookHandler = () => Promise.resolve({ systemMessage: "m" });
    const result = await run(makeSandbox(), STDIN, handler);
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: "m" });
  });
});
