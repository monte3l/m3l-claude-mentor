/**
 * Show and delete for the mentor's data directory (design 13.2): what is
 * stored, without its content, and a purge that removes exactly the managed
 * files. Re-exported from `./export.ts`.
 */

import { lstat, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { MentorStateError } from "./errors.ts";
import { checkNow, isConfirmed } from "./export-bundle.ts";
import { LOCK_FILE_NAME, withStateLock, type LockedOptions } from "./lock.ts";
import {
  DATA_FILES,
  assertValidDataDir,
  dataFilePath,
  type DataFile,
} from "./paths.ts";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  readEvidence,
} from "./store.ts";

/** Every managed file, in {@link DATA_FILES} order. */
const MANAGED_FILES = Object.keys(DATA_FILES) as readonly DataFile[];

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

/**
 * One managed file as reported by {@link describeData}.
 *
 * @example
 * ```ts
 * import { describeData, type DataFileInfo } from "./export.ts";
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
 * import { describeData, type DataSummary } from "./export.ts";
 * const summary: DataSummary = await describeData("/var/data/m3l", Date.now());
 * ```
 */
export interface DataSummary {
  readonly dir: string;
  /** Every managed file, in {@link DATA_FILES} order. */
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

/** The size of a managed file (`lstat`); `null` when missing. */
async function sizeOf(dir: string, file: DataFile): Promise<number | null> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(dataFilePath(dir, file));
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return null;
    throw new MentorStateError(
      "READ_FAILED",
      `could not read ${DATA_FILES[file]}`,
      { cause },
    );
  }
  if (!info.isFile()) {
    throw new MentorStateError(
      "READ_FAILED",
      `${DATA_FILES[file]} is not a regular file`,
    );
  }
  return info.size;
}

/**
 * Shows what is stored without dumping content: each managed file's path
 * and size, evidence counts, topic counts and the project exclusion list.
 * Sizes come from `lstat`, so a managed file that is a symbolic link (live or
 * dangling) or a directory is `READ_FAILED`. A missing file is reported with
 * `bytes: null`, not an error. The state, profile, catalog, goals and
 * evidence sections are loaded, so a corrupt or unreadable `state.json`,
 * `profile.json`, `catalog.json`, `goals.md` or evidence log is not hidden:
 * its typed error propagates. The exam files (`exam-items.jsonl` and
 * `exam-pending.json`) are listed with their sizes only; they are not loaded
 * or validated, so a corrupt exam file does not fail this call. Never
 * creates the data directory.
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
 * import { describeData } from "./export.ts";
 * const { files, evidenceEvents } = await describeData("/var/data/m3l", Date.now());
 * ```
 */
export async function describeData(
  dir: string,
  now: number,
): Promise<DataSummary> {
  assertValidDataDir(dir);
  checkNow(now);
  const files: DataFileInfo[] = [];
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
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `${DATA_FILES.goals} is invalid: it contains a NUL character`,
    );
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

/**
 * The outcome of {@link purgeData}.
 *
 * @example
 * ```ts
 * import { purgeData, type PurgeResult } from "./export.ts";
 * const result: PurgeResult = await purgeData("/var/data/m3l", { confirm: true });
 * ```
 */
export interface PurgeResult {
  readonly deleted: readonly DataFile[];
  readonly alreadyMissing: readonly DataFile[];
}

type UnlinkOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly cause: unknown };

/** Unlinks one directory entry; `unlink` never recurses or follows a symlink. */
async function unlinkEntry(target: string): Promise<UnlinkOutcome> {
  try {
    await unlink(target);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return { kind: "missing" };
    return { kind: "failed", cause };
  }
  return { kind: "deleted" };
}

/** The prefix of a stale lock moved aside by `withStateLock` (`./lock.ts`). */
const STALE_LOCK_PREFIX = `${LOCK_FILE_NAME}.stale.`;

/**
 * Whether `name` is a leftover to sweep: `.<managed-name>.<something>.tmp` (a
 * stale temp file) or `.state.lock.stale.<something>` (a broken lock that was
 * not removed). The live `.state.lock` itself never matches.
 */
function isLeftover(name: string): boolean {
  if (name.startsWith(STALE_LOCK_PREFIX)) {
    return name.length > STALE_LOCK_PREFIX.length;
  }
  const suffix = ".tmp";
  return Object.values(DATA_FILES).some((managed) => {
    const prefix = `.${managed}.`;
    return (
      name.startsWith(prefix) &&
      name.endsWith(suffix) &&
      name.length > prefix.length + suffix.length
    );
  });
}

