/**
 * One-time carry-over of the learner's data from the plugin's former name.
 * Claude Code keeps a plugin's data in `~/.claude/plugins/data/<id>/`, where
 * `<id>` is the plugin name and marketplace joined by `-`. The plugin was
 * called `m3l-claude-mentor` until 1.2.0, so a learner who installs the
 * renamed plugin starts with an empty directory next to the old one. This
 * module copies the old files across, once, and never touches the old
 * directory.
 */

import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { MentorStateError } from "./errors.ts";
import { withStateLock, type LockOptions } from "./lock.ts";
import {
  DATA_FILES,
  assertValidDataDir,
  dataFilePath,
  type DataFile,
} from "./paths.ts";

/**
 * The directory-name prefix of the current plugin id (`m3l-mentor@<market>`,
 * with every character other than a letter, digit, `_` or `-` replaced by
 * `-`).
 *
 * @example
 * ```ts
 * import { DATA_DIR_PREFIX } from "./legacy-data.ts";
 * "m3l-mentor-monte3l".startsWith(DATA_DIR_PREFIX); // true
 * ```
 */
export const DATA_DIR_PREFIX = "m3l-mentor-";

/**
 * The directory-name prefix the plugin id had until 1.2.0.
 *
 * @example
 * ```ts
 * import { LEGACY_DATA_DIR_PREFIX } from "./legacy-data.ts";
 * LEGACY_DATA_DIR_PREFIX; // "m3l-claude-mentor-"
 * ```
 */
export const LEGACY_DATA_DIR_PREFIX = "m3l-claude-mentor-";

/**
 * The file written into the new data directory when the carry-over has run,
 * so it never runs twice (a purge must not bring old data back).
 *
 * @example
 * ```ts
 * import { MIGRATION_MARKER } from "./legacy-data.ts";
 * MIGRATION_MARKER; // ".migrated-from-m3l-claude-mentor"
 * ```
 */
export const MIGRATION_MARKER = ".migrated-from-m3l-claude-mentor";

/**
 * The largest old file the carry-over copies, in bytes (32 MiB). A larger one
 * is left behind, because the SessionStart hook has a 10 second budget.
 *
 * @example
 * ```ts
 * import { MAX_LEGACY_FILE_BYTES } from "./legacy-data.ts";
 * MAX_LEGACY_FILE_BYTES; // 33554432
 * ```
 */
export const MAX_LEGACY_FILE_BYTES = 33_554_432;

/**
 * The copy order. `state.json` goes last, so a copy that stops half way never
 * leaves a state without the profile and evidence it describes.
 */
const COPY_ORDER: readonly DataFile[] = [
  "profile",
  "evidence",
  "catalog",
  "goals",
  "examItems",
  "examPending",
  "state",
];

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

/**
 * What `file` is, without following a symlink, or `null` when it does not
 * exist. Any other failure is a `READ_FAILED` with a fixed message.
 */
async function inspect(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT" || errorCode(cause) === "ENOTDIR") {
      return null;
    }
    throw new MentorStateError("READ_FAILED", "could not inspect a data path", {
      cause,
    });
  }
}

/** The size of a regular file (a symlink is not one), or `null` otherwise. */
async function regularFileSize(file: string): Promise<number | null> {
  const info = await inspect(file);
  return info?.isFile() === true ? info.size : null;
}

/** Whether `file` is a regular file. */
async function exists(file: string): Promise<boolean> {
  return (await regularFileSize(file)) !== null;
}

/** Whether `dir` exists and is a real directory (not a symlink). */
async function isRealDirectory(dir: string): Promise<boolean> {
  return (await inspect(dir))?.isDirectory() === true;
}

/**
 * The data directory the plugin used under its former name, next to `dir`,
 * or `null` when `dir` is not named after the current plugin id. The old
 * name is the same directory name with `m3l-mentor-` replaced by
 * `m3l-claude-mentor-`, so the marketplace part is kept.
 *
 * @param dir - The current data directory.
 * @returns The sibling directory path, or `null`.
 *
 * @example
 * ```ts
 * import { legacyDataDir } from "./legacy-data.ts";
 * legacyDataDir("/home/a/.claude/plugins/data/m3l-mentor-monte3l");
 * // "/home/a/.claude/plugins/data/m3l-claude-mentor-monte3l"
 * legacyDataDir("/tmp/anything"); // null
 * ```
 */
