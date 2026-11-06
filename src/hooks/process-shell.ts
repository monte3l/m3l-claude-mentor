/**
 * The hook process shell: the only hook code that touches `process`. It
 * reads stdin, delegates to {@link runHookCore} and writes the result. It is
 * exercised through the spawned entry tests, not in-process.
 */
import {
  hookNote,
  MAX_STDIN_BYTES,
  runHookCore,
  type HookHandler,
  type HookRunOptions,
  type HookRunResult,
} from "./runtime.js";

/**
 * Reads stdin, keeping at most {@link MAX_STDIN_BYTES} + 1 bytes (enough to
 * trip the size check in {@link runHookCore}) while still draining the rest.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let kept = 0;
  for await (const chunk of process.stdin) {
    if (kept > MAX_STDIN_BYTES) continue;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    chunks.push(bytes);
    kept += bytes.length;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The hook process wrapper: reads all of stdin, runs {@link runHookCore}
 * with `process.env`, `Date.now()` and `options`, writes its output, and sets
 * `process.exitCode = 0`. It never calls `process.exit()`, so pending writes
 * flush, and never rejects: `runHookCore` never throws, and a stdin read
 * failure becomes one fixed stderr line (the error is not echoed, as its
 * message could carry input).
 *
 * @param name - The hook event name used in stderr notes and output.
 * @param handler - The event handler.
 * @param options - Forwarded to {@link runHookCore}.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { isMainModule } from "./main-guard.js";
 * if (isMainModule(import.meta, process.argv[1])) {
 *   await runHook("Stop", () => Promise.resolve(null), { catalog: false });
 * }
 * ```
 */
export async function runHook(
  name: string,
  handler: HookHandler,
  options?: HookRunOptions,
): Promise<void> {
  let stdinText: string | null;
  try {
    stdinText = await readStdin();
  } catch {
    // The error message may embed input, so only a fixed note is written.
    stdinText = null;
  }
  const result: HookRunResult =
    stdinText === null
      ? {
          stdout: "",
          stderr: hookNote(name, "stdin could not be read; ignored"),
        }
      : await runHookCore(
          name,
          { stdinText, env: process.env, now: Date.now() },
          handler,
          options,
        );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = 0;
}
