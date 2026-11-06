/**
 * The hook process shell: the only hook code that touches `process`. It
 * reads stdin, delegates to {@link runHookCore} and writes the result. It is
 * exercised through the spawned entry tests, not in-process.
 */
import { type HookHandler, type HookRunOptions } from "./runtime.js";
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
export declare function runHook(name: string, handler: HookHandler, options?: HookRunOptions): Promise<void>;
//# sourceMappingURL=process-shell.d.ts.map