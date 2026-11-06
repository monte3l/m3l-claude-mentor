/**
 * Bounded reads, atomic whole-file writes and line appends for the files in
 * the mentor's data directory. Every filesystem failure surfaces as a
 * {@link MentorStateError}; only a missing file is treated as benign.
 */
import { type DataFile } from "./paths.js";
/**
 * The largest `state.json`, `profile.json` or `catalog.json` the loaders
 * accept, in bytes (1 MiB).
 *
 * @example
 * ```ts
 * import { MAX_JSON_BYTES, readTextBounded } from "./fs-atomic.js";
 * await readTextBounded("/var/data/m3l", "state", MAX_JSON_BYTES);
 * ```
 */
export declare const MAX_JSON_BYTES = 1048576;
/**
 * The largest `goals.md` the mentor reads or writes, in bytes (64 KiB).
 *
 * @example
 * ```ts
 * import { MAX_GOALS_BYTES } from "./fs-atomic.js";
 * Buffer.byteLength("my goals") <= MAX_GOALS_BYTES; // true
 * ```
 */
export declare const MAX_GOALS_BYTES = 65536;
/**
 * How many bytes from the end of `evidence.jsonl` are read (2 MiB).
 *
 * @example
 * ```ts
 * import { EVIDENCE_TAIL_BYTES, readTailLines } from "./fs-atomic.js";
 * await readTailLines("/var/data/m3l", "evidence", EVIDENCE_TAIL_BYTES);
 * ```
 */
export declare const EVIDENCE_TAIL_BYTES = 2097152;
/**
 * The largest appended line, in bytes, counting its terminating newline.
 *
 * @example
 * ```ts
 * import { MAX_EVIDENCE_LINE_BYTES } from "./fs-atomic.js";
 * Buffer.byteLength("{}") + 1 <= MAX_EVIDENCE_LINE_BYTES; // true
 * ```
 */
export declare const MAX_EVIDENCE_LINE_BYTES = 4096;
/**
 * Reads a data file as UTF-8 text, refusing anything larger than `maxBytes`.
 * At most `maxBytes + 1` bytes are read, so a file that grows while it is
 * being read still trips the limit. Only a missing file (or directory) is
 * benign. Decoding is lenient, as befits external data: invalid UTF-8 bytes
 * become U+FFFD.
 *
 * @param dir - The data directory.
 * @param file - Which data file.
 * @param maxBytes - The largest accepted size in bytes; a non-negative safe integer.
 * @returns The text, or `null` when the file does not exist.
 * @throws MentorStateError `TOO_LARGE` when the file exceeds `maxBytes`;
 * `READ_FAILED` (with the fs error as `cause`) for any other fs failure,
 * including the path being a directory.
 * @throws RangeError when `maxBytes` is not a non-negative safe integer.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { MAX_GOALS_BYTES, readTextBounded } from "./fs-atomic.js";
 * const goals = (await readTextBounded("/var/data/m3l", "goals", MAX_GOALS_BYTES)) ?? "";
 * ```
 */
export declare function readTextBounded(dir: string, file: DataFile, maxBytes: number): Promise<string | null>;
/**
 * Replaces a data file: creates `dir` if needed (mode `0o700`), writes
 * `text` to a uniquely named temp file in the same directory (flag `wx`, mode
 * `0o600`), fsyncs and closes it, then renames it over the target. A reader
 * therefore sees either the old or the new content, never a torn file. Two
 * concurrent writers of one file are last-writer-wins; there is no locking.
 * The directory is not fsynced, so after a power loss the rename may be lost
 * and the old content remain. A read-only target is still replaced, because
 * rename permission comes from the directory. On a failure the handle is
 * closed and the temp file removed (best effort, so a cleanup error cannot
 * hide the primary one); a process killed mid-write can still leave a stale
 * `.<file>.<pid>.<uuid>.tmp` behind, which purge removes.
 *
 * @param dir - The data directory.
 * @param file - Which data file.
 * @param text - The full new content, written as UTF-8.
 * @throws MentorStateError `WRITE_FAILED` with the primary fs error as
 * `cause`.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { writeTextAtomic } from "./fs-atomic.js";
 * await writeTextAtomic("/var/data/m3l", "goals", "Learn hooks\n");
 * ```
 */
export declare function writeTextAtomic(dir: string, file: DataFile, text: string): Promise<void>;
/**
 * Appends one line plus `"\n"` to a data file (flag `a+`, mode `0o600`),
 * creating `dir` if needed (mode `0o700`). Each record is one `write` call on
 * an `O_APPEND` handle; on local Linux and macOS filesystems concurrent
 * appends land whole, but this is not guaranteed on network filesystems. When
 * the file is non-empty and its last byte is not `"\n"` (a torn record left by
 * a crash or a short write), the same `write` starts with a `"\n"` so the
 * fragment stays on its own line; otherwise no leading newline is written.
 *
 * @param dir - The data directory.
 * @param file - Which data file.
 * @param line - One line without `\n` or `\r`; its UTF-8 size plus the
 * newline must not exceed {@link MAX_EVIDENCE_LINE_BYTES}.
 * @throws MentorStateError `VALIDATION_FAILED` for a bad line (the message
 * never contains it); `WRITE_FAILED` with the fs error as `cause`. A short
 * write is reported as `WRITE_FAILED` and can leave a partial record, which
 * the next append separates with a newline, barring a concurrent torn write
 * between the tail check and the write. When `WRITE_FAILED` comes from
 * closing the handle the line may already be on disk, so a caller that
 * retries can record the event twice.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { appendLineAtomic } from "./fs-atomic.js";
 * await appendLineAtomic("/var/data/m3l", "evidence", '{"at":0}');
 * ```
 */
export declare function appendLineAtomic(dir: string, file: DataFile, line: string): Promise<void>;
/**
 * Reads the last `tailBytes` bytes of a data file and splits them into
 * lines. When the read starts after offset 0 the first line is always
 * dropped, since it may be partial (or begin inside a multibyte character).
 * Empty lines are omitted; an unterminated last line is kept.
 *
 * @param dir - The data directory.
 * @param file - Which data file.
 * @param tailBytes - How many trailing bytes to read; a positive safe integer.
 * @returns The non-empty lines in file order, or `null` when the file does
 * not exist.
 * @throws MentorStateError `READ_FAILED` with the fs error as `cause`.
 * @throws RangeError when `tailBytes` is not a positive safe integer.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { EVIDENCE_TAIL_BYTES, readTailLines } from "./fs-atomic.js";
 * const lines = (await readTailLines("/var/data/m3l", "evidence", EVIDENCE_TAIL_BYTES)) ?? [];
 * ```
 */
export declare function readTailLines(dir: string, file: DataFile, tailBytes: number): Promise<readonly string[] | null>;
//# sourceMappingURL=fs-atomic.d.ts.map