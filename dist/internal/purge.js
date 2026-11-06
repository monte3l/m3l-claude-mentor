/**
 * Show and delete for the mentor's data directory (design 13.2): what is
 * stored, without its content, and a purge that removes exactly the managed
 * files. Re-exported from `./export.ts`.
 */
import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { MentorStateError } from "./errors.js";
import { checkNow, isConfirmed } from "./export-bundle.js";
import { DATA_FILES, assertValidDataDir, dataFilePath, } from "./paths.js";
import { loadCatalogFile, loadGoals, loadProfile, loadState, readEvidence, } from "./store.js";
/** Every managed file, in {@link DATA_FILES} order. */
const MANAGED_FILES = Object.keys(DATA_FILES);
function errorCode(error) {
    return typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
}
/** The size of a managed file (`lstat`); `null` when missing. */
async function sizeOf(dir, file) {
    let info;
    try {
        info = await lstat(dataFilePath(dir, file));
    }
    catch (cause) {
        if (errorCode(cause) === "ENOENT")
            return null;
        throw new MentorStateError("READ_FAILED", `could not read ${DATA_FILES[file]}`, { cause });
    }
    if (!info.isFile()) {
        throw new MentorStateError("READ_FAILED", `${DATA_FILES[file]} is not a regular file`);
    }
    return info.size;
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
export async function describeData(dir, now) {
    assertValidDataDir(dir);
    checkNow(now);
    const files = [];
    for (const file of MANAGED_FILES) {
        files.push({
            file,
            path: dataFilePath(dir, file),
            bytes: await sizeOf(dir, file),
        });
    }
    const state = await loadState(dir, now);
    const profile = await loadProfile(dir, now);
    await loadCatalogFile(dir);
    const goals = await loadGoals(dir);
    if (goals.includes("\0")) {
        throw new MentorStateError("VALIDATION_FAILED", `${DATA_FILES.goals} is invalid: it contains a NUL character`);
    }
    const evidence = await readEvidence(dir);
    return {
        dir,
        files,
        evidenceEvents: evidence.events.length,
        evidenceSkipped: evidence.skipped,
        topics: Object.keys(profile.topics).length,
        mutedTopics: state.mutedTopics.length,
        excludedProjects: [...state.excludedProjects],
    };
}
/** Unlinks one directory entry; `unlink` never recurses or follows a symlink. */
async function unlinkEntry(target) {
    try {
        await unlink(target);
    }
    catch (cause) {
        if (errorCode(cause) === "ENOENT")
            return { kind: "missing" };
        return { kind: "failed", cause };
    }
    return { kind: "deleted" };
}
/** Whether `name` is `.<managed-name>.<something>.tmp`, a stale temp file. */
function isManagedTemp(name) {
    const suffix = ".tmp";
    return Object.values(DATA_FILES).some((managed) => {
        const prefix = `.${managed}.`;
        return (name.startsWith(prefix) &&
            name.endsWith(suffix) &&
            name.length > prefix.length + suffix.length);
    });
}
/** The entry names in `dir`; empty when the directory is missing. */
async function listEntries(dir) {
    try {
        return await readdir(dir);
    }
    catch (cause) {
        if (errorCode(cause) === "ENOENT")
            return [];
        throw cause;
    }
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
export async function purgeData(dir, options) {
    assertValidDataDir(dir);
    if (!isConfirmed(options, "confirm")) {
        throw new MentorStateError("CONFIRMATION_REQUIRED", "purge deletes all stored mentor data; pass { confirm: true } to confirm");
    }
    const deleted = [];
    const alreadyMissing = [];
    const failed = [];
    const causes = [];
    const recordFailure = (label, cause) => {
        failed.push(label);
        causes.push(cause);
    };
    for (const file of MANAGED_FILES) {
        const outcome = await unlinkEntry(dataFilePath(dir, file));
        switch (outcome.kind) {
            case "deleted":
                deleted.push(file);
                break;
            case "missing":
                alreadyMissing.push(file);
                break;
            case "failed":
                recordFailure(JSON.stringify(DATA_FILES[file]), outcome.cause);
                break;
        }
    }
    let names = [];
    try {
        names = await listEntries(dir);
    }
    catch (cause) {
        recordFailure("leftover temp files", cause);
    }
    for (const name of names.filter(isManagedTemp)) {
        const outcome = await unlinkEntry(path.join(dir, name));
        if (outcome.kind === "failed") {
            recordFailure(JSON.stringify(name), outcome.cause);
        }
    }
    if (failed.length > 0) {
        throw new MentorStateError("WRITE_FAILED", `could not delete: ${failed.join(", ")}`, { cause: new AggregateError(causes, "purge failures") });
    }
    return { deleted, alreadyMissing };
}
//# sourceMappingURL=purge.js.map