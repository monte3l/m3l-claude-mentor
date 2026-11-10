/**
 * The options `mentor-state` accepts before the command name.
 */
/**
 * The general usage line of `mentor-state`, without the command list. Both
 * the entry (for a bad global option) and `runCommand` (for an unknown
 * command) print it, so it is defined once here.
 *
 * @example
 * ```ts
 * import { GLOBAL_USAGE } from "./global-options.js";
 * process.stderr.write(`usage: ${GLOBAL_USAGE}\n`);
 * ```
 */
export declare const GLOBAL_USAGE = "mentor-state [--data-dir <absolute path>] <command> [arguments]";
/**
 * The outcome of {@link parseGlobalOptions}: the data directory given on
 * the command line (`null` when absent) and the remaining arguments, or a
 * usage error that carries no text.
 *
 * @example
 * ```ts
 * import { parseGlobalOptions, type GlobalOptions } from "./global-options.js";
 * const parsed: GlobalOptions = parseGlobalOptions(["show"]);
 * ```
 */
export type GlobalOptions = {
    readonly ok: true;
    readonly dataDir: string | null;
    readonly argv: readonly string[];
} | {
    readonly ok: false;
};
/**
 * Consumes a leading `--data-dir <value>` pair (the first two arguments
 * only) and returns the rest untouched; `--data-dir` anywhere else is left
 * for the command parser. The value is returned as given: the caller
 * validates it as a data directory. Pure; the input is not mutated.
 *
 * @param argv - The process arguments after the script path.
 * @returns `{ ok: false }` when the value is missing or starts with `--`, or
 * when `--data-dir` is repeated right after the pair.
 *
 * @example
 * ```ts
 * import { parseGlobalOptions } from "./global-options.js";
 * parseGlobalOptions(["--data-dir", "/var/data/m3l", "show"]);
 * // { ok: true, dataDir: "/var/data/m3l", argv: ["show"] }
 * ```
 */
export declare function parseGlobalOptions(argv: readonly string[]): GlobalOptions;
//# sourceMappingURL=global-options.d.ts.map