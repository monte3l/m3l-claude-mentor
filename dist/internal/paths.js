/**
 * Locating the mentor's data directory and the files inside it. Pure path
 * arithmetic: nothing here touches the filesystem.
 */
import path from "node:path";
import { MentorStateError } from "./errors.js";
/**
 * The environment variable that names the plugin's data directory.
 *
 * @example
 * ```ts
 * import { DATA_DIR_ENV } from "./paths.js";
 * process.env[DATA_DIR_ENV]; // the directory Claude Code assigned, if any
 * ```
 */
export const DATA_DIR_ENV = "CLAUDE_PLUGIN_DATA";
/**
 * The base name of each file the mentor keeps in its data directory. Frozen.
 *
 * @example
 * ```ts
 * import { DATA_FILES } from "./paths.js";
 * DATA_FILES.state; // "state.json"
 * ```
 */
export const DATA_FILES = Object.freeze({
    profile: "profile.json",
    state: "state.json",
    catalog: "catalog.json",
    goals: "goals.md",
    evidence: "evidence.jsonl",
});
/** Why `value` is not a usable data directory, or `null` when it is. */
function dataDirProblem(value) {
    if (typeof value !== "string" || value.trim().length === 0)
        return "unset";
    if (value.includes("\0") || !path.isAbsolute(value))
        return "not-absolute";
    const resolved = path.resolve(value);
    return path.parse(resolved).root === resolved ? "root" : null;
}
/**
 * Resolves the data directory from `env[DATA_DIR_ENV]`, read once as an own
 * property. The value is not trimmed: whitespace-only counts as unset, and
 * any other value must be an absolute path exactly as given. There is no
 * fallback directory. Error messages never contain the value.
 *
 * @param env - The environment to read, such as `process.env`.
 * @returns The normalized absolute path, without a trailing separator.
 * @throws MentorStateError `DATA_DIR_UNSET` when the variable is absent,
 * empty or whitespace-only; `DATA_DIR_INVALID` when it is not an absolute
 * path, contains a NUL character, or resolves to a filesystem root (such as
 * `/`, `//` or `/..`).
 *
 * @example
 * ```ts
 * import { resolveDataDir } from "./paths.js";
 * resolveDataDir({ CLAUDE_PLUGIN_DATA: "/var/data/m3l/" }); // "/var/data/m3l"
 * ```
 */
export function resolveDataDir(env) {
    const value = Object.hasOwn(env, DATA_DIR_ENV)
        ? env[DATA_DIR_ENV]
        : undefined;
    const problem = dataDirProblem(value);
    switch (problem) {
        case "unset":
            throw new MentorStateError("DATA_DIR_UNSET", `${DATA_DIR_ENV} is not set; the mentor has no data directory`);
        case "not-absolute":
            throw new MentorStateError("DATA_DIR_INVALID", `${DATA_DIR_ENV} must be an absolute path without NUL characters`);
        case "root":
            throw new MentorStateError("DATA_DIR_INVALID", `${DATA_DIR_ENV} must not be a filesystem root`);
        case null:
            return path.resolve(value);
    }
}
/**
 * Checks that `dir` is usable as the data directory. The check is LEXICAL:
 * by its text alone it rejects a non-string, an empty or whitespace-only
 * string, a relative path, a path containing NUL, and a path that resolves
 * to a filesystem root (such as `/`, `/./` or `/..`). These are the rules
 * {@link resolveDataDir} applies to the environment variable. Symbolic links
 * are not resolved, so a data directory that is a symlink to a broader
 * location passes; callers only ever touch the managed file names inside it.
 * Every public function taking a `dir` calls this first, before any other
 * validation or I/O.
 *
 * @param dir - The candidate data directory.
 * @throws MentorStateError `DATA_DIR_INVALID` with a fixed message that does
 * not contain `dir`.
 *
 * @example
 * ```ts
 * import { assertValidDataDir } from "./paths.js";
 * assertValidDataDir("/var/data/m3l"); // returns; "relative" or "/" would throw
 * ```
 */
export function assertValidDataDir(dir) {
    if (dataDirProblem(dir) !== null) {
        throw new MentorStateError("DATA_DIR_INVALID", "the data directory must be a non-root absolute path without NUL characters");
    }
}
/**
 * The path of one data file inside `dir` (`path.join`, so a trailing
 * separator on `dir` is tolerated).
 *
 * @param dir - The data directory, normally from {@link resolveDataDir}.
 * @param file - Which data file; checked at runtime to be an own key of
 * {@link DATA_FILES}.
 * @throws MentorStateError `VALIDATION_FAILED` when `file` is not an own key
 * of {@link DATA_FILES}; the message does not contain `file`.
 *
 * @example
 * ```ts
 * import { dataFilePath } from "./paths.js";
 * dataFilePath("/var/data/m3l", "state"); // "/var/data/m3l/state.json"
 * ```
 */
export function dataFilePath(dir, file) {
    if (!Object.hasOwn(DATA_FILES, file)) {
        throw new MentorStateError("VALIDATION_FAILED", "unknown data file; expected a key of DATA_FILES");
    }
    return path.join(dir, DATA_FILES[file]);
}
//# sourceMappingURL=paths.js.map