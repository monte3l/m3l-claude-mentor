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
export declare function isMainModule(meta: {
    readonly url: string;
    readonly main?: boolean | undefined;
}, argv1: string | undefined): boolean;
//# sourceMappingURL=main-guard.d.ts.map