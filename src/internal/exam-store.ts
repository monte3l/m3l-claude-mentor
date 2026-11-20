/**
 * Loading and saving the exam practice files: the append-only
 * `exam-items.jsonl` log and the in-flight `exam-pending.json`. Mirrors the
 * evidence and state helpers in `./store.ts`: a missing file is benign,
 * every other failure is a {@link MentorStateError} whose message names the
 * file but never contains its content.
 */

import { MentorStateError } from "./errors.ts";
import {
  MAX_EXAM_ITEMS,
  MAX_EXAM_ITEM_LINE_BYTES,
  parseExamItem,
  parsePendingExam,
  type ExamItem,
  type PendingExam,
} from "./exam-schema.ts";
import {
  appendLineAtomic,
  readTailLines,
  readTextBounded,
  removeDataFile,
  writeTextAtomic,
} from "./fs-atomic.ts";
import { DATA_FILES, assertValidDataDir } from "./paths.ts";

/** How many bytes from the end of `exam-items.jsonl` are read (1 MiB). */
const EXAM_ITEMS_TAIL_BYTES = 1_048_576;

/** The largest `exam-pending.json` accepted, in bytes (64 KiB). */
const MAX_PENDING_BYTES = 65_536;

function refuseAppend(reason: string): MentorStateError {
  return new MentorStateError(
    "VALIDATION_FAILED",
    `refusing to append to ${DATA_FILES.examItems}: ${reason}`,
  );
}

/**
 * Re-validates `item` with {@link parseExamItem} and appends the parsed copy
 * (only the ten typed fields, so no question text can be smuggled in) as one
 * JSON line to `exam-items.jsonl`, created with mode `0o600`. A torn last
 * line left by a crash is closed off first, as `appendLineAtomic`
 * (`./fs-atomic.ts`) does.
 * This function does not take the data lock (`withStateLock` in
 * `./lock.ts`); a caller that can race an import or a purge must hold it.
 * Unlocked, the race is real: an append that lands while an import
 * renames a new log into place, or while a purge deletes it, can be lost
 * or can land in the data that replaced the learner's.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param item - The answered item to record.
 * @throws MentorStateError `VALIDATION_FAILED` for an invalid item or a line
 * longer than {@link MAX_EXAM_ITEM_LINE_BYTES} with its newline (nothing is
 * written); `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { parseExamItem } from "./exam-schema.ts";
 * import { appendExamItem } from "./exam-store.ts";
 * const r = parseExamItem({
 *   v: 1, track: "CCAR-F", domain: "D1", objective: "D1.2", topic: "plan-mode",
 *   kind: "single", mode: "drill", correct: true, at: Date.now(), session: "sess-1",
 * });
 * if (r.ok) await appendExamItem("/var/data/m3l", r.value);
 * ```
 */
export async function appendExamItem(
  dir: string,
  item: ExamItem,
): Promise<void> {
  assertValidDataDir(dir);
  const parsed = parseExamItem(item);
  if (!parsed.ok) throw refuseAppend(parsed.reason);
  const line: unknown = JSON.stringify(parsed.value);
  if (typeof line !== "string") {
    throw refuseAppend("the item does not serialize to JSON");
  }
  if (Buffer.byteLength(line, "utf8") + 1 > MAX_EXAM_ITEM_LINE_BYTES) {
    throw refuseAppend(
      `a line must not exceed ${String(MAX_EXAM_ITEM_LINE_BYTES)} bytes`,
    );
  }
  await appendLineAtomic(dir, "examItems", line);
}

/**
 * The result of {@link readExamItems}.
 *
 * @example
 * ```ts
 * import { readExamItems, type ExamItemsRead } from "./exam-store.ts";
 * const read: ExamItemsRead = await readExamItems("/var/data/m3l");
 * ```
 */
export interface ExamItemsRead {
  /** The last valid items, oldest first (file order). */
  readonly items: readonly ExamItem[];
  /** How many lines were malformed, oversized or invalid. */
  readonly skipped: number;
}

function parseExamLine(line: string): ExamItem | null {
  if (Buffer.byteLength(line, "utf8") + 1 > MAX_EXAM_ITEM_LINE_BYTES) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    // A malformed line is external data: counted as skipped, never echoed.
    return null;
  }
  const parsed = parseExamItem(raw);
  return parsed.ok ? parsed.value : null;
}

/**
 * Reads the most recent exam items from the last 1 MiB of
 * `exam-items.jsonl`. A line that is not JSON, fails {@link parseExamItem},
 * or is longer than {@link MAX_EXAM_ITEM_LINE_BYTES} with its newline is not
 * an error: it is counted in `skipped`, and its text is never returned or
 * thrown. Never creates the data directory.
 *
 * @param dir - The data directory.
 * @param options - `maxItems`: how many of the last valid items to keep; an
 * integer from 1 to {@link MAX_EXAM_ITEMS} (the default).
 * @returns The last `maxItems` valid items in file order and the skipped
 * count; `{ items: [], skipped: 0 }` when the file is missing.
 * @throws RangeError when `maxItems` is invalid (checked before any I/O).
 * @throws MentorStateError `READ_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { readExamItems } from "./exam-store.ts";
 * const { items, skipped } = await readExamItems("/var/data/m3l", { maxItems: 100 });
 * ```
 */
