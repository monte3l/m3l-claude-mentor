/**
 * Show and delete for the mentor's data directory (design 13.2): what is
 * stored, without its content, and a purge that removes exactly the managed
 * files. Re-exported from `./export.ts`.
 */
import { type DataFile } from "./paths.js";
/**
 * One managed file as reported by {@link describeData}.
 *
 * @example
 * ```ts
 * import { describeData, type DataFileInfo } from "./export.js";
 * const [first]: readonly DataFileInfo[] = (await describeData(dir, Date.now())).files;
 * ```
 */
export interface DataFileInfo {
    readonly file: DataFile;
    readonly path: string;
    /** Size in bytes, or `null` when the file does not exist. */
    readonly bytes: number | null;
}
/**
 * What the mentor stores, without its content.
 *
 * @example
 * ```ts
 * import { describeData, type DataSummary } from "./export.js";
 * const summary: DataSummary = await describeData("/var/data/m3l", Date.now());
 * ```
 */
export interface DataSummary {
    readonly dir: string;
    /** All five managed files, in {@link DATA_FILES} order. */
    readonly files: readonly DataFileInfo[];
    /** Valid evidence events in the tail window. */
    readonly evidenceEvents: number;
    /** Evidence lines that were malformed or invalid. */
    readonly evidenceSkipped: number;
    /** Topics recorded in `profile.json`. */
    readonly topics: number;
    readonly mutedTopics: number;
    readonly excludedProjects: readonly string[];
}
/**
 * Shows what is stored without dumping content: each managed file's path
 * and size, evidence counts, topic counts and the project exclusion list.
 * Sizes come from `lstat`, so a managed file that is a symbolic link (live or
 * dangling) or a directory is `READ_FAILED`. A missing file is reported with
 * `bytes: null`, not an error. Every section is loaded, so a corrupt or
 * unreadable `state.json`, `profile.json`, `catalog.json`, `goals.md` or
 * evidence log is not hidden: its typed error propagates. Never creates the
 * data directory.
 *
 * @param dir - The data directory.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @returns The summary.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails `assertValidDataDir`; `READ_FAILED` when a managed path is not a
 * regular file or cannot be inspected; the loader errors (`READ_FAILED`,
 * `TOO_LARGE`, `PARSE_FAILED`, `VALIDATION_FAILED`).
 * @throws RangeError when `now` is invalid (checked before any I/O).
 *
 * @example
 * ```ts
 * import { describeData } from "./export.js";
 * const { files, evidenceEvents } = await describeData("/var/data/m3l", Date.now());
 * ```
 */
export declare function describeData(dir: string, now: number): Promise<DataSummary>;
/**
 * The outcome of {@link purgeData}.
 *
 * @example
 * ```ts
 * import { purgeData, type PurgeResult } from "./export.js";
 * const result: PurgeResult = await purgeData("/var/data/m3l", { confirm: true });
 * ```
 */
export interface PurgeResult {
    readonly deleted: readonly DataFile[];
    readonly alreadyMissing: readonly DataFile[];
}
/**
 * Deletes everything the mentor stores (design 13.2): the five managed files
 * by exact name, plus leftover temp files named `.<managed-name>.<anything>.tmp`
 * in `dir`. Each is removed with `unlink`, which never recurses and removes a
 * symlink itself, not its target. Nothing else is touched: not the
 * directory, not a subdirectory, not any other file. Every entry is
 * attempted before a failure is reported, so one bad file does not leave
 * the rest behind. An empty or missing directory is fine.
 *
 * @param dir - The data directory.
 * @param options - `confirm` must be exactly `true` (an own property).
 * @returns Which managed files were deleted and which were already missing.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails `assertValidDataDir`, and `CONFIRMATION_REQUIRED` unless `confirm` is
 * exactly `true` (neither deletes anything); one collected `WRITE_FAILED`
 * naming, as JSON-quoted base names, the entries that could not be deleted
 * (or "leftover temp files" when `dir` cannot be listed), thrown after every
 * other entry was attempted, with the fs errors as an `AggregateError`
 * `cause`.
 *
 * @example
 * ```ts
 * import { purgeData } from "./export.js";
 * const { deleted } = await purgeData("/var/data/m3l", { confirm: true });
 * ```
 */
export declare function purgeData(dir: string, options: {
    readonly confirm: true;
}): Promise<PurgeResult>;
//# sourceMappingURL=purge.d.ts.map