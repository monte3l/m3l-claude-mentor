/**
 * The shared hook runtime: turns a hook's stdin and environment into the
 * dependencies a handler needs, runs the handler, and renders its output.
 * A mentor failure must never block the learner, so every failure becomes a
 * one-line stderr note and the process still exits 0.
 */
import path from "node:path";
import { loadBundledCatalog } from "../internal/bundled-catalog.js";
import { mergeCatalog } from "../internal/catalog.js";
import { isMentorStateError, MentorStateError } from "../internal/errors.js";
import { resolveDataDir } from "../internal/paths.js";
import type { CatalogEntry } from "../internal/schema.js";
import { loadCatalogFile } from "../internal/store.js";
import { readSettings, type HookSettings } from "./settings.js";

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
export type HookHandler = (
  payload: Readonly<Record<string, unknown>>,
  deps: HookDeps,
) => Promise<HookOutput | null>;

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
export const MAX_STDIN_BYTES: number = 1_048_576;

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
export const MAX_CONTEXT_CHARS: number = 9_000;

const PREFIX = "m3l-claude-mentor";
const ELLIPSIS = "…";

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
export function oneLine(text: string): string {
  return text.replace(/[\r\n\p{Zl}\p{Zp}]+/gu, " ");
}

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
export function hookNote(name: string, text: string): string {
  return `${PREFIX}: ${oneLine(name)}: ${oneLine(text)}\n`;
}

/**
 * Describes a thrown value without echoing input: a MentorStateError gives
 * its code and fixed-text message; any other Error only its name (its
 * message may embed payload text); a non-Error a fixed label. Never throws.
 */
function describeError(error: unknown): string {
  try {
    if (isMentorStateError(error)) return `${error.code}: ${error.message}`;
    if (error instanceof Error) {
      const raw: unknown = error.name;
      const label = typeof raw === "string" && raw !== "" ? raw : "Error";
      return `${label}: ${label}`;
    }
  } catch {
    // An accessor on the thrown value failed; fall through to the fixed label.
  }
  return "UnknownError: a non-Error value was thrown";
}

/**
 * Whether a `JSON.parse` result is an object (not an array or null). Only
 * plain objects and arrays come out of `JSON.parse`, so no prototype check
 * is needed.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cuts `text` to {@link MAX_CONTEXT_CHARS}, ending with an ellipsis. */
function cap(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  let head = text.slice(0, MAX_CONTEXT_CHARS - ELLIPSIS.length);
  const last = head.charCodeAt(head.length - 1);
  // Never leave half of a surrogate pair at the cut.
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + ELLIPSIS;
}

/**
 * Projects the allowlisted output fields, capping the free-text ones and
 * forcing `hookEventName` to the running hook's `name`.
 */
function render(name: string, output: HookOutput): string {
  const specific = output.hookSpecificOutput;
  const projected: HookOutput = {
    ...(typeof output.systemMessage === "string"
      ? { systemMessage: cap(output.systemMessage) }
      : {}),
    ...(specific !== undefined
      ? {
          hookSpecificOutput: {
            hookEventName: name,
            ...(typeof specific.additionalContext === "string"
              ? { additionalContext: cap(specific.additionalContext) }
              : {}),
          },
        }
      : {}),
  };
  return `${JSON.stringify(projected)}\n`;
}

async function loadCatalog(dir: string): Promise<readonly CatalogEntry[]> {
  const bundled = await loadBundledCatalog();
  const file = await loadCatalogFile(dir);
  const merged = mergeCatalog(bundled, file.user);
  if (!merged.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `catalog.json does not merge with the bundled catalog: ${merged.reason}`,
    );
  }
  return merged.value;
}

function absoluteCwd(
  payload: Readonly<Record<string, unknown>>,
): string | null {
  const raw: unknown = Object.hasOwn(payload, "cwd") ? payload["cwd"] : null;
  return typeof raw === "string" && raw !== "" && path.isAbsolute(raw)
    ? raw
    : null;
}

async function runSteps(
  name: string,
  input: HookRunInput,
  handler: HookHandler,
  withCatalog: boolean,
): Promise<HookRunResult> {
  if (Buffer.byteLength(input.stdinText) > MAX_STDIN_BYTES) {
    return {
      stdout: "",
      stderr: hookNote(
        name,
        `stdin exceeds ${String(MAX_STDIN_BYTES)} bytes; ignored`,
      ),
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.stdinText);
  } catch {
    // No detail: a SyntaxError message embeds a snippet of the payload.
    payload = undefined;
  }
  if (!isJsonObject(payload)) {
    return {
      stdout: "",
      stderr: hookNote(name, "stdin is not a JSON object; ignored"),
    };
  }
  const dir = resolveDataDir(input.env);
  const deps: HookDeps = {
    dir,
    now: input.now,
    settings: readSettings(input.env),
    catalog: withCatalog ? await loadCatalog(dir) : [],
    cwd: absoluteCwd(payload),
  };
  const output = await handler(payload, deps);
  return { stdout: output === null ? "" : render(name, output), stderr: "" };
}

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
export async function runHookCore(
  name: string,
  input: HookRunInput,
  handler: HookHandler,
  options: HookRunOptions = {},
): Promise<HookRunResult> {
  try {
    return await runSteps(name, input, handler, options.catalog ?? true);
  } catch (error) {
    return { stdout: "", stderr: hookNote(name, describeError(error)) };
  }
}
