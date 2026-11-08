/**
 * Export, import, show and purge for the mentor's data directory (design
 * sections 10 and 13): moving a profile between machines, and showing or
 * deleting everything the mentor stores. Import and purge replace or delete
 * user data, so both demand an explicit `true` confirmation, and import
 * validates the whole bundle before it changes a single file.
 */
import { type Bundle } from "./export-bundle.js";
export { BUNDLE_FORMAT, BUNDLE_VERSION, parseBundle, serializeBundle, type Bundle, } from "./export-bundle.js";
export { describeData, purgeData } from "./purge.js";
/**
 * The result of {@link exportBundle}.
 *
 * @example
 * ```ts
 * import { exportBundle, type ExportResult } from "./export.js";
 * const { bundle, evidenceSkipped }: ExportResult = await exportBundle(dir, Date.now());
 * ```
 */
export interface ExportResult {
    readonly bundle: Bundle;
    /** Evidence lines in the tail window that were malformed or invalid. */
    readonly evidenceSkipped: number;
}
/**
 * Loads every section of the data directory into a bundle with
 * `exportedAt = now`. A section whose file is missing exports its default;
 * a corrupt or unreadable section is not skipped, its typed error propagates
 * (an export that silently omitted data would look complete). Evidence is
 * only the tail window `readEvidence` returns: the last (at most
 * `MAX_EVIDENCE_EVENTS` from `./schema.ts`) valid events within the last 2 MiB of
 * `evidence.jsonl`, oldest first; older events are not exported, and
 * malformed lines in the window are counted in `evidenceSkipped`. The bundle
 * is re-validated with {@link parseBundle} and its serialized size checked
 * against {@link MAX_BUNDLE_BYTES}, so what is exported can be imported.
 * Never creates the data directory.
 *
 * @param dir - The data directory.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @returns A fresh bundle and the skipped-evidence count.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails {@link assertValidDataDir}; the loader errors (`READ_FAILED`,
 * `TOO_LARGE`, `PARSE_FAILED`, `VALIDATION_FAILED`); `VALIDATION_FAILED` when
 * the loaded data would not import (for example `goals.md` containing a NUL
 * character); `TOO_LARGE` when the serialized bundle exceeds
 * {@link MAX_BUNDLE_BYTES}.
 * @throws RangeError when `now` is invalid (checked before any I/O).
 *
 * @example
 * ```ts
 * import { exportBundle } from "./export.js";
 * const { bundle, evidenceSkipped } = await exportBundle("/var/data/m3l", Date.now());
 * ```
 */
export declare function exportBundle(dir: string, now: number): Promise<ExportResult>;
/**
 * Exports the data directory (see {@link exportBundle}, including its
 * evidence tail-window limit and size check) and writes the serialized
 * bundle to `targetPath` atomically: a temp file in the target's directory
 * is written, fsynced and renamed over the target, so a reader sees either
 * the old file or the complete bundle. An existing file at `targetPath` is
 * replaced WITHOUT confirmation. The target's directory must already exist.
 * A target equal to one of the managed data files is refused; the
 * comparison is case-insensitive after `path.resolve`, so on a
 * case-sensitive filesystem a distinct file differing only in letter case
 * (such as `STATE.JSON`) is refused too, and an alias reached through a
 * symlinked directory is not detected. Nothing is written when the export
 * fails validation or the size check.
 *
 * @param dir - The data directory.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @param targetPath - Absolute path of the bundle file to write.
 * @returns The skipped-evidence count of the export.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails {@link assertValidDataDir}; `VALIDATION_FAILED` for a relative
 * target or one that is a managed data file (nothing is read or written);
 * the {@link exportBundle} errors; `WRITE_FAILED` with the fs error as
 * `cause`.
 * @throws RangeError when `now` is invalid (checked before any I/O).
 *
 * @example
 * ```ts
 * import { exportBundleToFile } from "./export.js";
 * await exportBundleToFile("/var/data/m3l", Date.now(), "/home/me/mentor-export.json");
 * ```
 */
export declare function exportBundleToFile(dir: string, now: number, targetPath: string): Promise<{
    readonly evidenceSkipped: number;
}>;
/**
 * What an import replaced.
 *
 * @example
 * ```ts
 * import { importBundle, type ImportSummary } from "./export.js";
 * const summary: ImportSummary = await importBundle(dir, bundle, { replace: true });
 * ```
 */
export interface ImportSummary {
    readonly state: boolean;
    readonly profile: boolean;
    readonly catalog: boolean;
    readonly goals: boolean;
    /** How many evidence events the new log holds. */
    readonly evidenceEvents: number;
}
/**
 * Replaces all stored data with `bundle`. `options.replace` must be exactly
 * `true` (there is no merge mode). The bundle is re-validated with
 * {@link parseBundle} and every file's new content is built before any
 * managed file changes, so an invalid bundle leaves the directory as it
 * was. Files are then written atomically one by one: evidence (the log is
 * rebuilt in a temp file and renamed, never appended to), goals, catalog,
 * profile, and `state` last. There is no rollback: if a write fails midway
 * the directory holds a mix, and the error says which sections were already
 * replaced.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param bundle - The bundle to import.
 * @param options - `replace: true` confirms the replacement.
 * @returns What was replaced.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails {@link assertValidDataDir}; `CONFIRMATION_REQUIRED` unless `replace`
 * is exactly `true`; `IMPORT_INVALID` for an invalid bundle;
 * `VALIDATION_FAILED` when a section does not serialize to JSON (none of
 * these writes anything); `WRITE_FAILED` naming the file that failed and the
 * sections already replaced (`none` when the first write fails), with the fs
 * error as `cause`.
 *
 * @example
 * ```ts
 * import { exportBundle, importBundle } from "./export.js";
 * const bundle = await exportBundle("/old/data", Date.now());
 * await importBundle("/new/data", bundle, { replace: true });
 * ```
 */
export declare function importBundle(dir: string, bundle: Bundle, options: {
    readonly replace: boolean;
}): Promise<ImportSummary>;
/**
 * Reads a bundle file and imports it with the same rules as
 * {@link importBundle}. The file is read with a bound of
 * {@link MAX_BUNDLE_BYTES}; a leading UTF-8 byte order mark is ignored; it
 * is parsed and fully validated before any managed file changes.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param sourcePath - Absolute path of the bundle file.
 * @param options - `replace: true` confirms the replacement.
 * @returns What was replaced.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails {@link assertValidDataDir}; `CONFIRMATION_REQUIRED`;
 * `VALIDATION_FAILED` for a relative path; `READ_FAILED` (a missing file included) with the fs error
 * as `cause`; `TOO_LARGE`; `IMPORT_INVALID` for malformed JSON (a fixed
 * message, no `cause`) or an invalid bundle; `WRITE_FAILED` as in
 * {@link importBundle} (including its `VALIDATION_FAILED`). Only
 * `WRITE_FAILED` can follow a change to the
 * directory.
 *
 * @example
 * ```ts
 * import { importBundleFromFile } from "./export.js";
 * await importBundleFromFile("/var/data/m3l", "/home/me/mentor-export.json", { replace: true });
 * ```
 */
export declare function importBundleFromFile(dir: string, sourcePath: string, options: {
    readonly replace: boolean;
}): Promise<ImportSummary>;
//# sourceMappingURL=export.d.ts.map