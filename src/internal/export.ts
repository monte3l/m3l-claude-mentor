/**
 * Export, import, show and purge for the mentor's data directory (design
 * sections 10 and 13): moving a profile between machines, and showing or
 * deleting everything the mentor stores. Import and purge replace or delete
 * user data, so both demand an explicit `true` confirmation, and import
 * validates the whole bundle before it changes a single file.
 */

import { randomUUID } from "node:crypto";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { serializeCatalogFile } from "./catalog-file.js";
import { MentorStateError } from "./errors.js";
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MAX_BUNDLE_BYTES,
  checkNow,
  isConfirmed,
  jsonText,
  parseBundle,
  serializeBundle,
  type Bundle,
} from "./export-bundle.js";
import { writeTextAtomic } from "./fs-atomic.js";
import {
  DATA_FILES,
  assertValidDataDir,
  dataFilePath,
  type DataFile,
} from "./paths.js";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  readEvidence,
} from "./store.js";

export {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MAX_BUNDLE_BYTES,
  parseBundle,
  serializeBundle,
  type Bundle,
} from "./export-bundle.js";
export {
  describeData,
  purgeData,
  type DataFileInfo,
  type DataSummary,
  type PurgeResult,
} from "./purge.js";

/** Every managed file, in {@link DATA_FILES} order. */
const MANAGED_FILES = Object.keys(DATA_FILES) as readonly DataFile[];

/** The order import replaces files in: `state` last, as hooks read it first. */
const IMPORT_ORDER: readonly DataFile[] = [
  "evidence",
  "goals",
  "catalog",
  "profile",
  "state",
];

const FILE_MODE = 0o600;

/** A UTF-8 byte order mark, as decoded; stripped before parsing an import. */
const BOM = "\uFEFF";

/** Validates a caller-supplied file path; the message never echoes it. */
function checkAbsolutePath(value: unknown, what: string): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `${what} must be an absolute path without NUL characters`,
    );
  }
  return path.resolve(value);
}

/**
 * Closes a handle on a path that is already failing. A close error is
 * dropped on purpose: the caller throws the primary error instead.
 */
async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // Best effort only; the primary error is re-thrown by the caller.
  }
}

/**
 * Removes a temp file on a path that is already failing. An unlink error is
 * dropped on purpose so it cannot replace the primary error.
 */
async function unlinkQuietly(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch {
    // Best effort only; the primary error is re-thrown by the caller.
  }
}

/** Fills `buffer` from the start of the file until it is full or the file ends. */
async function readInto(handle: FileHandle, buffer: Buffer): Promise<number> {
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.length - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return total;
}

/**
 * Reads at most `MAX_BUNDLE_BYTES + 1` bytes of the import file. A missing
 * file is an error here, never an empty import.
 */
async function readBundleFile(source: string): Promise<string> {
  const buffer = Buffer.alloc(MAX_BUNDLE_BYTES + 1);
  let handle: FileHandle | undefined;
  let total: number;
  try {
    handle = await open(source, "r");
    total = await readInto(handle, buffer);
    const opened = handle;
    handle = undefined;
    await opened.close();
  } catch (cause) {
    if (handle !== undefined) await closeQuietly(handle);
    throw new MentorStateError(
      "READ_FAILED",
      "could not read the import file",
      {
        cause,
      },
    );
  }
  if (total > MAX_BUNDLE_BYTES) {
    throw new MentorStateError(
      "TOO_LARGE",
      `the import file is larger than ${String(MAX_BUNDLE_BYTES)} bytes`,
    );
  }
  return buffer.toString("utf8", 0, total);
}

/**
 * Writes `text` to `target` through a uniquely named temp file in the same
 * directory (flag `wx`, mode `0o600`), fsynced, closed and renamed over the
 * target, as `writeTextAtomic` does for the data files. The parent directory
 * is not created.
 */
async function writeFileAtomic(target: string, text: string): Promise<void> {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(temp, "wx", FILE_MODE);
    created = true;
    await handle.writeFile(text, "utf8");
    await handle.sync();
    const opened = handle;
    handle = undefined;
    await opened.close();
    await rename(temp, target);
  } catch (cause) {
    if (handle !== undefined) await closeQuietly(handle);
    if (created) await unlinkQuietly(temp);
    throw new MentorStateError(
      "WRITE_FAILED",
      "could not write the export file",
      { cause },
    );
  }
}

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