export async function readExamItems(
  dir: string,
  options?: { readonly maxItems?: number },
): Promise<ExamItemsRead> {
  assertValidDataDir(dir);
  const maxItems = options?.maxItems ?? MAX_EXAM_ITEMS;
  if (
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > MAX_EXAM_ITEMS
  ) {
    throw new RangeError(
      `maxItems must be an integer from 1 to ${String(MAX_EXAM_ITEMS)}`,
    );
  }
  const lines = await readTailLines(dir, "examItems", EXAM_ITEMS_TAIL_BYTES);
  if (lines === null) return { items: [], skipped: 0 };
  const items: ExamItem[] = [];
  let skipped = 0;
  for (const line of lines) {
    const item = parseExamLine(line);
    if (item === null) skipped += 1;
    else items.push(item);
  }
  return { items: items.slice(-maxItems), skipped };
}

/**
 * Loads `exam-pending.json`. Expiry is not checked here: callers decide with
 * `isPendingExpired` (`./exam-schema.ts`). Never creates the data directory.
 *
 * @param dir - The data directory.
 * @returns The pending exam, or `null` when the file is missing.
 * @throws MentorStateError `READ_FAILED`, `TOO_LARGE` (beyond 64 KiB),
 * `PARSE_FAILED` (no `cause`, the message never quotes the file) or
 * `VALIDATION_FAILED`.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { loadPending } from "./exam-store.ts";
 * const pending = await loadPending("/var/data/m3l");
 * ```
 */
export async function loadPending(dir: string): Promise<PendingExam | null> {
  assertValidDataDir(dir);
  const text = await readTextBounded(dir, "examPending", MAX_PENDING_BYTES);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Deliberately no `cause`: the SyntaxError message quotes file content.
    throw new MentorStateError(
      "PARSE_FAILED",
      `${DATA_FILES.examPending} is not valid JSON`,
    );
  }
  const parsed = parsePendingExam(raw);
  if (!parsed.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `${DATA_FILES.examPending} is invalid: ${parsed.reason}`,
    );
  }
  return parsed.value;
}

/**
 * Validates `pending` and writes the parsed copy (keys sorted, extra fields
 * dropped) atomically to `exam-pending.json` (mode `0o600`), replacing any
 * previous pending exam.
 * This function does not take the data lock (`withStateLock` in
 * `./lock.ts`); a caller that can race an import or a purge must hold it.
 * Unlocked, the race is real: a save that lands just after an import or
 * a purge removed `exam-pending.json` recreates a pending exam whose answer
 * key belongs to the replaced or deleted data. A caller doing a
 * read-modify-write takes the lock around the whole sequence too.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param pending - The pending exam to persist.
 * @throws MentorStateError `VALIDATION_FAILED` ("refusing to write ...")
 * without touching the file; `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { parsePendingExam } from "./exam-schema.ts";
 * import { savePending } from "./exam-store.ts";
 * const r = parsePendingExam({
 *   v: 1, track: "CCAR-F", mode: "drill", createdAt: Date.now(),
 *   items: [{ objective: "D1.2", topic: "plan-mode", kind: "single", key: ["B"] }],
 * });
 * if (r.ok) await savePending("/var/data/m3l", r.value);
 * ```
 */
export async function savePending(
  dir: string,
  pending: PendingExam,
): Promise<void> {
  assertValidDataDir(dir);
  const parsed = parsePendingExam(pending);
  if (!parsed.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `refusing to write ${DATA_FILES.examPending}: ${parsed.reason}`,
    );
  }
  // A parsed pending exam is plain data, so JSON.stringify returns a string.
  const text = JSON.stringify(parsed.value, null, 2);
  await writeTextAtomic(dir, "examPending", `${text}\n`);
}

/**
 * Deletes `exam-pending.json`. Idempotent: a missing file or data directory
 * is not an error, and the directory is never created. The exam log is not
 * touched.
 * This function does not take the data lock (`withStateLock` in
 * `./lock.ts`); a caller that can race an import or a purge must hold it.
 * Unlocked, the race is real: a clear that interleaves with an import
 * or a purge can remove a pending exam another caller just wrote.
 *
 * @param dir - The data directory.
 * @throws MentorStateError `WRITE_FAILED` with the fs error as `cause` when
 * the file exists but cannot be removed.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { clearPending } from "./exam-store.ts";
 * await clearPending("/var/data/m3l");
 * ```
 */
export async function clearPending(dir: string): Promise<void> {
  assertValidDataDir(dir);
  await removeDataFile(dir, "examPending");
}
