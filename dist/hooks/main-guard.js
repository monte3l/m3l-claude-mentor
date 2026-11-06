/**
 * Decides whether a module is the process entry point, so an entry file can
 * run only when executed and never when imported.
 */
import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * The real path of an existing regular file, or `null` when the path is not
 * one or cannot be resolved. Never throws.
 */
function realFile(file) {
    try {
        const real = realpathSync(file);
        return statSync(real).isFile() ? real : null;
    }
    catch {
        // Missing, unreadable or not a path: treated as "not this module".
        return null;
    }
}
/**
 * Whether the module described by `meta` is the process entry point. A
 * boolean `meta.main` (Node's `import.meta.main`) is authoritative. Otherwise
 * it compares the real paths of `argv1` (`process.argv[1]`) and the module's
 * `file:` URL, so a symlinked launch path still matches. Any failure (no
 * `argv1`, a non-`file:` URL, a missing file, a directory) yields `false`;
 * it never throws.
 *
 * @param meta - The module's `import.meta` (only `url` and `main` are read).
 * @param argv1 - The script path the process was started with.
 * @returns `true` only when the module is the entry point.
 *
 * @example
 * ```ts
 * import { isMainModule } from "./main-guard.js";
 * if (isMainModule(import.meta, process.argv[1])) {
 *   // run the entry
 * }
 * ```
 */
export function isMainModule(meta, argv1) {
    try {
        const main = meta.main;
        if (typeof main === "boolean")
            return main;
        if (typeof argv1 !== "string" || argv1 === "")
            return false;
        const self = realFile(fileURLToPath(meta.url));
        return self !== null && self === realFile(argv1);
    }
    catch {
        // A non-file: URL makes fileURLToPath throw: not this process's entry.
        return false;
    }
}
//# sourceMappingURL=main-guard.js.map