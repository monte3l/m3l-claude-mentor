/**
 * The options `mentor-state` accepts before the command name.
 */
const DATA_DIR_FLAG = "--data-dir";
const FLAG_PREFIX = "--";
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
export const GLOBAL_USAGE = "mentor-state [--data-dir <absolute path>] <command> [arguments]";
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
export function parseGlobalOptions(argv) {
    if (argv[0] !== DATA_DIR_FLAG)
        return { ok: true, dataDir: null, argv };
    const value = argv[1];
    if (value === undefined ||
        value.startsWith(FLAG_PREFIX) ||
        argv[2] === DATA_DIR_FLAG) {
        return { ok: false };
    }
    return { ok: true, dataDir: value, argv: argv.slice(2) };
}
//# sourceMappingURL=global-options.js.map