/** Loads, validates and serializes the export, refusing an oversized one. */
async function buildExport(
  dir: string,
  now: number,
): Promise<ExportResult & { readonly text: string }> {
  const state = await loadState(dir, now);
  const profile = await loadProfile(dir, now);
  const catalog = await loadCatalogFile(dir);
  const goals = await loadGoals(dir);
  const { events, skipped } = await readEvidence(dir);
  const parsed = parseBundle({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: now,
    state,
    profile,
    catalog: serializeCatalogFile(catalog),
    goals,
    evidence: events,
  });
  if (!parsed.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `the stored data would not import: ${parsed.reason}`,
    );
  }
  const text = serializeBundle(parsed.value);
  if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES) {
    throw new MentorStateError(
      "TOO_LARGE",
      `the export is larger than ${String(MAX_BUNDLE_BYTES)} bytes and could not be imported`,
    );
  }
  return { bundle: parsed.value, evidenceSkipped: skipped, text };
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
export async function exportBundle(
  dir: string,
  now: number,
): Promise<ExportResult> {
  assertValidDataDir(dir);
  checkNow(now);
  const { bundle, evidenceSkipped } = await buildExport(dir, now);
  return { bundle, evidenceSkipped };
}

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
export async function exportBundleToFile(
  dir: string,
  now: number,
  targetPath: string,
): Promise<{ readonly evidenceSkipped: number }> {
  assertValidDataDir(dir);
  checkNow(now);
  const target = checkAbsolutePath(targetPath, "the export target");
  const folded = target.toLowerCase();
  for (const file of MANAGED_FILES) {
    if (path.resolve(dataFilePath(dir, file)).toLowerCase() === folded) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "the export target must not be one of the mentor's data files",
      );
    }
  }
  const { evidenceSkipped, text } = await buildExport(dir, now);
  await writeFileAtomic(target, text);
  return { evidenceSkipped };
}

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

function requireReplace(options: unknown): void {
  if (!isConfirmed(options, "replace")) {
    throw new MentorStateError(
      "CONFIRMATION_REQUIRED",
      "import replaces all stored mentor data; pass { replace: true } to confirm",
    );
  }
}

function invalidBundle(reason: string): MentorStateError {
  return new MentorStateError(
    "IMPORT_INVALID",
    `the import bundle is invalid: ${reason}`,
  );
}

/** Every file's new content, built before anything is written. */
function fileTexts(bundle: Bundle): Readonly<Record<DataFile, string>> {
  return {
    evidence: bundle.evidence
      .map((event) => jsonText(event, "an evidence event", 0))
      .join(""),
    goals: bundle.goals,
    catalog: jsonText(serializeCatalogFile(bundle.catalog), "the catalog", 2),
    profile: jsonText(bundle.profile, "the profile", 2),
    state: jsonText(bundle.state, "the state", 2),
  };
}

/**
 * Replaces every managed file from an already-validated bundle, in
 * {@link IMPORT_ORDER}. Each file (the evidence log included) is written to
 * a temp file and renamed, so the old log is replaced, never appended to.
 */
async function replaceAll(dir: string, bundle: Bundle): Promise<ImportSummary> {
  const texts = fileTexts(bundle);
  const replaced: DataFile[] = [];
  for (const file of IMPORT_ORDER) {
    try {
      await writeTextAtomic(dir, file, texts[file]);
    } catch (cause) {
      const done = replaced.length === 0 ? "none" : replaced.join(", ");
      throw new MentorStateError(
        "WRITE_FAILED",
        `import stopped writing ${DATA_FILES[file]}; sections already replaced: ${done}`,
        { cause },
      );
    }
    replaced.push(file);
  }
  return {
    state: true,
    profile: true,
    catalog: true,
    goals: true,
    evidenceEvents: bundle.evidence.length,
  };
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
export async function importBundle(
  dir: string,
  bundle: Bundle,
  options: { readonly replace: boolean },
): Promise<ImportSummary> {
  assertValidDataDir(dir);
  requireReplace(options);
  const parsed = parseBundle(bundle);
  if (!parsed.ok) throw invalidBundle(parsed.reason);
  return replaceAll(dir, parsed.value);
}

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
export async function importBundleFromFile(
  dir: string,
  sourcePath: string,
  options: { readonly replace: boolean },
): Promise<ImportSummary> {
  assertValidDataDir(dir);
  requireReplace(options);
  const source = checkAbsolutePath(sourcePath, "the import file");
  const text = await readBundleFile(source);
  let raw: unknown;
  try {
    raw = JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
  } catch {
    // Deliberately no `cause`: the SyntaxError message quotes file content.
    throw new MentorStateError(
      "IMPORT_INVALID",
      "the import file is not valid JSON",
    );
  }
  const parsed = parseBundle(raw);
  if (!parsed.ok) throw invalidBundle(parsed.reason);
  return replaceAll(dir, parsed.value);
}
