import path from "node:path";
import { parseTopicId } from "../internal/schema.js";
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
export class CliUsageError extends Error {
    constructor() {
        super("usage error");
        this.name = "CliUsageError";
    }
}
const FLAG_PREFIX = "--";
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
export function parseArgs(argv, spec) {
    const values = new Map();
    const booleans = new Set();
    const positionals = [];
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        if (!token.startsWith(FLAG_PREFIX)) {
            positionals.push(token);
            continue;
        }
        const name = token.slice(FLAG_PREFIX.length);
        if (values.has(name) || booleans.has(name))
            throw new CliUsageError();
        if (spec.booleanFlags.includes(name)) {
            booleans.add(name);
        }
        else if (spec.valueFlags.includes(name)) {
            const value = argv[i + 1];
            if (value === undefined)
                throw new CliUsageError();
            values.set(name, value);
            i += 1;
        }
        else {
            throw new CliUsageError();
        }
    }
    return { positional: checkPositional(positionals, spec), values, booleans };
}
function checkPositional(positionals, spec) {
    if (spec.positional === undefined) {
        if (positionals.length > 0)
            throw new CliUsageError();
        return undefined;
    }
    const [only] = positionals;
    if (positionals.length !== 1 ||
        only === undefined ||
        !spec.positional.includes(only)) {
        throw new CliUsageError();
    }
    return only;
}
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
export function requireValue(args, name) {
    const value = args.values.get(name);
    if (value === undefined)
        throw new CliUsageError();
    return value;
}
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
export function requireOneOf(args, name, allowed) {
    const value = requireValue(args, name);
    const match = allowed.find((candidate) => candidate === value);
    if (match === undefined)
        throw new CliUsageError();
    return match;
}
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
export function requireTopicId(args) {
    const parsed = parseTopicId(requireValue(args, "topic"));
    if (!parsed.ok)
        throw new CliUsageError();
    return parsed.value;
}
const MAX_PATH_LENGTH = 1024;
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
export function requireAbsolutePath(args, name) {
    const value = requireValue(args, name);
    if (value.length > MAX_PATH_LENGTH ||
        value.includes("\0") ||
        !path.isAbsolute(value)) {
        throw new CliUsageError();
    }
    return value;
}
//# sourceMappingURL=args.js.map