/**
 * Bounded reads, atomic whole-file writes and line appends for the files in
 * the mentor's data directory. Every filesystem failure surfaces as a
 * {@link MentorStateError}; only a missing file is treated as benign.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { MentorStateError } from "./errors.js";
import { DATA_FILES, assertValidDataDir, dataFilePath, } from "./paths.js";
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
export const MAX_JSON_BYTES = 1_048_576;
/**
 * The largest `goals.md` the mentor reads or writes, in bytes (64 KiB).
 *
 * @example
 * ```ts
 * import { MAX_GOALS_BYTES } from "./fs-atomic.js";
 * Buffer.byteLength("my goals") <= MAX_GOALS_BYTES; // true
 * ```
 */
export const MAX_GOALS_BYTES = 65_536;
/**
 * How many bytes from the end of `evidence.jsonl` are read (2 MiB).
 *
 * @example
 * ```ts
 * import { EVIDENCE_TAIL_BYTES, readTailLines } from "./fs-atomic.js";
 * await readTailLines("/var/data/m3l", "evidence", EVIDENCE_TAIL_BYTES);
 * ```
 */
export const EVIDENCE_TAIL_BYTES = 2_097_152;
/**
 * The largest appended line, in bytes, counting its terminating newline.
 *
 * @example
 * ```ts
 * import { MAX_EVIDENCE_LINE_BYTES } from "./fs-atomic.js";
 * Buffer.byteLength("{}") + 1 <= MAX_EVIDENCE_LINE_BYTES; // true
 * ```
 */
export const MAX_EVIDENCE_LINE_BYTES = 4096;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
function errorCode(error) {
    return typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
}
function readFailed(file, cause) {
    return new MentorStateError("READ_FAILED", `could not read ${DATA_FILES[file]}`, { cause });
}
function writeFailed(file, cause) {
    return new MentorStateError("WRITE_FAILED", `could not write ${DATA_FILES[file]}`, { cause });
}
function checkByteCount(value, name, min) {
    if (!Number.isSafeInteger(value) || value < min) {
        throw new RangeError(`${name} must be a safe integer of at least ${String(min)}`);
    }
}
/** Opens `file` for reading; `null` when it (or its directory) is missing. */
async function openForRead(dir, file) {
    const target = dataFilePath(dir, file);
    try {
        return await open(target, "r");
    }
    catch (cause) {
        if (errorCode(cause) === "ENOENT")
            return null;
        throw readFailed(file, cause);
    }
}
/** Fills `buffer` from `position` until it is full or the file ends. */
async function readInto(handle, buffer, position) {
    let total = 0;
    while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, position + total);
        if (bytesRead === 0)
            break;
        total += bytesRead;
    }
    return total;
}
/**
 * Closes a handle on a path that is already failing. A close error here is
 * dropped on purpose: the caller is about to throw the primary error, which
 * is the one that explains the failure.
 */
async function closeQuietly(handle) {
    try {
        await handle.close();
    }
    catch {
        // Best effort only; the primary error is re-thrown by the caller.
    }
}
/**
 * Removes a temp file on a path that is already failing. An unlink error is
 * dropped on purpose so it cannot replace the primary error.
 */
async function unlinkQuietly(target) {
    try {
        await unlink(target);
    }
    catch {
        // Best effort only; the primary error is re-thrown by the caller.
    }
}
async function ensureDir(dir, file) {
    try {
        await mkdir(dir, { recursive: true, mode: DIR_MODE });
    }
    catch (cause) {
        throw writeFailed(file, cause);
    }
}
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
export async function readTextBounded(dir, file, maxBytes) {
    assertValidDataDir(dir);
    checkByteCount(maxBytes, "maxBytes", 0);
    const handle = await openForRead(dir, file);
    if (handle === null)
        return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    let total;
    try {
        total = await readInto(handle, buffer, 0);
        await handle.close();
    }
    catch (cause) {
        await closeQuietly(handle);
        throw readFailed(file, cause);
    }
    if (total > maxBytes) {
        throw new MentorStateError("TOO_LARGE", `${DATA_FILES[file]} is larger than ${String(maxBytes)} bytes`);
    }
    return buffer.toString("utf8", 0, total);
}
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
export async function writeTextAtomic(dir, file, text) {
    assertValidDataDir(dir);
    const target = dataFilePath(dir, file);
    const temp = path.join(dir, `.${DATA_FILES[file]}.${String(process.pid)}.${randomUUID()}.tmp`);
    await ensureDir(dir, file);
    let handle;
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
    }
    catch (cause) {
        if (handle !== undefined)
            await closeQuietly(handle);
        if (created)
            await unlinkQuietly(temp);
        throw writeFailed(file, cause);
    }
}
const NEWLINE = Buffer.from("\n", "utf8");
/** Whether the file behind `handle` is non-empty and lacks a final `"\n"`. */
async function endsTorn(handle) {
    const { size } = await handle.stat();
    if (size === 0)
        return false;
    const last = Buffer.alloc(1);
    const { bytesRead } = await handle.read(last, 0, 1, size - 1);
    return bytesRead === 1 && last[0] !== NEWLINE[0];
}
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
export async function appendLineAtomic(dir, file, line) {
    assertValidDataDir(dir);
    if (typeof line !== "string" || /[\n\r]/u.test(line)) {
        throw new MentorStateError("VALIDATION_FAILED", `refusing to append to ${DATA_FILES[file]}: a line must be a string without line breaks`);
    }
    const bytes = Buffer.from(`${line}\n`, "utf8");
    if (bytes.length > MAX_EVIDENCE_LINE_BYTES) {
        throw new MentorStateError("VALIDATION_FAILED", `refusing to append to ${DATA_FILES[file]}: a line must not exceed ${String(MAX_EVIDENCE_LINE_BYTES)} bytes`);
    }
    const target = dataFilePath(dir, file);
    await ensureDir(dir, file);
    let handle;
    let payload;
    let written;
    try {
        handle = await open(target, "a+", FILE_MODE);
        const torn = await endsTorn(handle);
        payload = torn ? Buffer.concat([NEWLINE, bytes]) : bytes;
        ({ bytesWritten: written } = await handle.write(payload));
        const opened = handle;
        handle = undefined;
        await opened.close();
    }
    catch (cause) {
        if (handle !== undefined)
            await closeQuietly(handle);
        throw writeFailed(file, cause);
    }
    if (written !== payload.length) {
        throw new MentorStateError("WRITE_FAILED", `short write appending to ${DATA_FILES[file]}`);
    }
}
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
export async function readTailLines(dir, file, tailBytes) {
    assertValidDataDir(dir);
    checkByteCount(tailBytes, "tailBytes", 1);
    const handle = await openForRead(dir, file);
    if (handle === null)
        return null;
    let start;
    let bytes;
    try {
        const { size } = await handle.stat();
        start = Math.max(0, size - tailBytes);
        const buffer = Buffer.alloc(size - start);
        const total = await readInto(handle, buffer, start);
        bytes = buffer.subarray(0, total);
        await handle.close();
    }
    catch (cause) {
        await closeQuietly(handle);
        throw readFailed(file, cause);
    }
    const lines = bytes.toString("utf8").split("\n");
    if (start > 0)
        lines.shift();
    return lines.filter((line) => line.length > 0);
}
//# sourceMappingURL=fs-atomic.js.map