/** The entry names in `dir`; empty when the directory is missing. */
async function listEntries(dir: string): Promise<readonly string[]> {
  try {
    return await readdir(dir);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    throw cause;
  }
}

/**
 * Deletes everything the mentor stores (design 13.2): every managed file in
 * {@link DATA_FILES} (the exam item log and the pending exam included) by
 * exact name, plus leftover temp files named `.<managed-name>.<anything>.tmp`
 * and broken locks named `.state.lock.stale.<anything>` in `dir`. When `dir`
 * exists the deletion runs under the data lock (`withStateLock` in
 * `./lock.ts`), whose release removes `.state.lock` last, so purge leaves no
 * lock file; a missing `dir` is not created (nothing is locked, and every
 * file is `alreadyMissing`), and a `dir` that is a regular file is not
 * locked either. Purging a missing directory without the lock can race a
 * writer's first-ever write into it: that is the cost of a missing
 * directory staying missing. Each is removed with `unlink`, which never recurses and removes a
 * symlink itself, not its target. Nothing else is touched: not the
 * directory, not a subdirectory, not any other file. Every entry is
 * attempted before a failure is reported, so one bad file does not leave
 * the rest behind. An empty or missing directory is fine.
 *
 * @param dir - The data directory.
 * @param options - `confirm` must be exactly `true` (an own property).
 * @param lockOptions - Optional lock tuning; real callers pass nothing or a
 * CLI timeout.
 * @returns Which managed files were deleted and which were already missing.
 * @throws MentorStateError `DATA_DIR_INVALID` (checked first) when `dir`
 * fails `assertValidDataDir`, and `CONFIRMATION_REQUIRED` unless `confirm` is
 * exactly `true` (checked before the lock; neither deletes anything);
 * `WRITE_FAILED` "could not inspect the data directory" (the `stat` error as
 * `cause`, nothing deleted, no lock taken) when `dir` cannot be inspected for
 * any reason other than not existing;
 * `LOCK_TIMEOUT` when the data lock stays held, or the lock's `WRITE_FAILED`
 * when it cannot be created (nothing deleted); one collected `WRITE_FAILED`
 * naming, as JSON-quoted base names, the entries that could not be deleted
 * (or "leftover temp files" when `dir` cannot be listed), thrown after every
 * other entry was attempted, with the fs errors as an `AggregateError`
 * `cause`.
 *
 * @example
 * ```ts
 * import { purgeData } from "./export.ts";
 * const { deleted } = await purgeData("/var/data/m3l", { confirm: true });
 * ```
 */
export async function purgeData(
  dir: string,
  options: { readonly confirm: true },
  lockOptions: LockedOptions = {},
): Promise<PurgeResult> {
  assertValidDataDir(dir);
  if (!isConfirmed(options, "confirm")) {
    throw new MentorStateError(
      "CONFIRMATION_REQUIRED",
      "purge deletes all stored mentor data; pass { confirm: true } to confirm",
    );
  }
  if (!(await isDirectory(dir))) return purgeEntries(dir);
  return withStateLock(dir, () => purgeEntries(dir), lockOptions.lock);
}

/**
 * Whether `dir` is an existing directory (following a symlink). Missing
 * (`ENOENT`, `ENOTDIR`) or a regular file is `false`: there is no data
 * directory to protect, and the lock would create one.
 *
 * @throws MentorStateError `WRITE_FAILED` (fixed message, the `stat` error as
 * `cause`) for any other `stat` failure: purge cannot tell whether there is
 * data to protect, so it deletes nothing.
 */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new MentorStateError(
      "WRITE_FAILED",
      "could not inspect the data directory",
      { cause },
    );
  }
}

/** The purge itself; see {@link purgeData}. */
async function purgeEntries(dir: string): Promise<PurgeResult> {
  const deleted: DataFile[] = [];
  const alreadyMissing: DataFile[] = [];
  const failed: string[] = [];
  const causes: unknown[] = [];
  const recordFailure = (label: string, cause: unknown): void => {
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

  let names: readonly string[] = [];
  try {
    names = await listEntries(dir);
  } catch (cause) {
    recordFailure("leftover temp files", cause);
  }
  for (const name of names.filter(isLeftover)) {
    const outcome = await unlinkEntry(path.join(dir, name));
    if (outcome.kind === "failed") {
      recordFailure(JSON.stringify(name), outcome.cause);
    }
  }

  if (failed.length > 0) {
    throw new MentorStateError(
      "WRITE_FAILED",
      `could not delete: ${failed.join(", ")}`,
      { cause: new AggregateError(causes, "purge failures") },
    );
  }
  return { deleted, alreadyMissing };
}
