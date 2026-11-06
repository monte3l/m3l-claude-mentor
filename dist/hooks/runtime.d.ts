import type { CatalogEntry } from "../internal/schema.js";
import { type HookSettings } from "./settings.js";
/**
 * What a hook process received.
 *
 * @example
 * ```ts
 * import type { HookRunInput } from "./runtime.js";
 * const input: HookRunInput = { stdinText: "{}", env: process.env, now: Date.now() };
 * ```
 */
export interface HookRunInput {
    /** The whole of stdin, decoded as UTF-8. */
    readonly stdinText: string;
    /** The process environment. */
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The clock, in epoch milliseconds. */
    readonly now: number;
}
/**
 * The JSON a hook prints on stdout. `systemMessage` is shown to the user;
 * `additionalContext` reaches only the model.
 *
 * @example
 * ```ts
 * import type { HookOutput } from "./runtime.js";
 * const output: HookOutput = {
 *   hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." },
 * };
 * ```
 */
export interface HookOutput {
    /** A notice shown to the user. */
    readonly systemMessage?: string;
    /** Event-specific output. */
    readonly hookSpecificOutput?: {
        /** The hook event this output answers. */
        readonly hookEventName: string;
        /** Text added to the model's context. */
        readonly additionalContext?: string;
    };
}
/**
 * Everything a handler may depend on besides the payload.
 *
 * @example
 * ```ts
 * import type { HookDeps } from "./runtime.js";
 * const deps: HookDeps = {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   settings: { dial: 2, transcriptAnalysis: true },
 *   catalog: [],
 *   cwd: null,
 * };
 * ```
 */
export interface HookDeps {
    /** The resolved data directory. */
    readonly dir: string;
    /** The clock, in epoch milliseconds. */
    readonly now: number;
    /** The user options. */
    readonly settings: HookSettings;
    /** The bundled catalog merged with the learner's user catalog. */
    readonly catalog: readonly CatalogEntry[];
    /** The payload's `cwd` when it is an absolute path, else `null`. */
    readonly cwd: string | null;
}
/**
 * A hook event handler: `null` means "print nothing". Errors it throws are
 * reported by {@link runHookCore}, which still exits cleanly.
 *
 * @example
 * ```ts
 * import type { HookHandler } from "./runtime.js";
 * const handler: HookHandler = () => Promise.resolve(null);
 * ```
 */
export type HookHandler = (payload: Readonly<Record<string, unknown>>, deps: HookDeps) => Promise<HookOutput | null>;
/**
 * The text a hook process writes: `stdout` is `""` or one JSON document
 * plus a newline; `stderr` is `""` or one newline-terminated line.
 *
 * @example
 * ```ts
 * import type { HookRunResult } from "./runtime.js";
 * const result: HookRunResult = { stdout: "", stderr: "" };
 * ```
 */
export interface HookRunResult {
    /** What to print on stdout. */
    readonly stdout: string;
    /** What to print on stderr. */
    readonly stderr: string;
}
/**
 * Options for {@link runHookCore}.
 *
 * @example
 * ```ts
 * import type { HookRunOptions } from "./runtime.js";
 * const options: HookRunOptions = { catalog: false };
 * ```
 */
export interface HookRunOptions {
    /**
     * Whether to load the bundled catalog merged with the learner's
     * `catalog.json` (default `true`). With `false` no catalog is read, so a
     * broken `catalog.json` cannot stop the hook, and the handler gets `[]`.
     */
    readonly catalog?: boolean;
}
/**
 * The largest stdin accepted, in bytes (1 MiB).
 *
 * @example
 * ```ts
 * import { MAX_STDIN_BYTES } from "./runtime.js";
 * Buffer.byteLength("{}") <= MAX_STDIN_BYTES; // true
 * ```
 */
export declare const MAX_STDIN_BYTES: number;
/**
 * The longest `additionalContext` or `systemMessage` emitted, in UTF-16
 * code units; Claude Code itself caps both at 10,000.
 *
 * @example
 * ```ts
 * import { MAX_CONTEXT_CHARS } from "./runtime.js";
 * "hint".length <= MAX_CONTEXT_CHARS; // true
 * ```
 */
export declare const MAX_CONTEXT_CHARS: number;
/**
 * Collapses every run of line breaks (CR, LF, U+2028, U+2029) into one
 * space, so text written as a diagnostic always stays on one line.
 *
 * @param text - Any text.
 * @returns `text` with no line breaks.
 *
 * @example
 * ```ts
 * import { oneLine } from "./runtime.js";
 * oneLine("a\r\nb"); // "a b"
 * ```
 */
export declare function oneLine(text: string): string;
/**
 * Formats one hook diagnostic line for stderr:
 * `m3l-claude-mentor: <name>: <text>` plus a newline, each part passed
 * through {@link oneLine}.
 *
 * @param name - The hook event name.
 * @param text - The note; must not carry payload text.
 * @returns One newline-terminated line.
 *
 * @example
 * ```ts
 * import { hookNote } from "./runtime.js";
 * hookNote("Stop", "stdin could not be read"); // "m3l-claude-mentor: Stop: stdin could not be read\n"
 * ```
 */
export declare function hookNote(name: string, text: string): string;
/**
 * Runs one hook invocation without touching the process. Steps: reject stdin
 * over {@link MAX_STDIN_BYTES} bytes; parse it as a plain JSON object;
 * resolve the data directory; unless `options.catalog` is `false`, load the
 * bundled catalog merged with the learner's `catalog.json` (else the handler
 * gets `[]`); take `cwd` from the payload when absolute; call `handler`. A
 * `null` result prints nothing; otherwise stdout is one JSON document with
 * `systemMessage` and `additionalContext` capped at
 * {@link MAX_CONTEXT_CHARS} (ending in "…" when cut) and
 * `hookSpecificOutput.hookEventName` forced to `name`. Never throws: any
 * failure yields empty stdout and one stderr line
 * `m3l-claude-mentor: <name>: <CODE or ErrorName>: <detail>`, where the
 * detail is a MentorStateError's message or else the error name, so payload
 * text is never echoed.
 *
 * @param name - The hook event name used in stderr notes.
 * @param input - The stdin text, environment and clock.
 * @param handler - The event handler.
 * @param options - Whether to load the catalog (default: load it).
 * @returns What to print on stdout and stderr; the process exits 0 either way.
 *
 * @example
 * ```ts
 * import { runHookCore } from "./runtime.js";
 * const result = await runHookCore(
 *   "Stop",
 *   { stdinText: "{}", env: process.env, now: Date.now() },
 *   () => Promise.resolve(null),
 * );
 * process.stdout.write(result.stdout);
 * ```
 */
export declare function runHookCore(name: string, input: HookRunInput, handler: HookHandler, options?: HookRunOptions): Promise<HookRunResult>;
//# sourceMappingURL=runtime.d.ts.map