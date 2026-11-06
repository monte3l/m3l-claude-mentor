import { type CatalogEntry } from "../internal/schema.js";
/**
 * What {@link runCommand} needs from its caller.
 *
 * @example
 * ```ts
 * import type { CliContext } from "./commands.js";
 * const ctx: CliContext = {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   session: "sess_1",
 *   bundled: [],
 * };
 * ```
 */
export interface CliContext {
    /** The data directory; validated by the store functions. */
    readonly dir: string;
    /** The current time in epoch milliseconds; finite and non-negative. */
    readonly now: number;
    /** The Claude Code session id; must pass `parseSessionId`. */
    readonly session: string;
    /**
     * The bundled topic catalog (`data/topic-catalog.json`, already parsed).
     * Absent means an EMPTY catalog, so every topic command then fails as an
     * unknown topic: callers must pass it.
     */
    readonly bundled?: readonly CatalogEntry[];
}
/**
 * The outcome of one command: an exit code and the full stdout and stderr
 * text. On success `stdout` is one JSON document plus `"\n"` and `stderr`
 * is empty; on failure `stdout` is empty and `stderr` is one line.
 *
 * @example
 * ```ts
 * import type { CliResult } from "./commands.js";
 * const ok: CliResult = { exitCode: 0, stdout: "{\"muted\":true}\n", stderr: "" };
 * ```
 */
export interface CliResult {
    /** 0 success, 1 a data or argument failure, 2 a usage error. */
    readonly exitCode: 0 | 1 | 2;
    readonly stdout: string;
    readonly stderr: string;
}
/**
 * Runs one `mentor-state` command. Never reads `process`, never writes to
 * the console and never exits: the caller prints `stdout`/`stderr` and
 * exits with `exitCode`.
 *
 * A usage error (unknown command; a missing, extra, repeated or invalid
 * argument; a topic not in the merged catalog) yields exit 2 and the fixed
 * usage line of the command. A `MentorStateError` yields exit 1 and
 * `<code>: <message>`; a `RangeError` or `TypeError` from a deeper layer
 * yields exit 1 and `invalid-argument: <message>`. That mapping is by error
 * class alone, so a `RangeError`/`TypeError` from a bug deeper down is
 * reported the same way. No argument value is
 * written to `stderr` by this module; a deeper layer's message is forwarded
 * as is (those messages are fixed text). Any other error is rethrown.
 *
 * Known limitation: commands that update state or the profile do a
 * read-modify-write with no lock, so two concurrent invocations race and the
 * last writer wins.
 *
 * @param argv - The command name followed by its arguments.
 * @param ctx - The data directory, clock, session and bundled catalog.
 * @throws RangeError when `ctx.now` is not finite and non-negative, or
 * `ctx.session` is not a valid session id (checked before anything else).
 *
 * @example
 * ```ts
 * import { runCommand } from "./commands.js";
 * const result = await runCommand(["set-mute", "on"], {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   session: "sess_1",
 *   bundled: [],
 * });
 * // result: { exitCode: 0, stdout: "{\"muted\":true}\n", stderr: "" }
 * ```
 */
export declare function runCommand(argv: readonly string[], ctx: CliContext): Promise<CliResult>;
//# sourceMappingURL=commands.d.ts.map