import { type TopicId } from "../internal/schema.js";
/**
 * A command-line usage error. It carries no text: `runCommand` prints the
 * fixed usage line of the command, so an argument value is never echoed.
 *
 * @example
 * ```ts
 * import { CliUsageError } from "./args.js";
 * throw new CliUsageError();
 * ```
 */
export declare class CliUsageError extends Error {
    constructor();
}
/**
 * What one command accepts.
 *
 * @example
 * ```ts
 * import type { CommandSpec } from "./args.js";
 * const spec: CommandSpec = {
 *   usage: "introduce --topic <id>",
 *   positional: undefined,
 *   valueFlags: ["topic"],
 *   booleanFlags: [],
 * };
 * ```
 */
export interface CommandSpec {
    /** The fixed usage text printed after `usage: `. */
    readonly usage: string;
    /** The allowed values of the single required positional, if any. */
    readonly positional: readonly string[] | undefined;
    /** Flags followed by a value, without the leading `--`. */
    readonly valueFlags: readonly string[];
    /** Flags without a value, without the leading `--`. */
    readonly booleanFlags: readonly string[];
}
/**
 * The parsed arguments of one command.
 *
 * @example
 * ```ts
 * import { parseArgs, type ParsedArgs } from "./args.js";
 * const args: ParsedArgs = parseArgs(["--topic", "plan-mode"], spec);
 * ```
 */
export interface ParsedArgs {
    /** The positional, already checked against the spec's allowed values. */
    readonly positional: string | undefined;
    readonly values: ReadonlyMap<string, string>;
    readonly booleans: ReadonlySet<string>;
}
/**
 * Parses the arguments after the command name against `spec`. Flags may
 * come in any order; a value flag takes the next token verbatim (so a goals
 * text may start with `--`).
 *
 * @throws CliUsageError for an unknown or repeated flag, a value flag
 * without a value, a missing, extra or disallowed positional.
 *
 * @example
 * ```ts
 * import { parseArgs } from "./args.js";
 * parseArgs(["on", "--topic", "plan-mode"], spec).positional; // "on"
 * ```
 */
export declare function parseArgs(argv: readonly string[], spec: CommandSpec): ParsedArgs;
/**
 * The value of a required value flag.
 *
 * @throws CliUsageError when the flag is absent.
 *
 * @example
 * ```ts
 * import { requireValue } from "./args.js";
 * const text = requireValue(args, "text");
 * ```
 */
export declare function requireValue(args: ParsedArgs, name: string): string;
/**
 * The value of a required flag that must be one of `allowed`.
 *
 * @throws CliUsageError when the flag is absent or not allowed.
 *
 * @example
 * ```ts
 * import { requireOneOf } from "./args.js";
 * const result = requireOneOf(args, "result", ["pass", "fail"] as const);
 * ```
 */
export declare function requireOneOf<T extends string>(args: ParsedArgs, name: string, allowed: readonly T[]): T;
/**
 * The `--topic` value as a well-formed topic id (catalog membership is
 * checked separately).
 *
 * @throws CliUsageError when absent or malformed.
 *
 * @example
 * ```ts
 * import { requireTopicId } from "./args.js";
 * const topic = requireTopicId(args);
 * ```
 */
export declare function requireTopicId(args: ParsedArgs): TopicId;
/**
 * The value of a required flag holding an absolute path of 1 to 1024
 * characters without NUL.
 *
 * @throws CliUsageError when absent, relative, too long or holding NUL.
 *
 * @example
 * ```ts
 * import { requireAbsolutePath } from "./args.js";
 * const to = requireAbsolutePath(args, "to");
 * ```
 */
export declare function requireAbsolutePath(args: ParsedArgs, name: string): string;
//# sourceMappingURL=args.d.ts.map