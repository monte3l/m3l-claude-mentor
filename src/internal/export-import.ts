/**
 * The replace phase of an import (design section 10): stages every file of
 * an already-validated bundle, then renames them into place under the data
 * lock and removes the pending exam. Validation and confirmation live in
 * `./export.ts`, which is the public entry point.
 */

import { unlink } from "node:fs/promises";
import { serializeCatalogFile } from "./catalog-file.ts";
import { MentorStateError } from "./errors.ts";
import { jsonText, type Bundle } from "./export-bundle.ts";
import {
  removeDataFile,
  stageTextAtomic,
  type StagedText,
} from "./fs-atomic.ts";
import { withStateLock, type LockedOptions } from "./lock.ts";
import { DATA_FILES, type DataFile } from "./paths.ts";

/**
 * The order import replaces files in: `state` last, as hooks read it first.
 * `examItems` is replaced only when the bundle carries the section, and
 * `examPending` is never imported (a replace-import removes it after these).
 */
const IMPORT_ORDER: readonly DataFile[] = [
  "evidence",
  "goals",
  "catalog",
  "examItems",
  "profile",
  "state",
];

/**
 * What an import replaced.
 *
 * @example
 * ```ts
 * import { importBundle, type ImportSummary } from "./export.ts";
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
  /**
   * How many items the exam log holds after the import when the bundle
   * carried `examItems` (`0` for an empty section); `null` when the section
   * was absent and the stored log was kept.
   */
  readonly examItems: number | null;
}

/**
 * Removes a file on a path that is already failing (a temp file that will
 * never be committed). An unlink error is dropped on purpose so it cannot
 * replace the primary error.
 *
 * @param target - The file to remove.
 *
 * @example
 * ```ts
 * import { unlinkQuietly } from "./export-import.ts";
 * await unlinkQuietly("/var/data/m3l/.state.json.123.tmp");
 * ```
 */
export async function unlinkQuietly(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch {
    // Best effort only; the primary error is re-thrown by the caller.
  }
}

/**
 * Every imported file's new content, built before anything is written. The
 * exam log has an entry only when the bundle carries `examItems` (`""` for
 * an empty section); there is never an entry for `examPending`.
 */
function fileTexts(
  bundle: Bundle,
): Partial<Readonly<Record<DataFile, string>>> {
  return {
    ...(bundle.examItems === undefined
      ? {}
      : {
          examItems: bundle.examItems
            .map((item) => jsonText(item, "an exam item", 0))
            .join(""),
        }),
    evidence: bundle.evidence
      .map((event) => jsonText(event, "an evidence event", 0))
      .join(""),
    goals: bundle.goals,
    catalog: jsonText(serializeCatalogFile(bundle.catalog), "the catalog", 2),
    profile: jsonText(bundle.profile, "the profile", 2),
    state: jsonText(bundle.state, "the state", 2),
  };
}

function importStopped(
  file: DataFile,
  replaced: readonly DataFile[],
  cause: unknown,
  action: "writing" | "removing" = "writing",
): MentorStateError {
  const done = replaced.length === 0 ? "none" : replaced.join(", ");
  return new MentorStateError(
    "WRITE_FAILED",
    `import stopped ${action} ${DATA_FILES[file]}; sections already replaced: ${done}`,
    { cause },
  );
}

/** One data file staged for import. */
interface StagedFile {
  readonly file: DataFile;
  readonly staged: StagedText;
}

/** Removes staged temp files that will never be committed (best effort). */
async function discardStaged(files: readonly StagedFile[]): Promise<void> {
  for (const { staged } of files) await unlinkQuietly(staged.temp);
}

/**
 * Stages every file in {@link IMPORT_ORDER} that has new content in `texts`
 * (files without an entry are left as they are). A failure discards
 * whatever was staged, so no managed file has changed and no temp file is
 * left behind.
 */
async function stageAll(
  dir: string,
  texts: Partial<Readonly<Record<DataFile, string>>>,
): Promise<readonly StagedFile[]> {
  const staged: StagedFile[] = [];
  for (const file of IMPORT_ORDER) {
    const text = texts[file];
    if (text === undefined) continue;
    try {
      staged.push({
        file,
        staged: await stageTextAtomic(dir, file, text),
      });
    } catch (cause) {
      await discardStaged(staged);
      throw importStopped(file, [], cause);
    }
  }
  return staged;
}

/**
 * Renames every staged file over its target, in {@link IMPORT_ORDER}, then
 * removes the pending exam (idempotent when it is absent).
 */
async function commitAll(
  dir: string,
  files: readonly StagedFile[],
): Promise<void> {
  const replaced: DataFile[] = [];
  for (const { file, staged } of files) {
    try {
      await staged.commit();
    } catch (cause) {
      throw importStopped(file, replaced, cause);
    }
    replaced.push(file);
  }
  try {
    await removeDataFile(dir, "examPending");
  } catch (cause) {
    throw importStopped("examPending", replaced, cause, "removing");
  }
}

/**
 * Replaces the managed files from an already-validated bundle in two
 * phases (the exam log only when the bundle carries `examItems`; never the
 * pending exam, which is removed after the renames). First every file (the evidence and exam logs included, so an
 * old log is replaced, never appended to) is staged to a fsynced temp file WITHOUT the
 * data lock: the temps are private until renamed, and an import replaces the
 * data wholesale, so nothing staged depends on what is stored. Only the
 * renames, in {@link IMPORT_ORDER}, run under the lock; that keeps the lock
 * short, so a large bundle on a slow disk cannot hold it across slow fsyncs
 * for longer than the stale window. A staging failure changes nothing. If
 * the lock cannot be taken, or a rename fails (a temp that vanished before
 * its commit, say to a purge sweep, included), every temp not yet renamed is
 * removed; a rename failure leaves the sections before it replaced, and a
 * failure to remove the pending exam leaves every section replaced.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param bundle - A bundle already validated by `parseBundle`.
 * @param options - Lock tuning passed to `withStateLock`.
 * @returns The {@link ImportSummary}.
 * @throws MentorStateError `VALIDATION_FAILED` when a section does not
 * serialize; `LOCK_TIMEOUT`; `WRITE_FAILED` naming the file that failed and
 * the sections already replaced.
 *
 * @example
 * ```ts
 * import { replaceAll } from "./export-import.ts";
 * const summary = await replaceAll("/var/data/m3l", parsedBundle, {});
 * ```
 */
export async function replaceAll(
  dir: string,
  bundle: Bundle,
  options: LockedOptions,
): Promise<ImportSummary> {
  const files = await stageAll(dir, fileTexts(bundle));
  try {
    await withStateLock(dir, () => commitAll(dir, files), options.lock);
  } catch (error) {
    // Already-renamed temps are gone, so this removes only the rest.
    await discardStaged(files);
    throw error;
  }
  return {
    state: true,
    profile: true,
    catalog: true,
    goals: true,
    evidenceEvents: bundle.evidence.length,
    examItems: bundle.examItems?.length ?? null,
  };
}