export function legacyDataDir(dir: string): string | null {
  const resolved = path.resolve(dir);
  const base = path.basename(resolved);
  if (!base.startsWith(DATA_DIR_PREFIX) || base === DATA_DIR_PREFIX) {
    return null;
  }
  return path.join(
    path.dirname(resolved),
    LEGACY_DATA_DIR_PREFIX + base.slice(DATA_DIR_PREFIX.length),
  );
}

/**
 * Copies one old file into `dir` when `dir` has no such file: to a temp file
 * first, then hard-linked into place, so the target appears whole or not at
 * all and an existing file is never replaced.
 */
async function copyOne(
  legacy: string,
  dir: string,
  file: DataFile,
): Promise<boolean> {
  const source = dataFilePath(legacy, file);
  const size = await regularFileSize(source);
  if (size === null || size > MAX_LEGACY_FILE_BYTES) return false;
  const target = dataFilePath(dir, file);
  if ((await regularFileSize(target)) !== null) return false;
  const temp = path.join(
    dir,
    `.${DATA_FILES[file]}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await copyFile(source, temp, constants.COPYFILE_EXCL);
    await chmod(temp, 0o600);
    await link(temp, target);
    return true;
  } catch (cause) {
    if (errorCode(cause) === "EEXIST" && (await exists(target))) return false;
    throw new MentorStateError(
      "WRITE_FAILED",
      "could not carry a data file over",
      {
        cause,
      },
    );
  } finally {
    try {
      await unlink(temp);
    } catch {
      // The temp file may not exist (the copy failed first); nothing to do.
    }
  }
}

/** Writes the marker. Writing it twice is harmless, so there is no race to guard. */
async function writeMarker(dir: string): Promise<void> {
  try {
    await writeFile(path.join(dir, MIGRATION_MARKER), "migrated\n", {
      mode: 0o600,
    });
  } catch (cause) {
    throw new MentorStateError(
      "WRITE_FAILED",
      "could not record the carry-over",
      { cause },
    );
  }
}

/**
 * Carries the learner's data over from the former plugin name, once. When
 * `dir` is named after the current plugin id, the sibling directory of the
 * former id exists, and the carry-over has not run, it copies every managed
 * data file the new directory does not have yet (never replacing one, never
 * following a symlink, skipping anything above {@link MAX_LEGACY_FILE_BYTES}),
 * `state.json` last, and then writes {@link MIGRATION_MARKER}. The old
 * directory is only read. The copy runs under the data lock, so two sessions
 * starting together copy once. After the first run the cost is one `lstat`
 * of the marker, and with no old directory, one more.
 *
 * Nothing here is logged and no content is read into memory: files are copied
 * as bytes by the operating system.
 *
 * @param dir - The current data directory.
 * @param lock - Lock tuning, a test seam.
 * @returns The files that were copied, in copy order; empty when there was
 * nothing to do.
 * @throws MentorStateError `READ_FAILED` or `WRITE_FAILED` (fixed text, the
 * fs error as `cause`), `LOCK_TIMEOUT` when another session holds the lock.
 * The caller decides how to degrade; a failure leaves the marker unwritten,
 * so the next session tries again.
 * @throws MentorStateError `DATA_DIR_INVALID` when `dir` fails
 * {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { migrateLegacyData } from "./legacy-data.ts";
 * const copied = await migrateLegacyData("/data/m3l-mentor-monte3l");
 * copied; // ["profile", "evidence", "state"] on the first session, [] after
 * ```
 */
export async function migrateLegacyData(
  dir: string,
  lock: LockOptions = {},
): Promise<readonly DataFile[]> {
  assertValidDataDir(dir);
  const legacy = legacyDataDir(dir);
  if (legacy === null) return [];
  const marker = path.join(dir, MIGRATION_MARKER);
  if (await exists(marker)) return [];
  if (!(await isRealDirectory(legacy))) return [];
  return withStateLock(
    dir,
    async () => {
      if (await exists(marker)) return [];
      const copied: DataFile[] = [];
      for (const file of COPY_ORDER) {
        if (await copyOne(legacy, dir, file)) copied.push(file);
      }
      await writeMarker(dir);
      return copied;
    },
    lock,
  );
}
