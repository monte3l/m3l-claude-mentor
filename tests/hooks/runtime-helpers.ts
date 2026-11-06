import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HookHandler,
  HookRunInput,
  HookRunResult,
} from "../../src/hooks/runtime.js";
import { runHookCore } from "../../src/hooks/runtime.js";

export const NOW = 1_700_000_000_000;

const sandboxes: string[] = [];

/** A fresh data-dir sandbox; remove with {@link cleanSandboxes}. */
export function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "m3l-runtime-"));
  sandboxes.push(dir);
  return dir;
}

export function cleanSandboxes(): void {
  for (const dir of sandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `runHookCore("TestHook", ...)` against `dir` with `stdinText`. */
export function run(
  dir: string | null,
  stdinText: string,
  handler: HookHandler,
  extraEnv: Readonly<Record<string, string | undefined>> = {},
  options?: { readonly catalog?: boolean },
): Promise<HookRunResult> {
  const input: HookRunInput = {
    stdinText,
    env: {
      ...(dir === null ? {} : { CLAUDE_PLUGIN_DATA: dir }),
      ...extraEnv,
    },
    now: NOW,
  };
  return options === undefined
    ? runHookCore("TestHook", input, handler)
    : runHookCore("TestHook", input, handler, options);
}

/** Asserts a stderr note is exactly one newline-terminated line. */
export function isOneLine(text: string): boolean {
  return (
    text.length > 1 && text.endsWith("\n") && !text.slice(0, -1).includes("\n")
  );
}
